import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useState } from "react";
import { expandRegions, expandLegModes, expansionLine, findRegion } from "../../supabase/functions/_shared/regions";
import { applyRegionsToBody } from "../../supabase/functions/logistics-plan/regionsBody";
import { chosenNights } from "../../supabase/functions/_shared/booking/tripRoute";
import { logisticsPlanArgs, multiDestTripInsert } from "@/lib/multiDestGenerate";
import { RegionBases } from "@/components/route/RegionBases";

describe("regiones → ciudades base (tabla curada)", () => {
  it("Roma, Venecia, Florencia, Toscana con 4 noches en Toscana → Siena y Lucca, 2 y 2", () => {
    const r = expandRegions(["Roma", "Venecia", "Florencia", "Toscana"], [3, 2, 2, 4]);
    expect(r.destinations).toEqual(["Roma", "Venecia", "Florencia", "Siena", "Lucca"]);
    expect(r.nightsPerCity).toEqual([3, 2, 2, 2, 2]);
    expect(r.expansions).toEqual([{ region: "Toscana", ciudades: ["Siena", "Lucca"] }]);
    expect(expansionLine(r.expansions[0])).toBe("Toscana: te armamos la ruta por Siena y Lucca");
  });

  it("noches: ≤2 → 1 base; 5+ → 3 bases con el reparto", () => {
    expect(expandRegions(["Roma", "Toscana"], [3, 2]).destinations).toEqual(["Roma", "Florencia"]);
    const r = expandRegions(["Toscana", "Roma"], [5, 2]);
    expect(r.destinations).toEqual(["Florencia", "Siena", "Lucca", "Roma"]);
    expect(r.nightsPerCity).toEqual([2, 2, 1, 2]);
  });

  it("región sin noches: 2 bases y las noches quedan sin definir", () => {
    const r = expandRegions(["Roma", "Costa Amalfitana"]);
    expect(r.destinations).toEqual(["Roma", "Positano", "Amalfi"]);
    expect(r.nightsPerCity).toBeUndefined();
  });

  it("no repite una base que ya está en la lista", () => {
    const r = expandRegions(["Siena", "Florencia", "Toscana"], [2, 2, 4]);
    expect(r.destinations).toEqual(["Siena", "Florencia", "Lucca", "Pisa"]);
    expect(r.nightsPerCity).toEqual([2, 2, 2, 2]);
  });

  it("alias y mayúsculas/acentos: Tuscany, toscana, la Toscana, ANDALUCIA", () => {
    expect(expandRegions(["Tuscany"]).expansions[0].region).toBe("Toscana");
    expect(expandRegions(["toscana"]).destinations).toEqual(["Florencia", "Siena"]);
    expect(findRegion("la Toscana")?.name).toBe("Toscana");
    expect(expandRegions(["ANDALUCIA"]).destinations).toEqual(["Sevilla", "Granada"]);
    expect(findRegion("Côte d'Azur")?.name).toBe("Riviera Francesa");
  });

  it("ciudades normales y regiones que no están en la tabla quedan intactas", () => {
    const r = expandRegions(["París", "Roma", "Patagonia"], [3, 3, 3]);
    expect(r.destinations).toEqual(["París", "Roma", "Patagonia"]);
    expect(r.nightsPerCity).toEqual([3, 3, 3]);
    expect(r.expansions).toEqual([]);
  });

  it("bases elegidas por la persona: solo las de la tabla", () => {
    const r = expandRegions(["Roma", "Toscana"], [2, 4], { Toscana: ["Lucca", "Siena", "Atlantis"] });
    expect(r.destinations).toEqual(["Roma", "Siena", "Lucca"]);
    expect(expandRegions(["Toscana"], null, { Toscana: ["Atlantis"] }).destinations).toEqual(["Florencia", "Siena"]);
  });

  it("modos por tramo (mixto) se llevan a la lista expandida", () => {
    const r = expandRegions(["Roma", "Florencia", "Toscana"]);
    expect(expandLegModes(["tren", "coche"], r.sourceIndex)).toEqual(["tren", "coche", "coche"]);
  });
});

describe("logistics-plan usa la lista expandida", () => {
  it("cuerpo: destinos, noches por ciudad y modos por tramo; las noches siguen valiendo (chosenNights)", async () => {
    const body: any = {
      origin: "Ciudad de México",
      destinations: ["Roma", "Venecia", "Florencia", "Toscana"],
      nights_per_city: [3, 2, 2, 4],
      prefs: { transport_mode: "mixto", leg_modes: ["tren", "tren", "coche"] },
    };
    const exp = (await applyRegionsToBody(body)).expansions;
    expect(exp).toEqual([{ region: "Toscana", ciudades: ["Siena", "Lucca"] }]);
    expect(body.destinations).toEqual(["Roma", "Venecia", "Florencia", "Siena", "Lucca"]);
    expect(body.nights_per_city).toEqual([3, 2, 2, 2, 2]);
    expect(body.prefs.leg_modes).toEqual(["tren", "tren", "coche", "coche"]);
    expect(chosenNights(body.nights_per_city, body.destinations.length, 11)).toEqual([3, 2, 2, 2, 2]);
    // Sin regiones no toca nada.
    const plain: any = { destinations: ["Roma", "Florencia"], nights_per_city: [2, 2] };
    expect((await applyRegionsToBody(plain)).expansions).toEqual([]);
    expect(plain.destinations).toEqual(["Roma", "Florencia"]);
  });

  it("el viaje se guarda con las ciudades del servidor y sus expansiones", () => {
    const a = { userId: "u1", origin: "CDMX", stops: ["Roma", "Toscana"], viajeros: 2, prefs: {}, regionBases: { Toscana: ["Siena", "Lucca"] } };
    expect(logisticsPlanArgs(a).region_bases).toEqual({ Toscana: ["Siena", "Lucca"] });
    const row = multiDestTripInsert(a, {
      destinations: ["Roma", "Siena", "Lucca"],
      region_expansions: [{ region: "Toscana", ciudades: ["Siena", "Lucca"] }],
      per_destination: [], days: [],
    });
    expect(row.destino).toBe("Roma → Siena → Lucca");
    expect(row.itinerario_json.destinations).toEqual(["Roma", "Siena", "Lucca"]);
    expect(row.itinerario_json.region_expansions).toHaveLength(1);
  });
});

describe("RegionBases (vista previa antes de generar)", () => {
  function Harness() {
    const [choices, setChoices] = useState<Record<string, string[]>>({});
    return <RegionBases stops={["Roma", "Toscana"]} nights={[3, 4]} choices={choices} onChange={setChoices} />;
  }
  it("muestra Toscana → Florencia · Siena y deja quitar o cambiar una base", () => {
    render(<Harness />);
    const box = screen.getByTestId("region-bases");
    expect(box.textContent).toContain("Toscana →");
    expect(box.textContent).toContain("Florencia");
    expect(box.textContent).toContain("Siena");
    expect(screen.getByLabelText("Agregar Arezzo")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Quitar Siena"));
    expect(screen.queryByLabelText("Quitar Siena")).toBeNull();
    expect(screen.getByLabelText("Agregar Siena")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Agregar Lucca"));
    expect(screen.queryByLabelText("Agregar Lucca")).toBeNull();
    expect(screen.getByLabelText("Quitar Lucca")).toBeTruthy();
  });
  it("sin regiones no muestra nada", () => {
    const { container } = render(<RegionBases stops={["Roma", "París"]} choices={{}} onChange={() => {}} />);
    expect(container.textContent).toBe("");
  });
});
