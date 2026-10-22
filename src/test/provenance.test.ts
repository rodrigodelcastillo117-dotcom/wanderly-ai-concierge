import { describe, it, expect } from "vitest";
import { ESTADOS_DATO, formatAge, provenanceOf } from "@/lib/provenance";

const now = new Date("2026-10-22T12:00:00Z");
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600_000).toISOString();

describe("provenanceOf: proveedores en vivo", () => {
  it("Google Flights/Hotels consultados hace < 24 h → CONSULTADO_EN_VIVO", () => {
    for (const [source, provider] of [["serpapi", "Google"], ["google_flights", "Google Flights"], ["google_hotels", "Google Hotels"], ["serpapi-hotels", "Google Hotels"]]) {
      const p = provenanceOf({ source, consultadoAt: hoursAgo(2) }, now);
      expect(p.state).toBe("CONSULTADO_EN_VIVO");
      expect(p.label).toBe(`Consultado en vivo · ${provider}`);
      expect(p.trusted).toBe(true);
    }
  });

  it("más de 24 h → OBSOLETO con la antigüedad y 'verifica antes de reservar'", () => {
    const p = provenanceOf({ source: "google_flights", consultadoAt: hoursAgo(72) }, now);
    expect(p.state).toBe("OBSOLETO");
    expect(p.label).toBe("Precio de hace 3 días; verifica antes de reservar");
    expect(p.trusted).toBe(false);
  });

  it("en vivo sin fecha de consulta → OBSOLETO (nunca se afirma que está vigente)", () => {
    const p = provenanceOf({ source: "serpapi" }, now);
    expect(p.state).toBe("OBSOLETO");
    expect(p.label).toBe("Precio sin fecha de consulta; verifica antes de reservar");
  });

  it("una fecha en el futuro lejano no cuenta como vigente", () => {
    expect(provenanceOf({ source: "serpapi", consultadoAt: "2027-01-01T00:00:00Z" }, now).state).toBe("OBSOLETO");
  });
});

describe("provenanceOf: caché de Travelpayouts", () => {
  it("nunca dice 'verificado en vivo': 'Precio de referencia (caché ≤48 h)'", () => {
    for (const source of ["travelpayouts", "aviasales"]) {
      const p = provenanceOf({ source, consultadoAt: hoursAgo(1) }, now);
      expect(p.state).toBe("CONSULTADO_EN_VIVO");
      expect(p.label).toBe("Precio de referencia (caché ≤48 h)");
      expect(p.label).not.toMatch(/verificado/i);
    }
  });
  it("con fechas aproximadas → ESTIMADO", () => {
    const p = provenanceOf({ source: "travelpayouts", consultadoAt: hoursAgo(1), approximateDates: true }, now);
    expect(p.state).toBe("ESTIMADO");
    expect(p.label).toBe("Tarifa aproximada (fechas cercanas)");
  });
  it("viejo → OBSOLETO", () => {
    expect(provenanceOf({ source: "travelpayouts", consultadoAt: hoursAgo(30) }, now).state).toBe("OBSOLETO");
  });
});

describe("provenanceOf: estimaciones y otros", () => {
  it("sin fuente → 'Sin fuente' (antes no se mostraba nada)", () => {
    for (const source of [undefined, null, "", "  "]) {
      const p = provenanceOf({ source }, now);
      expect(p.state).toBe("ESTIMADO");
      expect(p.label).toBe("Sin fuente");
    }
  });
  it("IA → 'Estimado por IA'", () => {
    for (const source of ["estimado", "ai-fallback", "ai-estimate"]) {
      expect(provenanceOf({ source }, now)).toMatchObject({ state: "ESTIMADO", label: "Estimado por IA", trusted: false });
    }
  });
  it("Perplexity → 'Estimado con investigación web'", () => {
    expect(provenanceOf({ source: "perplexity" }, now)).toMatchObject({ state: "ESTIMADO", label: "Estimado con investigación web" });
  });
  it("TripAdvisor / Google Maps: lugar real, precio estimado", () => {
    expect(provenanceOf({ source: "tripadvisor" }, now)).toMatchObject({ state: "ESTIMADO", label: "Reseñas reales · TripAdvisor · precio estimado" });
    expect(provenanceOf({ source: "google_maps" }, now)).toMatchObject({ state: "ESTIMADO", label: "Reseñas reales · Google · precio estimado" });
  });
  it("etiqueta desconocida → 'Estimado' (nunca en vivo)", () => {
    expect(provenanceOf({ source: "booking_magic", consultadoAt: hoursAgo(1) }, now)).toMatchObject({ state: "ESTIMADO", label: "Estimado", trusted: false });
  });
  it("estados explícitos del servidor", () => {
    expect(provenanceOf({ source: "serpapi", estado: "PENDIENTE_DE_VERIFICACION", consultadoAt: hoursAgo(1) }, now))
      .toMatchObject({ state: "PENDIENTE_DE_VERIFICACION", label: "Pendiente de verificar" });
    expect(provenanceOf({ estado: "CONFIRMADO" }, now)).toMatchObject({ state: "CONFIRMADO", trusted: true });
    expect(provenanceOf({ estado: "NO_DISPONIBLE" }, now)).toMatchObject({ state: "NO_DISPONIBLE", label: "No disponible ahora" });
    expect(provenanceOf({ source: "none" }, now).state).toBe("NO_DISPONIBLE");
    expect(provenanceOf({ source: "serpapi", estado: "OBSOLETO", consultadoAt: hoursAgo(1) }, now).state).toBe("OBSOLETO");
    expect(provenanceOf({ source: "estimado", estado: "consultado_en_vivo" }, now).state).toBe("ESTIMADO");
  });
  it("PDF del usuario → 'Según tu archivo (sin verificar)'", () => {
    expect(provenanceOf({ source: "pdf" }, now)).toMatchObject({ state: "PENDIENTE_DE_VERIFICACION", label: "Según tu archivo (sin verificar)" });
    expect(provenanceOf({ source: "serpapi", desdePdf: true }, now).state).toBe("PENDIENTE_DE_VERIFICACION");
  });
  it("cubre los 6 estados del diseño", () => {
    expect(ESTADOS_DATO).toEqual(["CONFIRMADO", "CONSULTADO_EN_VIVO", "ESTIMADO", "PENDIENTE_DE_VERIFICACION", "NO_DISPONIBLE", "OBSOLETO"]);
  });
});

describe("formatAge", () => {
  it("formatea minutos, horas, días y meses", () => {
    expect(formatAge(new Date(now.getTime() - 30_000), now)).toBe("hace un momento");
    expect(formatAge(new Date(now.getTime() - 15 * 60_000), now)).toBe("hace 15 min");
    expect(formatAge(new Date(now.getTime() - 5 * 3600_000), now)).toBe("hace 5 h");
    expect(formatAge(new Date(now.getTime() - 4 * 86400_000), now)).toBe("hace 4 días");
    expect(formatAge(new Date(now.getTime() - 90 * 86400_000), now)).toBe("hace 3 meses");
  });
});
