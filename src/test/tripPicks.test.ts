// Carruseles de restaurantes y experiencias (pedido del dueño 23-oct-2026): clasificación por precio
// con datos reales, regla de no inventar y "Recomendado por IATOS" con un porqué que cita el dato.
import { describe, expect, it } from "vitest";
import { buildPickCards, parsePriceRange, recommend, restaurantTier, tasteFrom, tourTier } from "@/lib/tripPicks";

const g = (nombre: string, extra: Record<string, unknown>) => ({ nombre, ciudad: "París", fuente: "google_places", ...extra });

describe("Nivel de precio con datos reales", () => {
  it("rango por persona de Google (EUR, MXN, 'Desde')", () => {
    expect(parsePriceRange("EUR 20–30")).toEqual({ currency: "EUR", mid: 25 });
    expect(parsePriceRange("MXN 1,000–1,400")).toEqual({ currency: "MXN", mid: 1200 });
    expect(parsePriceRange("Desde USD 15")).toEqual({ currency: "USD", mid: 15 });
    expect(restaurantTier({ rango_precio: "EUR 10–15" })).toBe("economico");
    expect(restaurantTier({ rango_precio: "EUR 30–50" })).toBe("medio");
    expect(restaurantTier({ rango_precio: "EUR 100+" })).toBe("caro");
    expect(restaurantTier({ rango_precio: "MXN 400–600" })).toBe("medio");
  });

  it("nivel de Google y símbolos guardados", () => {
    expect(restaurantTier({ nivel_precio: "Económico", rango_precio: "$" })).toBe("economico");
    expect(restaurantTier({ nivel_precio: "Precio moderado" })).toBe("medio");
    expect(restaurantTier({ nivel_precio: "Muy caro" })).toBe("caro");
    expect(restaurantTier({ rango_precio: "$$" })).toBe("medio");
    expect(restaurantTier({ rango_precio: "€€€" })).toBe("caro");
  });

  it("sin dato no se clasifica (no se adivina)", () => {
    expect(restaurantTier({ rango_precio: "Precio no publicado" })).toBeNull();
    expect(restaurantTier({ rango_precio: "JPY 3,000–5,000" })).toBeNull(); // moneda sin umbral
    expect(restaurantTier({})).toBeNull();
    expect(tourTier({ precio_por_persona: 0 })).toBeNull();
  });

  it("experiencias por precio por persona en MXN (gratis = económica)", () => {
    expect(tourTier({ precio_por_persona: 350 })).toBe("economico");
    expect(tourTier({ precio_por_persona: 1200 })).toBe("medio");
    expect(tourTier({ precio_por_persona: 4800 })).toBe("caro");
    expect(tourTier({ nombre: "Plaza del Trocadero (gratis)" })).toBe("economico");
  });
});

describe("4 tarjetas por ciudad y regla de no inventar", () => {
  const rest = [
    g("Bouillon Chartier", { cocina: "Francesa", rango_precio: "EUR 15–19", rating: 4.2, num_reviews: 40000 }),
    g("Le Relais de l'Entrecôte", { cocina: "Carne", rango_precio: "EUR 30–40", rating: 4.4, num_reviews: 15000 }),
    g("Bistrot Paul Bert", { cocina: "Bistro francés", rango_precio: "EUR 40–50", rating: 4.6, num_reviews: 3000 }),
    g("Le Cinq", { cocina: "Alta cocina", rango_precio: "EUR 200–400", rating: 4.7, num_reviews: 900 }),
    g("Bar Oyster", { cocina: "Mariscos", rango_precio: "Precio no publicado", rating: 4.5, num_reviews: 800 }),
  ];
  const idx = rest.map((_, i) => i);

  it("Económico, Medio (el mejor del nivel por calificación y reseñas), Caro y Recomendado (de lo que no está ya en pantalla)", () => {
    const cards = buildPickCards(rest, idx, "restaurante", null);
    // Medio: Entrecôte (4.4 con 15,000 reseñas) sobre Paul Bert (4.6 con 3,000). Recomendado: Paul Bert, la mejor calificada que queda.
    expect(cards.map((c) => [c.slot, c.index])).toEqual([["economico", 0], ["medio", 1], ["caro", 3], ["recomendado", 2]]);
  });

  it("sin opción de un nivel: queda vacío con 'Sin opción económica verificada' (no se rellena con otra)", () => {
    const only = [rest[2], rest[3]];
    const cards = buildPickCards(only, [0, 1], "restaurante", null);
    expect(cards[0]).toEqual({ slot: "economico", index: null, missing: "Sin opción económica verificada" });
    expect(cards.filter((c) => c.index != null && c.slot !== "recomendado").map((c) => c.slot)).toEqual(["medio", "caro"]);
    // El vacío nunca toma una opción de otro nivel.
    expect(cards.find((c) => c.slot === "economico")?.index).toBeNull();
  });

  it("recomendado para el perfil: cita el gusto que coincidió", () => {
    const taste = tasteFrom({ preferencias_comida: ["Mariscos"], presupuesto_rango: "medio" }, null);
    const r = recommend(rest, idx, "restaurante", taste)!;
    expect(rest[r.index].nombre).toBe("Bar Oyster");
    expect(r.reason).toBe("Va con lo que te gusta: mariscos (tu perfil)");
    // Le gusta lo francés: la recomendada es la mejor francesa (Paul Bert) y "Medio" muestra la siguiente.
    const fr = buildPickCards(rest, idx, "restaurante", tasteFrom({ preferencias_comida: ["Francesa"] }, null));
    expect(fr.map((c) => [c.slot, c.index])).toEqual([["economico", 0], ["medio", 1], ["caro", 3], ["recomendado", 2]]);
  });

  it("ADN gastronómico (cocinas visitadas en inglés de Google) también cuenta", () => {
    const taste = tasteFrom(null, { top_cuisines: [{ key: "seafood_restaurant", count: 6 }] });
    const r = recommend(rest, idx, "restaurante", taste)!;
    expect(rest[r.index].nombre).toBe("Bar Oyster");
    expect(r.reason).toMatch(/tu ADN gastronómico/);
  });

  it("sin perfil: la mejor calificada con su dato real; sin calificación: el porqué del análisis; sin nada: no hay recomendado", () => {
    const r = recommend(rest, [0, 1, 3], "restaurante", null)!;
    expect(r.reason).toBe("La mejor calificada: 4,7 en Google (900 reseñas)".replace("4,7", (4.7).toLocaleString("es-MX", { maximumFractionDigits: 1 })));
    const ai = [{ nombre: "Trattoria", por_que: "Cocina romana clásica cerca de tu hotel." }];
    expect(recommend(ai, [0], "restaurante", null)?.reason).toBe("Elegido para tu perfil: Cocina romana clásica cerca de tu hotel.");
    expect(recommend([{ nombre: "X" }], [0], "restaurante", null)).toBeNull();
  });

  it("experiencias: Louvre caro/medio por precio, Trocadero gratis económico", () => {
    const tours = [
      { nombre: "Plaza del Trocadero", precio_por_persona: 0, fuente: "tripadvisor", rating: 4.7, num_reviews: 20000, ciudad: "París" },
      { nombre: "Museo del Louvre", precio_por_persona: 480, fuente: "tripadvisor", rating: 4.7, num_reviews: 160000, ciudad: "París" },
      { nombre: "Torre Eiffel cumbre", precio_por_persona: 1400, fuente: "estimado", rating: 4.6, num_reviews: 140000, ciudad: "París" },
      { nombre: "Versalles con guía", precio_por_persona: 2600, fuente: "estimado", rating: 4.6, num_reviews: 90000, ciudad: "París" },
    ];
    // Le gusta el arte: el Louvre es la recomendada; su nivel (económico) no tiene otra y la repite.
    const arte = buildPickCards(tours, [0, 1, 2, 3], "experiencia", tasteFrom({ intereses: ["Arte"] }, null));
    expect(arte.map((c) => [c.slot, c.index])).toEqual([["economico", 1], ["medio", 2], ["caro", 3], ["recomendado", 1]]);
    expect((arte[3] as { reason: string }).reason).toBe("Va con lo que te gusta: arte (tu perfil)");
    // Sin perfil: Trocadero (sin precio, no se clasifica) es la recomendada por su calificación real.
    const cards = buildPickCards(tours, [0, 1, 2, 3], "experiencia", null);
    expect(cards.map((c) => [c.slot, c.index])).toEqual([["economico", 1], ["medio", 2], ["caro", 3], ["recomendado", 0]]);
    expect((cards[3] as { reason: string }).reason).toMatch(/^La mejor calificada: 4.7 en Tripadvisor \(20,000 reseñas\)$/);
  });
});
