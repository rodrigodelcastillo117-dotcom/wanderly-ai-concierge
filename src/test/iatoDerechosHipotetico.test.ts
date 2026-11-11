// Recorrido 11-nov-2026: una pregunta hipotética («si mi vuelo se retrasa…») o un retraso que ya pasó y se
// quiere reclamar no deben buscar vuelos alternativos ni abrir un caso «Vuelo cancelado» con el equipo.
import { describe, expect, it } from "vitest";
import { detectIntents, disruptionTiming, leadSentence, planTurn } from "../../supabase/functions/concierge-chat/planner";

const trip = { id: "t1", destino: "Puerto Escondido", ciudad_origen: "Ciudad de México", fecha_salida: "2026-12-20", num_viajeros: 2 };
const plan = (message: string) =>
  planTurn({ message, intents: detectIntents(message), trip, todayISO: "2026-11-11", coords: null, hasPriveSession: false, exigente: false });

describe("¿pasa ahora, es hipotético o ya pasó?", () => {
  it.each([
    ["Si mi vuelo se retrasa más de 3 horas, ¿qué derechos tengo?", "hipotetica"],
    ["¿Qué pasa si me cancelan el vuelo?", "hipotetica"],
    ["En caso de que se cancele mi vuelo, ¿me reembolsan?", "hipotetica"],
    ["Mi vuelo de Iberia Madrid-México se retrasó 5 horas el 2 de noviembre. Quiero reclamar.", "pasada"],
    ["Ayer me cancelaron el vuelo con Volaris", "pasada"],
    ["Me cancelaron el vuelo, ¿qué hago?", "ahora"],
    ["Mi vuelo se retrasó y estoy en el aeropuerto, quiero reclamar", "ahora"],
    ["se canceló mi vuelo", "ahora"],
  ])("%s → %s", (m, want) => expect(disruptionTiming(m)).toBe(want));
});

describe("plan de Iato", () => {
  it("hipotético: solo derechos, sin vuelos alternativos ni caso con el equipo", () => {
    const p = plan("Si mi vuelo se retrasa más de 3 horas, ¿qué derechos tengo?");
    expect(p.prefetch.map((s) => s.name)).toEqual(["web_search"]);
    expect(String(p.prefetch[0].args.query)).toContain("retrasado");
    expect(p.suggestedActions.some((a) => a.type === "fixer_request")).toBe(false);
    expect(leadSentence(p, { message: "Si mi vuelo se retrasa más de 3 horas, ¿qué derechos tengo?" })).toBe("Reviso tus derechos como pasajero.");
  });
  it("ya pasó y quiere reclamar: ofrece preparar la carta, sin reubicación", () => {
    const p = plan("Mi vuelo de Iberia Madrid-México se retrasó 5 horas el 2 de noviembre. Quiero reclamar.");
    expect(p.prefetch.some((s) => s.name === "search_flights")).toBe(false);
    expect(p.suggestedActions.some((a) => a.type === "fixer_request")).toBe(false);
    expect(p.notes.join(" ")).toContain("preparar_reclamo");
  });
  it("está pasando: sigue buscando alternativas y ofrece una persona del equipo", () => {
    const p = plan("Me cancelaron el vuelo, ¿qué hago?");
    expect(p.prefetch.some((s) => s.name === "search_flights")).toBe(true);
    expect(p.suggestedActions[0]).toMatchObject({ type: "fixer_request" });
  });
});
