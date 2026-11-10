// Recorrido familia 10-nov-2026: premium en Mérida = Hacienda Santa Cruz a $167,092 MXN/noche (37× el del medio).
import { describe, expect, it } from "vitest";
import { pickCityHotels } from "../../supabase/functions/logistics-plan/hotelPick";

const h = (name: string, usd: number, cls = 0) => ({ name, nightly_usd: usd, hotel_class: cls });

describe("hoteles por ciudad: premium sin outliers", () => {
  it("no elige una hacienda de 37× el precio del medio", () => {
    const list = [h("Zamna", 147, 3), h("Viva Mérida", 243, 4), h("Rosas & Xocolate", 320, 5), h("Hacienda Santa Cruz", 9032, 5)].sort((a, b) => a.nightly_usd - b.nightly_usd);
    const r = pickCityHotels(list);
    expect(r.cheap?.name).toBe("Zamna");
    expect(r.top?.name).toBe("Rosas & Xocolate");
  });
  it("sin outliers, premium sigue siendo el de más estrellas y más caro", () => {
    const list = [h("A", 100, 3), h("B", 180, 4), h("C", 260, 5), h("D", 400, 5)];
    expect(pickCityHotels(list).top?.name).toBe("D");
  });
  it("lista vacía o de uno", () => {
    expect(pickCityHotels([])).toEqual({});
    expect(pickCityHotels([h("Solo", 90)]).top?.name).toBe("Solo");
  });
});

describe("un destino (analizar-viaje): premium sin outliers", () => {
  it("con 4 hoteles y uno de 37×, el premium no es el outlier", async () => {
    const { buildHotelTiers } = await import("../../supabase/functions/analizar-viaje/hotelTiers");
    const live = [{ name: "Zamna", nightly_usd: 147 }, { name: "Viva Mérida", nightly_usd: 243 }, { name: "Rosas", nightly_usd: 320 }, { name: "Hacienda Santa Cruz", nightly_usd: 9032 }];
    const out = buildHotelTiers([], live, { fxUsd: 18.5, consultedAt: "2026-11-10T00:00:00Z" });
    expect(out.map((x: any) => x.nombre)).not.toContain("Hacienda Santa Cruz");
    expect(out.find((x: any) => x.tier === "premium")?.nombre).toBe("Rosas");
  });
});
