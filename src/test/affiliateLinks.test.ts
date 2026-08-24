import { describe, it, expect } from "vitest";
import {
  TP_MARKER,
  tpDeepLink,
  withMarker,
  aviasalesLink,
  hotellookLink,
  bookingLink,
  getYourGuideLink,
  welcomePickupsLink,
  WP_AFF_TRACK_ID,
} from "@/lib/affiliateLinks";

describe("monetización: links de afiliado", () => {
  it("tpDeepLink incluye el marker y la URL destino", () => {
    const url = tpDeepLink("https://ejemplo.com/hotel?x=1", "hotels");
    expect(url).toContain("tp.media/click");
    expect(url).toContain(`marker=${TP_MARKER}.hotels`);
    expect(url).toContain(encodeURIComponent("https://ejemplo.com/hotel?x=1"));
  });

  it("withMarker es idempotente", () => {
    const once = withMarker("https://ejemplo.com/a");
    expect(once).toContain(`marker=${TP_MARKER}`);
    expect(withMarker(once)).toBe(once);
  });

  it("los verticales principales siempre llevan marker", () => {
    const links = [
      aviasalesLink("MEX", "MAD", "2026-10-01", "2026-10-10", 2),
      hotellookLink("Madrid", "2026-10-01", "2026-10-10", 2),
      bookingLink("Madrid", "2026-10-01", "2026-10-10", 2),
      getYourGuideLink("Madrid", "tour"),
    ];
    for (const l of links) expect(l).toContain(TP_MARKER);
  });

  it("welcomePickupsLink lleva el tracking id del programa", () => {
    const l = welcomePickupsLink({ ciudad: "Madrid", pax: 2 });
    expect(l).toContain(WP_AFF_TRACK_ID);
  });
});
