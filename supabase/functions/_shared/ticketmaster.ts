// Ticketmaster Discovery API v2: eventos reales (conciertos, deportes, teatro, familia) con su página
// oficial de boletos. Sin dependencias de Deno: se prueba con Vitest (src/test/ticketmaster.test.ts);
// ticketmasterRuntime.ts conecta la llave (TICKETMASTER_API_KEY), la caché compartida y los límites.
//
// Documentación (developer.ticketmaster.com/products-and-docs/apis/discovery-api/v2/, consultada el
// 23-oct-2026):
//   GET https://app.ticketmaster.com/discovery/v2/events.json?apikey=…
//   Parámetros: geoPoint (geohash; latlong está deprecado), radius, unit (miles|km), city, countryCode,
//   startDateTime / endDateTime (ISO UTC con Z, sin milisegundos: "2016-03-18T14:00:00Z"),
//   classificationName (segmento/género: music, sports, arts & theatre, family), keyword, size, sort
//   ("date,asc"…), locale ("es-mx,es,*").
//   Respuesta: _embedded.events[] { id, name, url, images[], classifications[{segment.name, genre.name}],
//   dates.start{localDate, localTime, dateTime}, dates.status.code (onsale|offsale|canceled|postponed|
//   rescheduled), priceRanges[{type, currency, min, max}] (no siempre viene), _embedded.venues[{name,
//   address.line1, city.name, location{latitude, longitude}}] }, page{totalElements}.
//   Límites: 5000 llamadas al día y 5 por segundo.
//
// Reglas de IATOS:
//   * Solo eventos "onsale" u "offsale". Cancelados, pospuestos o reprogramados nunca se muestran.
//   * Precio SOLO si Ticketmaster publica priceRanges ("desde $X"; puede cambiar). Nunca se inventa.
//   * El enlace de boletos es SOLO el campo `url` del evento y debe ser un dominio oficial de Ticketmaster.
//   * La llave nunca sale en respuestas, errores ni logs (la URL con apikey no se registra jamás).

import { cacheGet, cacheKey, cachePut, type CacheStore, freshnessOf } from "./serpCache.ts";
import { checkAllowlisted, TM_DOMAINS } from "./booking/allowlist.ts";
import { cityAirports } from "./airports.ts";

export const TM_ENGINE = "ticketmaster";
export const TM_URL = "https://app.ticketmaster.com/discovery/v2/events.json";
export const TM_TIMEOUT_MS = 8000;
export const TM_MAX_RESULTS = 6;
/** Límites documentados de la cuenta. */
export const TM_PER_SECOND = 5;
export const TM_PER_DAY = 5000;
export const TM_NO_DISPONIBLE = "ticketmaster_no_disponible";

export type TmEstado = "onsale" | "offsale";
export interface TmEvent {
  id: string;
  title: string;
  /** YYYY-MM-DD (dates.start.localDate). */
  fecha: string | null;
  /** HH:MM local (dates.start.localTime). */
  hora: string | null;
  /** dates.start.dateTime (UTC), si viene. */
  date_time?: string;
  estado: TmEstado;
  recinto?: string;
  direccion?: string;
  ciudad?: string;
  lat?: number;
  lng?: number;
  categoria?: string;
  /** Solo si Ticketmaster publica priceRanges. */
  precio?: { min: number; max: number | null; currency: string };
  /** Página oficial de compra (campo `url`). */
  url: string;
  miniatura?: string;
}

export interface TmQuery {
  city?: string | null;
  coords?: { lat: number; lng: number } | null;
  radiusKm?: number;
  countryCode?: string | null;
  from?: string | null;
  to?: string | null;
  category?: string | null;
  keyword?: string | null;
  size?: number;
  locale?: string;
  /** Sin categoría ni palabra clave: todo lo que haya en la ciudad y las fechas (reintento amplio). */
  broad?: boolean;
}

export type TmOk = { ok: true; source: "ticketmaster"; results: TmEvent[]; consulted_at: string; from_cache?: boolean;
  /** Cuántos eventos dice Ticketmaster que hay en total (page.totalElements), si lo dijo. */
  total?: number };
export type TmFail = { ok: false; code: string; motivo: string; http?: number };
export type TmResult = TmOk | TmFail;

export interface TmDeps {
  fetchImpl: typeof fetch;
  apiKey?: string | null;
  store?: CacheStore | null;
  /** Ranura global (≤ 5 por segundo y tope diario). false = no se llama ahora. */
  limiter?: () => Promise<boolean>;
  /** Límite por usuario (anti-abuso). false = negado; null = no se pudo verificar (se sigue). */
  userGate?: () => Promise<boolean | null>;
  onLive?: (ok: boolean) => void | Promise<void>;
  timeoutMs?: number;
  now?: () => number;
  background?: (p: Promise<unknown>) => void;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const clean = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const finite = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN);
const validPoint = (p: { lat: number; lng: number } | null | undefined): p is { lat: number; lng: number } =>
  !!p && Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180 && !(p.lat === 0 && p.lng === 0);

const fail = (code: string, motivo: string, http?: number): TmFail => ({ ok: false, code, motivo, ...(http ? { http } : {}) });
export const NO_DISPONIBLE_MOTIVO = "Ticketmaster no está disponible por ahora; no hay eventos de Ticketmaster en esta respuesta.";

/** Dominios oficiales: la lista vive en la lista blanca del Booking Bridge. */
export { TM_DOMAINS };

/** Enlace oficial de Ticketmaster (https, sin credenciales, en la lista blanca) o null. */
export function officialTicketUrl(v: unknown): string | null {
  const r = checkAllowlisted(v);
  return r.ok && r.provider?.provider === "ticketmaster" ? r.url! : null;
}

// ─── Geohash (geoPoint): latlong está deprecado en la documentación ───
const B32 = "0123456789bcdefghjkmnpqrstuvwxyz";
export function geohash(lat: number, lng: number, precision = 7): string {
  let latR = [-90, 90], lngR = [-180, 180], hash = "", bit = 0, ch = 0, even = true;
  while (hash.length < precision) {
    const r = even ? lngR : latR;
    const v = even ? lng : lat;
    const mid = (r[0] + r[1]) / 2;
    if (v >= mid) { ch = (ch << 1) | 1; r[0] = mid; } else { ch = ch << 1; r[1] = mid; }
    if (even) lngR = r; else latR = r;
    even = !even;
    if (++bit === 5) { hash += B32[ch]; bit = 0; ch = 0; }
  }
  return hash;
}

/** "conciertos" → music, "teatro" → arts & theatre, "partido" → sports, "niños" → family. */
export function tmClassification(query: unknown): string | null {
  const q = String(query ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  if (/\b(concierto|conciert|concert|musica|music|festival|banda|dj|rock|pop|jazz|reggaeton|sinfonic)/.test(q)) return "music";
  if (/\b(partido|futbol|soccer|beisbol|baseball|basquet|basket|nba|nfl|mlb|nhl|deporte|sport|box|lucha|f1|formula|tenis|tennis|golf)/.test(q)) return "sports";
  if (/\b(teatro|theat|musical|opera|ballet|danza|dance|stand ?up|comedia|comedy|espectaculo|show|arte|arts)/.test(q)) return "arts & theatre";
  if (/\b(familia|family|ninos|kids|infantil|circo|circus|disney)/.test(q)) return "family";
  return null;
}

// ─── Qué buscar en Ticketmaster a partir de lo que pidió el usuario (auditoría 10 #5, ronda 2) ───
// Caso real (CDMX, Día de Muertos): "¿Qué eventos o conciertos hay este fin de semana?" mandaba
// keyword="eventos o conciertos" + classificationName=music. La Discovery API busca `keyword` como
// texto del evento: ningún evento se llama así y la respuesta fue {"results": []} con decenas de
// eventos en venta. Ahora:
//   * Las palabras de categoría (conciertos, teatro, partido…) van a classificationName (varias = lista
//     separada por comas, el parámetro es un arreglo) y NUNCA a keyword.
//   * "eventos o conciertos" / "eventos y teatro" = lo pide todo: sin categoría.
//   * Géneros conocidos (jazz, rock…) van como classificationName (acepta género y subgénero).
//   * keyword solo lleva lo específico que queda (un artista, un equipo, "Día de Muertos").

const NORM = (v: unknown) => String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const SEGMENT_WORDS: Array<[RegExp, string]> = [
  [/^(conciertos?|conciert\w*|concerts?|musica\w*|music|musicales|festival(es)?|bandas?|djs?|tocadas?)$/, "music"],
  [/^(partidos?|futbol|soccer|beisbol|baseball|basquet\w*|basketball|nba|nfl|mlb|nhl|deportes?|deportiv\w*|sports?|box|boxeo|lucha|luchas|f1|formula|tenis|tennis|golf|carreras?)$/, "sports"],
  [/^(teatro|teatral\w*|theat\w*|obras?|musical|opera|ballet|danza|dance|standup|stand-up|comedia|comedy|espectaculos?|shows?|arte|arts|cultural\w*|culturales)$/, "arts & theatre"],
  [/^(familia|familiar\w*|family|ninos|ninas|kids|infantil\w*|circo|circus|disney)$/, "family"],
];
const GENRE_WORDS: Record<string, string> = {
  rock: "Rock", pop: "Pop", jazz: "Jazz", metal: "Metal", reggaeton: "Latin", latina: "Latin", latino: "Latin", salsa: "Latin",
  electronica: "Dance/Electronic", electronic: "Dance/Electronic", techno: "Dance/Electronic", rap: "Hip-Hop/Rap", "hip-hop": "Hip-Hop/Rap",
  clasica: "Classical", sinfonica: "Classical", sinfonico: "Classical", country: "Country", blues: "Blues", indie: "Alternative",
};
/** Palabras que dicen "lo que haya" (no son nombre de nada). */
const GENERIC_WORDS = new Set(["evento", "eventos", "que", "hay", "hacer", "planes", "plan", "cosas", "algo", "actividades", "actividad", "boletos", "entradas"]);
const STOP_WORDS = new Set([
  "y", "o", "u", "e", "de", "del", "la", "el", "los", "las", "en", "para", "con", "un", "una", "unos", "unas", "al", "a", "por", "sobre",
  "este", "esta", "estos", "estas", "ese", "esa", "fin", "semana", "finde", "hoy", "manana", "noche", "tarde", "cerca", "mi", "mis", "me", "se",
  "buenos", "buenas", "mejores", "mejor", "top", "interesantes", "recomendados", "proximos", "proximo", "vivo", "en vivo", "live", "tipo",
  "sabado", "domingo", "viernes", "lunes", "martes", "miercoles", "jueves", "obra", "partido",
]);

export interface TmTerms { classifications: string[]; keyword: string | null; broad: boolean }

/** Categorías de Ticketmaster y la palabra clave específica (si queda alguna) de una consulta libre. */
export function tmQueryTerms(query: unknown): TmTerms {
  const raw = String(query ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
  if (!raw) return { classifications: [], keyword: null, broad: true };
  const tokens = raw.split(/[\s,;/]+/).filter(Boolean);
  const cats: string[] = [];
  const rest: string[] = [];
  let generic = false;
  let conj = /[,;/]/.test(raw);
  for (const t of tokens) {
    const n = NORM(t).replace(/[^a-z0-9-]/g, "");
    if (!n) continue;
    if (n === "y" || n === "o" || n === "u" || n === "e") { conj = true; continue; }
    const seg = SEGMENT_WORDS.find(([re]) => re.test(n));
    if (seg) { if (!cats.includes(seg[1])) cats.push(seg[1]); continue; }
    if (GENRE_WORDS[n]) { const g = GENRE_WORDS[n]; if (!cats.includes(g)) cats.push(g); continue; }
    if (GENERIC_WORDS.has(n)) { generic = true; continue; }
    if (STOP_WORDS.has(n) || n.length < 2) continue;
    rest.push(t.replace(/^[¿¡"“(]+|[?!.,"”)]+$/g, ""));
  }
  // "eventos o conciertos", "eventos y teatro": pide de todo (la categoría solo es un ejemplo).
  const broad = !cats.length || (generic && conj);
  // Sin categoría ni palabras genéricas, la frase va completa ("Día de Muertos", "Real Madrid").
  const phrase = !cats.length && !generic && rest.length ? raw.replace(/^[¿¡"“(]+|[?!.,"”)]+$/g, "") : rest.filter(Boolean).join(" ");
  const keyword = phrase.slice(0, 80) || null;
  return { classifications: broad ? [] : cats.slice(0, 4), keyword, broad };
}

const GENERIC_KEYWORD = /^(eventos?|que hay|que hacer|planes?|cosas que hacer|conciertos?|teatro|deportes?|partidos?|espectaculos?|shows?|musica|familia|para ninos)$/;

/** Dónde buscar: coordenadas físicas (con permiso) → ciudad conocida (coordenadas + país) → nombre de ciudad. */
export function tmLocation(q: TmQuery): { geoPoint?: string; radius?: number; countryCode?: string; city?: string; keyLoc: string; lng?: number } | null {
  if (validPoint(q.coords)) {
    const radius = Math.min(Math.max(Math.round(q.radiusKm ?? 25), 1), 100);
    return { geoPoint: geohash(q.coords.lat, q.coords.lng, 7), radius, keyLoc: `${q.coords.lat.toFixed(2)},${q.coords.lng.toFixed(2)}|${radius}`, lng: q.coords.lng };
  }
  const city = clean(q.city, 80);
  if (!city) return null;
  const known = cityAirports(city);
  const cc = clean(q.countryCode, 2).toUpperCase() || known?.iso2 || "";
  if (known) {
    const radius = Math.min(Math.max(Math.round(q.radiusKm ?? 40), 1), 100);
    return { geoPoint: geohash(known.lat, known.lng, 6), radius, ...(cc ? { countryCode: cc } : {}), keyLoc: `${known.name.toLowerCase()}|${radius}`, lng: known.lng };
  }
  return { city, ...(/^[A-Z]{2}$/.test(cc) ? { countryCode: cc } : {}), keyLoc: city.toLowerCase() };
}

const isoStart = (d: string) => `${d}T00:00:00Z`;
const isoEnd = (d: string) => `${d}T23:59:59Z`;
const addDays = (d: string, n: number) => {
  const x = new Date(`${d}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};

/** Parámetros de la búsqueda SIN la llave (también son la llave de la caché). */
export function tmParams(q: TmQuery, nowMs = Date.now()): Record<string, string> | null {
  const loc = tmLocation(q);
  if (!loc) return null;
  const from = q.from && ISO.test(q.from) ? q.from : null;
  const to = q.to && ISO.test(q.to) ? (from && q.to < from ? from : q.to) : from;
  const today = new Date(nowMs).toISOString().slice(0, 10);
  const p: Record<string, string> = {};
  if (loc.geoPoint) { p.geoPoint = loc.geoPoint; p.radius = String(loc.radius); p.unit = "km"; }
  if (loc.city) p.city = loc.city;
  if (loc.countryCode) p.countryCode = loc.countryCode;
  // startDateTime/endDateTime comparan la hora UTC del evento; el día que importa es el LOCAL (se filtra
  // abajo con localDate). Al este de Greenwich (UTC+) un evento temprano del primer día empieza el día
  // anterior en UTC: se pide desde un día antes. Sin coordenadas, también (no se sabe la zona).
  const east = typeof loc.lng !== "number" || loc.lng > 0;
  const wanted = from && from > today ? from : today;
  const startDay = east && wanted > today ? addDays(wanted, -1) : wanted;
  p.startDateTime = isoStart(startDay);
  if (to) p.endDateTime = isoEnd(addDays(to, 1));
  const terms = tmQueryTerms(q.keyword ?? q.category ?? "");
  // Compatibilidad: una categoría ya dicha en inglés ("music") pasa tal cual.
  const legacy = q.category && ["music", "sports", "arts & theatre", "family"].includes(q.category) ? [q.category] : [];
  const cats = q.broad ? [] : terms.classifications.length ? terms.classifications : legacy;
  if (cats.length) p.classificationName = cats.join(",");
  const kw = q.broad ? "" : clean(terms.keyword, 80);
  if (kw && !GENERIC_KEYWORD.test(NORM(kw))) p.keyword = kw;
  // Con un rango de fechas se piden más (la ciudad puede tener muchos eventos el mismo día; se
  // muestran los primeros 6 por fecha y se avisa que hay más).
  p.size = String(Math.min(Math.max(q.size ?? (from ? 50 : 20), 1), 100));
  p.sort = "date,asc";
  p.locale = q.locale ?? "es-mx,es,en,*";
  return p;
}

const TIME = /^([01]\d|2[0-3]):([0-5]\d)/;

// ═══ Categoría en español (auditoría 10, ronda 4, N4-P2-3) ═══
// Ticketmaster manda el segmento en el idioma pedido ("Música") pero el género en inglés ("Latin",
// "Classical"): la tarjeta decía "Música · Latin". Se traduce lo conocido y un nombre sin traducción no
// se muestra (nada en inglés en la pantalla).
const tmKey = (v: string) => v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const TM_SEGMENT_ES: Record<string, string> = {
  music: "Música", musica: "Música", sports: "Deportes", deportes: "Deportes", "arts theatre": "Arte y teatro",
  "artes y teatro": "Arte y teatro", "arte y teatro": "Arte y teatro", film: "Cine", cine: "Cine", miscellaneous: "Varios", varios: "Varios",
  family: "Familia", familia: "Familia",
};
const TM_GENRE_ES: Record<string, string> = {
  latin: "Latina", latina: "Latina", classical: "Clásica", clasica: "Clásica", "classical vocal": "Clásica", rock: "Rock", pop: "Pop",
  jazz: "Jazz", blues: "Blues", "jazz blues": "Jazz y blues", country: "Country", "hip hop rap": "Hip hop y rap", "r b": "R&B", rnb: "R&B",
  "dance electronic": "Electrónica", electronic: "Electrónica", alternative: "Alternativa", metal: "Metal", folk: "Folk", reggae: "Reggae",
  world: "Música del mundo", "new age": "New age", religious: "Religiosa", "children s music": "Infantil", other: "", undefined: "",
  theatre: "Teatro", teatro: "Teatro", comedy: "Comedia", comedia: "Comedia", musical: "Musical", opera: "Ópera", ballet: "Ballet",
  dance: "Danza", danza: "Danza", "fine art": "Arte", "magic illusion": "Magia", "circus specialty acts": "Circo", "children s theatre": "Teatro infantil",
  family: "Familiar", "fairs festivals": "Ferias y festivales", "performance art": "Performance", cultural: "Cultural", variety: "Variedad",
  spectacular: "Espectáculo", puppetry: "Títeres", multimedia: "Multimedia", "classical ballet": "Ballet",
  soccer: "Fútbol", football: "Fútbol americano", basketball: "Básquetbol", baseball: "Béisbol", tennis: "Tenis", boxing: "Box",
  wrestling: "Lucha libre", "lucha libre": "Lucha libre", hockey: "Hockey", "ice hockey": "Hockey sobre hielo", golf: "Golf",
  "motorsports racing": "Automovilismo", "mixed martial arts": "Artes marciales mixtas", equestrian: "Ecuestre", volleyball: "Voleibol",
  rugby: "Rugby", "extreme": "Deportes extremos", miscellaneous: "", "music": "",
};
const SPANISH_VALUES = new Set([...Object.values(TM_SEGMENT_ES), ...Object.values(TM_GENRE_ES)].filter(Boolean).map(tmKey));

/** "Música · Latina"; lo que no tiene traducción conocida no se muestra. */
export function tmCategoryEs(segment: string | null | undefined, genre: string | null | undefined): string | undefined {
  const tr = (v: string | null | undefined, map: Record<string, string>) => {
    const k = tmKey(String(v ?? ""));
    if (!k || k === "undefined") return "";
    if (k in map) return map[k];
    return SPANISH_VALUES.has(k) ? String(v).trim() : "";
  };
  const seg = tr(segment, TM_SEGMENT_ES);
  const gen = tr(genre, TM_GENRE_ES);
  return [seg, gen && tmKey(gen) !== tmKey(seg) ? gen : ""].filter(Boolean).join(" · ") || undefined;
}

/** Respuesta de la Discovery API → eventos en venta (o fuera de venta), dentro del rango local pedido. */
export function mapTicketmasterEvents(json: any, range: { from?: string | null; to?: string | null } = {}, stats?: { inRange: number }): TmEvent[] {
  const list = Array.isArray(json?._embedded?.events) ? json._embedded.events : [];
  const from = range.from && ISO.test(range.from) ? range.from : null;
  const to = range.to && ISO.test(range.to) ? range.to : from;
  const out: TmEvent[] = [];
  const seen = new Set<string>();
  for (const e of list) {
    const code = String(e?.dates?.status?.code ?? "").toLowerCase();
    if (code !== "onsale" && code !== "offsale") continue; // canceled, postponed, rescheduled: nunca
    const title = clean(e?.name, 160);
    const url = officialTicketUrl(e?.url);
    if (!title || !url) continue;
    const fecha = typeof e?.dates?.start?.localDate === "string" && ISO.test(e.dates.start.localDate) ? e.dates.start.localDate : null;
    if (from && (!fecha || fecha < from || (to && fecha > to))) continue;
    const tm = typeof e?.dates?.start?.localTime === "string" ? e.dates.start.localTime.match(TIME) : null;
    const hora = tm ? `${tm[1]}:${tm[2]}` : null;
    const v = Array.isArray(e?._embedded?.venues) ? e._embedded.venues[0] : null;
    const recinto = clean(v?.name, 120) || undefined;
    const ciudad = clean(v?.city?.name, 80) || undefined;
    const direccion = [clean(v?.address?.line1, 120), ciudad].filter(Boolean).join(", ").slice(0, 200) || undefined;
    const lat = finite(v?.location?.latitude), lng = finite(v?.location?.longitude);
    const coords = validPoint({ lat, lng }) ? { lat, lng } : null;
    const cls = Array.isArray(e?.classifications) ? e.classifications.find((c: any) => c?.primary) ?? e.classifications[0] : null;
    const categoria = tmCategoryEs(clean(cls?.segment?.name, 40), clean(cls?.genre?.name, 40));
    const pr = Array.isArray(e?.priceRanges) ? e.priceRanges.find((p: any) => Number.isFinite(finite(p?.min)) && finite(p?.min) > 0 && /^[A-Z]{3}$/.test(String(p?.currency ?? ""))) : null;
    const precio = pr ? { min: finite(pr.min), max: Number.isFinite(finite(pr.max)) && finite(pr.max) >= finite(pr.min) ? finite(pr.max) : null, currency: String(pr.currency) } : undefined;
    const img = (Array.isArray(e?.images) ? e.images : [])
      .filter((i: any) => typeof i?.url === "string" && /^https:\/\//.test(i.url) && i?.fallback !== true)
      .sort((a: any, b: any) => (b?.ratio === "16_9" ? 1 : 0) - (a?.ratio === "16_9" ? 1 : 0) || Math.abs((a?.width ?? 0) - 640) - Math.abs((b?.width ?? 0) - 640))[0];
    const id = clean(e?.id, 60) || `${title}|${fecha}`;
    const k = `${title.toLowerCase()}|${fecha}|${(recinto ?? "").toLowerCase()}`;
    if (seen.has(k)) continue;
    seen.add(k);
    if (stats) stats.inRange += 1;
    // Se cuentan todos los del rango (para decir que hay más), pero solo se devuelven los primeros.
    if (out.length >= TM_MAX_RESULTS) continue;
    out.push({
      id, title, fecha, hora, ...(typeof e?.dates?.start?.dateTime === "string" ? { date_time: clean(e.dates.start.dateTime, 30) } : {}),
      estado: code as TmEstado, ...(recinto ? { recinto } : {}), ...(direccion ? { direccion } : {}), ...(ciudad ? { ciudad } : {}),
      ...(coords ? coords : {}), ...(categoria ? { categoria } : {}), ...(precio ? { precio } : {}), url,
      ...(img ? { miniatura: img.url as string } : {}),
    });
  }
  return out;
}

/** Ventana deslizante en memoria: como máximo `perSecond` llamadas por segundo en esta instancia. */
export function makeRateLimiter(opts: { perSecond?: number; now?: () => number; sleep?: (ms: number) => Promise<void>; maxWaitMs?: number } = {}) {
  const per = opts.perSecond ?? TM_PER_SECOND;
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const maxWait = opts.maxWaitMs ?? 1500;
  const stamps: number[] = [];
  return async function acquire(): Promise<boolean> {
    let waited = 0;
    for (;;) {
      const t = now();
      while (stamps.length && t - stamps[0] >= 1000) stamps.shift();
      if (stamps.length < per) { stamps.push(t); return true; }
      const wait = 1000 - (t - stamps[0]) + 5;
      if (waited + wait > maxWait) return false;
      waited += wait;
      await sleep(wait);
    }
  };
}

const redactKey = (s: string, key?: string | null) => (key ? s.split(key).join("[llave]") : s).replace(/apikey=[^&\s"]+/gi, "apikey=[llave]");

async function getJson(fetchImpl: typeof fetch, url: string, timeoutMs: number) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { signal: ctrl.signal, headers: { accept: "application/json" } });
    const text = await res.text();
    let json: unknown = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* no JSON */ }
    return { status: res.status, ok: res.ok, json };
  } finally {
    clearTimeout(t);
  }
}

export const tmCacheKey = (params: Record<string, string>, q: TmQuery) =>
  cacheKey(TM_ENGINE, { loc: tmLocation(q)?.keyLoc ?? "", from: params.startDateTime?.slice(0, 10) ?? "", to: params.endDateTime?.slice(0, 10) ?? "",
    cat: params.classificationName ?? "", kw: (params.keyword ?? "").toLowerCase(), size: params.size ?? "" });

/**
 * Búsqueda con caché de 6 h (public.serp_cache, misma tabla y RPC que SerpApi), límite global de la
 * cuenta y límite por usuario. Sin llave, o si Ticketmaster rechaza la llave (401/403), responde
 * { ok:false, code:"ticketmaster_no_disponible" } con un motivo honesto.
 */
export async function searchTicketmaster(q: TmQuery, deps: TmDeps): Promise<TmResult> {
  const now = deps.now ?? Date.now;
  const params = tmParams(q, now());
  if (!params) return fail("falta_ciudad", "Falta la ciudad o la ubicación para buscar eventos.");
  const range = { from: q.from ?? null, to: q.to ?? q.from ?? null };
  const key = await tmCacheKey(params, q);
  const cached = await cacheGet(deps.store, key);
  if (cached && freshnessOf(cached, now()).fresh) {
    const resp = cached.response as { results?: TmEvent[]; total?: number } | null;
    const rows = resp?.results ?? [];
    return { ok: true, source: "ticketmaster", results: rows, consulted_at: cached.fetched_at, from_cache: true, ...(typeof resp?.total === "number" ? { total: resp.total } : {}) };
  }
  if (!deps.apiKey) return fail(TM_NO_DISPONIBLE, NO_DISPONIBLE_MOTIVO);
  if (deps.userGate) {
    let allowed: boolean | null = null;
    try { allowed = await deps.userGate(); } catch { allowed = null; }
    if (allowed === false) return fail("ticketmaster_limite_usuario", "Hiciste muchas búsquedas de eventos seguidas; espera un minuto.");
  }
  if (deps.limiter && !(await deps.limiter().catch(() => false))) return fail("ticketmaster_ocupado", "Ticketmaster está ocupado en este momento; intenta en unos segundos.");

  const url = new URL(TM_URL);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("apikey", deps.apiKey);
  let r: { status: number; ok: boolean; json: unknown };
  try {
    r = await getJson(deps.fetchImpl, url.toString(), deps.timeoutMs ?? TM_TIMEOUT_MS);
  } catch (e) {
    return fail("ticketmaster_error", (e as Error)?.name === "AbortError" ? "Ticketmaster tardó demasiado en responder." : "Ticketmaster no respondió.");
  }
  const live = Promise.resolve().then(() => deps.onLive?.(r.ok)).catch(() => { /* registrar nunca rompe la búsqueda */ });
  if (deps.background) deps.background(live); else await live;
  if (r.status === 401 || r.status === 403) return fail(TM_NO_DISPONIBLE, NO_DISPONIBLE_MOTIVO, r.status);
  if (r.status === 429) return fail("ticketmaster_ocupado", "Ticketmaster alcanzó su límite de consultas por ahora.", 429);
  if (!r.ok || !r.json || typeof r.json !== "object") return fail("ticketmaster_error", "Ticketmaster no respondió bien.", r.status);
  const stats = { inRange: 0 };
  const results = mapTicketmasterEvents(r.json, range, stats);
  // Más páginas en Ticketmaster de las que se pidieron: hay al menos uno más de los contados.
  const j = r.json as { page?: { totalElements?: unknown }; _embedded?: { events?: unknown[] } };
  const pageMore = Number(j?.page?.totalElements) > (Array.isArray(j?._embedded?.events) ? j._embedded!.events!.length : 0);
  const total = stats.inRange + (pageMore ? 1 : 0);
  const put = Promise.resolve(cachePut(deps.store, key, TM_ENGINE, { results, total })).catch(() => { /* la caché es opcional */ });
  if (deps.background) deps.background(put); else await put;
  return { ok: true, source: "ticketmaster", results, consulted_at: new Date(now()).toISOString(), total };
}

/**
 * Sonda de diagnóstico (health-check ?action=ticketmaster): UNA llamada mínima (Ciudad de México,
 * size=1, sin caché). Dice si la llave existe, el estado HTTP y cuántos eventos hay. Nunca devuelve la
 * llave, la URL ni encabezados.
 */
export async function probeTicketmaster(deps: { fetchImpl: typeof fetch; apiKey?: string | null; now?: () => number; timeoutMs?: number }) {
  const t0 = Date.now();
  const base = { api: "Ticketmaster Discovery API v2", llave_configurada: !!deps.apiKey };
  if (!deps.apiKey) return { ...base, ok: false, http: null, eventos: null, detail: "Falta TICKETMASTER_API_KEY", ms: 0 };
  const params = tmParams({ city: "Ciudad de México", size: 1 }, deps.now?.() ?? Date.now())!;
  delete params.endDateTime;
  const url = new URL(TM_URL);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("apikey", deps.apiKey);
  try {
    const r = await getJson(deps.fetchImpl, url.toString(), deps.timeoutMs ?? TM_TIMEOUT_MS);
    const j = r.json as { page?: { totalElements?: unknown }; _embedded?: { events?: unknown[] }; fault?: { faultstring?: unknown }; errors?: { detail?: unknown }[] } | null;
    const total = Number(j?.page?.totalElements);
    const eventos = Number.isFinite(total) ? total : Array.isArray(j?._embedded?.events) ? j!._embedded!.events!.length : r.ok ? 0 : null;
    const msg = r.ok ? null : clean(j?.fault?.faultstring ?? j?.errors?.[0]?.detail ?? "", 160) || null;
    return { ...base, ok: r.ok, http: r.status, eventos, detail: msg ? redactKey(msg, deps.apiKey) : null, ms: Date.now() - t0 };
  } catch (e) {
    return { ...base, ok: false, http: null, eventos: null, detail: (e as Error)?.name === "AbortError" ? "timeout" : "sin respuesta", ms: Date.now() - t0 };
  }
}
