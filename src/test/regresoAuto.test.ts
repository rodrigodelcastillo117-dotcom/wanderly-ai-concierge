// «6 días» y solo la fecha de salida: el regreso se llena solo (recorrido road trip, 9-nov-2026).
import { describe, expect, it } from "vitest";
import { emptySpec, setTripBasics } from "../../supabase/functions/_shared/tripSpec.ts";

const base = () => ({ ...emptySpec("ia"), noches_total: 5, preguntas: [{ id: "q", tipo: "fechas", texto: "fechas", pregunta: "¿Qué fechas?", opciones: [], parada: null, resuelta: false }] } as any);

describe("setTripBasics: regreso automático", () => {
  it("salida + 5 noches = regreso, y la pregunta de fechas queda resuelta", () => {
    const s = setTripBasics(base(), { fecha_salida: "2027-04-08" });
    expect(s.fecha_regreso).toBe("2027-04-13");
    expect(s.noches_total).toBe(5);
    expect(s.preguntas[0].resuelta).toBe(true);
  });
  it("si la nueva salida pasa el regreso, el regreso se recorre con las mismas noches", () => {
    const s = setTripBasics(setTripBasics(base(), { fecha_salida: "2027-04-08" }), { fecha_salida: "2027-04-20" });
    expect(s.fecha_regreso).toBe("2027-04-25");
  });
  it("un regreso elegido por la persona no se toca", () => {
    const a = setTripBasics(setTripBasics(base(), { fecha_salida: "2027-04-08" }), { fecha_regreso: "2027-04-16" });
    expect(setTripBasics(a, { fecha_salida: "2027-04-09" }).fecha_regreso).toBe("2027-04-16");
  });
  it("sin duración: el regreso queda vacío", () => {
    const s = setTripBasics({ ...base(), noches_total: null }, { fecha_salida: "2027-04-08" });
    expect(s.fecha_regreso).toBeNull();
  });
});

import { applySaidDuration, makeStop } from "../../supabase/functions/_shared/tripSpec.ts";
describe("«6 días» en 3 ciudades: reparto propuesto, sin preguntar", () => {
  it("2, 2 y 1 noches y la pregunta de repartir queda resuelta", () => {
    const s: any = { ...emptySpec("ia"), paradas: ["Querétaro", "San Miguel de Allende", "Guanajuato"].map((c) => makeStop(c)),
      preguntas: [{ id: "q2", tipo: "otro", texto: "x", pregunta: "¿Cómo quieres repartir las 5 noches entre Querétaro, San Miguel de Allende y Guanajuato?", opciones: [], parada: null, resuelta: false }] };
    const r = applySaidDuration(s, "Road trip a Querétaro, San Miguel de Allende y Guanajuato, 6 días");
    expect(r.paradas.map((p: any) => p.noches)).toEqual([2, 2, 1]);
    expect(r.preguntas[0].resuelta).toBe(true);
  });
});
