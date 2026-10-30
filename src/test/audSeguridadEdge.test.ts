// Auditoría de cierre (grupo seguridad): reglas que deben cumplir TODAS las funciones Edge.
// Se leen los fuentes reales de supabase/functions y supabase/config.toml; una función nueva que
// rompa una regla hace fallar esta prueba. Ver docs/iatos/cierre/SEGURIDAD.md.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isPaidBucket } from "../../supabase/functions/_shared/rate-limit-core";
import { canWritePackingList, loadPromptContext, vaultSummary } from "../../supabase/functions/generar-packing-list/access";
import { tripIdForTracking } from "../../supabase/functions/track-flight/rules";

const FN_DIR = join(__dirname, "../../supabase/functions");
const CONFIG = readFileSync(join(__dirname, "../../supabase/config.toml"), "utf8");
const functions = readdirSync(FN_DIR).filter((d) => d !== "_shared" && statSync(join(FN_DIR, d)).isDirectory()).sort();
const sourceOf = (fn: string) =>
  readdirSync(join(FN_DIR, fn)).filter((f) => f.endsWith(".ts") && !f.includes(".test."))
    .map((f) => readFileSync(join(FN_DIR, fn, f), "utf8")).join("\n");
const verifyJwt = (fn: string): boolean | undefined => {
  const m = new RegExp(`\\[functions\\.${fn.replace(/-/g, "\\-")}\\]\\s*\\n\\s*verify_jwt\\s*=\\s*(true|false)`).exec(CONFIG);
  return m ? m[1] === "true" : undefined;
};

// Puertas propias de las funciones públicas (verify_jwt = false), revisadas una por una.
const PUBLIC_GATES: Record<string, RegExp> = {
  "stripe-webhook": /constructEventAsync|constructEvent/,      // firma de Stripe
  "reservations-inbound": /handleInbound\([\s\S]*verifySvixSignature\(headers/, // firma Svix (Resend Receiving)
  "booking-go": /verifyRedirect\(/,                             // enlace firmado HMAC
  "ai-reservations": /getAuthUser[\s\S]*icsForLink|icsForLink[\s\S]*getAuthUser/, // JWT en POST, firma en el .ics
  "reclamos-inbound": /handleInbound\([\s\S]*verifySvixSignature\(headers/, // firma Svix propia (RECLAMOS_INBOUND_SECRET)
  // Secreto del webhook de Telegram (X-Telegram-Bot-Api-Secret-Token, comparación en tiempo constante); sin token → 503.
  // Avisos de proveedores (comisiones): firma HMAC de RateHawk en tiempo constante + token de un solo uso; otro proveedor → 404.
  "proveedores-webhook": /FIRMA_INVALIDA[\s\S]*provider_webhook_token_once[\s\S]*manejarWebhook\(new URL[\s\S]*igualSeguro\(esperada/,
  "telegram-webhook": /TELEGRAM_OFF[\s\S]*parseInbound!?\(req\)[\s\S]*INVALID_SECRET[\s\S]*sameSecret\(req\.headers\.get\("x-telegram-bot-api-secret-token"\)/,
  // WhatsApp: apagado sin secretos (503); firma de Meta (X-Hub-Signature-256) o de Twilio (X-Twilio-Signature) antes de leer nada.
  "whatsapp-webhook": /WHATSAPP_OFF[\s\S]*verifyMetaSignature\(req\.headers\.get\("x-hub-signature-256"\)[\s\S]*INVALID_SIGNATURE[\s\S]*verifyTwilioSignature\(req\.headers\.get\("x-twilio-signature"\)[\s\S]*INVALID_SIGNATURE/,
  // Voz (Vapi): apagado sin VOZ_WEBHOOK_SECRET (503); encabezado x-iatos-voz firmado y atado al caso.
  "voz-webhook": /VOZ_OFF[\s\S]*verificarFirmaLlamada\(req\.headers\.get\("x-iatos-voz"\)[\s\S]*INVALID_SIGNATURE/,
};
// Consumen APIs de pago (IA, Google, SerpApi, Pexels, Travelpayouts, correo).
const PAID_CALL = /connector-gateway\.lovable\.dev|aiFetch|ai\.gateway\.lovable|callClaude|serpapi|googleTransportFor|api\.pexels|travelpayouts|sendEmail\(/;

describe("funciones Edge: autenticación (config.toml vs código)", () => {
  it("todas las funciones (64 al cierre) están declaradas en config.toml", () => {
    expect(functions.length).toBeGreaterThanOrEqual(64);
    expect(functions.filter((f) => verifyJwt(f) === undefined)).toEqual([]);
  });

  it("toda función pública (verify_jwt = false) tiene su propia puerta que falla cerrada", () => {
    const sinPuerta = functions.filter((f) => verifyJwt(f) === false).filter((f) => {
      const src = sourceOf(f) + (f === "reservations-inbound" || f === "ai-reservations"
        ? readFileSync(join(FN_DIR, "_shared/ai-reservations/service.ts"), "utf8") : "")
        + (f === "reclamos-inbound" ? readFileSync(join(FN_DIR, "_shared/derechos/servicio.ts"), "utf8") : "")
        + (f === "telegram-webhook" ? readFileSync(join(FN_DIR, "_shared/channels/telegram.ts"), "utf8") : "")
        + (f === "proveedores-webhook" ? readFileSync(join(FN_DIR, "_shared/proveedores/ratehawk.ts"), "utf8") : "")
        + (f === "booking-go" ? readdirSync(join(FN_DIR, "_shared/booking")).map((x) => readFileSync(join(FN_DIR, "_shared/booking", x), "utf8")).join("\n") : "");
      return PUBLIC_GATES[f] ? !PUBLIC_GATES[f].test(src) : !/isAuthorizedCron\(req\)/.test(src);
    });
    expect(sinPuerta).toEqual([]);
  });

  it("toda función con verify_jwt = true valida además al usuario dentro del código", () => {
    const sinUsuario = functions.filter((f) => verifyJwt(f) === true)
      .filter((f) => !/getAuthUser\(|auth\.getUser\(/.test(sourceOf(f)));
    expect(sinUsuario).toEqual([]);
  });
});

describe("funciones Edge: costo (AUD-SEG-02)", () => {
  it("toda función de usuario que llama una API de pago aplica enforceRateLimit", () => {
    const sinLimite = functions.filter((f) => verifyJwt(f) === true)
      .filter((f) => PAID_CALL.test(sourceOf(f)) && !/enforceRateLimit\(/.test(sourceOf(f)));
    expect(sinLimite).toEqual([]);
  });

  it("mark-visited (Google Places Details) está en las cubetas de pago: si el límite no se puede verificar, se niega", () => {
    expect(isPaidBucket("mark-visited")).toBe(true);
    expect(sourceOf("mark-visited")).toMatch(/enforceRateLimit\(req, "mark-visited", user_id/);
  });
});

describe("generar-packing-list: datos y lista de quién (AUD-SEG-03)", () => {
  const OWNER = "11111111-1111-4111-8111-111111111111";
  const COLLAB = "22222222-2222-4222-8222-222222222222";

  it("el colaborador no sobrescribe (ni se queda con) la lista del dueño", () => {
    expect(canWritePackingList({ user_id: OWNER }, COLLAB, OWNER)).toBe(false);
  });
  it("sí puede crear la primera o regenerar la suya; el dueño siempre puede", () => {
    expect(canWritePackingList(null, COLLAB, OWNER)).toBe(true);
    expect(canWritePackingList({ user_id: COLLAB }, COLLAB, OWNER)).toBe(true);
    expect(canWritePackingList({ user_id: COLLAB }, OWNER, OWNER)).toBe(true);
    expect(canWritePackingList({ user_id: OWNER }, OWNER, OWNER)).toBe(true);
  });
  // T-P2-6: antes esta prueba era una expresión regular sobre el texto de index.ts y sobrevivía a la
  // mutación de la auditoría (perfil y ADN con trip.user_id). Ahora prueba el comportamiento de
  // loadPromptContext con un cliente simulado que guarda cada consulta y sus filtros, y solo devuelve las
  // filas que cumplen los filtros (como PostgREST con la llave de servicio, que no aplica RLS).
  const fakeAdmin = () => {
    const rows: Record<string, Record<string, unknown>[]> = {
      profiles: [{ id: OWNER, full_name: "Dueña del viaje" }, { id: COLLAB, full_name: "Colaborador" }],
      user_vault_benefits: [
        { user_id: OWNER, credit_cards: [{ bank: "Amex", card_tier: "Platinum" }] },
        { user_id: COLLAB, credit_cards: [{ bank: "BBVA", card_tier: "Azul" }] },
      ],
      ai_user_preferences: [{ user_id: OWNER, perfil_ia: { adn: "dueña" } }, { user_id: COLLAB, perfil_ia: { adn: "colaborador" } }],
    };
    const queries: { table: string; filters: [string, unknown][] }[] = [];
    const from = (table: string) => {
      const q = { table, filters: [] as [string, unknown][] };
      queries.push(q);
      const result = () => (rows[table] ?? []).filter((r) => q.filters.every(([c, v]) => r[c] === v));
      const b = {
        select: () => b,
        eq: (c: string, v: unknown) => { q.filters.push([c, v]); return b; },
        maybeSingle: async () => ({ data: result()[0] ?? null, error: null }),
        then: (ok: (r: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve({ data: result(), error: null }).then(ok, ko),
      };
      return b;
    };
    return { admin: { from }, queries };
  };

  it("un colaborador recibe SU perfil, SU bóveda y SU ADN, nunca los del dueño (comportamiento)", async () => {
    const { admin, queries } = fakeAdmin();
    const ctx = await loadPromptContext(admin, { user_id: OWNER }, COLLAB);
    expect(ctx.profile).toEqual({ id: COLLAB, full_name: "Colaborador" });
    expect(ctx.vault).toEqual([{ user_id: COLLAB, credit_cards: [{ bank: "BBVA", card_tier: "Azul" }] }]);
    expect(ctx.dnaPref).toEqual({ user_id: COLLAB, perfil_ia: { adn: "colaborador" } });
    // Las tres consultas, cada una filtrada por quien llama y por nada del dueño.
    expect(queries.map((q) => q.table).sort()).toEqual(["ai_user_preferences", "profiles", "user_vault_benefits"]);
    for (const q of queries) {
      expect(q.filters.length).toBeGreaterThan(0);
      expect(q.filters.every(([, v]) => v === COLLAB)).toBe(true);
    }
    expect(JSON.stringify(ctx)).not.toMatch(/Dueña|Amex|"dueña"/);
  });

  it("el dueño recibe su propio contexto; sin filas, el contexto queda vacío (no el de otro)", async () => {
    const { admin } = fakeAdmin();
    const own = await loadPromptContext(admin, { user_id: OWNER }, OWNER);
    expect(own.profile).toEqual({ id: OWNER, full_name: "Dueña del viaje" });
    const stranger = await loadPromptContext(admin, { user_id: OWNER }, "33333333-3333-4333-8333-333333333333");
    expect(stranger).toEqual({ profile: null, vault: [], dnaPref: null });
  });

  it("index.ts arma el prompt solo con loadPromptContext(admin, trip, userId) y userId es el usuario autenticado", () => {
    const index = readFileSync(join(FN_DIR, "generar-packing-list/index.ts"), "utf8");
    expect(index).toMatch(/const userId = userData\.user\.id;/);
    expect(index).toMatch(/await loadPromptContext\(admin, trip, userId\)/);
    // Nada de leer perfil, bóveda o ADN por fuera de la función probada.
    expect(index).not.toMatch(/from\("(profiles|user_vault_benefits|ai_user_preferences)"\)/);
  });
});

describe("track-flight: trip_id con la llave de servicio (AUD-SEG-04)", () => {
  it("solo guarda un trip_id que el usuario puede ver; cualquier otro queda en null", async () => {
    const TRIP = "33333333-3333-4333-8333-333333333333";
    const visible = async (id: string) => id === TRIP;
    expect(await tripIdForTracking(TRIP, visible)).toBe(TRIP);
    expect(await tripIdForTracking("44444444-4444-4444-8444-444444444444", visible)).toBeNull();
    expect(await tripIdForTracking("no-es-uuid", async () => true)).toBeNull();
    expect(await tripIdForTracking({ id: TRIP }, async () => true)).toBeNull();
    expect(await tripIdForTracking(undefined, async () => true)).toBeNull();
  });
});

describe("generar-packing-list: la bóveda sí llega al modelo (mejora)", () => {
  it("resume tarjetas, aerolíneas, hoteles y rentas sin números de socio ni documentos", () => {
    const rows = [{
      credit_cards: [{ bank: "BBVA", card_tier: "Platinum", lounge_access: ["Priority Pass"] }, { card_name: "Amex Gold", bank: "Amex", card_tier: "Gold" }],
      airline_alliances: [{ alliance_name: "SkyTeam", airline: "Aeroméxico", membership_number: "AM123456789", tier_status: "Oro" }],
      hotel_loyalty: [{ chain_name: "Marriott Bonvoy", member_id: "MB-998877", status_tier: "Platinum" }],
      car_rentals: [{ company_name: "Hertz", customer_id: "HZ-1" }],
      travel_documents: [{ type: "pasaporte", number: "G12345678" }],
    }];
    const out = vaultSummary(rows);
    expect(out).toEqual([
      "Tarjeta BBVA Platinum (salas VIP)", "Tarjeta Amex Gold", "Aerolínea Aeroméxico Oro", "Hotel Marriott Bonvoy Platinum", "Renta de autos Hertz",
    ]);
    expect(out.join(" ")).not.toMatch(/AM123456789|MB-998877|HZ-1|G12345678/);
  });
  it("datos vacíos o raros no rompen el prompt", () => {
    expect(vaultSummary(null)).toEqual([]);
    expect(vaultSummary([{ credit_cards: "x", hotel_loyalty: [null, 3, {}] }])).toEqual([]);
  });
});
