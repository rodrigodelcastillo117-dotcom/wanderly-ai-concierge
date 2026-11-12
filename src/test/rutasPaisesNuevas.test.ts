// «Safari en Kenia 8 días, luna de miel» proponía solo Nairobi (recorrido 12-nov-2026): rutas clásicas para 11 países más.
import { describe, expect, it } from "vitest";
import { COUNTRY_ROUTES, countryRouteFor } from "@/lib/countryRoutes";
import { cityAirports, nearestAirport } from "../../supabase/functions/_shared/airports";

describe("rutas por país nuevas", () => {
  it("Kenia propone el safari en Masái Mara, no solo Nairobi", () => {
    const r = countryRouteFor("kenia");
    expect(r?.country).toBe("Kenia");
    expect(r?.stops.map((s) => s.city)).toEqual(["Nairobi", "Masái Mara", "Nairobi"]);
  });
  it.each(["Tanzania", "Sudáfrica", "Turquía", "Jordania", "Suiza", "Croacia", "Vietnam", "Argentina", "Chile", "Colombia"])("%s tiene ruta", (p) => {
    expect(countryRouteFor(p.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase())?.country).toBe(p);
  });
  it("cada parada se puede volar (aeropuerto propio o el más cercano) y la primera y la última tienen aeropuerto", () => {
    for (const r of COUNTRY_ROUTES) {
      for (const s of r.stops) expect(nearestAirport(s.city), `${r.country}: ${s.city}`).not.toBeNull();
      expect(cityAirports(r.stops[0].city), `${r.country} inicio`).not.toBeNull();
      expect(cityAirports(r.stops[r.stops.length - 1].city), `${r.country} final`).not.toBeNull();
    }
  });
});
