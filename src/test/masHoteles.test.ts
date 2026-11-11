// Pedido del dueño (10-nov-2026): «no da más opciones, solo te da 3». Se guardan hasta 5 hoteles reales más
// (tier "alternativa") y Comprar enseña los 3 niveles + «Ver más hoteles». El total sigue usando el del nivel.
import { describe, expect, it } from "vitest";
import { buildHotelTiers } from "../../supabase/functions/analizar-viaje/hotelTiers";
import { hotelOptionGroups } from "@/lib/buyFlow";

const live = [90, 120, 150, 180, 210, 240, 270, 300, 330, 9000].map((usd, i) => ({ name: `Hotel ${i + 1}`, nightly_usd: usd, rating: 4.5 }));

describe("más opciones de hotel", () => {
  it("un destino: 3 niveles + hasta 5 alternativas reales, sin outliers", () => {
    const out = buildHotelTiers([], live, { fxUsd: 20, consultedAt: "2026-11-10T00:00:00Z" });
    const tiers = out.filter((h: any) => h.tier !== "alternativa");
    const alts = out.filter((h: any) => h.tier === "alternativa");
    expect(tiers.map((h: any) => h.tier)).toEqual(["ahorro", "equilibrio", "premium"]);
    expect(alts).toHaveLength(5);
    expect(out.map((h: any) => h.nombre)).not.toContain("Hotel 10"); // 9000 USD: fuera (4× el del medio)
    expect(new Set(out.map((h: any) => h.nombre)).size).toBe(out.length);
    expect(alts.every((h: any) => h.fuente_precio === "serpapi" && h.precio_por_noche > 0)).toBe(true);
  });
  it("Comprar: los 3 niveles a la vista y el resto en «Ver más»; el elegido siempre visible", () => {
    const hospedaje_json = [
      { nombre: "A", tier: "ahorro", precio_por_noche: 1000 }, { nombre: "Alt1", tier: "alternativa", precio_por_noche: 1200 },
      { nombre: "B", tier: "equilibrio", precio_por_noche: 2000 }, { nombre: "Alt2", tier: "alternativa", precio_por_noche: 2500 },
      { nombre: "C", tier: "premium", precio_por_noche: 4000 },
    ];
    const sorted = [0, 1, 2, 3, 4];
    expect(hotelOptionGroups({ hospedaje_json }, sorted, 2)).toEqual({ options: [0, 2, 4], moreOptions: [1, 3] });
    expect(hotelOptionGroups({ hospedaje_json }, sorted, 3)).toEqual({ options: [0, 2, 4, 3], moreOptions: [1] });
    // Viajes viejos sin niveles: los 3 más baratos, como antes.
    const viejo = { hospedaje_json: [{ precio_por_noche: 1 }, { precio_por_noche: 2 }, { precio_por_noche: 3 }, { precio_por_noche: 4 }] };
    expect(hotelOptionGroups(viejo, [0, 1, 2, 3], -1)).toEqual({ options: [0, 1, 2], moreOptions: [3] });
  });
});
