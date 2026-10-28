// Notas del agente de pantallas (E2E 28-oct-2026), lado servidor: la pregunta de regreso cuando el modo ya
// está dicho, proveedores técnicos en el análisis, "Fixer" en textos de Iato y "Bóveda" en el correo.
import { describe, expect, it } from "vitest";
import { isReturnModeQuestion, validateTripSpec } from "../../supabase/functions/_shared/tripSpec";
import { cleanNarrative, scrubProviders } from "../../supabase/functions/analizar-viaje/narrative";
import { validateAction } from "../../supabase/functions/concierge-chat/actions";
import { NOT_BOOKED_LINE } from "../../supabase/functions/concierge-chat/guard";
import { detectIntents, planTurn } from "../../supabase/functions/concierge-chat/planner";
import { welcomeEmail } from "../../supabase/functions/_shared/email-templates";

const VALLE = "Viaje de 4 días a Valle de Bravo en coche desde CDMX";
const raw = (modo: string) => ({
  version: 1, consulta_original: VALLE, intencion: "viaje_futuro", origen: "Ciudad de México",
  paradas: [{ id: "p1", ciudad: "Valle de Bravo", pais: "México", rol: "estancia", llegada_por: "coche", texto: "Valle de Bravo" }],
  regreso: { a: "Ciudad de México", via: null, modo },
  preguntas: [
    { id: "q1", tipo: "fechas", texto: "No indicaste las fechas del viaje.", pregunta: "¿Cuándo quieres salir a Valle de Bravo?", opciones: [], parada: "p1" },
    { id: "q3", tipo: "otro", texto: "No indicaste cómo regresas a Ciudad de México.", pregunta: "¿Regresas a Ciudad de México en coche o de otra forma?", opciones: ["Coche", "Otro medio"], parada: null },
  ],
  menciones: [{ texto: "Valle de Bravo", tipo: "ciudad", estado: "parada", ref: "p1" }, { texto: "en coche", tipo: "tramo", estado: "tramo", ref: "p1" }],
});

describe("interpretar-viaje: no pregunta el regreso si el modo ya está dicho", () => {
  it("regreso.modo = coche → sin «¿Regresas … en coche o de otra forma?»; las demás preguntas siguen", () => {
    const v: any = validateTripSpec(JSON.stringify(raw("coche")), VALLE, { origen: "Ciudad de México" });
    expect(v.ok).toBe(true);
    expect(v.spec.preguntas.map((q: any) => q.id)).toEqual(["q1"]);
  });
  it("sin modo de regreso la pregunta se conserva", () => {
    const v: any = validateTripSpec(JSON.stringify(raw("por_definir")), VALLE, { origen: "Ciudad de México" });
    expect(v.spec.preguntas.map((q: any) => q.id)).toEqual(["q1", "q3"]);
    expect(isReturnModeQuestion({ tipo: "otro", pregunta: "¿Cuántos viajeros son?", texto: "" })).toBe(false);
  });
});

describe("analizar-viaje: sin proveedores técnicos en el texto", () => {
  it("SerpApi, Perplexity y Travelpayouts se dicen como los ve la persona; la Bóveda es «tus documentos y tarjetas»", () => {
    expect(scrubProviders("Los vuelos salen de Google Flights vía SerpApi (consultado hoy).")).toBe("Los vuelos salen de Google Flights (consultado hoy).");
    expect(scrubProviders("El hospedaje sale de SerpApi / Google Hotels.")).toBe("El hospedaje sale de Google Hotels.");
    expect(scrubProviders("Marzo es temporada media según Perplexity.")).toBe("Marzo es temporada media según búsquedas web.");
    expect(scrubProviders("Tarifa de Travelpayouts/Aviasales.")).toBe("Tarifa de Aviasales.");
    const a: any = { analisis_narrativo: "Como tu Bóveda está vacía, no apliqué perks. Fuentes: Google Maps y SerpApi / Google Hotels (tarifas)." };
    cleanNarrative(a, { destino: "Nueva York", enCoche: false, otherPlaces: [] });
    expect(a.analisis_narrativo).toBe("Como no tienes tarjetas ni programas guardados, no apliqué perks. Fuentes: Google Maps y Google Hotels (tarifas).");
    expect(a.analisis_narrativo).not.toMatch(/SerpApi|Perplexity|Bóveda/);
  });
});

describe("Iato y correos: «una persona del equipo», no «Fixer»; «Documentos y tarjetas», no «Bóveda»", () => {
  it("la acción, la línea de reservas y la respuesta de 'quiero un humano'", () => {
    const v: any = validateAction("fixer_request", { tipo: "other", titulo: "Mesa en Pujol" }, { trips: [] } as any);
    expect(v.action.confirm_label).toBe("Pedírselo a una persona del equipo");
    expect(JSON.stringify(v.action)).not.toMatch(/Fixer/);
    expect(NOT_BOOKED_LINE).not.toMatch(/Fixer/);
    const plan = planTurn({ message: "quiero hablar con un humano", intents: detectIntents("quiero hablar con un humano"), trip: null, todayISO: "2026-10-28", coords: null, hasPriveSession: false, exigente: false });
    expect(plan.direct?.text).toMatch(/Hablar con una persona/);
    expect(plan.direct?.text).not.toMatch(/Fixer/);
  });
  it("correo de bienvenida", () => {
    const e = welcomeEmail({ firstName: "Sofía", siteUrl: "https://traveliatos.life" });
    expect(`${e.html} ${e.text}`).not.toMatch(/Bóveda/);
    expect(e.text).toMatch(/Documentos y tarjetas/);
  });
});
