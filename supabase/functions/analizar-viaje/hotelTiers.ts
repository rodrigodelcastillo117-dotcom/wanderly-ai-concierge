// Tres niveles de hotel (económico, medio y premium) con hoteles REALES de la búsqueda de Google Hotels
// (caso CDMX → Tepoztlán, 27-oct-2026: se guardó un solo hotel, "The Red Tree House", a $13,347 por
// noche, y el total lo sumaba como si fuera el elegido). Sin dependencias de Deno, para probarlo.
//
// Por qué quedaba uno solo: el servidor guardaba lo que escribiera la IA en "hospedaje" (la regla le pide
// "3 representativas", pero nada lo exigía) y enforceSources solo re-etiquetaba. Ahora, si hay lista en
// vivo, el servidor completa los niveles que falten con hoteles de esa lista (por precio por noche) y
// quita los que la IA inventó fuera de ella. Sin lista en vivo, se deja lo de la IA (ya marcado
// "estimado" por enforceSources).
import { sameName } from "./sources.ts";

export type HotelTier = "ahorro" | "equilibrio" | "premium";
export const HOTEL_TIERS: HotelTier[] = ["ahorro", "equilibrio", "premium"];

const nightlyMxn = (h: any, fx: number) => Math.round((Number(h?.nightly_usd) || 0) * fx);

/** Hotel de la lista de Google Hotels (hotels-search) con la forma de trips.hospedaje_json. */
export function hotelFromLive(x: any, fx: number, o: { tier: HotelTier; porQue?: string | null; consultedAt: string; saved?: boolean }): any {
  const cls = Number(x?.hotel_class) > 0 ? Number(x.hotel_class) : null;
  const rating = Number(x?.rating) > 0 ? Number(x.rating) : 0;
  const reviews = Number(x?.reviews) > 0 ? Number(x.reviews) : null;
  const facts = [rating ? `Calificación ${rating.toLocaleString("es-MX", { maximumFractionDigits: 1 })} en Google Hotels${reviews ? ` (${reviews.toLocaleString("es-MX")} reseñas)` : ""}` : null,
    cls ? `${cls} estrellas` : null].filter(Boolean).join(" · ");
  return {
    nombre: String(x?.name ?? "Hotel"),
    tipo: cls ? `Hotel ${cls}★` : String(x?.type ?? "Hotel"),
    barrio: "",
    rating,
    precio_por_noche: nightlyMxn(x, fx),
    por_que: o.porQue?.trim() || facts || "Opción real de Google Hotels para tus fechas.",
    booking_link: typeof x?.booking_url === "string" ? x.booking_url : undefined,
    fuente_precio: "serpapi",
    estado_dato: o.saved ? "OBSOLETO" : "CONSULTADO_EN_VIVO",
    consultado_at: o.consultedAt,
    tier: o.tier,
    ...(x?.property_token ? { property_token: x.property_token } : {}),
    ...(typeof x?.link === "string" && /^https:\/\//.test(x.link) ? { website: x.link } : {}),
    ...(typeof x?.thumbnail === "string" && /^https:\/\//.test(x.thumbnail) ? { thumbnail: x.thumbnail } : {}),
    ...(x?.total_usd ? { total_usd: x.total_usd } : {}),
  };
}

/**
 * Índices (en `live`, ordenada de menor a mayor por noche) de los tres niveles: el más barato, el del
 * medio y el del percentil ~85 (no el más caro: un outlier de $700 USD no es "premium" de un pueblo).
 */
export function tierIndices(n: number): Record<HotelTier, number> | null {
  if (n <= 0) return null;
  if (n === 1) return { ahorro: 0, equilibrio: 0, premium: 0 };
  if (n === 2) return { ahorro: 0, equilibrio: 1, premium: 1 };
  return { ahorro: 0, equilibrio: Math.floor((n - 1) / 2), premium: Math.max(Math.floor((n - 1) / 2) + 1, Math.round((n - 1) * 0.85)) };
}

/** ¿Es una casa o departamento completo (no un hotel)? Solo cuenta si quedan al menos 3 hoteles. */
const isRental = (x: any) => /vacation rental|alquiler|casa|departamento|apartment/i.test(String(x?.type ?? ""));

/**
 * hospedaje final con 3 niveles (cada uno con `tier`):
 *  - con lista en vivo: los hoteles de la IA que SÍ son de la lista (enforceSources los dejó en
 *    "serpapi") se conservan (respetan lo que pidió el cliente); los niveles que falten se llenan con la
 *    lista por precio; lo que la IA inventó fuera de la lista se quita.
 *  - sin lista en vivo: lo de la IA, ordenado por precio y con su nivel.
 */
export function buildHotelTiers(aiHotels: any[], live: any[], o: { fxUsd: number; consultedAt: string; saved?: boolean; exclude?: boolean }): any[] {
  const ai = (Array.isArray(aiHotels) ? aiHotels : []).filter((h) => h && typeof h === "object");
  if (o.exclude) return ai;
  const fx = Number(o.fxUsd) || 0;
  let list = (Array.isArray(live) ? live : []).filter((x) => Number(x?.nightly_usd) > 0 && x?.name);
  if (!list.length || !(fx > 0)) {
    const sorted = [...ai].sort((a, b) => (Number(a?.precio_por_noche) || 0) - (Number(b?.precio_por_noche) || 0));
    const idx = tierIndices(sorted.length);
    return sorted.map((h, i) => ({ ...h, tier: h.tier ?? (idx ? (i === idx.ahorro ? "ahorro" : i >= idx.premium && sorted.length > 2 ? "premium" : "equilibrio") : "equilibrio") }));
  }
  const hotelsOnly = list.filter((x) => !isRental(x));
  if (hotelsOnly.length >= 3) list = hotelsOnly;
  // Sin repetidos y de menor a mayor por noche.
  const seen = new Set<string>();
  list = [...list].sort((a, b) => Number(a.nightly_usd) - Number(b.nightly_usd)).filter((x) => {
    const k = String(x.name).toLowerCase().trim();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const keptAi = ai.filter((h) => String(h?.fuente_precio ?? "") === "serpapi" && list.some((x) => sameName(x?.name, h?.nombre)));
  const out: any[] = [];
  const used = new Set<string>();
  const porQueOf = (name: unknown) => ai.find((h) => sameName(h?.nombre, name))?.por_que ?? null;
  // Con 3 o más de la IA en la lista, se respetan (son los que encajan con lo que pidió el cliente).
  if (keptAi.length >= 3) {
    const sorted = [...keptAi].sort((a, b) => (Number(a?.precio_por_noche) || 0) - (Number(b?.precio_por_noche) || 0));
    const idx = tierIndices(sorted.length)!;
    return HOTEL_TIERS.map((t) => ({ ...sorted[idx[t]], tier: t }));
  }
  const idx = tierIndices(list.length)!;
  for (const t of HOTEL_TIERS) {
    // Si la IA eligió uno de la lista que cae en el rango de ese nivel, va el suyo.
    const target = list[idx[t]];
    if (!target) continue;
    const k = String(target.name).toLowerCase();
    if (used.has(k)) continue;
    used.add(k);
    out.push(hotelFromLive(target, fx, { tier: t, porQue: porQueOf(target.name), consultedAt: o.consultedAt, saved: o.saved }));
  }
  return out;
}

/** Nivel de hotel que prefiere el perfil (presupuesto del perfil de viaje); por defecto, el medio. */
export function preferredHotelTier(presupuesto: unknown): HotelTier {
  const p = String(presupuesto ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  if (/econ|bajo|mochil|ahorr|barat/.test(p)) return "ahorro";
  if (/lujo|luxury|premium|alto|ultra/.test(p)) return "premium";
  return "equilibrio";
}
