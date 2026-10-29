// R2 viajes P2-9: Iato decía «Florencia y Siena suman 5 noches… lo que cubre los 5 días» y Planear decía
// 4 noches. Una sola regla en toda la app: N días = N − 1 noches.
import { describe, it, expect } from "vitest";
import { durationSaid, validateTripSpec } from "../../supabase/functions/_shared/tripSpec.ts";
import { finalizeSpec } from "@/lib/tripSpecLocal";
import { durationOf } from "@/lib/multiCityText";

const TEXT = "Toscana 5 días en abril de 2027, 2 personas, saliendo de Ciudad de México";
const AI = {
  intencion: "viaje_futuro", origen: "Ciudad de México",
  paradas: [
    { id: "p1", ciudad: "Florencia", pais: "Italia", de_region: "Toscana", rol: "estancia", noches: 3, llegada_por: "por_definir", sugerida: true, texto: "Toscana" },
    { id: "p2", ciudad: "Siena", pais: "Italia", de_region: "Toscana", rol: "estancia", noches: 2, llegada_por: "por_definir", sugerida: true, texto: "Toscana" },
  ],
  regreso: { a: "Ciudad de México", via: null, modo: "por_definir" },
  fecha_salida: null, fecha_regreso: null, fechas_expresas: false, noches_total: 5, viajeros: 2,
  preferencias: [], reservas: [], menciones: [{ texto: "Toscana", tipo: "region", estado: "parada", ref: "p1" }],
  preguntas: [
    { id: "q1", tipo: "ciudades_de_pais", texto: "Toscana", pregunta: "Propongo Florencia y Siena como base para la Toscana. ¿Quieres confirmarlas?", opciones: ["Florencia y Siena"], parada: "p1" },
    { id: "q2", tipo: "fechas", texto: "fechas", pregunta: "¿Qué días exactos de abril de 2027 quieres viajar? ¿Los 5 días son 5 noches o 4?", opciones: [], parada: null },
  ],
  sugerencias: ["Florencia y Siena suman 5 noches si se reparten 3 en Florencia y 2 en Siena, lo que cubre los 5 días."],
};

describe("noches = días − 1, como Planear", () => {
  it("durationSaid coincide con Planear (durationOf)", () => {
    expect(durationSaid(TEXT)).toEqual({ days: 5, nights: 4 });
    expect(durationOf(TEXT).nights).toBe(4);
    expect(durationSaid("4 noches en Lima")).toEqual({ days: 5, nights: 4 });
    expect(durationSaid("dos semanas en Japón")?.nights).toBe(13);
  });

  it("interpretar-viaje: 4 noches, sin la sugerencia de 5 noches ni la pregunta «¿5 noches o 4?»", () => {
    const v = validateTripSpec(AI, TEXT, { origen: "Ciudad de México" });
    expect(v.ok).toBe(true);
    const s = finalizeSpec((v as any).spec, TEXT, { origen: "Ciudad de México" });
    expect(s.noches_total).toBe(4);
    expect(s.paradas.map((p) => p.noches)).toEqual([null, null]); // 3 + 2 ≠ 4: lo reparte el plan
    expect(s.sugerencias.join(" ")).not.toMatch(/5 noches/);
    const fechas = s.preguntas.find((q) => q.tipo === "fechas")!;
    expect(fechas.pregunta).toBe("¿Qué días exactos de abril de 2027 quieres viajar?");
  });

  it("un reparto que sí suma se respeta", () => {
    const ok = { ...AI, paradas: AI.paradas.map((p, i) => ({ ...p, noches: i === 0 ? 2 : 2 })), sugerencias: ["Florencia y Siena suman 4 noches: 2 y 2."] };
    const s = (validateTripSpec(ok, TEXT, { origen: "Ciudad de México" }) as any).spec;
    expect(s.paradas.map((p: any) => p.noches)).toEqual([2, 2]);
    expect(s.sugerencias).toEqual(["Florencia y Siena suman 4 noches: 2 y 2."]);
  });
});
