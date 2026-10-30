// "Mi mundo" (Perfil): países y ciudades de tus viajes, hechos y planeados, solo con datos reales y sin
// geocodificar (cero búsquedas de pago). Cálculo puro: src/lib/miMundo.ts.
import { describe, expect, it } from "vitest";
import { buildMiMundo, knownPlace, paisesTexto, tripEstado, type MundoTrip } from "@/lib/miMundo";

const HOY = "2026-10-29";
const T = (id: string, destino: string, pais: string | null, salida: string | null, regreso: string | null, destinations?: string[]): MundoTrip => ({
  id, destino, pais_destino: pais, fecha_salida: salida, fecha_regreso: regreso, itinerario_json: destinations ? { multi: true, destinations } : {},
});

const CARLO: MundoTrip[] = [
  T("jp", "Tokio → Kioto → Osaka", "Japón", "2027-03-20", "2027-03-29", ["Tokio", "Kioto", "Osaka"]),
  T("pt", "Lisboa → Sintra → Oporto", "Portugal", "2025-05-02", "2025-05-11", ["Lisboa", "Sintra", "Oporto"]),
  T("es", "Madrid", "España", "2027-02-10", "2027-02-15"),
  T("pt2", "Oporto", "Portugal", "2027-06-01", "2027-06-05"),
];

describe("Mi mundo · países y ciudades de tus viajes", () => {
  it("Tokio → Kioto → Osaka (planeado) y Lisboa → Sintra → Oporto (hecho): países, ciudades y estados", () => {
    const m = buildMiMundo(CARLO, HOY);
    const pais = (iso: string) => m.paises.find((p) => p.iso2 === iso);
    expect(pais("JP")).toMatchObject({ name: "Japón", estado: "planeado", ciudades: 3 });
    expect(pais("PT")).toMatchObject({ name: "Portugal", estado: "hecho", ciudades: 3 });
    expect(pais("ES")).toMatchObject({ name: "España", estado: "planeado" });
    expect(m.paises).toHaveLength(3);
    expect(m.paisesHechos).toBe(1);
    expect(m.paisesPlaneados).toBe(2);
    // Los hechos primero.
    expect(m.paises[0].iso2).toBe("PT");

    const city = (name: string) => m.ciudades.find((c) => c.name === name);
    for (const n of ["Tokio", "Kioto", "Osaka"]) expect(city(n)?.estado, n).toBe("planeado");
    for (const n of ["Lisboa", "Sintra", "Oporto"]) expect(city(n)?.estado, n).toBe("hecho");
    // Oporto también está en un viaje planeado: cuenta como hecho y en 2 viajes.
    expect(city("Oporto")).toMatchObject({ estado: "hecho", viajes: 2 });
    // Coordenadas reales de las tablas de la app (Sintra y Kioto no tienen aeropuerto: TOWNS).
    expect(city("Sintra")).toMatchObject({ lat: 38.8, lng: -9.381, iso2: "PT" });
    expect(city("Kioto")).toMatchObject({ lat: 35.011, lng: 135.768, iso2: "JP" });
    expect(m.ciudades).toHaveLength(7);
    expect(m.sinCoordenadas).toEqual([]);
    expect(m.viajes).toBe(4);
  });

  it("una ciudad sin coordenadas conocidas igual cuenta su país (no se geocodifica)", () => {
    const m = buildMiMundo([T("x", "Hoi An", "Vietnam", "2025-01-10", "2025-01-15")], HOY);
    expect(m.ciudades).toEqual([]);
    expect(m.sinCoordenadas).toEqual(["Hoi An"]);
    expect(m.paises).toEqual([expect.objectContaining({ name: "Vietnam", estado: "hecho" })]);
  });

  it("hecho = el viaje ya empezó (vivido o en curso); por venir o sin fecha = planeado", () => {
    expect(tripEstado({ fecha_salida: "2025-01-01", fecha_regreso: "2025-01-05" }, HOY)).toBe("hecho");
    expect(tripEstado({ fecha_salida: "2026-10-25", fecha_regreso: "2026-11-02" }, HOY)).toBe("hecho");
    expect(tripEstado({ fecha_salida: "2026-11-01", fecha_regreso: "2026-11-05" }, HOY)).toBe("planeado");
    expect(tripEstado({ fecha_salida: null, fecha_regreso: null }, HOY)).toBe("planeado");
  });

  it("lee la lista de ciudades aunque la consulta solo traiga itinerario_json->destinations", () => {
    const m = buildMiMundo([{ id: "a", destino: "Tokio → Kioto → Osaka", pais_destino: "Japón", fecha_salida: "2027-03-20", fecha_regreso: "2027-03-29", destinations: ["Tokio", "Kioto", "Osaka"] }], HOY);
    expect(m.ciudades.map((c) => c.name)).toEqual(["Tokio", "Kioto", "Osaka"]);
  });

  it("sin viajes: nada que pintar", () => {
    const m = buildMiMundo([], HOY);
    expect(m).toMatchObject({ ciudades: [], paises: [], paisesHechos: 0, paisesPlaneados: 0, viajes: 0 });
  });

  it("knownPlace y el texto del conteo", () => {
    expect(knownPlace("Lisbon")).toMatchObject({ name: "Lisboa", iso2: "PT" });
    expect(knownPlace("Ciudad Inventada")).toBeNull();
    expect(paisesTexto(1)).toBe("1 país");
    expect(paisesTexto(3)).toBe("3 países");
  });
});
