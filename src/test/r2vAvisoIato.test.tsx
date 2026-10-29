// R2 viajes (parcial de ronda 1, Toscana): el aviso seguía roto en todos los viajes — «Iato completó tu
// viaje: preguntó por «No indicaste cómo llegarán a Lima.» y «No indicaste…».» — y los botones «Quitar «No
// indicaste cómo llegarán a Lima.»» / «Quitar «Toscana»» confundían.
import React, { useState } from "react";
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TripSpecReview } from "@/components/plan/TripSpecReview";
import { draftNote, draftSpec, mergeDraftWithAi } from "@/lib/tripSpecDraft";
import { emptySpec, makeStop, openQuestions, type TripSpec } from "../../supabase/functions/_shared/tripSpec.ts";

const TODAY = new Date(2026, 9, 29);

function Harness({ initial }: { initial: TripSpec }) {
  const [spec, setSpec] = useState(initial);
  return <><TripSpecReview spec={spec} onChange={setSpec} onConfirm={() => {}} /><output data-testid="pend">{openQuestions(spec).length}</output></>;
}

describe("aviso de Iato sin frases de la IA entre comillas", () => {
  it("una pregunta libre nueva se cuenta, no se cita", () => {
    const t = "Toscana 5 días en abril de 2027 desde Ciudad de México, 2 personas";
    const draft = draftSpec(t, { origen: "Ciudad de México", today: TODAY });
    const ai: TripSpec = JSON.parse(JSON.stringify(draft));
    ai.preguntas.push({ id: "qx", tipo: "otro", texto: "No indicaste el ritmo del viaje.", pregunta: "¿Prefieren un ritmo tranquilo o intenso?", opciones: ["Tranquilo", "Intenso"], parada: null, resuelta: false });
    const m = mergeDraftWithAi(draft, draft, ai, { origen: "Ciudad de México", today: TODAY });
    expect(m.nota).toBe("Iato completó tu viaje: te dejó 1 pregunta abajo.");
    expect(m.nota).not.toMatch(/No indicaste|«/);
  });

  it("los nombres llevan su punto final fuera del aviso", () => {
    expect(draftNote([], ["las ciudades de Toscana."])).toBe("Iato completó tu viaje: preguntó por las ciudades de Toscana.");
    expect(draftNote(["Siena"], ["las fechas"], 2)).toBe("Iato completó tu viaje: agregó Siena; preguntó por las fechas; te dejó 2 preguntas abajo.");
  });
});

describe("botones claros en los pendientes", () => {
  it("pregunta libre: «Descartar esta pregunta» (sin «Quitar «No indicaste…»»)", () => {
    const spec = emptySpec("Lima", "ia");
    spec.origen = "Ciudad de México";
    spec.fecha_salida = "2027-02-11"; spec.fecha_regreso = "2027-02-16";
    spec.paradas = [makeStop("Lima", { id: "p1" })];
    spec.preguntas = [{ id: "q1", tipo: "otro", texto: "No indicaste el ritmo.", pregunta: "¿Prefieren un ritmo tranquilo o intenso?", opciones: ["Tranquilo"], parada: null, resuelta: false }];
    render(<Harness initial={spec} />);
    expect(screen.queryByText(/Quitar «/)).toBeNull();
    expect(screen.queryByText("Entendido")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Descartar esta pregunta" }));
    expect(screen.getByTestId("pend").textContent).toBe("0");
  });

  it("lugar: «Quitar Toscana del viaje»", () => {
    const spec = draftSpec("Toscana del 10 al 15 de abril de 2027 desde Ciudad de México", { origen: "Ciudad de México", today: TODAY });
    render(<Harness initial={spec} />);
    expect(screen.queryByText(/Quitar «/)).toBeNull();
    expect(screen.getByRole("button", { name: "Quitar Toscana del viaje" })).toBeInTheDocument();
  });
});
