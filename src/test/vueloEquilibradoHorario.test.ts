// Recorrido 11-nov-2026, viaje de negocios CDMX→Monterrey: «Equilibrado» era Viva 22:55 → 00:32 por $5,523 mientras
// Viva 16:00 costaba $4,926. Un nivel no puede ser peor en precio y en horario que otra opción real.
import { describe, expect, it } from "vitest";
import { awkwardHours, preferComfortableEquilibrio } from "../../supabase/functions/analizar-viaje/flightAlternatives";

const v = (tier: string, pp: number, salida?: string, llegada?: string) => ({ tier, aerolinea: "Viva", precio_por_persona: pp, ...(salida ? { salida } : {}), ...(llegada ? { llegada } : {}) });

describe("«Equilibrado» con horario razonable", () => {
  it("cambia el de 22:55→00:32 por el de 16:00 que cuesta menos; el otro queda como alternativa", () => {
    const rows = [
      v("ahorro", 4926), v("equilibrio", 5523, "2026-11-17 22:55", "2026-11-18 00:32"), v("premium", 5934),
      v("alternativa", 4926, "2026-11-17 16:00", "2026-11-17 17:35"), v("alternativa", 4926, "2026-11-17 22:35", "2026-11-18 00:10"),
      v("alternativa", 5934, "2026-11-17 16:15", "2026-11-17 17:50"),
    ];
    const out = preferComfortableEquilibrio(rows);
    const eq = out.find((x) => x.tier === "equilibrio")!;
    expect(eq.salida).toBe("2026-11-17 16:00");
    expect(eq.precio_por_persona).toBe(4926);
    expect(out.filter((x) => x.tier === "alternativa").some((x) => x.salida === "2026-11-17 22:55")).toBe(true);
    expect(out).toHaveLength(rows.length);
    expect(out.filter((x) => x.tier === "equilibrio")).toHaveLength(1);
  });
  it("no cambia nada si el horario ya es bueno, o si la opción buena cuesta más", () => {
    const ok = [v("equilibrio", 5000, "2026-11-17 09:00", "2026-11-17 10:40"), v("alternativa", 4000, "2026-11-17 12:00", "2026-11-17 13:40")];
    expect(preferComfortableEquilibrio(ok)).toEqual(ok);
    const caro = [v("equilibrio", 5000, "2026-11-17 23:30", "2026-11-18 01:00"), v("alternativa", 5600, "2026-11-17 12:00", "2026-11-17 13:40")];
    expect(preferComfortableEquilibrio(caro)).toEqual(caro);
  });
  it("horario incómodo: sale antes de las 6 o llega a las 23 o de madrugada", () => {
    expect(awkwardHours(v("x", 1, "2026-11-17 05:10", "2026-11-17 07:00"))).toBe(true);
    expect(awkwardHours(v("x", 1, "2026-11-17 21:00", "2026-11-17 23:15"))).toBe(true);
    expect(awkwardHours(v("x", 1, "2026-11-17 08:00", "2026-11-17 10:00"))).toBe(false);
    expect(awkwardHours(v("x", 1))).toBe(false);
  });
});

describe("«Ahorro» es el vuelo más barato", () => {
  it("intercambia nivel si «Equilibrado» o «Premium» cuesta menos (mochilero CDMX → Bacalar)", async () => {
    const { cheapestIsAhorro } = await import("../../supabase/functions/analizar-viaje/flightAlternatives");
    const rows = [v("ahorro", 3172), v("equilibrio", 2556), v("premium", 3209)];
    const out = cheapestIsAhorro(rows);
    expect(out.find((x) => x.tier === "ahorro")!.precio_por_persona).toBe(2556);
    expect(out.find((x) => x.tier === "equilibrio")!.precio_por_persona).toBe(3172);
    expect(cheapestIsAhorro([v("ahorro", 2000), v("equilibrio", 2500)])).toEqual([v("ahorro", 2000), v("equilibrio", 2500)]);
    const bus = { tier: "ahorro", modo: "autobus", precio_por_persona: 0 };
    expect(cheapestIsAhorro([bus, v("equilibrio", 2500)])).toEqual([bus, v("equilibrio", 2500)]);
  });
});
