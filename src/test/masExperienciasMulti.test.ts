// «Más opciones de todo» en viajes de varias ciudades (dueño, 11-nov-2026): además de las 4–5 experiencias de la IA,
// los demás lugares REALES de la lista de la ciudad, sin precio, para «Ver más» en Comprar.
import { describe, expect, it } from "vitest";
import { moreExperiences } from "../../supabase/functions/logistics-plan/moreExperiences";
import { multiDestTripRows } from "@/lib/multiDestTrip";
import { buildPickCards, morePickCards } from "@/lib/tripPicks";

const places = [
  { name: "Coliseo", rating: 4.8, num_reviews: 90000, place_id: "p1" },
  { name: "Panteón", rating: 4.8, num_reviews: 70000, place_id: "p2" },
  { name: "Fontana di Trevi", rating: 4.7, num_reviews: 80000, place_id: "p3" },
  { name: "Galería Borghese", rating: 4.7, num_reviews: 20000, place_id: "p4" },
  { name: "Trastevere", rating: 4.6, num_reviews: 15000 },
  { name: "Castillo Sant'Angelo", rating: 4.6, num_reviews: 30000, web_url: "https://maps.example/x" },
  { name: "", rating: 5 },
];
const elegidas = [
  { nombre: "Coliseo", fuente: "google_places", estado_dato: "ESTIMADO", price_per_person_usd: 25, verificado: true },
  { nombre: "Panteón de Agripa (Panteón)", fuente: "google_places", estado_dato: "ESTIMADO", verificado: true },
];

describe("más experiencias reales por ciudad (varias ciudades)", () => {
  it("agrega los lugares reales que faltan, sin repetir, sin precio y marcados como opción extra", () => {
    const extra = moreExperiences(elegidas, places, { source: "google_places", city: "Roma" });
    const names = extra.map((e) => e.nombre);
    expect(names).not.toContain("Coliseo");
    expect(names).toEqual(expect.arrayContaining(["Fontana di Trevi", "Galería Borghese", "Trastevere", "Castillo Sant'Angelo"]));
    expect(names).not.toContain("");
    for (const e of extra) {
      expect(e.price_per_person_usd).toBeUndefined();
      expect(e.alternativa).toBe(true);
      expect(e.estado_dato).toBe("CONSULTADO_EN_VIVO");
    }
    expect(extra.find((e) => e.nombre === "Castillo Sant'Angelo")?.maps_url).toBe("https://maps.example/x");
  });

  it("respeta el máximo y no inventa nada sin lista del proveedor", () => {
    expect(moreExperiences(elegidas, places, { source: "tripadvisor", city: "Roma", max: 4 }).length).toBe(2);
    expect(moreExperiences(elegidas, null, { source: "tripadvisor", city: "Roma" })).toEqual([]);
  });

  it("en Comprar quedan en «Ver más» (no en las tarjetas de precio) y el total no cambia", () => {
    const extra = moreExperiences(elegidas, places, { source: "google_places", city: "Roma" });
    const logistics = {
      fx_usd_mxn: 20, flights: [],
      per_destination: [{ city: "Roma", nights: 3, hospedaje: [], restaurantes: [], arrival_options: [], experiencias: [...elegidas, ...extra] }],
    };
    const { tours_json } = multiDestTripRows(logistics, ["Roma"], "Ciudad de México");
    expect(tours_json.length).toBe(elegidas.length + extra.length);
    const extraRows = tours_json.filter((t: any) => t.alternativa);
    expect(extraRows.length).toBe(extra.length);
    expect(extraRows.every((t: any) => t.precio_por_persona === 0)).toBe(true);
    const idx = tours_json.map((_: any, i: number) => i);
    const cards = buildPickCards(tours_json, idx, "experiencia", null).filter((c) => c.index != null);
    // Sin precio real no entran a las tarjetas de nivel de precio (pueden ser la «Recomendada» por su calificación).
    expect(cards.some((c) => ["economico", "medio", "caro"].includes(c.slot) && tours_json[c.index!].alternativa)).toBe(false);
    const more = morePickCards(tours_json, idx, cards, "experiencia", null);
    const shownExtra = cards.filter((c) => tours_json[c.index!].alternativa).length;
    expect(more.filter((c) => tours_json[c.index!].alternativa).length + shownExtra).toBe(extra.length);
  });
});
