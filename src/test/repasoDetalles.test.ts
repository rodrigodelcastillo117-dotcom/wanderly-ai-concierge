// Recorrido en producción (9-nov-2026): «Elegir vuelo y hotel» del Inicio abría la pestaña Resumen (con el tutorial) en
// vez de Comprar; el aviso del globo decía «usa la rueda para zoom» en el celular.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { nextTripAction } from "@/lib/tripCommand";

describe("botón «Elegir vuelo y hotel»", () => {
  const base = { id: "t1", fecha_salida: "2027-03-10", fecha_regreso: "2027-03-17", total_estimado: 81831, created_at: "2026-10-28T15:00:00Z" };
  const NOW = new Date("2026-10-28T16:00:00Z");
  it("lleva directo a la pestaña Comprar del viaje", () => {
    expect(nextTripAction(base, { today: "2026-10-28", now: NOW, missing: ["hotel"] })).toMatchObject({ cta: "Elegir vuelo y hotel", to: "/dashboard/viajes/t1#comprar" });
    expect(nextTripAction(base, { today: "2026-10-28", now: NOW })).toMatchObject({ to: "/dashboard/viajes/t1#comprar" });
    expect(nextTripAction(base, { today: "2026-10-28", now: NOW, missing: [] })).toMatchObject({ cta: "Ver tu selección", to: "/dashboard/viajes/t1#comprar" });
  });
});

describe("aviso del globo", () => {
  it("en pantallas táctiles dice pellizcar, no la rueda del ratón", () => {
    const src = readFileSync("src/components/RouteGlobe3D.tsx", "utf8");
    expect(src).toMatch(/matchMedia\("\(pointer: coarse\)"\)/);
    expect(src).toMatch(/pellizca para acercar/);
  });
});

describe("notificaciones sin jerga interna", () => {
  it("«pedir ayuda al Fixer» se lee «pedir ayuda a una persona del equipo IATOS»", async () => {
    const { sinJerga } = await import("@/components/NotificationBell");
    expect(sinJerga("Puedes llamar al restaurante o pedir ayuda al Fixer.")).toBe("Puedes llamar al restaurante o pedir ayuda a una persona del equipo IATOS.");
    expect(sinJerga("Solicitud al Fixer enviada")).toBe("Solicitud a una persona del equipo IATOS enviada");
    expect(sinJerga("Tu vuelo sale a tiempo")).toBe("Tu vuelo sale a tiempo");
    expect(sinJerga(null)).toBe("");
  });
});
