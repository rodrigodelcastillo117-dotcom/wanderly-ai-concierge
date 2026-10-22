import { describe, it, expect } from "vitest";
import { homeTrips } from "@/lib/homeTrips";

// E-11: el viaje activo se elige por fechas, no por el orden de creación.
const today = "2026-10-22";
const trips = [
  // creado al último, pero ya terminó
  { id: "pasado", destino: "Roma", fecha_salida: "2026-09-01", fecha_regreso: "2026-09-10", created_at: "2026-10-21" },
  // creado al último también, sale en 3 días
  { id: "proximo", destino: "Lima", fecha_salida: "2026-10-25", fecha_regreso: "2026-10-30", created_at: "2026-10-20" },
  // el más viejo de crear, pero está en curso hoy
  { id: "en-curso", destino: "Tokio", fecha_salida: "2026-10-18", fecha_regreso: "2026-10-28", created_at: "2026-01-05" },
  { id: "lejano", destino: "Oslo", fecha_salida: "2027-02-01", fecha_regreso: "2027-02-08", created_at: "2026-03-01" },
];

describe("homeTrips", () => {
  it("el viaje en curso es el activo aunque sea el más antiguo de crear", () => {
    const r = homeTrips(trips, today);
    expect(r.active?.id).toBe("en-curso");
    expect(r.upcoming).toBeNull();
    expect(r.list.map((t) => t.id)).toEqual(["en-curso", "proximo"]);
  });

  it("sin viaje en curso: 'próximo' es el que sale en ≤7 días; los pasados no salen", () => {
    const r = homeTrips(trips.filter((t) => t.id !== "en-curso"), today);
    expect(r.active).toBeNull();
    expect(r.upcoming?.id).toBe("proximo");
    expect(r.list.map((t) => t.id)).toEqual(["proximo", "lejano"]);
  });

  it("el último día del viaje todavía cuenta como en curso; el día siguiente ya no", () => {
    const t = [{ id: "x", fecha_salida: "2026-10-15", fecha_regreso: "2026-10-22" }];
    expect(homeTrips(t, "2026-10-22").active?.id).toBe("x");
    expect(homeTrips(t, "2026-10-23").active).toBeNull();
    expect(homeTrips(t, "2026-10-23").list).toEqual([]);
  });
});
