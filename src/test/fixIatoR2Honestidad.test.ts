// Auditoría 10, ronda 2: N1 (viaje a Japón negado), N3 (tarjeta de Booking que no existe), N4
// ("enviada" sin envío), N10 (adaptador en viaje nacional) y P1-1 de cuenta (ruta /dashboard/insurance).
// Textos reales de producción (r2-concierge/out/*.cmp.json, 29-oct-2026). Los guardarraíles corren EN
// VIVO (honesty.ts): lo que se ve mientras Iato escribe es lo que queda.
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { runConciergeTurn } from "../../supabase/functions/concierge-chat/turn";
import { CircuitBreaker, DEFAULT_MODEL_CONFIG, routeTurn } from "../../supabase/functions/concierge-chat/router";
import type { ModelCaller } from "../../supabase/functions/concierge-chat/agent";
import { finalizeTurn } from "../../supabase/functions/concierge-chat/finalize";
import {
  aiReservationsForPrompt, applyHonesty, dropAdapter, type HonestyCtx, isDomesticTrip, LiveHonestyFilter,
} from "../../supabase/functions/concierge-chat/honesty";
import { computeTripGaps, tripsDigest } from "../../supabase/functions/concierge-chat/context";
import { buildContextMessage, SYSTEM, TRIP_RULES } from "../../supabase/functions/concierge-chat/prompt";

const HOY = "2026-10-28";
const ACTX = { todayISO: HOY, trips: [], activeTripId: null };

const T09 = "En Japón **no se acostumbra dejar propina** en restaurantes, bares ni taxis. Según información general, sin verificar en vivo, ofrecerla puede incomodar, y el servicio ya viene incluido en el precio. Solo en algunos hoteles y ryokan de lujo aparece un cargo por servicio (a veces 10–15%) en la cuenta, y eso ya cubre la propina.\n\nJapón no está entre tus viajes guardados. ¿Lo estás planeando?";
const C6 = "**Valle de Bravo, 30 oct–1 nov (2 personas):**\n\n- **Qué tienes:** nada reservado aún. Todo está cotizado, sin reservar.\n- **Siguiente paso:** elegir hotel. Mi recomendación es Múbú, boutique con rating 4.7. Reserva en el enlace de Booking que te dejo en la card. Tu Platinum te sirve para pagar y para sus seguros, pero confirma la cobertura con Amex.\n\n¿Te armo la solicitud de seguro o prefieres cerrar primero el hotel?";
const R1 = "Contramar (Durango 200, Roma Norte) recibe reservaciones y atiende sábados de 11:00 a 20:00, así que el sábado 14 de noviembre a las 14:00 entra en su horario, según Google Maps. Primero verás a quién le escribiremos y qué le diremos; nada se envía sin tu confirmación. Aún no está reservado: solo quedará confirmado cuando el restaurante lo confirme por escrito.\n\nHay además una solicitud anterior de Contramar para el 13 de noviembre a las 14:30 que sigue como solicitud enviada, no como reserva. Si quieres, la cancelamos o la dejamos.";
const X3 = "Esta es la lista, sin guardar:\n\n- **Paraguas o impermeable plegable**\n- **Medicamentos personales y protector solar**\n- **Cargador, power bank y adaptador** para tus fotos del mirador\n\nSi quieres que la guarde en tu viaje, dímelo y la agrego.";

/** 11 viajes; Japón (Tokio) es el 9º por fecha de salida, como en la cuenta del reporte. */
const TRIPS = [
  ["Valle de Bravo", "México", "2026-10-30"], ["Ciudad de México", "México", "2026-11-13"], ["Puebla", "México", "2026-11-20"],
  ["Madrid", "España", "2026-12-01"], ["Cancún", "México", "2026-12-15"], ["Roma", "Italia", "2027-01-10"], ["Lisboa", "Portugal", "2027-02-01"],
  ["Oaxaca", "México", "2027-02-20"], ["Tokio", "Japón", "2027-03-25"], ["Bangkok", "Tailandia", "2027-04-10"], ["París", "Francia", "2027-05-01"],
].map(([destino, pais_destino, fecha_salida], i) => ({ id: `t${i + 1}`, destino, pais_destino, fecha_salida, fecha_regreso: fecha_salida, ciudad_origen: "Ciudad de México" }));

const AI_RES = [
  { id: "886929f4", venue_name: "Contramar", requested_local: "2026-11-06T14:00", party_size: 2, status: "sent", sent_at: "2026-10-27T18:00:00Z" },
  { id: "8fbcd8b7", venue_name: "Contramar", requested_local: "2026-11-13T14:30", party_size: 2, status: "awaiting_user_ok", sent_at: null },
];

const ctx = (o: Partial<HonestyCtx> = {}): HonestyCtx => ({ trips: TRIPS, userMessage: "pregunta", todayISO: HOY, toolsWithData: () => new Set(), ...o });

async function liveTurn(text: string, honesty: Omit<HonestyCtx, "toolsWithData">, message = "pregunta") {
  const shown: string[] = [];
  const caller: ModelCaller = async (step, _i, h) => {
    for (const chunk of text.match(/[\s\S]{1,7}/g) ?? []) h.onText(chunk);
    return { provider: step.provider, model: step.model, stopReason: "end_turn", text, content: [{ type: "text", text }], toolUses: [], usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } };
  };
  const out = await runConciergeTurn({
    plan: { intents: [], prefetch: [], notes: [], toolHints: [], suggestedActions: [], cards: [] },
    route: routeTurn({ message, intents: [], exigente: false, config: DEFAULT_MODEL_CONFIG }), config: DEFAULT_MODEL_CONFIG, breaker: new CircuitBreaker(),
    callModel: caller, execTool: async () => ({}), toolTimeout: () => 1000,
    send: (ev) => { if (ev.type === "delta") shown.push(ev.data.text); else if (ev.type === "reset") shown.length = 0; },
    meta: {}, stableSystem: "s", dynamicSystem: "d", contextMessage: null, history: [{ role: "user", content: message }], userMessage: message,
    exigente: false, hasAnthropicKey: true, hasLovableKey: false, actionCtx: ACTX, honesty,
  });
  return { final: out.final, shown: shown.join("") };
}

describe("N1 · viajes: el modelo ve TODOS y no niega uno que existe", () => {
  it("el contexto lleva los 11 viajes (8 detallados + los demás compactos, Japón incluido)", () => {
    const otros = tripsDigest(TRIPS, { skipIds: TRIPS.slice(0, 8).map((t) => t.id), todayISO: HOY });
    expect(otros.map((t: any) => t.destino)).toEqual(["Tokio", "Bangkok", "París"]);
    expect(otros[0]).toEqual({ id: "t9", destino: "Tokio", pais: "Japón", salida: "2027-03-25", regreso: "2027-03-25" });
    const msg = buildContextMessage({ viajes: TRIPS.slice(0, 8), otrosViajes: otros })!.content;
    expect(msg).toMatch(/<otros_viajes_usuario>[\s\S]*Japón/);
    expect(TRIP_RULES).toMatch(/Tokio está en Japón/);
  });
  it("'Japón no está entre tus viajes guardados' no llega a la pantalla (y el final es lo que se vio)", async () => {
    const { final, shown } = await liveTurn(T09, { trips: TRIPS, userMessage: "¿Cuánta propina se acostumbra dejar en restaurantes en Japón?", todayISO: HOY });
    expect(shown).not.toMatch(/no está entre tus viajes/);
    expect(shown).toMatch(/no se acostumbra dejar propina/);
    expect(final.text).toBe(shown.trim());
    expect(final.guards).toContain("honestidad_en_vivo");
  });
  it("si de verdad no está, la frase se queda", () => {
    const t = "Marruecos no está entre tus viajes guardados. ¿Lo estás planeando?";
    expect(applyHonesty(t, ctx({ userMessage: "propinas en Marruecos" })).text).toBe(t);
  });
});

describe("N3 · no prometer tarjetas o enlaces que no existen", () => {
  it("'el enlace de Booking que te dejo en la card' sin búsqueda de hoteles se quita; lo demás queda igual", async () => {
    const { final, shown } = await liveTurn(C6, { trips: TRIPS, userMessage: "Mi viaje a Valle de Bravo", todayISO: HOY, planCardTypes: ["alert"] });
    expect(shown).not.toMatch(/Booking/);
    expect(shown).toMatch(/Mi recomendación es Múbú, boutique con rating 4\.7\. Tu Platinum te sirve/);
    expect(final.text).toBe(shown.trim());
  });
  it("con la búsqueda de hoteles en el turno, sí puede mencionarla", () => {
    const t = "Reserva en el enlace de Booking que te dejo en la card.";
    expect(applyHonesty(t, ctx({ toolsWithData: () => new Set(["search_hotels"]) })).text).toBe(t);
    // "tarjeta" de crédito no es una card.
    expect(applyHonesty("Paga con tu tarjeta Platinum.", ctx()).text).toBe("Paga con tu tarjeta Platinum.");
  });
});

describe("N4 · Reservas IA: estado exacto, nunca 'enviada' si no se envió", () => {
  it("el contexto dice el estado exacto de cada una (borrador ≠ enviada) con fecha y hora", () => {
    const r = aiReservationsForPrompt(AI_RES);
    expect(r[1]).toMatchObject({ restaurante: "Contramar", fecha_hora: "2026-11-13T14:30", estado: "awaiting_user_ok", se_envio: false });
    expect(String(r[1].estado_exacto)).toMatch(/aún no se envió/);
    expect(r[0]).toMatchObject({ se_envio: true });
    expect(SYSTEM).toMatch(/nunca digas que una solicitud 'se envió'/);
  });
  it("la del 13 de noviembre (awaiting_user_ok) no se llama 'enviada': se dice su estado real", async () => {
    const { final, shown } = await liveTurn(R1, { trips: TRIPS, userMessage: "Resérvame Contramar el sábado 14", todayISO: HOY, aiReservations: AI_RES });
    expect(shown).not.toMatch(/sigue como solicitud enviada/);
    expect(shown).toMatch(/La solicitud de Contramar para el 13 de noviembre a las 14:30 está en borrador listo: aún no se envió/);
    expect(shown).toMatch(/nada se envía sin tu confirmación/); // la frase verdadera se queda
    expect(final.text).toBe(shown.trim());
  });
  it("la del 6 de noviembre sí se envió: la frase se queda", () => {
    const t = "Tu solicitud de Contramar del 6 de noviembre ya se envió al restaurante.";
    expect(applyHonesty(t, ctx({ aiReservations: AI_RES })).text).toBe(t);
  });
});

describe("N10 · adaptador en un viaje nacional", () => {
  it("CDMX → Valle de Bravo es nacional; CDMX → Tokio no", () => {
    expect(isDomesticTrip({ destino: "Valle de Bravo", pais_destino: "México", ciudad_origen: "Ciudad de México" })).toBe(true);
    expect(isDomesticTrip({ destino: "Tokio", pais_destino: "Japón", ciudad_origen: "Ciudad de México" })).toBe(false);
    expect(isDomesticTrip({ destino: "Valle de Bravo", pais_destino: "México" })).toBe(false); // sin origen no se afirma
  });
  it("la lista de empaque ya no trae adaptador (y la viñeta queda bien escrita)", async () => {
    const { shown } = await liveTurn(X3, { trips: TRIPS, userMessage: "¿qué llevo?", todayISO: HOY, domesticTrip: true });
    expect(shown).not.toMatch(/adaptador/i);
    expect(shown).toMatch(/- \*\*Cargador y power bank\*\* para tus fotos del mirador/);
    expect(dropAdapter("- Adaptador de corriente")).toBe("");
    // Viaje internacional: no se toca.
    expect(applyHonesty(X3, ctx()).text).toBe(X3);
  });
  it("la acción de guardar la lista tampoco lo agrega", () => {
    const raw = `Lista.\n<<<IATO_DATA>>>\n${JSON.stringify({ actions: [{ type: "add_packing_items", params: { trip_id: "t1", items: ["Paraguas", "Adaptador universal"] } }] })}`;
    const f = finalizeTurn({ raw, toolRuns: [], plan: { cards: [], suggestedActions: [] }, actionCtx: { todayISO: HOY, trips: [{ id: "t1", destino: "Valle de Bravo", fecha_salida: "2026-10-30", fecha_regreso: "2026-11-01" }], activeTripId: "t1" },
      honesty: ctx({ domesticTrip: true }) });
    const a = f.actions.find((x) => x.type === "add_packing_items");
    if (a) expect(a.params.items).toEqual(["Paraguas"]);
  });
});

describe("Filtro en vivo: sin nada que corregir, el texto sale idéntico", () => {
  it.each([T09.replace(/\n\nJapón.*$/s, ""), "Uno.\n\n- a\n- b. Dos.\n\n**Fuente:** X", "Texto sin punto final"])("%#", (t) => {
    const f = new LiveHonestyFilter(ctx());
    let out = "";
    for (const ch of t.match(/[\s\S]{1,3}/g) ?? []) out += f.push(ch);
    out += f.flush();
    expect(out).toBe(t);
  });
});

describe("P1-1 (cuenta) · ninguna ruta /dashboard/... inexistente en textos para el modelo o el usuario", () => {
  const app = readFileSync("src/App.tsx", "utf8");
  const routes = [...app.matchAll(/path="(\/dashboard[^"]*)"/g)].map((m) => m[1]);
  const re = (r: string) => new RegExp(`^${r.replace(/:[a-zA-Z]+/g, "[^/]+")}$`);
  const valid = (p: string) => {
    const clean = p.replace(/[?#].*$/, "").replace(/\/$/, "");
    // "/dashboard/viajes/" + id (plantilla) cuenta como prefijo de una ruta con parámetro.
    return routes.some((r) => re(r).test(clean)) || (p.endsWith("/") && routes.some((r) => r.startsWith(p) && /:/.test(r.slice(p.length))));
  };
  const files: string[] = [];
  const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) { if (f !== "test" && f !== "node_modules") walk(p); } else if (/\.(ts|tsx)$/.test(f)) files.push(p); } };
  walk("supabase/functions");
  walk("src");
  it("la sugerencia de seguro ya no manda a /dashboard/insurance", () => {
    const gaps = computeTripGaps({ id: "t1", destino: "Valle de Bravo", fecha_salida: "2026-10-30", fecha_regreso: "2026-11-01" }, [], HOY);
    const seguro = gaps.find((g: any) => g.id === "seguro");
    expect(JSON.stringify(seguro)).not.toMatch(/\/dashboard\//);
  });
  it("todas las rutas /dashboard/... escritas en el código existen en el router", () => {
    const bad: string[] = [];
    for (const f of files) {
      for (const m of readFileSync(f, "utf8").matchAll(/["'`(\s](\/dashboard(?:\/[a-z0-9_-]+)*\/?)(?=[\s"'`)?#$.,;:]|\$\{)/g)) {
        if (!valid(m[1])) bad.push(`${f}: ${m[1]}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
