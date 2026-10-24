// "Que la IA entienda todo el mundo": qué es cada destino escrito (país, región, ciudad, pueblo, lugar o
// carretera) y, si es país, región o carretera, por qué ciudades reales se recorre.
// Sin dependencias de Deno: se prueba con Vitest (src/test/placeResolve.test.ts) con fixtures y sin red.
//
// Fuentes (nada inventado):
// - Google Geocoding (SKU "Geocoding", USD 5 / 1,000; 10,000 gratis al mes) por el transporte del conector
//   de Google (google-maps.ts / googleTransportFor): tipo, nombre canónico, país (ISO2), lat/lng, viewport y
//   place_id. UNA llamada por destino nuevo; la caché (serp_cache, 30 días: los términos de Google permiten
//   guardar place_id y coordenadas hasta 30 días) evita repetirla para cualquier usuario.
// - Wikidata (CC0, gratis): ciudades de un país o región ordenadas por población (P1082; la capital P36
//   primero en un país) y paradas de una carretera (P609 "lugar de término", P559 "término", P1302
//   "destinos principales"). User-Agent descriptivo como piden sus términos. Timeout de 6 s por consulta y
//   caché de 30 días. Si Wikidata falla, el destino queda como está.
// - La tabla curada (_shared/regions.ts) tiene prioridad y no gasta ninguna consulta.
//
// Ambiguo ("Córdoba") o sin resultado: no se adivina; se devuelve needs_clarification con hasta 3
// candidatos reales de Geocoding para que la persona elija.
import { cityAirports } from "./airports.ts";
import { type CacheStore, cacheGet, cacheKey, freshnessOf } from "./serpCache.ts";
import { callError, type GoogleTransport, googleJson } from "./google-maps.ts";
import { findRegion, placeKey } from "./regions.ts";

export type PlaceKind = "country" | "region" | "city" | "town" | "poi" | "route";

export type Viewport = { ne: { lat: number; lng: number }; sw: { lat: number; lng: number } };

export type PlaceCandidate = {
  /** Lo que se muestra y se escribe en la ruta al elegirlo ("Córdoba, Argentina"). */
  label: string;
  name: string;
  kind: PlaceKind;
  country: string | null;
  country_name: string | null;
  lat: number | null;
  lng: number | null;
  viewport: Viewport | null;
  place_id: string | null;
};

export type PlaceResolution = {
  input: string;
  /** skipped: la tabla curada o el catálogo de ciudades ya lo conocen (sin consulta). */
  status: "ok" | "needs_clarification" | "unavailable" | "skipped";
  kind?: PlaceKind;
  name?: string;
  label?: string;
  country?: string | null;
  country_name?: string | null;
  lat?: number | null;
  lng?: number | null;
  viewport?: Viewport | null;
  place_id?: string | null;
  /** Ciudades de Wikidata (país/región: por población; carretera: paradas en orden). Hasta 8. */
  bases?: string[];
  /** Carretera: se recorre en coche (con o sin paradas de Wikidata). */
  roadtrip?: boolean;
  wikidata?: { qid: string; url: string } | null;
  candidates?: PlaceCandidate[];
  /** Texto para la persona ("¿Te refieres a Córdoba, España o Córdoba, Argentina?"). */
  message?: string;
};

export type PlaceDeps = {
  google: GoogleTransport | null;
  store?: CacheStore | null;
  /** fetch para Wikidata (en pruebas, un fixture). */
  fetch?: typeof fetch;
  now?: () => number;
  wikidataTimeoutMs?: number;
  log?: (...a: unknown[]) => void;
};

export const GEOCODE_SKU = "Geocoding";
export const PLACE_TTL = 30 * 86400;
export const PLACE_TTL_EMPTY = 7 * 86400;
export const WIKIDATA_TIMEOUT_MS = 6000;
export const WIKIDATA_UA = "IATOS/1.0 (https://traveliatos.life)";
const WD_API = "https://www.wikidata.org/w/api.php";
const WD_SPARQL = "https://query.wikidata.org/sparql";
const MAX_BASES = 8;

// ─── ¿Hace falta consultar? ───

/** false si la tabla curada lo conoce (región) o es una ciudad del catálogo de aeropuertos. */
export function needsResolve(d: unknown): boolean {
  const s = String(d ?? "").trim();
  if (s.length < 2) return false;
  if (findRegion(s)) return false;
  if (cityAirports(s)) return false;
  return true;
}

// ─── Google Geocoding ───

type GeoComponent = { long_name?: string; short_name?: string; types?: string[] };
type GeoResult = {
  place_id?: string;
  types?: string[];
  formatted_address?: string;
  address_components?: GeoComponent[];
  geometry?: { location?: { lat?: number; lng?: number }; viewport?: { northeast?: { lat: number; lng: number }; southwest?: { lat: number; lng: number } } };
  partial_match?: boolean;
};

/** Tipo de lugar según los `types` de Geocoding. */
export function classifyTypes(types: unknown): PlaceKind {
  const t = new Set(Array.isArray(types) ? types.map(String) : []);
  if (t.has("country")) return "country";
  if (t.has("route")) return "route";
  if (t.has("locality")) return "city";
  if (t.has("administrative_area_level_1") || t.has("administrative_area_level_2") || t.has("colloquial_area")) return "region";
  if (t.has("postal_town") || t.has("administrative_area_level_3") || t.has("administrative_area_level_4") || t.has("sublocality") || t.has("sublocality_level_1") || t.has("neighborhood")) return "town";
  return "poi"; // natural_feature, point_of_interest, establishment, park, airport…
}

const comp = (r: GeoResult, type: string) => (r.address_components ?? []).find((c) => (c.types ?? []).includes(type));

export function candidateFrom(r: GeoResult): PlaceCandidate {
  const kind = classifyTypes(r.types);
  const country = comp(r, "country");
  const first = (r.address_components ?? [])[0];
  const name = String(first?.long_name ?? (r.formatted_address ?? "").split(",")[0] ?? "").trim();
  const cName = country?.long_name ?? null;
  const label = kind === "country" || !cName || name === cName ? name : `${name}, ${cName}`;
  const loc = r.geometry?.location;
  const vp = r.geometry?.viewport;
  return {
    label, name, kind,
    country: country?.short_name && /^[A-Z]{2}$/.test(country.short_name) ? country.short_name : null,
    country_name: cName,
    lat: Number.isFinite(loc?.lat) ? loc!.lat! : null,
    lng: Number.isFinite(loc?.lng) ? loc!.lng! : null,
    viewport: vp?.northeast && vp?.southwest ? { ne: vp.northeast, sw: vp.southwest } : null,
    place_id: r.place_id ?? null,
  };
}

/** Candidatos distintos (hasta 3); si dos se llaman igual se les agrega su región ("Córdoba, Córdoba, Argentina"). */
function distinctCandidates(results: GeoResult[]): PlaceCandidate[] {
  const out: PlaceCandidate[] = [];
  const raw = results.slice(0, 5);
  for (const r of raw) {
    const c = candidateFrom(r);
    if (!c.name) continue;
    if (out.some((o) => o.place_id && o.place_id === c.place_id)) continue;
    if (out.some((o) => placeKey(o.label) === placeKey(c.label))) {
      const a1 = comp(r, "administrative_area_level_1")?.long_name;
      if (a1 && a1 !== c.name) c.label = `${c.name}, ${a1}${c.country_name ? `, ${c.country_name}` : ""}`;
      if (out.some((o) => placeKey(o.label) === placeKey(c.label))) continue;
    }
    out.push(c);
    if (out.length >= 3) break;
  }
  return out;
}

type GeoCached = { candidates: PlaceCandidate[]; partial: boolean };

/** Geocoding con caché de 30 días (7 si no hubo resultado). null = Google no respondió (no se guarda). */
export async function geocodePlace(input: string, deps: PlaceDeps): Promise<GeoCached | null> {
  const q = input.replace(/\s+/g, " ").trim().slice(0, 120);
  const key = await cacheKey("gmaps_geocode", { q: placeKey(q), lang: "es" });
  const row = await cacheGet(deps.store, key, deps.log);
  if (row && freshnessOf(row, (deps.now ?? Date.now)()).fresh) return row.response as GeoCached;
  if (!deps.google) return null;
  const r = await googleJson<{ status?: string; results?: GeoResult[] }>(deps.google, "geocoding", GEOCODE_SKU, "/maps/api/geocode/json", {
    query: new URLSearchParams({ address: q, language: "es" }),
    timeoutMs: 6000,
  });
  if (!r.ok) {
    (deps.log ?? console.warn)("placeResolve geocode:", callError(r).kind);
    return null;
  }
  const results = Array.isArray(r.data?.results) ? r.data!.results! : [];
  const value: GeoCached = { candidates: distinctCandidates(results), partial: results.length === 1 && !!results[0]?.partial_match };
  if (deps.store) {
    try {
      await deps.store.put(key, "gmaps_geocode", value, value.candidates.length ? PLACE_TTL : PLACE_TTL_EMPTY);
    } catch (e) {
      (deps.log ?? console.warn)("placeResolve cache put:", (e as Error)?.message);
    }
  }
  return value;
}

// ─── Wikidata ───

type WdBinding = Record<string, { value: string } | undefined>;
type WdBases = { status: "ok"; qid: string | null; bases: string[] } | { status: "empty" };

const QID = /^Q\d+$/;
const qidOf = (uri: string | undefined) => {
  const m = /\/(Q\d+)$/.exec(String(uri ?? ""));
  return m ? m[1] : null;
};
const labelOk = (l: string | undefined): l is string => !!l && !QID.test(l);
/** "Ciudad de Madrid" y "Madrid" son la misma base (Wikidata separa a veces el municipio de la ciudad). */
const baseKey = (n: unknown) => placeKey(n).replace(/^ciudad de /, "");

async function wdFetch(deps: PlaceDeps, url: string, accept: string): Promise<unknown> {
  const f = deps.fetch ?? fetch;
  const res = await f(url, {
    headers: { "User-Agent": WIKIDATA_UA, "Api-User-Agent": WIKIDATA_UA, Accept: accept },
    signal: AbortSignal.timeout(deps.wikidataTimeoutMs ?? WIKIDATA_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`wikidata ${res.status}`);
  return await res.json();
}

/** wbsearchentities: QIDs que coinciden con el nombre (en español), en el orden de Wikidata. */
export async function wdSearch(deps: PlaceDeps, name: string): Promise<string[]> {
  const qs = new URLSearchParams({ action: "wbsearchentities", format: "json", type: "item", limit: "7", language: "es", uselang: "es", search: name.slice(0, 100) });
  const data = (await wdFetch(deps, `${WD_API}?${qs}`, "application/json")) as { search?: Array<{ id?: string }> };
  return (data?.search ?? []).map((s) => String(s?.id ?? "")).filter((id) => QID.test(id));
}

async function sparql(deps: PlaceDeps, query: string): Promise<WdBinding[]> {
  const data = (await wdFetch(deps, `${WD_SPARQL}?${new URLSearchParams({ format: "json", query })}`, "application/sparql-results+json")) as { results?: { bindings?: WdBinding[] } };
  return data?.results?.bindings ?? [];
}

const LABEL = `SERVICE wikibase:label { bd:serviceParam wikibase:language "es,en". }`;
const iso2 = (s: string | null | undefined) => (s && /^[A-Z]{2}$/.test(s) ? s : null);
const valuesRank = (qids: string[]) => qids.filter((q) => QID.test(q)).map((q, i) => `(wd:${q} ${i + 1})`).join(" ");

/** País: capital (P36) primero y luego sus ciudades por población (P1082). */
export function countryQuery(iso: string): string {
  return `SELECT ?city ?cityLabel ?pop ?cap ?country WHERE {
  { SELECT ?city (MAX(?p) AS ?pop) WHERE {
      hint:Query hint:optimizer "None" .
      VALUES ?cls { wd:Q515 wd:Q1549591 wd:Q1637706 wd:Q3957 wd:Q1137833 wd:Q494721 }
      ?city wdt:P31 ?cls .
      ?city wdt:P17 ?c .
      ?c wdt:P297 "${iso}" .
      ?city wdt:P1082 ?p .
    } GROUP BY ?city ORDER BY DESC(?pop) LIMIT 14 }
  UNION
  { ?country wdt:P297 "${iso}" . ?country wdt:P36 ?city . OPTIONAL { ?city wdt:P1082 ?pop } BIND(true AS ?cap) }
  ${LABEL}
}`;
}

/**
 * Región: la primera entidad de la búsqueda que está en ese país (P17 → P297) y contiene entidades
 * administrativas; sus asentamientos (P150+ hacia abajo, que es la jerarquía P131 al revés: P131+ tarda
 * más de 6 s) ordenados por población, sin barrios de una ciudad más grande.
 */
export function regionQuery(qids: string[], iso: string): string {
  return `SELECT ?item ?city ?cityLabel ?pop WITH {
  SELECT ?item WHERE {
    VALUES (?item ?rank) { ${valuesRank(qids)} }
    ?item wdt:P17 ?c . ?c wdt:P297 "${iso}" .
    FILTER EXISTS { ?item wdt:P150 ?any }
    FILTER NOT EXISTS { ?item wdt:P297 ?iso }
  } ORDER BY ?rank LIMIT 1
} AS %pick WITH {
  SELECT ?item ?city (MAX(?p) AS ?pop) WHERE {
    INCLUDE %pick .
    ?item wdt:P150+ ?city .
    ?city wdt:P1082 ?p .
  } GROUP BY ?item ?city ORDER BY DESC(?pop) LIMIT 60
} AS %top WHERE {
  INCLUDE %top .
  FILTER EXISTS { ?city wdt:P31/wdt:P279* wd:Q486972 }
  FILTER NOT EXISTS { ?city wdt:P131 ?up . ?up wdt:P1082 ?upPop . FILTER(?upPop > ?pop) ?up wdt:P31/wdt:P279* wd:Q486972 . }
  ${LABEL}
} ORDER BY DESC(?pop) LIMIT 12`;
}

/** Carretera: lugares de término (P609/P559) y destinos principales (P1302) con coordenadas y población. */
export function routeQuery(qids: string[], iso: string): string {
  return `SELECT ?item ?rank ?stop ?stopLabel ?kind ?coord ?pop WHERE {
  hint:Query hint:optimizer "None" .
  VALUES (?item ?rank) { ${valuesRank(qids)} }
  ?item wdt:P17 ?c . ?c wdt:P297 "${iso}" .
  { ?item wdt:P609 ?stop . BIND("terminus" AS ?kind) } UNION { ?item wdt:P559 ?stop . BIND("terminus" AS ?kind) } UNION { ?item wdt:P1302 ?stop . BIND("via" AS ?kind) }
  ?stop wdt:P625 ?coord .
  OPTIONAL { ?stop wdt:P1082 ?pop }
  ${LABEL}
} ORDER BY ?rank`;
}

const point = (wkt: string | undefined): { lat: number; lng: number } | null => {
  const m = /Point\(\s*(-?[\d.]+)\s+(-?[\d.]+)\s*\)/.exec(String(wkt ?? ""));
  return m ? { lng: Number(m[1]), lat: Number(m[2]) } : null;
};
const dist2 = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => (a.lat - b.lat) ** 2 + (a.lng - b.lng) ** 2;

export function parseCountry(rows: WdBinding[], countryName: string): WdBases {
  const caps: string[] = [];
  const rest: Array<{ qid: string; name: string; pop: number }> = [];
  let countryQid: string | null = null;
  for (const b of rows) {
    const qid = qidOf(b.city?.value);
    const name = b.cityLabel?.value;
    if (!qid || !labelOk(name)) continue;
    if (b.cap?.value === "true") {
      if (!caps.includes(name)) caps.push(name);
      countryQid = qidOf(b.country?.value) ?? countryQid;
    } else rest.push({ qid, name, pop: Number(b.pop?.value) || 0 });
  }
  rest.sort((a, b) => b.pop - a.pop);
  const seen = new Set<string>();
  const bases: string[] = [];
  for (const n of [...caps, ...rest.map((r) => r.name)]) {
    const k = baseKey(n);
    if (seen.has(k) || k === baseKey(countryName)) continue;
    seen.add(k);
    bases.push(n);
    if (bases.length >= MAX_BASES) break;
  }
  return bases.length ? { status: "ok", qid: countryQid, bases } : { status: "empty" };
}

export function parseRegion(rows: WdBinding[], regionName: string): WdBases {
  const sorted = rows
    .map((b) => ({ item: qidOf(b.item?.value), name: b.cityLabel?.value, pop: Number(b.pop?.value) || 0 }))
    .filter((r): r is { item: string | null; name: string; pop: number } => labelOk(r.name))
    .sort((a, b) => b.pop - a.pop);
  const seen = new Set<string>();
  const bases: string[] = [];
  for (const r of sorted) {
    const k = baseKey(r.name);
    if (seen.has(k) || k === baseKey(regionName)) continue;
    seen.add(k);
    bases.push(r.name);
    if (bases.length >= MAX_BASES) break;
  }
  return bases.length ? { status: "ok", qid: sorted[0]?.item ?? null, bases } : { status: "empty" };
}

/** Paradas de la carretera mejor clasificada: términos en los extremos y destinos principales en medio. */
export function parseRoute(rows: WdBinding[]): WdBases {
  const ranked = rows.map((b) => ({
    item: qidOf(b.item?.value), stop: qidOf(b.stop?.value), rank: Number(b.rank?.value) || 99, name: b.stopLabel?.value, kind: b.kind?.value,
    at: point(b.coord?.value), pop: b.pop?.value,
  })).filter((r) => r.item && labelOk(r.name) && r.at && r.pop != null); // con población: un asentamiento, no un cruce
  if (!ranked.length) return { status: "empty" };
  const best = Math.min(...ranked.map((r) => r.rank));
  const mine = ranked.filter((r) => r.rank === best);
  const uniq = <T extends { name?: string }>(xs: T[]) => xs.filter((x, i) => xs.findIndex((y) => placeKey(y.name) === placeKey(x.name)) === i);
  // Wikidata no da el sentido de la carretera: los términos van en orden de QID para que la ruta sea estable.
  const qnum = (r: { stop?: string | null }) => Number(String(r.stop ?? "").slice(1)) || 0;
  const ends = uniq(mine.filter((r) => r.kind === "terminus")).sort((a, b) => qnum(a) - qnum(b));
  const vias = uniq(mine.filter((r) => r.kind !== "terminus" && !ends.some((e) => placeKey(e.name) === placeKey(r.name))));
  const start = ends[0] ?? vias[0];
  vias.sort((a, b) => dist2(a.at!, start.at!) - dist2(b.at!, start.at!));
  const ordered = ends.length >= 2 ? [ends[0], ...vias, ...ends.slice(1)] : [...ends, ...vias];
  const bases = ordered.map((r) => r.name!).slice(0, MAX_BASES);
  return { status: "ok", qid: mine[0].item, bases };
}

/** Ciudades de Wikidata para un país, región o carretera, con caché de 30 días. null = Wikidata falló. */
export async function wikidataBases(place: PlaceCandidate, deps: PlaceDeps): Promise<WdBases | null> {
  const iso = iso2(place.country);
  if (!iso || (place.kind !== "country" && place.kind !== "region" && place.kind !== "route")) return { status: "empty" };
  const key = await cacheKey("wikidata_bases", { kind: place.kind, name: placeKey(place.name), iso, v: 1 });
  const row = await cacheGet(deps.store, key, deps.log);
  if (row && freshnessOf(row, (deps.now ?? Date.now)()).fresh) return row.response as WdBases;
  let value: WdBases;
  try {
    if (place.kind === "country") {
      value = parseCountry(await sparql(deps, countryQuery(iso)), place.name);
    } else {
      const qids = await wdSearch(deps, place.name);
      if (!qids.length) value = { status: "empty" };
      else if (place.kind === "region") value = parseRegion(await sparql(deps, regionQuery(qids, iso)), place.name);
      else value = parseRoute(await sparql(deps, routeQuery(qids, iso)));
    }
  } catch (e) {
    (deps.log ?? console.warn)("placeResolve wikidata:", (e as Error)?.name === "TimeoutError" ? "timeout" : (e as Error)?.message);
    return null;
  }
  if (deps.store) {
    try {
      await deps.store.put(key, "wikidata_bases", value, value.status === "ok" ? PLACE_TTL : PLACE_TTL_EMPTY);
    } catch (e) {
      (deps.log ?? console.warn)("placeResolve cache put:", (e as Error)?.message);
    }
  }
  return value;
}

// ─── Todo junto ───

export function clarifyMessage(input: string, cands: PlaceCandidate[]): string {
  if (!cands.length) return `No encontramos «${input}». Escríbelo con su país (por ejemplo, «${input}, España»).`;
  const ls = cands.map((c) => c.label);
  const lista = ls.length > 1 ? `${ls.slice(0, -1).join(", ")} o ${ls[ls.length - 1]}` : ls[0];
  return `¿Te refieres a ${lista}?`;
}

/** Resuelve UN destino. Nunca lanza. */
export async function resolveDestination(input: string, deps: PlaceDeps): Promise<PlaceResolution> {
  const text = String(input ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
  if (!needsResolve(text)) return { input: text, status: "skipped" };
  let geo: GeoCached | null = null;
  try {
    geo = await geocodePlace(text, deps);
  } catch (e) {
    (deps.log ?? console.warn)("placeResolve:", (e as Error)?.message);
  }
  if (!geo) return { input: text, status: "unavailable" };
  const cands = geo.candidates;
  if (cands.length !== 1 || geo.partial) {
    return { input: text, status: "needs_clarification", candidates: cands, message: clarifyMessage(text, cands) };
  }
  const c = cands[0];
  const out: PlaceResolution = {
    input: text, status: "ok", kind: c.kind, name: c.name, label: c.label, country: c.country, country_name: c.country_name,
    lat: c.lat, lng: c.lng, viewport: c.viewport, place_id: c.place_id,
    ...(c.kind === "route" ? { roadtrip: true } : {}),
  };
  if (c.kind === "country" || c.kind === "region" || c.kind === "route") {
    const wd = await wikidataBases(c, deps).catch(() => null);
    if (wd && wd.status === "ok") {
      out.bases = wd.bases;
      out.wikidata = wd.qid ? { qid: wd.qid, url: `https://www.wikidata.org/wiki/${wd.qid}` } : null;
    }
  }
  return out;
}

/** Varios destinos en paralelo (sin repetir la consulta de dos iguales). */
export async function resolveDestinations(list: string[], deps: PlaceDeps): Promise<PlaceResolution[]> {
  const memo = new Map<string, Promise<PlaceResolution>>();
  return await Promise.all(list.map((d) => {
    const k = placeKey(d);
    if (!memo.has(k)) memo.set(k, resolveDestination(d, deps));
    return memo.get(k)!.then((r) => ({ ...r, input: String(d ?? "").replace(/\s+/g, " ").trim().slice(0, 120) }));
  }));
}
