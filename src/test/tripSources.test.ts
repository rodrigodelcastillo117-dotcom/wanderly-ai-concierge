import { describe, it, expect } from "vitest";
import { enforceSources, hotelPreference, sameName } from "../../supabase/functions/analizar-viaje/sources";

describe("hotelPreference", () => {
  it("keeps only the lodging clause of the notes", () => {
    expect(hotelPreference("aniversario, hotel boutique en Le Marais, cenas especiales")).toBe("hotel boutique en Le Marais");
    expect(hotelPreference("temporada de cerezos, gastronomía y cultura, hotel de diseño")).toBe("hotel de diseño");
    expect(hotelPreference("hotel boutique con vista al mar")).toBe("hotel boutique con vista al mar");
  });
  it("returns nothing when the notes don't talk about lodging", () => {
    expect(hotelPreference("quiero comer mariscos y bucear")).toBe("");
    expect(hotelPreference(null)).toBe("");
  });
});

describe("enforceSources", () => {
  const places = [{ name: "Museo del Louvre" }, { name: "Sainte-Chapelle" }];
  const hotels = [{ name: "Hôtel de JoBo" }];

  it("keeps real names and relabels invented ones as estimated", () => {
    const a = {
      tours: [
        { nombre: "Museo del Louvre", fuente: "tripadvisor", rating: 4.7, num_reviews: 300 },
        { nombre: "Sainte Chapelle", fuente: "google_maps", rating: 4.8, num_reviews: 50 },
        { nombre: "París — Ruta secreta de cafés", fuente: "google_maps", rating: 4.9, num_reviews: 10 },
      ],
      hospedaje: [
        { nombre: "Hotel de Jobo", fuente_precio: "serpapi" },
        { nombre: "The Mayfair Hotel", fuente_precio: "serpapi" },
      ],
    };
    enforceSources(a, places, hotels, "google_maps");
    expect(a.tours.map((t) => t.fuente)).toEqual(["google_maps", "google_maps", "estimado"]);
    expect(a.tours[2]).toMatchObject({ rating: null, num_reviews: null });
    expect(a.hospedaje.map((h) => h.fuente_precio)).toEqual(["serpapi", "estimado"]);
  });

  it("matches names ignoring accents, case and punctuation", () => {
    expect(sameName("Hôtel de JoBo", "hotel de jobo")).toBe(true);
    expect(sameName("Cenote Calavera", "Cenote Calavera Tulum")).toBe(true);
    expect(sameName("Torre Eiffel", "Louvre")).toBe(false);
  });
});

describe("enforceSources: vuelos y hoteles contra las listas en vivo (B-05)", () => {
  const live = {
    fxUsd: 20,
    consultedAt: "2026-10-22T10:00:00Z",
    tpFlights: [{ price: 500, booking_link: "https://www.aviasales.com/x?marker=533299" }],
    googleFlights: [{ price_per_person_usd: 900, buy_url: "https://www.aviasales.com/search/x" }],
  };

  it("un vuelo 'travelpayouts' inventado pasa a estimado; uno real conserva su fuente pero como precio de referencia", () => {
    const a = {
      vuelos: [
        { tier: "ahorro", precio_por_persona: 10000, fuente_precio: "travelpayouts" }, // 500 × 20
        { tier: "equilibrio", precio_por_persona: 13000, fuente_precio: "travelpayouts" }, // no está en la lista
        { tier: "premium", precio_por_persona: 18100, fuente_precio: "serpapi" }, // 900 × 20 (±3 %)
      ],
    };
    enforceSources(a, [], [], "tripadvisor", live);
    expect(a.vuelos.map((v: any) => v.fuente_precio)).toEqual(["travelpayouts", "estimado", "serpapi"]);
    // Travelpayouts es caché de búsquedas (≤48 h): nunca "en vivo", aunque el precio sea real.
    expect(a.vuelos.map((v: any) => v.estado_dato)).toEqual(["ESTIMADO", "ESTIMADO", "CONSULTADO_EN_VIVO"]);
    expect((a.vuelos[0] as any).nota_precio).toMatch(/precio de referencia/i);
    expect((a.vuelos[0] as any).consultado_at).toBe("2026-10-22T10:00:00Z");
    expect((a.vuelos[1] as any).consultado_at).toBeUndefined();
  });

  it("sin listas en vivo ninguna etiqueta del modelo sobrevive", () => {
    const a = { vuelos: [{ precio_por_persona: 10000, fuente_precio: "travelpayouts" }], hospedaje: [{ nombre: "Real Hotel", precio_por_noche: 3000, fuente_precio: "travelpayouts" }] };
    enforceSources(a, [], [{ name: "Real Hotel", nightly_usd: 150 }], "tripadvisor");
    expect(a.vuelos[0].fuente_precio).toBe("estimado");
    // Travelpayouts ya no trae hoteles: esa etiqueta nunca es real.
    expect(a.hospedaje[0].fuente_precio).toBe("estimado");
  });

  it("hotel estimado pierde la liga que escribió el modelo (slug de Booking o dominio inventado)", () => {
    const a: any = { hospedaje: [{ nombre: "Hotel Escondido Oaxaca", precio_por_noche: 3000, fuente_precio: "estimado", booking_link: "https://www.hotelelcondido.com/oaxaca/" }] };
    enforceSources(a, [], [], "tripadvisor");
    expect(a.hospedaje[0].booking_link).toBeUndefined();
  });

  it("tarifa de Travelpayouts con fechas aproximadas queda como ESTIMADO", () => {
    const a = { vuelos: [{ precio_por_persona: 10000, fuente_precio: "travelpayouts" }] };
    enforceSources(a, [], [], "tripadvisor", { ...live, tpApproximateDates: true });
    expect(a.vuelos[0]).toMatchObject({ fuente_precio: "travelpayouts", approximate_dates: true, estado_dato: "ESTIMADO" });
  });

  it("hotel 'serpapi' con nombre de la lista pero precio distinto pasa a estimado", () => {
    const a = { hospedaje: [
      { nombre: "Hotel de Jobo", precio_por_noche: 3000, fuente_precio: "serpapi" }, // 150 × 20
      { nombre: "Hotel de Jobo", precio_por_noche: 4500, fuente_precio: "serpapi" },
    ] };
    enforceSources(a, [], [{ name: "Hôtel de JoBo", nightly_usd: 150 }], "tripadvisor", live);
    expect(a.hospedaje.map((h: any) => h.fuente_precio)).toEqual(["serpapi", "estimado"]);
  });

  it("sin fuente → estimado (nunca un precio sin etiqueta)", () => {
    const a = { vuelos: [{ precio_por_persona: 1 }], hospedaje: [{ nombre: "X Y" }], tours: [{ nombre: "Z" }] };
    enforceSources(a, [], [], "tripadvisor", live);
    expect([a.vuelos[0], a.hospedaje[0]].map((x: any) => x.fuente_precio)).toEqual(["estimado", "estimado"]);
    expect((a.tours[0] as any).fuente).toBe("estimado");
  });

  it("'Hotel' ya no coincide con cualquier hotel", () => {
    expect(sameName("Hotel", "Hôtel de JoBo")).toBe(false);
  });
});
