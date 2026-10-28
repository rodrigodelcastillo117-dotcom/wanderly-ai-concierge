// Varias ciudades escritas en el planeador ("paris roma y atenas 10 dias", "Roma, Florencia y Venecia",
// "CDMX → Madrid → Lisboa") → ruta multi-destino. Puro, sin red ni IA (cero costo), para probarlo.
//
// Caso del dueño (23-oct-2026): escribió "paris roma y atenas 10 dias" en el planeador normal. Como la
// frase traía "dias", detectRouteIntent la trataba como conversación (un solo destino) y el viaje se
// guardó con ese texto como destino: título literal, un vuelo "Ciudad de México → paris roma y atenas
// 10 dias" y un hotel de 9 noches en París, sin forma de seguir a Roma ni a Atenas.
//
// Reglas:
//  - Solo cuenta como ciudad lo que está en los catálogos que ya usa la app: aeropuertos
//    (_shared/airports.ts, con nombres en inglés y sin acentos), recuerdos (_shared/souvenirs.ts, solo
//    el nombre del lugar: sus alias mezclan ciudades vecinas, "toledo" → Madrid) y el selector de
//    origen (countriesCities.ts). Nada se adivina: lo que no se reconoce se devuelve en `unknown`.
//  - Un país ("Italia") no es una ciudad: va en `countries` para pedir ciudades.
//  - Un tramo sin separadores ("paris roma") se parte en ciudades solo si TODAS sus palabras son
//    ciudades conocidas (o relleno); "San Miguel de Allende" o "Valle de Guadalupe" no se parten.
//  - "desde X" o una primera ciudad que es el origen del viajero ("CDMX → Madrid → Lisboa") es el
//    origen, no una parada; si la última repite el origen (regreso), se quita.
import { CITIES as AIRPORT_CITIES, cityAirports } from "../../supabase/functions/_shared/airports.ts";
import { catalogCities, matchCountry } from "../../supabase/functions/_shared/souvenirs.ts";
import { sameCity, splitNights } from "../../supabase/functions/_shared/booking/tripRoute.ts";
import { COUNTRIES as PICKER_COUNTRIES } from "@/lib/countriesCities";
import { countryRouteFor, ROUTE_CITIES } from "@/lib/countryRoutes";
import { findRegion } from "../../supabase/functions/_shared/regions.ts";

const norm = (s: unknown) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

type Entry = { name: string; country: string | null };

// Nombre normalizado → ciudad para mostrar (con acentos). Los aeropuertos primero: su nombre es el
// que usan Google Flights, los hoteles por ciudad y sameCity.
const CATALOG = new Map<string, Entry>();
const add = (alias: string, e: Entry) => {
  const k = norm(alias);
  // Alias de 1–2 letras ("la" = Los Ángeles, "df") chocan con palabras comunes de una frase.
  if (k.length < 3 || CATALOG.has(k)) return;
  CATALOG.set(k, e);
};
for (const c of AIRPORT_CITIES) {
  const e = { name: c.name, country: c.country };
  add(c.name, e);
  for (const a of c.aliases ?? []) add(a, e);
}
// El catálogo de recuerdos tiene lugares que son países o regiones ("India", "Egipto", "Costa Rica"):
// no son ciudades (caso "india" → un hotel "india · 14 noches").
const isCountryName = (name: string) => {
  const row = matchCountry(name);
  return (!!row && norm(row[1]) === norm(name)) || PICKER_COUNTRIES.some((c) => norm(c.name) === norm(name));
};
const CITY_STATES = new Set(["singapur", "panama", "mexico"]);
for (const c of catalogCities()) if (!isCountryName(c.lugar) || CITY_STATES.has(norm(c.lugar))) add(c.lugar, { name: c.lugar, country: null });
for (const country of PICKER_COUNTRIES) for (const city of country.cities) add(city, { name: city, country: country.name });
for (const r of ROUTE_CITIES) add(r.city, { name: r.city, country: r.country });
// Nombres en inglés de ciudades del selector que la gente escribe así (caso Diego: "Cape Town" se leía
// como el país Sudáfrica por un alias del catálogo de recuerdos). Solo ciudades que ya están en el catálogo.
const EXTRA_CITY_ALIASES: Array<[string, string]> = [["cape town", "Ciudad del Cabo"], ["capetown", "Ciudad del Cabo"]];
for (const [alias, city] of EXTRA_CITY_ALIASES) { const e = CATALOG.get(norm(city)); if (e) add(alias, e); }
const MAX_WORDS = 5;

const COUNTRY_NAMES = new Set(PICKER_COUNTRIES.map((c) => norm(c.name)));
// Países que no están en el selector ni en el catálogo de recuerdos (para no tomarlos como "desconocidos").
const EXTRA_COUNTRIES: Array<[string, string[]]> = [["Arabia Saudita", ["arabia saudita", "arabia saudi", "arabia", "saudi arabia", "arabia saudí"]],
  ["Jordania", ["jordania", "jordan"]], ["Omán", ["oman"]], ["Catar", ["catar", "qatar"]]];
function asCountry(chunk: string): string | null {
  const k = norm(chunk);
  if (!k || CATALOG.has(k)) return null;
  const region = countryRouteFor(k);
  if (region) return region.country;
  const picker = PICKER_COUNTRIES.find((c) => norm(c.name) === k);
  if (picker) return picker.name;
  const extra = EXTRA_COUNTRIES.find(([, al]) => al.some((a) => norm(a) === k));
  if (extra) return extra[0];
  const row = matchCountry(chunk);
  if (row && (norm(row[1]) === k || row[3].includes(k))) return row[1];
  return COUNTRY_NAMES.has(k) ? chunk.trim() : null;
}

// Palabras que no son lugar: conectores, verbos de viaje, quién viaja.
const FILLER = new Set(("a al en de del por y e o la el los las lo desde hasta hacia para con sin mi mis tu un una unos unas " +
  "viaje viajes viajar viajamos ir irme iremos quiero queremos quisiera me nos gustaria conocer visitar recorrer recorrido ruta tour " +
  "luego despues primero despues finalmente terminar terminando empezar empezando empezamos acabar pasando pasar pasear " +
  "vacaciones escapada solo sola pareja familia amigos amigas novia novio esposa esposo hijos personas persona viajeros viajero adultos " +
  "plan planea planear arma armar armame crea creame haz hazme dias dia noches noche semana semanas mes meses total aprox aproximadamente " +
  "ciudades ciudad destinos destino paises pais entre todo toda varios varias otra otro mas " +
  // "más o menos", "somos 2", "algo de lujo": no son lugares (caso Diego).
  "menos o u somos seremos vamos estamos queremos algo lujo lujoso lujosa tipo cerca alrededor aproximado").split(/\s+/));

const NUM_WORDS: Record<string, number> = { un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
  once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, veinte: 20, treinta: 30 };
const MONTHS = "enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre";

/** Cada lugar escrito, en el orden de la frase (nada se descarta: lo no reconocido va como "unknown"). */
export type PlaceItem = { kind: "city" | "country" | "region" | "unknown"; text: string; name: string };

export type MultiCityParse = {
  /** Todo lo escrito, en orden: ciudades, países, regiones y lo no reconocido. */
  items: PlaceItem[];
  /** Ciudades del viaje en orden (nombres del catálogo, con acentos). */
  cities: string[];
  /** Ciudad de salida si la frase la dice ("desde CDMX", "CDMX → Madrid → Lisboa"). */
  origin: string | null;
  /** "10 dias" → 10; "una semana" → 7. */
  days: number | null;
  /** Noches del viaje según la frase ("10 noches", o días − 1). */
  nights: number | null;
  /** Lo que parecía un lugar y no está en el catálogo (se dice; no se inventa). */
  unknown: string[];
  /** Países escritos como si fueran paradas ("Italia y Grecia"). */
  countries: string[];
};

/** Duración escrita en la frase: días o noches. */
export function durationOf(text: string): { days: number | null; nights: number | null } {
  const t = norm(text);
  const n = (w: string) => (/^\d+$/.test(w) ? Number(w) : NUM_WORDS[w] ?? NaN);
  const word = "(\\d{1,3}|un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|veinte|treinta)";
  const m = t.match(new RegExp(`\\b${word}\\s*(dias|dia|d|noches|noche|semanas|semana)\\b`));
  if (!m) return { days: null, nights: null };
  const q = n(m[1]);
  if (!Number.isFinite(q) || q < 1 || q > 120) return { days: null, nights: null };
  if (/^noche/.test(m[2])) return { days: q + 1, nights: q };
  const days = /^semana/.test(m[2]) ? q * 7 : q;
  return { days, nights: Math.max(1, days - 1) };
}

/** Quita de la frase lo que no es lugar (duración, fechas, viajeros) dejando un separador. */
export function stripNonPlaces(text: string): string {
  const word = "(?:\\d{1,3}|un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|veinte|treinta)";
  return text
    .replace(new RegExp(`\\b(?:por\\s+|durante\\s+|en\\s+)?${word}\\s*(?:d[ií]as?|d|noches?|semanas?)\\b`, "gi"), " , ")
    .replace(new RegExp(`\\b(?:del?\\s+)?\\d{1,2}\\s+(?:de\\s+(?:${MONTHS})\\s+)?(?:al?|-|–)\\s+(?:el\\s+)?\\d{1,2}\\s+de\\s+(?:${MONTHS})(?:\\s+(?:de|del)\\s+\\d{4})?`, "gi"), " , ")
    .replace(new RegExp(`\\b(?:el\\s+)?\\d{1,2}\\s+de\\s+(?:${MONTHS})(?:\\s+(?:de|del)\\s+\\d{4})?`, "gi"), " , ")
    .replace(new RegExp(`\\b(?:en|para|de)\\s+(?:${MONTHS})\\b`, "gi"), " , ")
    .replace(new RegExp(`\\b(?:${MONTHS})\\b`, "gi"), " , ")
    .replace(/\b\d{1,2}\s*(?:personas?|viajeros?|adultos?|pax|ni[nñ]os?)\b/gi, " , ")
    .replace(/\b(?:fin de semana|con mi familia|con mi pareja|con amigos|en pareja)\b/gi, " , ")
    .replace(/\b\d{4}\b/g, " , ");
}

// Separadores entre paradas (sobre el texto original; "después" con o sin acento).
export const SEPARATOR = /\s*(?:(?<=[a-záéíóúñ]{3})\.\s+(?=[A-ZÁÉÍÓÚÑ])|→|->|=>|>|,|;|\+|\/|\||\s[-–]\s|\s+y\s+luego\s+|\s+y\s+despu[eé]s\s+|\s+luego\s+|\s+despu[eé]s\s+|\s+y\s+|\s+e\s+|\s+hasta\s+|\s+a\s+|\s+al\s+)\s*/i;
const ORIGIN_PREFIX = /^(?:desde|saliendo\s+de|salgo\s+de|salimos\s+de|partiendo\s+de)\s+/i;

type Segment = { cities: Entry[]; unknown: string | null; country: string | null; region: string | null; origin: Entry | null; text: string };
const ORIGIN_WORDS = new Set(["desde", "saliendo", "salgo", "salimos", "partiendo"]);

/** Un tramo entre separadores → ciudades (solo si todo el tramo se entiende) o lo no reconocido. */
function segment(chunk: string): Segment {
  const words = chunk.split(/\s+/).filter(Boolean);
  const nw = words.map(norm);
  const found: Entry[] = [];
  let origin: Entry | null = null;
  let originNext = false;
  let i = 0;
  let clean = true;
  while (i < words.length) {
    let hit: Entry | null = null;
    let len = 0;
    for (let k = Math.min(MAX_WORDS, words.length - i); k >= 1; k--) {
      const key = nw.slice(i, i + k).join(" ");
      const e = CATALOG.get(key);
      if (e) { hit = e; len = k; break; }
    }
    if (hit) {
      // "… desde CDMX": la ciudad que sigue a "desde" es el origen, no una parada.
      if (originNext && !origin) origin = hit; else found.push(hit);
      originNext = false;
      i += len;
      continue;
    }
    if (ORIGIN_WORDS.has(nw[i])) { originNext = true; i += 1; continue; }
    if (!nw[i] || FILLER.has(nw[i]) || /^\d+$/.test(nw[i])) { i += 1; continue; }
    clean = false;
    break;
  }
  if (clean) return { cities: found, unknown: null, country: null, region: null, origin, text: chunk.trim() };
  // No se parte un nombre que no conocemos ("Valle de Guadalupe"): todo el tramo es uno solo.
  const keep = (j: number) => !!nw[j] && !FILLER.has(nw[j]) && !/^\d+$/.test(nw[j]);
  const a = words.findIndex((_, j) => keep(j));
  let b = words.length - 1;
  while (b >= 0 && !keep(b)) b--;
  const meaningful = a >= 0 ? words.slice(a, b + 1).join(" ").replace(/[.!?¡¿"]+/g, "").trim() : "";
  if (!meaningful) return { cities: [], unknown: null, country: null, region: null, origin: null, text: "" };
  // Región turística de la tabla curada ("Toscana"): se recorre por sus ciudades base.
  const reg = findRegion(meaningful);
  if (reg) return { cities: [], unknown: null, country: null, region: reg.name, origin: null, text: meaningful };
  const country = asCountry(meaningful);
  return { cities: [], unknown: country ? null : meaningful, country, region: null, origin: null, text: meaningful };
}

/** Lee varias ciudades de una frase. `origin` = ciudad de salida del viajero (para no tomarla como parada). */
export function parseMultiCityText(text: string, opts: { origin?: string | null } = {}): MultiCityParse {
  const raw = String(text ?? "").trim();
  const { days, nights } = durationOf(raw);
  const empty: MultiCityParse = { items: [], cities: [], origin: null, days, nights, unknown: [], countries: [] };
  if (!raw) return empty;
  const chunks = stripNonPlaces(raw).split(SEPARATOR).map((c) => c.trim()).filter(Boolean);
  let origin: string | null = null;
  const stops: string[] = [];
  const unknown: string[] = [];
  const countries: string[] = [];
  const items: PlaceItem[] = [];
  const seen = (name: string) => stops.some((s) => sameCity(s, name) || norm(s) === norm(name));
  for (const c0 of chunks) {
    const isOrigin = ORIGIN_PREFIX.test(c0);
    const seg = segment(c0.replace(ORIGIN_PREFIX, ""));
    if (seg.unknown) { unknown.push(seg.unknown); items.push({ kind: "unknown", text: seg.unknown, name: seg.unknown }); }
    if (seg.region && !items.some((x) => x.kind === "region" && x.name === seg.region)) items.push({ kind: "region", text: seg.text, name: seg.region });
    if (seg.country && !countries.includes(seg.country)) { countries.push(seg.country); items.push({ kind: "country", text: seg.text, name: seg.country }); }
    if (seg.origin && !origin) origin = seg.origin.name;
    seg.cities.forEach((e, j) => {
      if (isOrigin && j === 0 && !origin) { origin = e.name; return; }
      if (!seen(e.name)) { stops.push(e.name); items.push({ kind: "city", text: e.name, name: e.name }); }
    });
  }
  // La primera ciudad es el origen: la del viajero, o una de México seguida de ciudades fuera de México.
  const mx = (c: string) => (cityAirports(c)?.country ?? PICKER_COUNTRIES.find((p) => p.cities.some((x) => norm(x) === norm(c)))?.name) === "México";
  if (!origin && stops.length >= 3) {
    const first = stops[0];
    if ((opts.origin && sameCity(first, opts.origin)) || (mx(first) && stops.slice(1).every((c) => !mx(c)))) origin = stops.shift()!;
  } else if (!origin && stops.length >= 2 && opts.origin && sameCity(stops[0], opts.origin)) {
    origin = stops.shift()!;
  }
  // Regreso al origen al final ("… → Lisboa → CDMX"): no es una parada.
  const home = origin ?? opts.origin ?? null;
  if (home && stops.length >= 3 && sameCity(stops[stops.length - 1], home)) stops.pop();
  const kept = items.filter((x) => x.kind !== "city" || stops.includes(x.name));
  return { items: kept, cities: stops, origin, days, nights, unknown, countries };
}

/** ¿La frase es solo un país o región ("india", "Japón 10 días", "Europa")? Devuelve el país. */
export function countryOnly(p: MultiCityParse | null | undefined): string | null {
  return p && p.cities.length === 0 && p.countries.length === 1 && p.unknown.length === 0 ? p.countries[0] : null;
}

/** ¿La frase es una ruta de 2 o más ciudades? */
export const isMultiCity = (p: MultiCityParse | null | undefined): p is MultiCityParse => !!p && p.cities.length >= 2;

/** "París → Roma → Atenas · 10 días" */
export function describeMultiCity(p: Pick<MultiCityParse, "cities" | "days" | "nights">): string {
  const parts = [p.cities.join(" → ")];
  if (p.days) parts.push(`${p.days} ${p.days === 1 ? "día" : "días"}`);
  else if (p.nights) parts.push(`${p.nights} ${p.nights === 1 ? "noche" : "noches"}`);
  return parts.join(" · ");
}

// ─── Noches por ciudad ───

/** Noches por ciudad válidas para el total; si no cuadran, el mismo reparto que el servidor. null si no alcanzan. */
export function fitNights(current: number[] | null | undefined, cities: number, total: number | null | undefined): number[] | null {
  const t = Math.round(Number(total) || 0);
  if (cities < 1 || t < cities) return null;
  const ok = Array.isArray(current) && current.length === cities && current.every((n) => Number.isInteger(n) && n >= 1)
    && current.reduce((a, b) => a + b, 0) === t;
  return ok ? [...current!] : splitNights(t, cities);
}

/**
 * +1 / −1 noche en una ciudad sin cambiar el total del viaje: la noche sale de la ciudad con más noches
 * (o va a la siguiente). Nunca deja una ciudad en 0 noches, así que no hay estado "inválido" que bloquee.
 */
export function shiftNight(nights: number[], i: number, delta: 1 | -1): number[] {
  const out = [...nights];
  if (i < 0 || i >= out.length || out.length < 2) return out;
  if (delta > 0) {
    let donor = -1;
    out.forEach((n, j) => { if (j !== i && n > 1 && (donor < 0 || n >= out[donor])) donor = j; });
    if (donor < 0) return out;
    out[i] += 1; out[donor] -= 1;
    return out;
  }
  if (out[i] <= 1) return out;
  const to = i + 1 < out.length ? i + 1 : i - 1;
  out[i] -= 1; out[to] += 1;
  return out;
}

/** Mueve una ciudad una posición (orden de la ruta); las noches viajan con su ciudad. */
export function moveCity<T>(list: T[], i: number, dir: -1 | 1): T[] {
  const j = i + dir;
  if (i < 0 || j < 0 || i >= list.length || j >= list.length) return list;
  const out = [...list];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

/** Ruta del planeador para MultiDestRoute (/dashboard/ruta?…), con noches por ciudad si las hay. */
export function routePlannerQuery(a: { origin?: string | null; cities: string[]; nights?: number[] | null; fechaSalida?: string | null; fechaRegreso?: string | null;
  viajeros?: number | null; presupuesto?: number | null; fromTrip?: string | null }): string {
  const qs = new URLSearchParams({ origin: String(a.origin ?? "").trim() || "Ciudad de México", destinos: a.cities.join("|") });
  if (a.fechaSalida) qs.set("fecha_salida", a.fechaSalida);
  if (a.fechaRegreso) qs.set("fecha_regreso", a.fechaRegreso);
  qs.set("viajeros", String(Math.max(1, Math.round(Number(a.viajeros) || 2))));
  if (a.nights && a.nights.length === a.cities.length) qs.set("noches", a.nights.join("|"));
  if (a.presupuesto != null) qs.set("presupuesto", String(a.presupuesto));
  if (a.fromTrip) qs.set("desde_viaje", a.fromTrip);
  return qs.toString();
}

/** Lee ?noches=3|3|3 (o null si no viene o no es válido). */
export function nightsFromQuery(v: string | null | undefined): number[] | null {
  if (!v) return null;
  const arr = v.split("|").map((x) => Number(x));
  return arr.length && arr.every((n) => Number.isInteger(n) && n >= 1 && n <= 60) ? arr : null;
}

/** "2026-11-06" + 9 → "2026-11-15" (fecha de calendario, sin zona horaria). */
export function addIsoDays(iso: string, n: number): string {
  const t = Date.parse(`${iso}T00:00:00Z`) + n * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}
