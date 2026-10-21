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
