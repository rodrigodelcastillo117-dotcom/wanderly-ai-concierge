// «Más opciones de todo… en base al usuario, eso es lo padre de IATOS, que aprende del cliente» (dueño, 11-nov-2026).
import { describe, expect, it } from "vitest";
import { buildPickCards, morePickCards, rankForProfile, type TasteProfile } from "@/lib/tripPicks";
import { moreTours } from "../../supabase/functions/analizar-viaje/moreTours";

const R = (nombre: string, cocina: string, rating: number, rango: string) => ({ nombre, cocina, rating, num_reviews: 500, rango_precio: rango, fuente: "google_places" });
const list = [
  R("Taquería", "Restaurante mexicano", 4.5, "MXN 100–200"), R("Fonda", "Restaurante mexicano", 4.3, "MXN 150–250"),
  R("Osteria Bella", "Restaurante italiano", 4.6, "MXN 400–600"), R("Sushi Zen", "Restaurante japonés", 4.7, "MXN 500–800"),
  R("Steak 55", "Steakhouse", 4.8, "MXN 1,000–1,500"), R("Trattoria Roma", "Restaurante italiano", 4.4, "MXN 300–500"),
  R("Café Luna", "Cafetería", 4.2, "MXN 100–200"), R("Mariscos Pepe", "Restaurante de mariscos", 4.6, "MXN 300–500"),
];
const idx = list.map((_, i) => i);
const amaItaliana: TasteProfile = { declared: ["Comida italiana"], cuisinesVisited: [], budget: null };

describe("más opciones ordenadas por el perfil", () => {
  it("«Ver más» trae lo que no está en las tarjetas, primero lo que va con sus gustos («Para ti»)", () => {
    const cards = buildPickCards(list, idx, "restaurante", amaItaliana).filter((c) => c.index != null);
    const more = morePickCards(list, idx, cards, "restaurante", amaItaliana);
    const shown = new Set(cards.map((c) => c.index));
    expect(more.every((c) => !shown.has(c.index))).toBe(true);
    expect(cards.length + more.length).toBe(list.length);
    const firstItalian = more.findIndex((c) => /italian/i.test(list[c.index!].cocina));
    expect(firstItalian).toBe(0);
    expect(more[0].slot).toBe("para_ti");
    expect(more[0].reason).toMatch(/italiana|perfil/i);
  });
  it("sin perfil, ordena por calificación y nada se llama «Para ti»", () => {
    const r = rankForProfile(list, idx, "restaurante", null);
    expect(list[r[0].index].nombre).toBe("Steak 55");
    const more = morePickCards(list, idx, [], "restaurante", null);
    expect(more.some((c) => c.slot === "para_ti")).toBe(false);
  });
  it("experiencias extra: lugares reales de la lista, sin precio, sin repetir, hasta 10", () => {
    const tours = [{ nombre: "Museo Maya" }, { nombre: "Playa Delfines" }];
    const places = ["Museo Maya", "Xcaret", "Xel-Há", "Isla Mujeres", "Playa Delfines"].map((name, i) => ({ name, rating: 4.5 + i / 10, num_reviews: 1000, place_id: `p${i}`, web_url: `https://maps.google.com/?cid=${i}` }));
    const out = moreTours(tours, places, { source: "google_places", city: "Cancún" });
    expect(out.map((t) => t.nombre)).toEqual(["Xcaret", "Xel-Há", "Isla Mujeres"]);
    expect(out[0]).toMatchObject({ ciudad: "Cancún", fuente: "google_places", place_id: "p1", verificado: true, alternativa: true });
    expect(out.every((t) => t.precio_por_persona === undefined)).toBe(true);
    expect(moreTours(tours, places, { source: "google_places", city: "Cancún", max: 3 })).toHaveLength(1);
  });
});
