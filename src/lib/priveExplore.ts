/**
 * EXPLORE de IATOS Privé: "Mapa + ¿cuándo ir?" y "Ruleta de inspiración" (dueño, 23-oct-2026: "Para ti" es
 * 100 % personal; Explorar es descubrir). Lógica pura, probada en src/test/priveExplore.test.tsx.
 *
 * Nada se inventa:
 *  - Clima: promedios mensuales de NASA POWER 2001–2025 (src/lib/priveExploreGeo.ts, generado por
 *    scripts/prive/gen_explore_geo.mjs, con fuente, términos y fecha). La regla de "buen clima" es fija y se
 *    muestra tal cual en la pantalla (CLIMATE_RULE).
 *  - Eventos: experiencias del catálogo con fecha (event_start/event_end) y su ficha con fuente.
 *  - Horas de vuelo: ESTIMADAS por la distancia en línea recta (haversine) a velocidad de crucero; siempre
 *    se etiquetan como estimado y sin escalas.
 *  - Razones de la ruleta: conteos y reconocimientos del catálogo, clima con fuente y las razones que el
 *    servidor calculó (prive_score: gustos solo con permiso, nivel de presupuesto, verificado).
 */
import { haversineKm } from "../../supabase/functions/_shared/geo-distance.ts";
import type { PriveExperience, PriveUniverse } from "@/lib/priveCatalogApi";
import type { PriveClimateMonth, PriveGeo } from "@/lib/priveExploreGeo";

export type Month = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11;
export type Coord = { lat: number; lng: number };

// ── Clima ──────────────────────────────────────────────────────────────────────────────────
/** Regla de "en temporada" por clima (se muestra en la leyenda; cambiarla aquí cambia el texto). */
export const CLIMATE_RULE = { minHigh: 17, maxHigh: 31, rainFactor: 1.1, rainFloor: 60, rainCap: 160, snow: 0.6 } as const;

export type SeasonKind = "good" | "snow" | "off" | "unknown";
export type MonthClimate = { high: number | null; low: number | null; rain: number | null; snow: number | null; kind: SeasonKind };

export function monthClimate(geo: PriveGeo | null | undefined, month: number): MonthClimate {
  const m: PriveClimateMonth | undefined = geo?.m?.[month];
  if (!geo || !m) return { high: null, low: null, rain: null, snow: null, kind: "unknown" };
  const [high, low, rain, snow] = m;
  return { high, low, rain, snow, kind: seasonKind(geo, month) };
}

/**
 * - "snow": más del 60 % del suelo con nieve en promedio (FRSNO), temporada de nieve.
 * - "good": máximas de 17 a 31 °C y lluvia por debajo de lo habitual del lugar (≤ 1.1 × su promedio
 *   mensual, con un piso de 60 mm y nunca más de 160 mm).
 * - "off": lo demás. "unknown": sin datos.
 */
export function seasonKind(geo: PriveGeo | null | undefined, month: number): SeasonKind {
  const m = geo?.m?.[month];
  if (!geo || !m) return "unknown";
  const [high, , rain, snow] = m;
  if (snow != null && snow >= CLIMATE_RULE.snow) return "snow";
  if (high == null || rain == null) return "unknown";
  const rains = geo.m.map((x) => x[2]).filter((x): x is number => x != null);
  const avg = rains.length ? rains.reduce((a, b) => a + b, 0) / rains.length : rain;
  const rainOk = rain <= Math.max(CLIMATE_RULE.rainFloor, CLIMATE_RULE.rainFactor * avg) && rain <= CLIMATE_RULE.rainCap;
  return high >= CLIMATE_RULE.minHigh && high <= CLIMATE_RULE.maxHigh && rainOk ? "good" : "off";
}

export const inSeason = (k: SeasonKind) => k === "good" || k === "snow";

/** Meses en temporada de un destino (para "mejor época: …"). */
export const seasonMonths = (geo: PriveGeo | null | undefined): number[] =>
  geo ? geo.m.map((_, i) => i).filter((i) => inSeason(seasonKind(geo, i))) : [];

// ── Vuelo (estimado) ───────────────────────────────────────────────────────────────────────
/** Velocidad media de crucero y tiempo fijo de despegue/aterrizaje usados para el ESTIMADO. */
export const FLIGHT_MODEL = { kmh: 820, overheadH: 0.5, minKm: 250 } as const;

export type FlightEstimate = { km: number; hours: number; short: boolean };

/** Horas de vuelo directo ESTIMADAS por distancia en línea recta (no hay vuelos reales detrás). */
export function flightEstimate(from: Coord | null | undefined, to: Coord | null | undefined): FlightEstimate | null {
  if (!from || !to) return null;
  const km = haversineKm(from, to);
  if (!Number.isFinite(km)) return null;
  const hours = km / FLIGHT_MODEL.kmh + FLIGHT_MODEL.overheadH;
  return { km: Math.round(km), hours: Math.round(hours * 2) / 2, short: km < FLIGHT_MODEL.minKm };
}

// ── Eventos con fecha ──────────────────────────────────────────────────────────────────────
const ymd = (iso: string) => iso.slice(0, 10);

/** ¿El evento ocurre (aunque sea un día) en ese mes del año dado? Fechas ISO del catálogo. */
export function eventInMonth(e: Pick<PriveExperience, "event_start" | "event_end">, year: number, month: number): boolean {
  if (!e.event_start) return false;
  const start = ymd(e.event_start);
  const end = ymd(e.event_end ?? e.event_start);
  const m0 = `${year}-${String(month + 1).padStart(2, "0")}-01`;
  const m1 = `${year}-${String(month + 1).padStart(2, "0")}-31`;
  return start <= m1 && end >= m0;
}

/** El año del mes elegido: el próximo que viene (octubre 2026 → enero es de 2027). */
export function yearFor(month: number, today = new Date()): number {
  return month < today.getMonth() ? today.getFullYear() + 1 : today.getFullYear();
}

/** Eventos del catálogo por destino en el mes elegido (solo publicables, con fecha). */
export function eventsByDestination(events: PriveExperience[], year: number, month: number): Map<string, PriveExperience[]> {
  const out = new Map<string, PriveExperience[]>();
  for (const e of events) {
    const slug = e.destination?.slug;
    if (!slug || !eventInMonth(e, year, month)) continue;
    if (!["VERIFICADO", "CURADO", "ESTIMADO"].includes(e.state)) continue;
    out.set(slug, [...(out.get(slug) ?? []), e].sort((a, b) => String(a.event_start).localeCompare(String(b.event_start))));
  }
  return out;
}

// ── Mapa (Web Mercator) ────────────────────────────────────────────────────────────────────
export const TILE = 256;

/** Coordenadas de píxel del mundo en el nivel z (z puede ser fraccionario). */
export function project(c: Coord, z: number): { x: number; y: number } {
  const n = TILE * 2 ** z;
  const lat = Math.max(-85.0511, Math.min(85.0511, c.lat));
  const s = Math.sin((lat * Math.PI) / 180);
  return { x: ((c.lng + 180) / 360) * n, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n };
}

export type MapPoint = { slug: string; x: number; y: number };
export type Cluster = { key: string; x: number; y: number; slugs: string[] };

/**
 * Agrupa puntos que quedan a menos de `radius` píxeles (codicioso, en orden estable). Lo que queda solo
 * es un punto; lo demás es un grupo con su número, que al tocarlo acerca el mapa.
 */
export function clusterPoints(points: MapPoint[], radius = 34): Cluster[] {
  const out: Cluster[] = [];
  const used = new Set<number>();
  for (let i = 0; i < points.length; i++) {
    if (used.has(i)) continue;
    used.add(i);
    const members = [points[i]];
    for (let j = i + 1; j < points.length; j++) {
      if (used.has(j)) continue;
      const dx = points[j].x - points[i].x, dy = points[j].y - points[i].y;
      if (dx * dx + dy * dy <= radius * radius) { used.add(j); members.push(points[j]); }
    }
    const x = members.reduce((a, p) => a + p.x, 0) / members.length;
    const y = members.reduce((a, p) => a + p.y, 0) / members.length;
    out.push({ key: members.map((m) => m.slug).sort().join("|"), x, y, slugs: members.map((m) => m.slug) });
  }
  return out;
}

// ── Ruleta de inspiración ──────────────────────────────────────────────────────────────────
/** Presupuesto aproximado por experiencia: nivel máximo de precio del catálogo (1–4, "$"…"$$$$"). */
export type BudgetKey = "any" | "moderate" | "high" | "top";
export const BUDGET_MAX: Record<BudgetKey, number> = { any: 4, moderate: 2, high: 3, top: 4 };

export type RouletteCandidate = {
  slug: string;
  name: string;
  /** Experiencias del universo elegido en ese destino, dentro del presupuesto (orden del servidor). */
  experiences: PriveExperience[];
  score: number;
  season: SeasonKind | null;
  events: PriveExperience[];
};

const expScore = (e: PriveExperience) => (typeof e.score === "number" ? e.score : e.score?.score ?? 0);
export const expReasons = (e: PriveExperience): string[] => (typeof e.score === "object" && e.score ? e.score.reasons ?? [] : e.reasons ?? []);

/**
 * Candidatos de la ruleta: destinos con experiencias publicables del universo elegido, dentro del
 * presupuesto (sin nivel de precio cuenta como "por confirmar" y sí entra). Con mes: el buen clima suma y
 * el mal clima resta, pero no se esconde (se dice en la tarjeta).
 */
export function rouletteCandidates(items: PriveExperience[], opts: { budget: BudgetKey; month: number | null; geo: Record<string, PriveGeo>; events?: PriveExperience[]; year?: number }): RouletteCandidate[] {
  const max = BUDGET_MAX[opts.budget];
  const by = new Map<string, RouletteCandidate>();
  for (const e of items) {
    if (!["VERIFICADO", "CURADO", "ESTIMADO"].includes(e.state)) continue;
    if (e.price_level != null && e.price_level > max) continue;
    const slug = e.destination?.slug;
    if (!slug) continue;
    const c = by.get(slug) ?? { slug, name: e.destination?.name ?? slug, experiences: [], score: 0, season: null, events: [] };
    c.experiences.push(e);
    by.set(slug, c);
  }
  const year = opts.year ?? (opts.month != null ? yearFor(opts.month) : new Date().getFullYear());
  const evs = opts.month != null && opts.events ? eventsByDestination(opts.events, year, opts.month) : new Map<string, PriveExperience[]>();
  for (const c of by.values()) {
    const top = c.experiences.slice(0, 3).reduce((a, e) => a + expScore(e), 0);
    c.score = top + Math.min(c.experiences.length, 6) * 4;
    if (opts.month != null) {
      c.season = seasonKind(opts.geo[c.slug], opts.month);
      if (inSeason(c.season)) c.score += 25;
      else if (c.season === "off") c.score -= 25;
      c.events = evs.get(c.slug) ?? [];
      if (c.events.length) c.score += 15;
    }
  }
  return [...by.values()].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

/**
 * Orden de las tarjetas: sorpresa, pero sin perder calidad. Se baraja dentro de franjas de 4 (los mejores
 * siguen saliendo primero) con un generador determinista por semilla (pruebas reproducibles).
 */
export function shuffleDeck<T>(list: T[], seed: number, band = 4): T[] {
  let s = seed >>> 0 || 1;
  const rnd = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 10_000) / 10_000; };
  const out: T[] = [];
  for (let i = 0; i < list.length; i += band) {
    const chunk = list.slice(i, i + band);
    for (let j = chunk.length - 1; j > 0; j--) {
      const k = Math.floor(rnd() * (j + 1));
      [chunk[j], chunk[k]] = [chunk[k], chunk[j]];
    }
    out.push(...chunk);
  }
  return out;
}

/** Universos que sirven de "mood" en la ruleta (los doce). */
export const MOODS: PriveUniverse[] = ["celebrations", "the_table", "yacht_sea", "adventure_elite", "after_dark", "private_stays",
  "culture_access", "wellness_escape", "iconic_events", "sport_leisure", "signature_mexico", "casino_grand_nights"];

/** Planeador de IATOS con el destino precargado (PlanTrip lee ?destino=). */
export const planHref = (destName: string) => `/dashboard/planear?destino=${encodeURIComponent(destName)}`;

/** "12–15 mar" / "28 feb – 2 mar" (fechas ISO del catálogo, sin mover el día por zona horaria). */
export function eventDates(e: Pick<PriveExperience, "event_start" | "event_end">, locale: string): string {
  if (!e.event_start) return "";
  const d = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  const a = d(e.event_start), b = d(e.event_end ?? e.event_start);
  const day = (x: Date) => x.toLocaleDateString(locale, { day: "numeric", timeZone: "UTC" });
  const dm = (x: Date) => x.toLocaleDateString(locale, { day: "numeric", month: "short", timeZone: "UTC" }).replace(/\.$/, "");
  if (a.getTime() === b.getTime()) return dm(a);
  if (a.getUTCMonth() === b.getUTCMonth()) return `${day(a)}–${dm(b)}`;
  return `${dm(a)} – ${dm(b)}`;
}
