// Defectos 9 y 10 (E2E 28-oct-2026, "Viaje de 4 días a Valle de Bravo en coche desde CDMX"), con la
// interpretación EXACTA que mandó interpretar-viaje en producción:
//  9. "Regresas a Ciudad de México · el vuelo de regreso sale de Valle de Bravo" en un viaje en coche.
// 10. "¿Cuántos viajeros son?" sin campo; "¿Cuántas noches?" solo con "3 noches" (venían "4 noches" y
//     "Otro número"); "¿Regresas en coche?" aunque el texto ya decía "en coche".
import React, { useState } from "react";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { TripSpecReview } from "@/components/plan/TripSpecReview";
import { finalizeSpec } from "@/lib/tripSpecLocal";
import { answerKindOf, numericOptions, returnLegText, tripModeFromText } from "@/lib/tripSpecAnswers";
import { openQuestions, type TripSpec } from "../../supabase/functions/_shared/tripSpec";

const TEXTO = "Viaje de 4 días a Valle de Bravo en coche desde CDMX";
const serverSpec = (): TripSpec => JSON.parse(JSON.stringify({
  version: 1, consulta_original: TEXTO, intencion: "viaje_futuro", origen: "Ciudad de México",
  paradas: [{ id: "p1", ciudad: "Valle de Bravo", pais: "México", de_region: null, es_puerto: false, rol: "estancia", noches: null, llegada_por: "coche", crucero: null, sugerida: false, texto: "Valle de Bravo" }],
  regreso: { a: "Ciudad de México", via: null, modo: "coche" }, fecha_salida: null, fecha_regreso: null, fechas_expresas: false, noches_total: null, viajeros: null,
  preferencias: ["Duración del viaje: 4 días"], reservas: [],
  menciones: [
    { texto: "Viaje de 4 días", tipo: "otro", estado: "preferencia", ref: null },
    { texto: "Valle de Bravo", tipo: "ciudad", estado: "parada", ref: "p1" },
    { texto: "en coche", tipo: "tramo", estado: "tramo", ref: "p1" },
    { texto: "desde CDMX", tipo: "origen", estado: "origen", ref: null },
  ],
  preguntas: [
    { id: "q1", tipo: "fechas", texto: "No indicaste las fechas del viaje.", pregunta: "¿Cuándo quieres salir a Valle de Bravo?", opciones: [], parada: "p1", resuelta: false },
    { id: "q2", tipo: "otro", texto: "Los 4 días pueden ser 3 o 4 noches según cómo lo cuentes.", pregunta: "¿Cuántas noches te quedarías en Valle de Bravo?", opciones: ["3 noches", "4 noches", "Otro número"], parada: "p1", resuelta: false },
    { id: "q3", tipo: "otro", texto: "No indicaste cómo regresas a Ciudad de México.", pregunta: "¿Regresas a Ciudad de México en coche o de otra forma?", opciones: ["Coche", "Otro medio", "Aún no lo sé"], parada: null, resuelta: false },
    { id: "q4", tipo: "otro", texto: "No indicaste cuántas personas viajan.", pregunta: "¿Cuántos viajeros son?", opciones: ["1", "2", "3", "4", "Más de 4"], parada: null, resuelta: false },
  ],
  sugerencias: [], fuente: "ia",
}));

function Harness({ initial, onSpec }: { initial: TripSpec; onSpec?: (s: TripSpec) => void }) {
  const [spec, setSpec] = useState(initial);
  return <TripSpecReview spec={spec} onChange={(s) => { setSpec(s); onSpec?.(s); }} onConfirm={() => {}} />;
}

describe("lógica de las respuestas", () => {
  it("reconoce viajeros, noches y regreso; lee todas las opciones numéricas", () => {
    const s = serverSpec();
    expect(s.preguntas.map(answerKindOf)).toEqual(["otro", "noches", "regreso_modo", "viajeros"]);
    expect(numericOptions(s.preguntas[1])).toEqual({ numbers: [3, 4], other: "Otro número" });
    expect(numericOptions(s.preguntas[3])).toEqual({ numbers: [1, 2, 3, 4], other: "Más de 4" });
    expect(tripModeFromText(TEXTO)).toBe("coche");
    expect(tripModeFromText("Madrid en avión y regreso en tren")).toBeNull();
  });

  it("'¿Regresas en coche?' no se pregunta si el texto ya dice 'en coche' (finalizeSpec en el cliente)", () => {
    const s = finalizeSpec(serverSpec(), TEXTO, { origen: "Ciudad de México" });
    expect(openQuestions(s).map((q) => q.id)).toEqual(["q1", "q2", "q4"]);
    expect(s.regreso.modo).toBe("coche");
  });
});

describe("resumen en pantalla", () => {
  it("9 · el regreso dice el modo real: en coche, no 'el vuelo de regreso'", () => {
    render(<Harness initial={finalizeSpec(serverSpec(), TEXTO)} />);
    const row = screen.getByTestId("spec-regreso");
    expect(row.textContent).toContain("regresas en coche desde Valle de Bravo");
    expect(row.textContent).not.toMatch(/vuelo de regreso/);
    // Cambiarlo a vuelo cambia la frase.
    fireEvent.change(within(row).getByLabelText("Cómo regresas"), { target: { value: "vuelo" } });
    expect(screen.getByTestId("spec-regreso").textContent).toContain("el vuelo de regreso sale de Valle de Bravo");
    expect(returnLegText({ ...serverSpec(), regreso: { a: "CDMX", via: null, modo: "por_definir" } })).toBe("regresas desde Valle de Bravo (cómo: por definir)");
  });

  it("10 · noches: todas las opciones y 'Otro número' con campo", () => {
    let last: TripSpec | null = null;
    render(<Harness initial={finalizeSpec(serverSpec(), TEXTO)} onSpec={(s) => { last = s; }} />);
    const noches = screen.getAllByTestId("spec-pregunta").find((li) => /Cuántas noches/.test(li.textContent ?? ""))!;
    expect(within(noches).getAllByTestId("spec-opcion").map((b) => b.textContent)).toEqual(["3 noches", "4 noches"]);
    fireEvent.click(within(noches).getByTestId("spec-opcion-otro"));
    fireEvent.change(within(noches).getByTestId("spec-numero"), { target: { value: "5" } });
    fireEvent.click(within(noches).getByRole("button", { name: "Usar" }));
    expect(last!.paradas[0].noches).toBe(5);
    expect(screen.queryAllByTestId("spec-pregunta").some((li) => /Cuántas noches/.test(li.textContent ?? ""))).toBe(false);
  });

  it("10 · viajeros: selector de número (1–4 y 'Más de 4' con campo)", () => {
    let last: TripSpec | null = null;
    render(<Harness initial={finalizeSpec(serverSpec(), TEXTO)} onSpec={(s) => { last = s; }} />);
    const viajeros = screen.getAllByTestId("spec-pregunta").find((li) => /Cuántos viajeros/.test(li.textContent ?? ""))!;
    expect(within(viajeros).getAllByTestId("spec-opcion").map((b) => b.textContent)).toEqual(["1", "2", "3", "4"]);
    fireEvent.click(within(viajeros).getByText("Más de 4"));
    fireEvent.change(within(viajeros).getByTestId("spec-numero"), { target: { value: "6" } });
    fireEvent.click(within(viajeros).getByRole("button", { name: "Usar" }));
    expect(last!.viajeros).toBe(6);
    expect(screen.queryAllByTestId("spec-pregunta").some((li) => /Cuántos viajeros/.test(li.textContent ?? ""))).toBe(false);
  });

  it("10 · poner los viajeros en el campo de abajo también contesta la pregunta", () => {
    render(<Harness initial={finalizeSpec(serverSpec(), TEXTO)} />);
    fireEvent.change(screen.getByLabelText("Viajeros"), { target: { value: "2" } });
    expect(screen.queryAllByTestId("spec-pregunta").some((li) => /Cuántos viajeros/.test(li.textContent ?? ""))).toBe(false);
  });
});
