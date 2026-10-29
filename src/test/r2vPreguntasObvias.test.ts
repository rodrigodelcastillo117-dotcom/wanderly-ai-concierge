// R2 viajes P1-2: con «Lima, Perú del 11 al 16 de febrero de 2027, 2 personas, saliendo de Ciudad de México»
// Iato dejaba de 1 a 3 pendientes falsos en las 4 corridas: «¿Cómo viajarán a Lima: vuelo, tren, coche,
// ferry, crucero…?», «Mencionaste «Perú»: ¿dónde va en tu viaje?», «¿Regresan… desde Italia?» con «Coche».
// Bogotá (ronda 1) salía directo a «Sí, armar mi viaje». Se filtran en el servidor (validateTripSpec) y en el
// cliente (finalizeSpec), las dos por canonicalQuestions.
import { describe, it, expect } from "vitest";
import fixture from "./fixtures/r2LimaInterpretaciones.json";
import {
  canonicalQuestions, checkCoverage, flightIsObvious, isObviousQuestion, openQuestions, routeOfSpec, validateTripSpec, type TripSpec,
} from "../../supabase/functions/_shared/tripSpec.ts";
import { buildLocalSpec, finalizeSpec } from "@/lib/tripSpecLocal";
import { draftSpec, mergeDraftWithAi } from "@/lib/tripSpecDraft";

const LIMA = fixture.texto;
const TODAY = new Date(2026, 9, 29);
const ctx = { origen: "Ciudad de México", today: TODAY };
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

/** Como la manda la IA (antes de validar). */
function raw(spec: any, preguntas?: any[], menciones?: any[]) {
  const r = clone(spec);
  delete r.fuente; delete r.version; delete r.consulta_original;
  if (preguntas) r.preguntas = preguntas;
  if (menciones) r.menciones = menciones;
  return r;
}

const ITALIA_Q = { id: "q3", tipo: "otro", texto: "regreso", pregunta: "¿Regresan a Ciudad de México desde Italia?", opciones: ["Coche", "Vuelo", "Otro"], parada: null };
const PERU_MENCION = [
  { texto: "Lima", tipo: "ciudad", estado: "parada", ref: "p1" },
  { texto: "Perú", tipo: "pais", estado: "pregunta", ref: "q9" },
  { texto: "saliendo de Ciudad de México", tipo: "origen", estado: "origen", ref: null },
];

function serverAndClient(r: unknown, text: string): { server: TripSpec; client: TripSpec } {
  const v = validateTripSpec(r, text, { origen: "Ciudad de México" });
  if (!v.ok) throw new Error((v as { error: string }).error);
  return { server: v.spec, client: finalizeSpec(v.spec, text, ctx) };
}

describe("P1-2 · Lima desde CDMX: sin pendientes falsos", () => {
  it.each(fixture.corridas.map((c, i) => [i + 1, c] as const))("corrida real %i de interpretar-viaje → directo a armar el viaje", (_, corrida) => {
    expect((corrida as any).preguntas.length).toBeGreaterThan(0); // la IA sí las mandó
    const { server, client } = serverAndClient(raw(corrida), LIMA);
    expect(openQuestions(server)).toEqual([]);
    expect(openQuestions(client)).toEqual([]);
    expect(client.paradas.map((p) => [p.ciudad, p.llegada_por])).toEqual([["Lima", "vuelo"]]);
    expect(client.regreso).toMatchObject({ a: "Ciudad de México", modo: "vuelo" });
    expect(checkCoverage(client).ok).toBe(true);
    expect(routeOfSpec(client)).toMatchObject({ kind: "unico", destino: "Lima", fecha_salida: "2027-02-11", fecha_regreso: "2027-02-16", viajeros: 2 });
  });

  it("«Mencionaste «Perú»: ¿dónde va?» y «¿Regresan… desde Italia?» con «Coche» no salen", () => {
    const base = fixture.corridas[1] as any;
    const { server, client } = serverAndClient(raw(base, [...base.preguntas, ITALIA_Q], PERU_MENCION), LIMA);
    for (const s of [server, client]) {
      expect(openQuestions(s).map((q) => q.pregunta)).toEqual([]);
      expect(s.menciones.find((m) => m.texto === "Perú")).toMatchObject({ estado: "parada", ref: "p1" });
    }
    expect(JSON.stringify(client.preguntas)).not.toMatch(/Mencionaste|Italia/);
  });

  it("también con el borrador local que se ve mientras responde la IA", () => {
    const draft = draftSpec(LIMA, ctx);
    expect(openQuestions(draft)).toEqual([]);
    const ai = finalizeSpec((validateTripSpec(raw(fixture.corridas[1], [...(fixture.corridas[1] as any).preguntas, ITALIA_Q]), LIMA, { origen: "Ciudad de México" }) as any).spec, LIMA, ctx);
    const m = mergeDraftWithAi(draft, draft, ai, ctx);
    expect(openQuestions(m.spec)).toEqual([]);
    expect(m.nota).toBe("Iato revisó tu viaje: no falta nada."); // R3 P2-11: antes «coincide con tu resumen»
  });
});

describe("P1-2 · Bogotá (igual que en la ronda 1: directo)", () => {
  const BOGOTA = "Bogotá del 10 al 15 de marzo de 2027, 2 personas, saliendo de Ciudad de México";
  const ai = {
    intencion: "viaje_futuro", origen: "Ciudad de México",
    paradas: [{ id: "p1", ciudad: "Bogotá", pais: "Colombia", de_region: null, es_puerto: false, rol: "estancia", noches: 5, llegada_por: "por_definir", crucero: null, sugerida: false, texto: "Bogotá" }],
    regreso: { a: "Ciudad de México", via: null, modo: "por_definir" },
    fecha_salida: "2027-03-10", fecha_regreso: "2027-03-15", fechas_expresas: true, noches_total: 5, viajeros: 2,
    preferencias: [], reservas: [], sugerencias: [],
    menciones: [{ texto: "Bogotá", tipo: "ciudad", estado: "parada", ref: "p1" }, { texto: "Colombia", tipo: "pais", estado: "pregunta", ref: null }],
    preguntas: [
      { id: "q1", tipo: "otro", texto: "No indicaste cómo llegarán a Bogotá.", pregunta: "¿Cómo viajarán a Bogotá?", opciones: ["vuelo", "tren", "coche", "ferry", "crucero"], parada: "p1" },
      { id: "q2", tipo: "otro", texto: "No indicaste cómo regresan.", pregunta: "¿Cómo regresan a Ciudad de México?", opciones: ["Coche", "Vuelo"], parada: null },
      { id: "q3", tipo: "lugar_desconocido", texto: "Colombia", pregunta: "Mencionaste «Colombia»: ¿dónde va en tu viaje?", opciones: [], parada: null },
    ],
  };
  it("sin pendientes y destino único", () => {
    const { server, client } = serverAndClient(ai, BOGOTA);
    expect(openQuestions(server)).toEqual([]);
    expect(openQuestions(client)).toEqual([]);
    expect(routeOfSpec(client)).toMatchObject({ kind: "unico", destino: "Bogotá" });
    expect(openQuestions(draftSpec(BOGOTA, ctx))).toEqual([]);
  });
});

describe("P1-2 · lo que NO es obvio se sigue preguntando", () => {
  it("Valle de Bravo (cerca, sin modo dicho): sí se pregunta cómo llegar", () => {
    const t = "Viaje de 4 días a Valle de Bravo desde CDMX";
    const s = buildLocalSpec(t, ctx);
    s.preguntas.push({ id: "qa", tipo: "otro", texto: "llegada", pregunta: "¿Cómo llegarán a Valle de Bravo: coche o autobús?", opciones: ["Coche", "Autobús"], parada: s.paradas[0].id, resuelta: false });
    expect(canonicalQuestions(s).some((q) => q.id === "qa")).toBe(true);
    expect(flightIsObvious("Ciudad de México", "Valle de Bravo")).toBe(false);
  });

  it("país con ciudades propuestas (Hungría → Budapest) sigue preguntando; un regreso por otra ciudad, también", () => {
    const s = buildLocalSpec("Hungría y regreso por Londres", ctx);
    const f = finalizeSpec(s, "Hungría y regreso por Londres", ctx);
    expect(openQuestions(f).map((q) => q.tipo).sort()).toEqual(expect.arrayContaining(["ciudades_de_pais", "conexion_o_estancia"]));
  });

  it("una pregunta libre sobre preferencias se queda", () => {
    const s = buildLocalSpec(LIMA, ctx);
    const q = { id: "qx", tipo: "otro" as const, texto: "ritmo", pregunta: "¿Prefieren un ritmo tranquilo o intenso en Lima?", opciones: ["Tranquilo", "Intenso"], parada: null, resuelta: false };
    expect(isObviousQuestion(s, q)).toBe(false);
  });

  it("Tokio desde CDMX: vuelo obvio; Madrid → Sevilla, no", () => {
    expect(flightIsObvious("Ciudad de México", "Tokio")).toBe(true);
    expect(flightIsObvious("Madrid", "Sevilla")).toBe(false);
  });
});
