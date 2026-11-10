// Recorrido familia 10-nov-2026: «Mérida 3 noches y Cancún 4 noches» salía Mérida 4 / Cancún 3 (reparto parejo).
import { describe, expect, it } from "vitest";
import { buildLocalSpec, nochesTrasCiudad } from "@/lib/tripSpecLocal";

describe("noches escritas después de la ciudad", () => {
  it("lee «Ciudad N noches», «Ciudad (N noches)», «Ciudad por N noches»", () => {
    expect(nochesTrasCiudad("Mérida 3 noches y Cancún 4 noches", "Mérida")).toBe(3);
    expect(nochesTrasCiudad("Mérida 3 noches y Cancún 4 noches", "Cancún")).toBe(4);
    expect(nochesTrasCiudad("Oaxaca (2 noches), luego Puebla", "Oaxaca")).toBe(2);
    expect(nochesTrasCiudad("San Miguel de Allende por 3 noches", "San Miguel de Allende")).toBe(3);
  });
  it("no toma un total («Mérida y Cancún 7 noches en total»)", () => {
    expect(nochesTrasCiudad("Mérida y Cancún 7 noches en total", "Cancún")).toBeUndefined();
  });
  it("el viaje familiar queda Mérida 3 y Cancún 4", () => {
    const spec = buildLocalSpec("Mérida 3 noches y Cancún 4 noches, del 12 al 19 de diciembre de 2026, con mi esposa y nuestros 2 hijos de 5 y 10 años, saliendo de Ciudad de México", { today: new Date(2026, 10, 10) });
    expect(spec.paradas.map((p) => [p.ciudad, p.noches])).toEqual([["Mérida", 3], ["Cancún", 4]]);
    expect(spec.viajeros).toBe(4);
    expect(spec.origen).toBe("Ciudad de México");
  });
});
