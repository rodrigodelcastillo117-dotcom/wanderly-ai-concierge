// Restaurantes y experiencias de "Comprar" en carrusel (pedido del dueño, 23-oct-2026): por ciudad,
// 4 tarjetas — Económico, Medio, Caro y "Recomendado por IATOS" — con foto, precio y calificación.
//
// Reglas (puras, probadas en tripPicks.test.ts):
//  - El nivel de precio sale SOLO de datos que ya trae el viaje: el rango por persona de Google
//    ("EUR 20–30"), el nivel de Google ("Precio moderado") o los símbolos guardados ("$$"); en
//    experiencias, el precio por persona en MXN. Sin dato, la opción no se clasifica.
//  - Si no hay una opción de un nivel, el lugar queda vacío y lo dice ("Sin opción económica
//    verificada"): no se rellena con otra ni se inventa.
//  - "Recomendado por IATOS" cruza el perfil de la persona (lo que declaró y su ADN gastronómico) con
//    la cocina / el nombre / la descripción de cada opción y su calificación; el porqué cita el dato
//    real que coincidió. Sin coincidencias, la mejor calificada de Google; sin calificación, el "por
//    qué" que escribió el análisis para su perfil.

import { fxSourceName } from "@/lib/fx";
export type PickTier = "economico" | "medio" | "caro";
/** "lugar": experiencia sin precio real (se muestra sin nivel de precio: "Precio en el sitio"). */
export type PickSlot = PickTier | "recomendado" | "lugar";
export type PickKind = "restaurante" | "experiencia";

export const TIER_LABEL: Record<PickTier, string> = { economico: "Económico", medio: "Medio", caro: "Caro" };
export const SLOT_LABEL: Record<PickSlot, string> = { ...TIER_LABEL, recomendado: "Recomendado por IATOS", lugar: "Para visitar" };
export const MISSING_LABEL: Record<PickTier, string> = {
  economico: "Sin opción económica verificada",
  medio: "Sin opción de precio medio verificada",
  caro: "Sin opción cara verificada",
};

const norm = (v: unknown) => String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9$€£]+/g, " ").trim();

// Por persona, en la moneda del rango. Umbrales de una comida: barato < 20, medio ≤ 50, caro > 50 en
// EUR/USD/GBP/CHF; en MXN < 350, ≤ 900, > 900.
const MEAL: Record<string, [number, number]> = { EUR: [20, 50], USD: [20, 50], GBP: [18, 45], CHF: [25, 60], MXN: [350, 900] };
// Experiencias por persona en MXN: < 700, ≤ 2,000, > 2,000.
const TOUR_MXN: [number, number] = [700, 2000];

const byThreshold = (v: number, [a, b]: [number, number]): PickTier => (v < a ? "economico" : v <= b ? "medio" : "caro");

/**
 * Rango por persona con su moneda: "EUR 20–30", "Desde USD 15", y también con la moneda al final como
 * lo escribe el análisis ("€€€ (40-60 USD)", "$15 - $30 USD por persona") → { currency, min, max }.
 */
export function parseAmountRange(text: unknown): { currency: string; min: number; max: number | null } | null {
  const t = String(text ?? "").replace(/–|—/g, "-");
  const n = (s?: string) => (s ? Number(s.replace(/[.,](?=\d{3}\b)/g, "").replace(",", ".")) : NaN);
  const out = (cur: string, a: number, b: number) => (Number.isFinite(a) && a > 0
    ? { currency: cur, min: a, max: Number.isFinite(b) && b > 0 ? b : null } : null);
  // Moneda al final: "40-60 USD", "$15 - $30 USD", "25-40 USD/persona".
  const after = t.match(/\$?\s*(\d[\d.,]*)(?:\s*-\s*\$?\s*(\d[\d.,]*))?\s*(EUR|USD|MXN|GBP|CHF|JPY)\b/i);
  if (after) return out(after[3].toUpperCase(), n(after[1]), n(after[2]));
  const m = t.match(/(?:desde|hasta)?\s*(EUR|USD|MXN|GBP|CHF|JPY|€|US\$|£)\s*([\d.,]+)(?:\s*-\s*([\d.,]+))?/i);
  if (!m) return null;
  const cur = ({ "€": "EUR", "£": "GBP", "US$": "USD" } as Record<string, string>)[m[1]] ?? m[1].toUpperCase();
  return out(cur, n(m[2]), n(m[3]));
}

/** "EUR 20–30" / "Desde USD 15" / "MXN 400–800" → { currency, mid } (punto medio por persona). */
export function parsePriceRange(text: unknown): { currency: string; mid: number } | null {
  const r = parseAmountRange(text);
  if (!r) return null;
  return { currency: r.currency, mid: r.max != null ? (r.min + r.max) / 2 : r.min };
}

/** Tasa USD → MXN con fuente (la del plan del viaje, la misma del total); null si es de respaldo o no tiene fuente. */
export type SourcedRate = { rate: number; source: string };
export function tripUsdMxnRate(trip: any): SourcedRate | null {
  const l = trip?.itinerario_json?.logistics;
  const rate = Number(l?.fx_usd_mxn);
  if (!(rate > 0) || !l?.fx_source || l?.fx_is_fallback === true) return null;
  return { rate, source: String(l.fx_source) };
}


const fmtNum = (v: number) => Math.round(v).toLocaleString("es-MX");

/**
 * Precio de un restaurante para una página en pesos, sin mezclar monedas (E2E España: "€€€ (40-60 USD)"):
 *  - rango en USD y tasa con fuente → "MXN 750–1,126 por persona" (y de dónde sale la conversión);
 *  - otra moneda o sin tasa con fuente → el rango en SU moneda ("USD 40–60 por persona");
 *  - solo símbolos → "$$" se queda; "€€€" (otra moneda) se dice con palabras ("Caro").
 */
export function restaurantPriceLabel(raw: unknown, fx: SourcedRate | null): { text: string; note: string | null } | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const r = parseAmountRange(s);
  const range = (a: number, b: number | null) => (b != null && b !== a ? `${fmtNum(a)}–${fmtNum(b)}` : fmtNum(a));
  if (r) {
    if (r.currency === "USD" && fx) {
      return { text: `MXN ${range(r.min * fx.rate, r.max != null ? r.max * fx.rate : null)} por persona`,
        note: `De USD ${range(r.min, r.max)} · 1 USD = ${fx.rate.toFixed(2)} MXN (${fxSourceName(fx.source)})` };
    }
    return { text: `${r.currency} ${range(r.min, r.max)} por persona`, note: null };
  }
  const sym = s.replace(/\s+/g, "");
  if (/^€{1,4}$/.test(sym)) return { text: TIER_LABEL[sym.length === 1 ? "economico" : sym.length === 2 ? "medio" : "caro"], note: null };
  return null;
}

/** Nivel de precio de un restaurante del viaje, o null si no hay dato real. */
export function restaurantTier(r: any): PickTier | null {
  const range = parsePriceRange(r?.rango_precio) ?? parsePriceRange(r?.precio_rango);
  if (range && MEAL[range.currency]) return byThreshold(range.mid, MEAL[range.currency]);
  const level = norm(r?.nivel_precio ?? r?.price_level);
  if (/gratis|economico|inexpensive|price level free/.test(level)) return "economico";
  if (/moderado|moderate/.test(level)) return "medio";
  if (/caro|expensive/.test(level)) return "caro";
  const sym = String(r?.rango_precio ?? "").replace(/\s+/g, "");
  if (/^(\${1,4}|€{1,4})$/.test(sym)) return sym.length === 1 ? "economico" : sym.length === 2 ? "medio" : "caro";
  return null;
}

/**
 * ¿El precio por persona de la experiencia es real? analizar-viaje marca TODO precio de tour como
 * "ESTIMADO" (lo escribe la IA: "$50 MXN" de una cascada sin fuente); solo un precio en vivo (Viator,
 * GetYourGuide…) cuenta. Sin estado (datos de otra fuente), se respeta como antes.
 */
export function tourHasRealPrice(t: any): boolean {
  const p = Number(t?.precio_por_persona);
  if (!(Number.isFinite(p) && p > 0)) return false;
  const estado = String(t?.estado_dato ?? "").toUpperCase();
  return estado !== "ESTIMADO";
}

/** Nivel de una experiencia por su precio por persona REAL (MXN). Gratis cuenta como económica. */
export function tourTier(t: any): PickTier | null {
  const free = /\bgratis\b|\bfree\b/i.test(String(t?.precio ?? t?.nombre ?? "")) && !(Number(t?.precio_por_persona) > 0);
  if (free) return "economico";
  if (!tourHasRealPrice(t)) return null;
  const p = Number(t?.precio_por_persona);
  return byThreshold(p, TOUR_MXN);
}

export const tierOf = (kind: PickKind, x: any) => (kind === "restaurante" ? restaurantTier(x) : tourTier(x));

/** Calidad para elegir dentro de un nivel: calificación ponderada por reseñas. */
export function quality(x: any): number {
  const r = Number(x?.rating);
  const n = Number(x?.num_reviews ?? x?.user_rating_count);
  if (!Number.isFinite(r) || r <= 0) return 0;
  return r * Math.log10((Number.isFinite(n) && n > 0 ? n : 1) + 10);
}

export type TasteProfile = {
  /** Cocinas, intereses y estilos declarados (onboarding / perfil de viaje). */
  declared: string[];
  /** Cocinas de lugares que visitó (profiles.food_dna.top_cuisines). */
  cuisinesVisited: string[];
  /** Nivel de presupuesto preferido (perfil de viaje o ADN). */
  budget: PickTier | null;
};

/** Perfil para recomendar a partir de travel_profiles y profiles.food_dna (lo que haya). */
export function tasteFrom(tp: any, foodDna: any): TasteProfile {
  const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => String(x ?? "").trim()).filter(Boolean) : []);
  const declared = [...arr(tp?.preferencias_comida), ...arr(tp?.intereses), ...arr(tp?.estilo_viaje)];
  // El ADN guarda tipos de Google en inglés ("seafood_restaurant"): se dicen en español.
  const ES: Record<string, string> = { seafood: "mariscos", italian: "cocina italiana", japanese: "cocina japonesa", mexican: "cocina mexicana",
    french: "cocina francesa", steak: "carne", "steak house": "carne", vegetarian: "comida vegetariana", vegan: "comida vegana", cafe: "café",
    "coffee shop": "café", pizza: "pizza", sushi: "sushi", chinese: "cocina china", thai: "cocina tailandesa", indian: "cocina india",
    greek: "cocina griega", spanish: "cocina española", mediterranean: "cocina mediterránea", bar: "bares", "wine bar": "bares de vino",
    "fine dining": "alta cocina", bakery: "panaderías", ramen: "ramen", korean: "cocina coreana", peruvian: "cocina peruana" };
  const cuisinesVisited = (Array.isArray(foodDna?.top_cuisines) ? foodDna.top_cuisines : [])
    .map((c: any) => String(c?.key ?? c ?? "").replace(/_restaurant$/i, "").replace(/_/g, " ").trim().toLowerCase())
    .filter(Boolean).map((k: string) => ES[k] ?? k);
  const b = norm(tp?.presupuesto_rango ?? foodDna?.preferred_price);
  const budget: PickTier | null = /econ|bajo|mochil|ahorro|inexpensive|\$(?!\$)/.test(b) ? "economico"
    : /lujo|luxury|premium|alto|expensive/.test(b) ? "caro"
    : /medio|moderad|equilibr|moderate/.test(b) ? "medio" : null;
  return { declared, cuisinesVisited, budget };
}

// Palabras de un gusto que no dicen nada para comparar.
const WEAK = new Set(["comida", "cocina", "restaurante", "restaurantes", "de", "la", "el", "y", "en", "viaje", "viajes", "tipo", "estilo"]);
// Español ↔ inglés para cocinas frecuentes (el ADN guarda tipos de Google en inglés).
const SYN: Record<string, string[]> = {
  italiana: ["italian", "italiana", "pasta", "pizza", "trattoria", "osteria"], mariscos: ["seafood", "mariscos", "pescado", "fish", "oyster", "ostras"],
  japonesa: ["japanese", "japonesa", "sushi", "ramen"], francesa: ["french", "francesa", "bistro", "brasserie"],
  griega: ["greek", "griega", "taverna"], mexicana: ["mexican", "mexicana", "tacos"], vegetariana: ["vegetarian", "vegetariana", "vegan", "vegana"],
  cafe: ["cafe", "coffee", "cafeteria"], vino: ["wine", "vino", "bar a vin", "enoteca"], carne: ["steak", "steakhouse", "carne", "asador"],
  arte: ["arte", "art", "museo", "museum", "galeria", "gallery", "louvre", "uffizi"], historia: ["historia", "history", "historic", "ruinas", "ruins", "foro", "acropolis", "coliseo"],
  cultura: ["cultura", "museo", "museum", "historia", "arte"], gastronomia: ["food", "gastronom", "cooking", "cocina", "tasting", "degustacion", "mercado", "market"],
  aventura: ["aventura", "adventure", "kayak", "hiking", "senderismo", "bici", "bike"], naturaleza: ["naturaleza", "nature", "parque", "park", "jardin", "garden"],
  lujo: ["lujo", "luxury", "michelin", "fine dining", "premium", "privado", "private"], nocturna: ["nightlife", "noche", "bar", "cocktail", "coctel", "jazz", "cabaret"],
};

function termsOf(taste: string): string[] {
  const n = norm(taste);
  const words = n.split(" ").filter((w) => w.length >= 3 && !WEAK.has(w));
  const extra = Object.entries(SYN).filter(([k, v]) => words.some((w) => w.startsWith(k.slice(0, 5)) || v.includes(w))).flatMap(([, v]) => v);
  return Array.from(new Set([...words, ...extra]));
}

const textOf = (x: any) => ` ${norm([x?.nombre, x?.cocina, x?.tipo, x?.por_que, x?.duracion].filter(Boolean).join(" "))} `;

export type Recommendation = { index: number; reason: string; /** true si coincidió con el perfil (no solo calificación). */ matched: boolean };

/**
 * La mejor opción para el perfil entre `candidates` (índices). El porqué dice el dato que coincidió;
 * null si no hay nada en qué basarse (sin perfil, sin calificación y sin "por qué").
 */
export function recommend(list: any[], candidates: number[], kind: PickKind, taste: TasteProfile | null): Recommendation | null {
  if (!candidates.length) return null;
  type Scored = { i: number; score: number; reason: string | null; matched: boolean };
  const scored: Scored[] = candidates.map((i) => {
    const x = list[i];
    const hay = textOf(x);
    let score = 0;
    let reason: string | null = null;
    const match = (tastes: string[]) => tastes.find((t) => termsOf(t).some((w) => hay.includes(` ${w}`)));
    const visited = taste ? match(taste.cuisinesVisited) : undefined;
    const declared = taste ? match(taste.declared) : undefined;
    if (visited) { score += 4; reason = `Va con lo que más visitas: ${visited.toLowerCase()} (tu ADN gastronómico)`; }
    if (declared) { score += 3; reason = reason ?? `Va con lo que te gusta: ${declared.toLowerCase()} (tu perfil)`; }
    const tier = tierOf(kind, x);
    const fits = !!taste?.budget && tier === taste.budget;
    if (fits) score += 1.5;
    const r = Number(x?.rating);
    const n = Number(x?.num_reviews);
    if (Number.isFinite(r) && r > 0) score += (r - 4) * 2 + Math.min(1, Math.log10((n || 1) + 1) / 4);
    if (!reason && Number.isFinite(r) && r > 0) {
      const src = String(x?.fuente ?? "").startsWith("google") ? "en Google" : String(x?.fuente ?? "") === "tripadvisor" ? "en Tripadvisor" : "";
      reason = `${fits ? "En tu presupuesto y la mejor calificada" : "La mejor calificada"}: ${r.toLocaleString("es-MX", { maximumFractionDigits: 1 })}${src ? ` ${src}` : ""}${Number.isFinite(n) && n > 0 ? ` (${n.toLocaleString("es-MX")} reseñas)` : ""}`;
    }
    if (!reason && typeof x?.por_que === "string" && x.por_que.trim()) {
      score += 0.1;
      reason = `Elegido para tu perfil: ${x.por_que.trim().replace(/\s+/g, " ").slice(0, 110)}${x.por_que.trim().length > 110 ? "…" : ""}`;
    }
    return { i, score, reason, matched: !!(visited || declared) };
  });
  const best = scored.filter((s) => s.reason).sort((a, b) => b.score - a.score)[0];
  return best ? { index: best.i, reason: best.reason!, matched: best.matched } : null;
}

export type PickCard =
  | { slot: PickSlot; index: number; reason?: string | null }
  | { slot: PickTier; index: null; missing: string };

/**
 * Las 4 tarjetas de una ciudad: lo mejor de cada nivel de precio (por calificación) y la recomendación
 * para el perfil, de preferencia una opción que no esté ya en las tarjetas de precio.
 */
export function buildPickCards(list: any[], indices: number[], kind: PickKind, taste: TasteProfile | null): PickCard[] {
  // Si algo coincide con el perfil, ESA es la recomendada (aunque también sea la mejor de su nivel: su
  // nivel muestra la siguiente, si hay). Si no, la recomendada sale de lo que no está ya en pantalla.
  const forProfile = recommend(list, indices, kind, taste);
  const pinned = forProfile?.matched ? forProfile : null;
  const used = new Set<number>();
  const cards: PickCard[] = (["economico", "medio", "caro"] as PickTier[]).map((tier) => {
    const pool = indices.filter((i) => tierOf(kind, list[i]) === tier);
    if (!pool.length) return { slot: tier, index: null, missing: MISSING_LABEL[tier] };
    const ranked = [...pool].sort((a, b) => quality(list[b]) - quality(list[a]) || a - b);
    const best = ranked.find((i) => i !== pinned?.index) ?? ranked[0];
    used.add(best);
    return { slot: tier, index: best };
  });
  const rec = pinned ?? recommend(list, indices.filter((i) => !used.has(i)), kind, taste) ?? forProfile;
  if (rec) cards.push({ slot: "recomendado", index: rec.index, reason: rec.reason });
  // Experiencias sin precio real (caso Tepoztlán: Tepozteco, Cascada de los Venaditos…): se muestran sin
  // nivel de precio ("Para visitar · Precio en el sitio") en vez de quedar fuera o con un precio inventado.
  if (kind === "experiencia") {
    for (const i of indices) {
      const x = list[i];
      // Solo las que tienen un precio de la IA que no se muestra (estado ESTIMADO): sin precio alguno se quedan como antes.
      if (used.has(i) || i === rec?.index || tierOf(kind, x) || String(x?.estado_dato ?? "").toUpperCase() !== "ESTIMADO") continue;
      cards.push({ slot: "lugar", index: i });
    }
  }
  return cards;
}

/** Niveles sin opción verificada, en palabras: "No encontramos opciones verificadas de nivel alto aquí." */
const TIER_WORDS: Record<PickTier, string> = { economico: "económico", medio: "medio", caro: "alto" };
export function missingTiersLine(cards: PickCard[]): string | null {
  const missing = cards.filter((c): c is Extract<PickCard, { index: null }> => c.index == null).map((c) => c.slot as PickTier);
  if (!missing.length) return null;
  if (missing.length === 3) return "Sin precios verificados para ordenarlos por nivel: el precio se confirma en el sitio.";
  const words = missing.map((t) => TIER_WORDS[t]);
  return `No encontramos opciones verificadas de nivel ${words.join(" ni ")} aquí.`;
}
