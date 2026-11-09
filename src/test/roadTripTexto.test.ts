// Viajes por carretera en México (recorrido 9-nov-2026): «Road trip en coche desde CDMX a …» salía como una ciudad
// desconocida y el viaje salía de la ciudad del perfil; Saltillo, Zacatecas, Morelia… no se reconocían.
import { describe, expect, it } from "vitest";
import { MX_PLACES, parseMultiCityText } from "@/lib/multiCityText";

describe("road trip en México: lector rápido", () => {
  it("«Road trip en coche desde CDMX a …»: sale de CDMX, 3 paradas, aunque el perfil diga Querétaro", () => {
    const p = parseMultiCityText("Road trip en coche desde Ciudad de México a Querétaro, San Miguel de Allende y Guanajuato, 6 días, 2 adultos", { origin: "Querétaro" });
    expect(p).toMatchObject({ origin: "Ciudad de México", cities: ["Querétaro", "San Miguel de Allende", "Guanajuato"], nights: 5, unknown: [] });
  });
  it("«En coche de CDMX a …» y «por carretera desde Monterrey a …»", () => {
    expect(parseMultiCityText("En coche de CDMX a Querétaro y Guanajuato, 5 días")).toMatchObject({ origin: "Ciudad de México", cities: ["Querétaro", "Guanajuato"] });
    expect(parseMultiCityText("Viaje por carretera desde Monterrey a Saltillo y Zacatecas")).toMatchObject({ origin: "Monterrey", cities: ["Saltillo", "Zacatecas"], unknown: [] });
  });
  it("todos los lugares de México de la lista se reconocen", () => {
    const sin = MX_PLACES.filter((c) => parseMultiCityText(`${c} y Puebla`).unknown.length > 0);
    expect(sin).toEqual([]);
  });
});
