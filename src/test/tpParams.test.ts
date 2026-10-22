import { describe, it, expect } from "vitest";
import { pricesForDatesParams, pricesForDatesUrl, resolveTpMarker, TP_PUBLIC_MARKER } from "../../supabase/functions/_shared/tp-params";
import { aviasalesSearchLink } from "../../supabase/functions/_shared/travelpayouts";

describe("travelpayouts prices_for_dates", () => {
  it("viaje redondo manda one_way=false y return_at", () => {
    const p = pricesForDatesParams({ origin: "MEX", destination: "MAD", departureAt: "2026-11-10", returnAt: "2026-11-20", token: "t" });
    expect(p.get("one_way")).toBe("false");
    expect(p.get("return_at")).toBe("2026-11-20");
    expect(p.get("departure_at")).toBe("2026-11-10");
    expect(p.get("currency")).toBe("usd");
  });
  it("viaje sencillo manda one_way=true y sin return_at", () => {
    const p = pricesForDatesParams({ origin: "MEX", destination: "CUN", departureAt: "2026-12-01", returnAt: null, token: "t" });
    expect(p.get("one_way")).toBe("true");
    expect(p.has("return_at")).toBe(false);
  });
  it("a nivel mes también es redondo", () => {
    const url = pricesForDatesUrl({ origin: "MEX", destination: "MAD", departureAt: "2026-11", returnAt: "2026-11", token: "t", limit: 30 });
    expect(url).toMatch(/^https:\/\/api\.travelpayouts\.com\/aviasales\/v3\/prices_for_dates\?/);
    expect(new URL(url).searchParams.get("one_way")).toBe("false");
    expect(new URL(url).searchParams.get("limit")).toBe("30");
  });
});

describe("marker de afiliado", () => {
  it("usa TRAVELPAYOUTS_MARKER si existe; si no, el público 533299 (nunca parte del token)", () => {
    expect(resolveTpMarker("612345")).toBe("612345");
    expect(resolveTpMarker("  612345 ")).toBe("612345");
    expect(resolveTpMarker(undefined)).toBe(TP_PUBLIC_MARKER);
    expect(resolveTpMarker("")).toBe("533299");
    expect(resolveTpMarker("bad marker with spaces")).toBe("533299");
  });
  it("link de búsqueda de respaldo con fechas DDMM", () => {
    expect(aviasalesSearchLink({ origin: "MEX", destination: "MAD", departureDate: "2026-10-22", returnDate: "2026-11-01" }, "533299"))
      .toBe("https://www.aviasales.com/search/MEX2210MAD01111?marker=533299");
  });
});
