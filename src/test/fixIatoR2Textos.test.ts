// Auditoría 10, ronda 2: #16 (frase inicial redundante), #17 (etiqueta del gasto) y N10 (texto del paso
// de atracciones). Casos reales del reporte.
import { describe, expect, it } from "vitest";
import { detectIntents, leadSentence, planTurn, toolStatusText } from "../../supabase/functions/concierge-chat/planner";
import { answerPlaceLabel, resolveTurnPlace } from "../../supabase/functions/concierge-chat/turnPlace";

const HOY = "2026-10-28";
const VB = { id: "b5feaa3f", destino: "Valle de Bravo", pais_destino: "México", fecha_salida: "2026-10-30", fecha_regreso: "2026-11-01", num_viajeros: 2, ciudad_origen: "Ciudad de México" };
const plan = (message: string, exigente = false) => planTurn({ message, intents: detectIntents(message), trip: VB, todayISO: HOY, coords: null, hasPriveSession: false, exigente, requested: "Valle de Bravo" });

describe("#16 · sin frases iniciales que no aplican", () => {
  const G1 = "Plan para una tarde en Valle de Bravo el sábado 31 de octubre: qué hacer y dónde comer";
  it("Modo exigente con un plan de tarde: no dice 'Busco restaurantes en Valle de Bravo en Google Maps.'", () => {
    const p = plan(G1, true);
    expect(p.prefetch.length).toBeGreaterThan(0);
    expect(leadSentence(p, { exigente: true, message: G1 })).toBeNull();
    // Tampoco en modo normal: la pregunta pide más que restaurantes.
    expect(leadSentence(p, { exigente: false, message: G1 })).toBeNull();
  });
  it("cuando sí aplica, se queda (cena cerca del hotel, emergencia aun en exigente)", () => {
    const p = plan("quiero cenar en Valle de Bravo");
    expect(leadSentence(p, { message: "quiero cenar en Valle de Bravo" })).toMatch(/^Busco .* en Google Maps\.$/);
    const e = planTurn({ message: "necesito ayuda urgente", intents: detectIntents("necesito ayuda urgente"), trip: VB, todayISO: HOY, coords: { lat: 19.4, lng: -99.1 }, hasPriveSession: false, exigente: true });
    expect(leadSentence(e, { exigente: true, message: "necesito ayuda urgente" })).toMatch(/emergencias local/);
  });
  it("sin una frase concreta no hay relleno ('Consulto los datos en vivo para responderte.')", () => {
    expect(leadSentence({ intents: [], prefetch: [{ name: "web_search", args: { query: "x" }, reason: "x" }] })).toBeNull();
  });
});

describe("N10 · el paso de atracciones dice su fuente real", () => {
  it("'Buscando atracciones en Google Maps', no 'Buscando reseñas y rankings'", () => {
    const t = toolStatusText("search_attractions", { query: "imperdibles Lisboa" });
    expect(t).toBe("Buscando atracciones en Google Maps: imperdibles Lisboa…");
    expect(t).not.toMatch(/reseñas y rankings/);
  });
});

describe("#17 · etiqueta de lugar del gasto: el viaje, no 'cerca de ti'", () => {
  it("'Registra un gasto … en mi viaje a Valle de Bravo' estando en CDMX → sobre Valle de Bravo", () => {
    const msg = "Registra un gasto de 150 pesos en comida, descripción: PRUEBA AUDITORÍA R2 café, en mi viaje a Valle de Bravo";
    const tp = resolveTurnPlace({ message: msg, trips: [VB], todayISO: HOY, pinnedId: VB.id, user: { coords: { lat: 19.43, lng: -99.13 }, place: "Ciudad de México" } });
    expect(tp.scope).toBe("trip");
    expect(answerPlaceLabel({ placeScope: tp.scope, placeLabel: tp.label, tripId: VB.id }, [VB])).toBe("sobre Valle de Bravo");
    // Sin "mi viaje" también: un gasto no es una búsqueda de lugares.
    const tp2 = resolveTurnPlace({ message: "Registra un gasto de 150 pesos en comida", trips: [VB], todayISO: HOY, pinnedId: VB.id, user: { coords: { lat: 19.43, lng: -99.13 }, place: "Ciudad de México" } });
    expect(tp2.scope).toBe("trip");
    // "Restaurantes cerca de mí" sigue siendo de donde está.
    expect(resolveTurnPlace({ message: "restaurantes cerca de mí", trips: [VB], todayISO: HOY, pinnedId: VB.id, user: { coords: { lat: 19.43, lng: -99.13 }, place: "Ciudad de México" } }).scope).toBe("here");
  });
});
