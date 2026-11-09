// Recorrido en producción (9-nov-2026, Madrid → París → Roma): «Lufthansa · Más barato $32,502 (1 escala)»,
// «Iberia · Más cómodo $33,910 (directo)» y «Aeroméxico · Equilibrado $35,188 (directo)»: el «Equilibrado» costaba MÁS
// que el «Más cómodo» (y era el de la cotización). Ahora «Equilibrado» siempre es más barato que «Más cómodo».
import { describe, expect, it } from "vitest";
import { pickTiers } from "../../supabase/functions/logistics-plan/openJaw";

const v = (nombre: string, price_total: number, duration_minutes: number, stops: number) => ({ nombre, price_total, duration_minutes, stops });

describe("etiquetas de vuelos (pickTiers)", () => {
  it("el caso del recorrido: ningún «Equilibrado» más caro que el «Más cómodo»", () => {
    const t = pickTiers([
      v("Lufthansa", 32502, 970, 1), v("Iberia", 33910, 680, 0), v("Aeroméxico", 35188, 690, 0), v("Air France", 34100, 900, 1),
    ])!;
    expect(t.ahorro.nombre).toBe("Lufthansa");
    expect(t.premium.nombre).toBe("Iberia");
    expect(t.equilibrio.price_total).toBeLessThanOrEqual(t.premium.price_total);
    expect(t.equilibrio.price_total).toBeGreaterThanOrEqual(t.ahorro.price_total);
  });

  it("entre los de en medio, «Equilibrado» es el más cómodo (menos tiempo, luego menos escalas)", () => {
    const t = pickTiers([
      v("A", 1000, 900, 2), v("B", 1200, 800, 1), v("C", 1300, 700, 1), v("D", 1500, 600, 0), v("E", 2000, 610, 0),
    ])!;
    expect([t.ahorro.nombre, t.equilibrio.nombre, t.premium.nombre]).toEqual(["A", "C", "D"]);
  });

  it("si no hay ninguno entre los dos, «Equilibrado» es el mismo vuelo que «Más cómodo» (nunca uno más caro)", () => {
    const t = pickTiers([v("A", 1000, 900, 1), v("B", 1500, 600, 0), v("C", 1800, 700, 0)])!;
    expect(t.premium.nombre).toBe("B");
    expect(t.equilibrio).toBe(t.premium);
  });

  it("en cualquier mezcla de vuelos el orden de precios se respeta", () => {
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let k = 0; k < 300; k++) {
      const lista = Array.from({ length: 2 + Math.floor(rnd() * 9) }, (_, i) => v(`F${i}`, 500 + Math.round(rnd() * 3000), 300 + Math.round(rnd() * 900), Math.floor(rnd() * 3)));
      const t = pickTiers(lista)!;
      expect(t.ahorro.price_total).toBeLessThanOrEqual(t.equilibrio.price_total);
      expect(t.equilibrio.price_total).toBeLessThanOrEqual(t.premium.price_total);
    }
  });
});
