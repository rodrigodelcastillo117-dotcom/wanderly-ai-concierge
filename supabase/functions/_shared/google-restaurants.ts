// Restaurantes reales desde Google Places API (New). Sin dependencias de Deno (Vitest).
// Lo usan suggest-restaurants (viajes importados) y analizar-viaje (cotización con IA); el chat
// también puede usarlo (restaurantsForCity).
//
// Regla: el nombre, la calificación, el número de reseñas, el nivel de precio, el horario y si acepta
// reservaciones vienen de Google y llevan la fecha de consulta. Un modelo de IA puede redactar el
// "por qué", pero no puede poner restaurantes que no estén en la lista de Google (si la hay).
import type { GoogleTransport } from "./google-maps.ts";
import { callError, googleErrorMessage } from "./google-maps.ts";
import {
  type GooglePlace, type PlacesResult, rankByQuality, restaurantFromPlace, samePlaceName, searchText,
} from "./google-places.ts";

/** Consulta de Text Search para restaurantes de una ciudad, con la preferencia de comida si hay. */
export function restaurantQuery(city: string, preferences?: string | null): string {
  const pref = String(preferences ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
  return `${pref ? `restaurantes ${pref}` : "mejores restaurantes"} en ${String(city ?? "").trim()}`;
}

/** Restaurantes de una ciudad (Text Search Enterprise + Atmosphere: incluye reservable, cena, resumen). */
export async function restaurantsForCity(
  t: GoogleTransport, city: string, opts: { preferences?: string | null; maxResults?: number; language?: string } = {},
): Promise<PlacesResult> {
  const r = await searchText(t, {
    query: restaurantQuery(city, opts.preferences),
    includedType: "restaurant",
    language: opts.language ?? "es",
    maxResults: opts.maxResults ?? 12,
    minRating: 4,
    preset: "atmosphere",
  });
  return r.ok ? { ...r, places: rankByQuality(r.places) } : r;
}

export type SuggestOutput = {
  ok: boolean;
  disponible: boolean;
  restaurantes: Record<string, unknown>[];
  fuente: "google_places";
  atribucion: "Google Maps";
  consultado_at: string | null;
  fallas?: Array<{ ciudad: string; motivo: string }>;
  motivo?: string;
};

/** Hasta 5 restaurantes reales por ciudad (máximo 6 ciudades por llamada). */
export async function suggestRestaurants(
  t: GoogleTransport, input: { cities: unknown[]; travelers?: number; preferences?: string | null; perCity?: number },
): Promise<SuggestOutput> {
  const cities = (Array.isArray(input.cities) ? input.cities : [])
    .map((c) => String(c ?? "").trim()).filter(Boolean).slice(0, 6);
  const perCity = Math.min(8, Math.max(1, input.perCity ?? 5));
  const results = await Promise.all(cities.map((c) => restaurantsForCity(t, c, { preferences: input.preferences })));
  const restaurantes: Record<string, unknown>[] = [];
  const fallas: Array<{ ciudad: string; motivo: string }> = [];
  let consultado: string | null = null;
  results.forEach((r, i) => {
    if (!r.ok) {
      fallas.push({ ciudad: cities[i], motivo: googleErrorMessage(callError(r).kind) });
      return;
    }
    consultado = consultado ?? r.consultado_at;
    if (r.places.length === 0) fallas.push({ ciudad: cities[i], motivo: "Google Maps no trajo restaurantes para esta ciudad." });
    for (const p of r.places.slice(0, perCity)) restaurantes.push(restaurantFromPlace(p, cities[i]));
  });
  const disponible = restaurantes.length > 0;
  return {
    ok: disponible,
    disponible,
    restaurantes,
    fuente: "google_places",
    atribucion: "Google Maps",
    consultado_at: consultado,
    ...(fallas.length ? { fallas } : {}),
    ...(disponible ? {} : { motivo: fallas[0]?.motivo ?? googleErrorMessage("error") }),
  };
}

/**
 * Restaurantes del análisis con la lista de Google:
 * - con lista: solo quedan los que están en Google (con los datos de Google y el "por qué" del
 *   modelo); se completan hasta `min` con los mejores de la lista. Los que no están se quitan
 *   (serían nombres sin verificar presentados como recomendación real).
 * - sin lista (Google no respondió): se conservan, marcados como sugerencia sin verificar.
 */
export function enforceRestaurants(model: unknown, places: GooglePlace[], city: string, min = 5): { restaurantes: any[]; quitados: number } {
  const list = Array.isArray(model) ? model.filter((r) => r && typeof r === "object") : [];
  if (!places.length) {
    return {
      quitados: 0,
      restaurantes: list.map((r: any) => {
        const out = {
          ...r,
          fuente: r.fuente === "perplexity" ? "perplexity" : "estimado",
          estado_dato: "ESTIMADO",
          verificado: false,
          nota: "Sugerencia sin verificar en Google Maps; confirma que sigue abierto antes de ir.",
        };
        delete out.consultado_at;
        delete out.rating;
        delete out.num_reviews;
        return out;
      }),
    };
  }
  const used = new Set<string>();
  const out: any[] = [];
  let quitados = 0;
  for (const r of list as any[]) {
    const p = places.find((x) => !used.has(x.place_id) && samePlaceName(x.name, r.nombre));
    if (!p) { quitados++; continue; }
    used.add(p.place_id);
    const base = restaurantFromPlace(p, r.ciudad ?? city);
    out.push({ ...base, por_que: typeof r.por_que === "string" && r.por_que.trim() ? r.por_que : base.por_que, ...(r.tip ? { tip: r.tip } : {}) });
  }
  for (const p of places) {
    if (out.length >= min) break;
    if (used.has(p.place_id)) continue;
    used.add(p.place_id);
    out.push(restaurantFromPlace(p, city));
  }
  return { restaurantes: out, quitados };
}
