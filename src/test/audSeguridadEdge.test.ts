// Auditoría de cierre (grupo seguridad): reglas que deben cumplir TODAS las funciones Edge.
// Se leen los fuentes reales de supabase/functions y supabase/config.toml; una función nueva que
// rompa una regla hace fallar esta prueba. Ver docs/iatos/cierre/SEGURIDAD.md.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isPaidBucket } from "../../supabase/functions/_shared/rate-limit-core";
import { canWritePackingList, vaultSummary } from "../../supabase/functions/generar-packing-list/access";
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
};
// Consumen APIs de pago (IA, Google, SerpApi, Pexels, Travelpayouts, correo).
const PAID_CALL = /connector-gateway\.lovable\.dev|aiFetch|ai\.gateway\.lovable|callClaude|serpapi|googleTransportFor|api\.pexels|travelpayouts|sendEmail\(/;

describe("funciones Edge: autenticación (config.toml vs código)", () => {
  it("hay 63 funciones y todas están declaradas en config.toml", () => {
    expect(functions.length).toBe(63);
    expect(functions.filter((f) => verifyJwt(f) === undefined)).toEqual([]);
  });

  it("toda función pública (verify_jwt = false) tiene su propia puerta que falla cerrada", () => {
    const sinPuerta = functions.filter((f) => verifyJwt(f) === false).filter((f) => {
      const src = sourceOf(f) + (f === "reservations-inbound" || f === "ai-reservations"
        ? readFileSync(join(FN_DIR, "_shared/ai-reservations/service.ts"), "utf8") : "")
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
  it("el contexto del prompt (perfil, bóveda de tarjetas, ADN) es el de quien llama, no el del dueño", () => {
    const src = sourceOf("generar-packing-list");
    expect(src).not.toMatch(/\.eq\("id", trip\.user_id\)/);
    expect(src).not.toMatch(/user_vault_benefits"\)\.select\("\*"\)\.eq\("user_id", trip\.user_id\)/);
    expect(src).toMatch(/user_vault_benefits"\)\.select\([^)]*\)\.eq\("user_id", userId\)/);
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
