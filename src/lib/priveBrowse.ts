/**
 * Explorar destinos de Privé sin lista infinita (dueño, 2026-10-22: "tengo que bajar 829 veces para
 * buscar, no es experiencia premium"). Lógica pura, probada en src/test/priveUx.test.tsx:
 *   - búsqueda instantánea sin acentos ni mayúsculas ("queretaro" → Querétaro, "nyc" → Nueva York,
 *     "italia" → las ciudades de Italia);
 *   - una región a la vez (pestañas);
 *   - una fila de destacados (más experiencias verificadas primero).
 */
import type { PriveCoverage } from "@/lib/priveCatalogApi";
import { PRIVE_DESTINATION_INDEX } from "@/lib/priveDestinationIndex";
import { PRIVE_TEXT, type PriveLang, type RegionKey } from "@/lib/priveI18n";

export type BrowseDestination = { slug: string; name: string; region_group: string | null; kind: string; coverage: PriveCoverage; count: number };

export const REGION_ORDER: RegionKey[] = ["mexico", "europa", "norteamerica", "medio_oriente", "asia_oceania", "otras_regiones"];

/** Igual que public.prive_norm(): sin acentos, minúsculas, & → and, lo demás → espacio. */
export function normalizeQuery(t: string | null | undefined): string {
  return String(t ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/ß/g, "ss").replace(/ø/gi, "o").replace(/ł/gi, "l")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export const displayName = (d: Pick<BrowseDestination, "slug" | "name">, lang: PriveLang) =>
  (lang === "en" && PRIVE_DESTINATION_INDEX[d.slug]?.en) || d.name;

/** Lo que se lista: destinos con experiencias, sin barrios (se ven dentro de su ciudad). */
export const browsable = (list: BrowseDestination[]) => list.filter((d) => d.count > 0 && d.kind !== "neighborhood");

const wordStarts = (hay: string, q: string) => hay === q || hay.startsWith(q) || hay.includes(` ${q}`);

/** Puntaje de coincidencia (0 = no coincide). Nombre > nombre en inglés/alias > país. */
export function matchScore(d: BrowseDestination, q: string): number {
  if (!q) return 0;
  const meta = PRIVE_DESTINATION_INDEX[d.slug];
  const name = normalizeQuery(d.name);
  if (name === q) return 100;
  if (name.startsWith(q)) return 90;
  if (wordStarts(name, q)) return 80;
  const names = [meta?.en, ...(meta?.aliases ?? [])].map(normalizeQuery).filter(Boolean);
  if (names.some((n) => n === q)) return 75;
  if (names.some((n) => wordStarts(n, q))) return 65;
  if (name.includes(q)) return 55;
  if (names.some((n) => n.includes(q))) return 45;
  const countries = [meta?.country_es, meta?.country_en].map(normalizeQuery).filter(Boolean);
  if (q.length >= 3 && countries.some((c) => wordStarts(c, q))) return 30;
  return 0;
}

export function searchDestinations(list: BrowseDestination[], query: string): BrowseDestination[] {
  const q = normalizeQuery(query);
  if (!q) return [];
  return list
    .map((d, i) => ({ d, i, s: matchScore(d, q) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || b.d.count - a.d.count || a.i - b.i)
    .map((x) => x.d);
}

/** Regiones con destinos, en el orden de la marca; las que no conocemos van al final. */
export function groupByRegion(list: BrowseDestination[]): { key: string; items: BrowseDestination[] }[] {
  const keys = [...REGION_ORDER, ...new Set(list.map((d) => d.region_group ?? "otras_regiones").filter((k) => !REGION_ORDER.includes(k as RegionKey)))];
  return keys
    .map((key) => ({ key, items: list.filter((d) => (d.region_group ?? "otras_regiones") === key) }))
    .filter((g) => g.items.length > 0);
}

const COVERAGE_RANK: Record<PriveCoverage, number> = { PILOTO_VERIFICADO: 0, COBERTURA_PARCIAL: 1, DESCUBRIMIENTO_BAJO_DEMANDA: 2, SIN_COBERTURA_VERIFICADA: 3 };

/** Destacados honestos: los de selección verificada y más experiencias, sin repetir orden del servidor. */
export function featuredDestinations(list: BrowseDestination[], n = 8): BrowseDestination[] {
  return list
    .map((d, i) => ({ d, i }))
    .sort((a, b) => (COVERAGE_RANK[a.d.coverage] ?? 9) - (COVERAGE_RANK[b.d.coverage] ?? 9) || b.d.count - a.d.count || a.i - b.i)
    .slice(0, n)
    .map((x) => x.d);
}

/**
 * Relación geográfica correcta en una línea (Fase 3): Polanco → "Barrio de Ciudad de México";
 * Montecarlo → "Zona de Mónaco"; Punta Mita → "En Riviera Nayarit"; Interlomas → "Área metropolitana
 * de Ciudad de México"; Riviera Nayarit → "Región · México"; París → "Francia".
 */
export function placeLine(slug: string, lang: PriveLang): string {
  const m = PRIVE_DESTINATION_INDEX[slug];
  if (!m) return "";
  const P = PRIVE_TEXT[lang].browse.place;
  const nm = (s: string | null) => (s ? (lang === "en" ? PRIVE_DESTINATION_INDEX[s]?.en : PRIVE_DESTINATION_INDEX[s]?.es) ?? s : "");
  const country = lang === "en" ? m.country_en : m.country_es;
  if (m.parent) {
    const parent = PRIVE_DESTINATION_INDEX[m.parent];
    if (m.kind === "neighborhood") return parent?.kind === "country" ? P.zoneOf(nm(m.parent)) : P.neighborhood(nm(m.parent));
    return P.within(nm(m.parent));
  }
  // La zona metropolitana solo para lo que no es su ciudad central (Interlomas sí; Ciudad de México no).
  if (m.area && !normalizeQuery(m.area.es).includes(normalizeQuery(m.es))) return lang === "en" ? m.area.en : m.area.es;
  if (m.kind === "region") return P.region(country);
  if (m.kind === "country") return PRIVE_TEXT[lang].browse.regionNames[(m.group ?? "otras_regiones") as RegionKey] ?? "";
  return country;
}

/** Todos los destinos del dueño desde el índice (sin conteos): para resolver búsquedas y viajes sin esperar a prive_home. */
export function indexDestinations(): BrowseDestination[] {
  return Object.entries(PRIVE_DESTINATION_INDEX).map(([slug, m]) => ({ slug, name: m.es, region_group: m.group, kind: m.kind, coverage: "SIN_COBERTURA_VERIFICADA" as PriveCoverage, count: 0 }));
}
