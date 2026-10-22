/**
 * Búsqueda universal de IATOS Privé (Fase 1.2): "Un destino, una experiencia, una noche extraordinaria…".
 * Estructurada primero, sin IA y sin llamar al servidor por tecla:
 *   1. destino: alias, acentos y otros idiomas desde el índice del dueño ("cdmx", "Montecarlo",
 *      "Japón" → sus ciudades, "Polanco" → barrio de Ciudad de México);
 *   2. intención → universos con el mismo analizador del planificador de Iato (privePlanner) más unas
 *      pocas palabras de estancias, romance y aventura;
 *   3. lo que sobra (p. ej. el nombre de un restaurante) → palabras clave para prive_search.
 * La consulta al servidor (prive_search, con sesión Privé) se hace solo al confirmar. Si la búsqueda
 * necesita interpretación, la persona puede pasársela a Iato con un toque (Concierge existente).
 */
import { intentsToFilters, PRIVE_UNIVERSES } from "../../supabase/functions/concierge-chat/prive";
import { PRIVE_DESTINATION_INDEX } from "@/lib/priveDestinationIndex";
import { normalizeQuery, type BrowseDestination } from "@/lib/priveBrowse";

export type ParsedSearch = {
  /** Destinos detectados (slugs), en orden de relevancia; vacío = ninguno. */
  cities: string[];
  /** Si el destino salió de un país ("Japón"), su nombre normalizado. */
  country: string | null;
  universes: string[] | null;
  keywords: string[] | null;
  /** La consulta es solo un destino (sin intención ni palabras extra). */
  destinationOnly: boolean;
};

const EXTRA: [RegExp, string[]][] = [
  [/\b(hotel|hoteles|villa|villas|estancia|estancias|suite|resort|hospedaje|stay|stays)\b/, ["private_stays"]],
  [/\b(romantic[ao]?s?|romance|pareja|aniversario|luna de miel|honeymoon|romantic)\b/, ["celebrations", "the_table"]],
  [/\b(aventura|helicoptero|helicopter|buceo|diving|safari|globo)\b/, ["adventure_elite"]],
  [/\b(mexicano|mexicana|mezcal|tequila|artesania|artesanos)\b/, ["signature_mexico"]],
  [/\b(tenis|tennis|esqui|ski|deporte)\b/, ["sport_leisure"]],
  [/\b(fiesta|club nocturno|nightclub|bar|bares|noche|nocturn[ao])\b/, ["after_dark"]],
];

const STOP = new Set(("a al algo alguna algun alguno de del desde el en entre es esta este experiencia experiencias extraordinaria extraordinario " +
  "increible increibles la las lo los lugar lugares mas me mejor mejores mi muy noche para por que quiero un una unas unico unica unicas unicos " +
  "uno unos y the of in to for best an at with my me i want some unique night place places experience experiences espectacular spectacular " +
  "donde ver visitar conocer hacer").split(" "));

const has = (hay: string, needle: string) => needle.length > 1 && ` ${hay} `.includes(` ${needle} `);

type IndexHit = { slug: string; len: number };

/** Destino(s) mencionados en el texto, por el alias más largo que aparezca completo. */
function findDestinations(t: string): { slugs: string[]; matched: string[]; country: string | null } {
  const hits: IndexHit[] = [];
  const matched: string[] = [];
  for (const [slug, m] of Object.entries(PRIVE_DESTINATION_INDEX)) {
    const names = [m.es, m.en, ...m.aliases].map(normalizeQuery);
    const best = names.filter((n) => n.length >= 2 && has(t, n)).sort((a, b) => b.length - a.length)[0];
    if (best) { hits.push({ slug, len: best.length }); matched.push(best); }
  }
  if (hits.length) {
    hits.sort((a, b) => b.len - a.len);
    // Si "roma condesa" y "roma" coinciden, gana el más largo; se quitan los que están contenidos en él.
    const top = hits[0];
    const keep = hits.filter((h) => h === top || h.len === top.len);
    return { slugs: keep.map((h) => h.slug).slice(0, 5), matched, country: null };
  }
  // País: "Japón" → sus destinos.
  for (const m of Object.values(PRIVE_DESTINATION_INDEX)) {
    for (const c of [m.country_es, m.country_en].map(normalizeQuery)) {
      if (c.length >= 4 && has(t, c)) {
        const slugs = Object.entries(PRIVE_DESTINATION_INDEX).filter(([, x]) => normalizeQuery(x.country_es) === normalizeQuery(m.country_es)).map(([s]) => s);
        return { slugs: slugs.slice(0, 5), matched: [c], country: c };
      }
    }
  }
  return { slugs: [], matched: [], country: null };
}

export function parseSearch(query: string): ParsedSearch {
  const t = normalizeQuery(query);
  if (!t) return { cities: [], country: null, universes: null, keywords: null, destinationOnly: false };
  const dest = findDestinations(t);
  const f = intentsToFilters([t], []);
  const uni = new Set<string>(f.universes ?? []);
  for (const [re, us] of EXTRA) if (re.test(t)) us.forEach((u) => uni.add(u));
  const intentWords = new Set<string>();
  for (const k of f.keywords ?? []) normalizeQuery(k).split(" ").forEach((w) => intentWords.add(w));
  const destWords = new Set(dest.matched.flatMap((m) => m.split(" ")));
  const extra = t.split(" ").filter((w) => w.length >= 4 && !STOP.has(w) && !destWords.has(w) && !intentWords.has(w)
    && !EXTRA.some(([re]) => re.test(w)) && !/^(cena|cenar|dinner|comida|restaurante|yate|yates|barco|spa|museo|arte|golf|casino|rooftop|playa|beach)$/.test(w));
  const universes = [...uni].filter((u) => (PRIVE_UNIVERSES as readonly string[]).includes(u));
  const keywords = [...new Set([...(f.keywords ?? []), ...extra])].slice(0, 12);
  return {
    cities: dest.slugs,
    country: dest.country,
    universes: universes.length ? universes : null,
    keywords: keywords.length ? keywords : null,
    destinationOnly: dest.slugs.length > 0 && !universes.length && !extra.length,
  };
}

/** Argumentos de prive_search: sin destino, el del viaje activo o los destacados (máximo 5). */
export function searchArgs(p: ParsedSearch, fallbackCities: string[]): { _cities: string[]; _universes: string[] | null; _keywords: string[] | null; _per_universe: number } {
  const cities = (p.cities.length ? p.cities : fallbackCities).slice(0, 5);
  return { _cities: cities, _universes: p.universes, _keywords: p.keywords, _per_universe: p.universes || p.keywords ? 4 : 2 };
}

/** Destinos de la lista que coinciden con lo que se escribe (instantáneo, sin servidor). */
export function destinationMatches(list: BrowseDestination[], p: ParsedSearch): BrowseDestination[] {
  if (!p.cities.length) return [];
  const by = new Map(list.map((d) => [d.slug, d]));
  return p.cities.map((s) => by.get(s) ?? (PRIVE_DESTINATION_INDEX[s]
    ? { slug: s, name: PRIVE_DESTINATION_INDEX[s].es, region_group: PRIVE_DESTINATION_INDEX[s].group, kind: PRIVE_DESTINATION_INDEX[s].kind, coverage: "SIN_COBERTURA_VERIFICADA" as const, count: 0 }
    : null)).filter((d): d is BrowseDestination => !!d);
}
