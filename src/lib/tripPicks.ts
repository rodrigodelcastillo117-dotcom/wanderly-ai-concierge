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

export type PickTier = "economico" | "medio" | "caro";
export type PickSlot = PickTier | "recomendado";
export type PickKind = "restaurante" | "experiencia";

export const TIER_LABEL: Record<PickTier, string> = { economico: "Económico", medio: "Medio", caro: "Caro" };
export const SLOT_LABEL: Record<PickSlot, string> = { ...TIER_LABEL, recomendado: "Recomendado por IATOS" };
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

/** "EUR 20–30" / "Desde USD 15" / "MXN 400–800" → { currency, mid } (punto medio por persona). */
export function parsePriceRange(text: unknown): { currency: string; mid: number } | null {
  const t = String(text ?? "").replace(/–|—/g, "-");
  const m = t.match(/(?:desde|hasta)?\s*(EUR|USD|MXN|GBP|CHF|€|US\$|£)\s*([\d.,]+)(?:\s*-\s*([\d.,]+))?/i);
  if (!m) return null;
  const cur = ({ "€": "EUR", "£": "GBP", "US$": "USD" } as Record<string, string>)[m[1]] ?? m[1].toUpperCase();
  const n = (s?: string) => (s ? Number(s.replace(/[.,](?=\d{3}\b)/g, "").replace(",", ".")) : NaN);
  const a = n(m[2]);
  const b = n(m[3]);
  if (!Number.isFinite(a) || a <= 0) return null;
  return { currency: cur, mid: Number.isFinite(b) && b > 0 ? (a + b) / 2 : a };
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

/** Nivel de una experiencia por su precio por persona (MXN). Gratis cuenta como económica. */
export function tourTier(t: any): PickTier | null {
  const free = /\bgratis\b|\bfree\b/i.test(String(t?.precio ?? t?.nombre ?? "")) && !(Number(t?.precio_por_persona) > 0);
  if (free) return "economico";
  const p = Number(t?.precio_por_persona);
  return Number.isFinite(p) && p > 0 ? byThreshold(p, TOUR_MXN) : null;
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
  const cuisinesVisited = (Array.isArray(foodDna?.top_cuisines) ? foodDna.top_cuisines : [])
    .map((c: any) => String(c?.key ?? c ?? "").replace(/_restaurant$/i, "").replace(/_/g, " ").trim()).filter(Boolean);
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
  return cards;
}
