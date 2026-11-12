// 12-nov-2026: «checa ciudades de trenes, África, Europa, Asia, todo». Un viaje que terminaba en Valencia salía sin vuelo con
// precio real (no estaba en la tabla). Ciudades con aeropuerto en todo el mundo y pueblos sin aeropuerto → el más cercano.
import { describe, expect, it } from "vitest";
import { cityAirports, nearestAirport } from "../../supabase/functions/_shared/airports";
import { planOpenJaw } from "../../supabase/functions/logistics-plan/openJaw";

describe("ciudades del mundo", () => {
  it.each([
    ["Valencia", "VLC"], ["Málaga", "AGP"], ["Mallorca", "PMI"], ["Bruselas", "BRU"], ["Estocolmo", "ARN"], ["Dubrovnik", "DBV"],
    ["Salzburgo", "SZG"], ["Nairobi", "NBO"], ["Kilimanjaro", "JRO"], ["Cataratas Victoria", "VFA"], ["Maldivas", "MLE"], ["Taipéi", "TPE"],
    ["Bariloche", "BRC"], ["Galápagos", "GPS"], ["Melbourne", "MEL"], ["Bora Bora", "BOB"], ["Boston", "BOS"], ["Honolulu", "HNL"],
  ])("%s tiene aeropuerto (%s)", (c, code) => expect(cityAirports(c)?.airports).toContain(code));

  it.each([
    ["Interlaken", "ZRH"], ["Hallstatt", "SZG"], ["Brujas", "BRU"], ["Cinque Terre", "PSA"], ["Petra", "AQJ"], ["Masái Mara", "NBO"],
    ["Ubud", "DPS"], ["Hoi An", "DAD"], ["San Pedro de Atacama", "CJC"], ["Torres del Paine", "PNT"], ["Kotor", "DBV"], ["Zermatt", "MXP"], ["Mont Saint-Michel", "RNS"], ["Gran Cañón", "FLG"],
  ])("%s (sin aeropuerto) vuela a %s", (place, code) => expect(nearestAirport(place)?.airport).toBe(code));

  it("Madrid → Barcelona → Valencia ya busca el vuelo real (antes: sin_aeropuerto:Valencia)", () => {
    const r = planOpenJaw({ origin: "Ciudad de México", destinations: ["Madrid", "Barcelona", "Valencia"], fecha_salida: "2027-09-08", fecha_regreso: "2027-09-18", num_viajeros: 2 } as never);
    expect(r.ok).toBe(true);
  });

  it("los nombres de país no se vuelven una ciudad (las rutas por país siguen igual)", () => {
    for (const p of ["Jordania", "Namibia", "Guatemala", "Montenegro", "Chipre"]) expect(cityAirports(p)).toBeNull();
  });
});
