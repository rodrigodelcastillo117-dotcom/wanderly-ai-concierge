// Places API (New): Text Search, Nearby Search y Place Details con máscaras de campos explícitas,
// resultados tipados en español y horario "abierto ahora" calculado en la zona horaria del lugar.
// Sin dependencias de Deno (se prueba con Vitest). Lo usan suggest-restaurants, tripadvisor-search,
// analizar-viaje y health-check; concierge-chat puede usarlo igual (ver docs/iatos/IATOS_DATOS_REALES.md).
//
// Costo: la máscara decide el SKU (https://developers.google.com/maps/documentation/places/web-service/data-fields,
// consultado 2026-10-22). Cada preset dice qué SKU cobra; no se agregan campos "por si acaso".
// Caché: los términos de Google solo permiten guardar el place_id (sin límite) y lat/lng (30 días).
// Por eso el contenido (nombre, calificación, horario) se consulta cada vez y se entrega con su
// fecha de consulta; lo único que se guarda es el place_id de una búsqueda (findPlaceId).
import {
  callError, coalesce, type GoogleError, type GoogleTransport, googleJson,
} from "./google-maps.ts";
import { type CacheStore, cacheGet, cacheKey } from "./serpCache.ts";

// ─── Máscaras de campos (preset → campos y SKU) ───

const PRO_FIELDS = [
  "id", "displayName", "formattedAddress", "location", "googleMapsUri", "primaryType", "primaryTypeDisplayName",
  "types", "businessStatus", "photos", "utcOffsetMinutes", "timeZone",
];
const ENTERPRISE_FIELDS = [
  "rating", "userRatingCount", "priceLevel", "priceRange", "websiteUri", "nationalPhoneNumber",
  "internationalPhoneNumber", "regularOpeningHours", "currentOpeningHours",
];
const ATMOSPHERE_FIELDS = [
  "editorialSummary", "reservable", "servesBreakfast", "servesBrunch", "servesLunch", "servesDinner", "servesVegetarianFood",
  "servesCocktails", "servesWine", "outdoorSeating", "goodForGroups",
];

/**
 * - ids: solo el id (Text Search "IDs Only": gratis e ilimitado).
 * - basic: nombre, dirección, ubicación, tipo, foto, link de Maps, zona horaria (Pro).
 * - rich: + calificación, reseñas, nivel de precio, horario, teléfono, sitio web (Enterprise).
 * - atmosphere: + resumen editorial, reservable, sirve desayuno/comida/cena… (Enterprise + Atmosphere).
 */
export type PlacePreset = "ids" | "verify" | "basic" | "rich" | "atmosphere";

export const PRESET_FIELDS: Record<PlacePreset, string[]> = {
  ids: ["id"],
  // Lo mínimo para comprobar que un nombre existe (resolvePlace): IDs Only no trae el nombre, así que
  // no sirve para validar (devuelve el lugar más parecido aunque el nombre sea inventado). Pro.
  verify: ["id", "displayName", "googleMapsUri", "businessStatus"],
  basic: PRO_FIELDS,
  rich: [...PRO_FIELDS, ...ENTERPRISE_FIELDS],
  atmosphere: [...PRO_FIELDS, ...ENTERPRISE_FIELDS, ...ATMOSPHERE_FIELDS],
};

const SKU_TIER: Record<PlacePreset, string> = { ids: "Essentials (IDs Only)", verify: "Pro", basic: "Pro", rich: "Enterprise", atmosphere: "Enterprise + Atmosphere" };

/** SKU que cobra Google por una llamada con ese preset. */
export function skuFor(method: "text" | "nearby" | "details", preset: PlacePreset): string {
  if (method === "nearby") return `Nearby Search ${preset === "ids" || preset === "verify" || preset === "basic" ? "Pro" : SKU_TIER[preset]}`;
  if (method === "text") return `Text Search ${SKU_TIER[preset]}`;
  // En Place Details, id/dirección/ubicación/fotos son Essentials; displayName ya es Pro.
  return `Place Details ${preset === "ids" ? "Essentials" : SKU_TIER[preset]}`;
}

/** Máscara de campos: para búsquedas cada campo va con "places.". */
export function fieldMask(method: "text" | "nearby" | "details", preset: PlacePreset): string {
  const fields = PRESET_FIELDS[preset];
  return (method === "details" ? fields : fields.map((f) => `places.${f}`)).join(",");
}

// ─── Tipos de salida ───

export type PriceLevel = "PRICE_LEVEL_FREE" | "PRICE_LEVEL_INEXPENSIVE" | "PRICE_LEVEL_MODERATE" | "PRICE_LEVEL_EXPENSIVE" | "PRICE_LEVEL_VERY_EXPENSIVE";

const PRICE_LEVEL_ES: Record<string, { label: string; symbol: string }> = {
  PRICE_LEVEL_FREE: { label: "Gratis", symbol: "Gratis" },
  PRICE_LEVEL_INEXPENSIVE: { label: "Económico", symbol: "$" },
  PRICE_LEVEL_MODERATE: { label: "Precio moderado", symbol: "$$" },
  PRICE_LEVEL_EXPENSIVE: { label: "Caro", symbol: "$$$" },
  PRICE_LEVEL_VERY_EXPENSIVE: { label: "Muy caro", symbol: "$$$$" },
};

/** "PRICE_LEVEL_MODERATE" → { label: "Precio moderado", symbol: "$$" }; null si no hay dato. */
export function priceLevelEs(level: unknown): { label: string; symbol: string } | null {
  return typeof level === "string" ? PRICE_LEVEL_ES[level] ?? null : null;
}

export type PhotoRef = {
  /** Nombre de recurso "places/…/photos/…": se pasa tal cual a place-photo (?ref=…). */
  ref: string;
  width: number | null;
  height: number | null;
  /** Autor de la foto: Google exige mostrarlo con la foto (o en la versión grande). */
  attributions: Array<{ name: string; uri: string | null }>;
};

export type GooglePlace = {
  place_id: string;
  name: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  maps_url: string | null;
  website: string | null;
  phone: string | null;
  /** Teléfono en formato internacional ("+39 055 …"): el único con el que se arma WhatsApp. */
  phone_international: string | null;
  primary_type: string | null;
  /** Tipo legible en español ("Restaurante italiano"). */
  primary_type_label: string | null;
  types: string[];
  business_status: string | null;
  /** true si Google lo marca como cerrado permanente o temporalmente. */
  closed: boolean;
  rating: number | null;
  user_rating_count: number | null;
  price_level: string | null;
  price_level_label: string | null;
  price_symbol: string | null;
  /** Rango de precio por persona que publica Google ("MXN 400–800"). */
  price_range: { min: number | null; max: number | null; currency: string | null; text: string } | null;
  open_now: boolean | null;
  /** "google" = lo calculó Google al consultar; "calculado" = periodos + zona horaria del lugar. */
  open_now_source: "google" | "calculado" | null;
  hours_today: string | null;
  weekday_hours: string[] | null;
  /** Periodos de regularOpeningHours tal cual (día 0 = domingo): el itinerario no pone un lugar en un día que cierra. */
  opening_periods: Array<{ open: { day: number; hour: number; minute: number }; close: { day: number; hour: number; minute: number } | null }> | null;
  time_zone: string | null;
  utc_offset_minutes: number | null;
  editorial_summary: string | null;
  reservable: boolean | null;
  serves: { breakfast: boolean | null; brunch: boolean | null; lunch: boolean | null; dinner: boolean | null; vegetarian: boolean | null; cocktails: boolean | null; wine: boolean | null };
  outdoor_seating: boolean | null;
  good_for_groups: boolean | null;
  photos: PhotoRef[];
  /** Primera foto (mismo contrato que places-search: `photo_ref`). */
  photo_ref: string | null;
  fuente: "google_places";
  estado_dato: "CONSULTADO_EN_VIVO";
  consultado_at: string;
  /** Google exige mostrar "Google Maps" junto a resultados sin mapa. */
  atribucion: "Google Maps";
};

// ─── Horario: abierto ahora en la zona horaria del lugar ───

type Point = { day?: number; hour?: number; minute?: number };
type Period = { open?: Point; close?: Point };

const WEEK_MIN = 7 * 24 * 60;
const toWeekMin = (p: Point) => ((p.day ?? 0) * 24 + (p.hour ?? 0)) * 60 + (p.minute ?? 0);

/** Día de la semana (0 = domingo) y minuto del día en la zona del lugar. */
export function localClock(nowMs: number, timeZone: string | null, utcOffsetMinutes: number | null): { day: number; minutes: number } | null {
  if (timeZone) {
    try {
      const parts = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
        .formatToParts(new Date(nowMs));
      const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
      const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
      const hour = Number(get("hour")) % 24;
      const minute = Number(get("minute"));
      if (day >= 0 && Number.isFinite(hour) && Number.isFinite(minute)) return { day, minutes: hour * 60 + minute };
    } catch { /* zona desconocida: se intenta con el desfase */ }
  }
  if (typeof utcOffsetMinutes === "number" && Number.isFinite(utcOffsetMinutes)) {
    const local = new Date(nowMs + utcOffsetMinutes * 60000);
    return { day: local.getUTCDay(), minutes: local.getUTCHours() * 60 + local.getUTCMinutes() };
  }
  return null;
}

/**
 * ¿Está abierto en ese momento local según los periodos de Google? null si no hay periodos.
 * Un periodo sin cierre que abre el domingo a las 00:00 es "abierto 24 horas".
 */
export function isOpenAt(periods: unknown, clock: { day: number; minutes: number } | null): boolean | null {
  if (!clock || !Array.isArray(periods) || periods.length === 0) return null;
  const now = clock.day * 24 * 60 + clock.minutes;
  for (const p of periods as Period[]) {
    if (!p?.open) continue;
    if (!p.close) {
      if ((p.open.day ?? 0) === 0 && (p.open.hour ?? 0) === 0 && (p.open.minute ?? 0) === 0) return true;
      continue;
    }
    const start = toWeekMin(p.open);
    let end = toWeekMin(p.close);
    if (end <= start) end += WEEK_MIN; // cruza la medianoche del sábado
    if ((now >= start && now < end) || (now + WEEK_MIN >= start && now + WEEK_MIN < end)) return true;
  }
  return false;
}

/** Texto del horario de hoy (weekdayDescriptions empieza en lunes). */
export function hoursToday(weekdayDescriptions: unknown, clock: { day: number } | null): string | null {
  if (!clock || !Array.isArray(weekdayDescriptions) || weekdayDescriptions.length !== 7) return null;
  const line = weekdayDescriptions[(clock.day + 6) % 7];
  return typeof line === "string" ? line : null;
}

// ─── Normalización ───

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const bool = (v: unknown) => (typeof v === "boolean" ? v : null);

function money(m: any): number | null {
  if (!m || typeof m !== "object") return null;
  const units = Number(m.units ?? 0);
  const nanos = Number(m.nanos ?? 0);
  const v = units + nanos / 1e9;
  return Number.isFinite(v) && v > 0 ? Math.round(v) : null;
}

function priceRangeOf(r: any): GooglePlace["price_range"] {
  if (!r || typeof r !== "object") return null;
  const min = money(r.startPrice);
  const max = money(r.endPrice);
  const currency = str(r.startPrice?.currencyCode) ?? str(r.endPrice?.currencyCode);
  if (min === null && max === null) return null;
  const fmt = (n: number) => n.toLocaleString("es-MX");
  const text = min !== null && max !== null ? `${currency ?? ""} ${fmt(min)}–${fmt(max)}`.trim()
    : min !== null ? `Desde ${currency ?? ""} ${fmt(min)}`.replace(/\s+/g, " ").trim()
    : `Hasta ${currency ?? ""} ${fmt(max!)}`.replace(/\s+/g, " ").trim();
  return { min, max, currency, text };
}

function pointOf(x: any): { day: number; hour: number; minute: number } | null {
  if (!x || typeof x !== "object") return null;
  const day = Number(x.day ?? 0), hour = Number(x.hour ?? 0), minute = Number(x.minute ?? 0);
  return [day, hour, minute].every(Number.isFinite) && day >= 0 && day <= 6 ? { day, hour, minute } : null;
}

/** regularOpeningHours.periods → lista limpia (null si Google no la publica). */
function periodsOf(raw: unknown): GooglePlace["opening_periods"] {
  if (!Array.isArray(raw) || !raw.length) return null;
  const out = (raw as any[]).map((r) => ({ open: pointOf(r?.open), close: pointOf(r?.close) }))
    .filter((r): r is { open: { day: number; hour: number; minute: number }; close: { day: number; hour: number; minute: number } | null } => !!r.open);
  return out.length ? out : null;
}

/** Respuesta cruda de Places (New) → GooglePlace. `nowMs` = momento de la consulta. */
export function normalizePlace(p: any, consultadoAt: string, nowMs = Date.parse(consultadoAt)): GooglePlace {
  const tz = str(p?.timeZone?.id) ?? str(p?.timeZone);
  const offset = num(p?.utcOffsetMinutes);
  const clock = localClock(Number.isFinite(nowMs) ? nowMs : Date.now(), tz, offset);
  const googleOpen = bool(p?.currentOpeningHours?.openNow);
  const computed = isOpenAt(p?.regularOpeningHours?.periods, clock);
  const level = priceLevelEs(p?.priceLevel);
  const status = str(p?.businessStatus);
  const photos: PhotoRef[] = (Array.isArray(p?.photos) ? p.photos : []).slice(0, 6)
    .filter((ph: any) => typeof ph?.name === "string")
    .map((ph: any) => ({
      ref: ph.name,
      width: num(ph.widthPx),
      height: num(ph.heightPx),
      attributions: (Array.isArray(ph.authorAttributions) ? ph.authorAttributions : [])
        .map((a: any) => ({ name: String(a?.displayName ?? ""), uri: str(a?.uri) }))
        .filter((a: { name: string }) => a.name),
    }));
  return {
    place_id: String(p?.id ?? ""),
    name: str(p?.displayName?.text),
    address: str(p?.formattedAddress),
    lat: num(p?.location?.latitude),
    lng: num(p?.location?.longitude),
    maps_url: str(p?.googleMapsUri),
    website: str(p?.websiteUri),
    phone: str(p?.internationalPhoneNumber) ?? str(p?.nationalPhoneNumber),
    phone_international: str(p?.internationalPhoneNumber),
    primary_type: str(p?.primaryType),
    primary_type_label: str(p?.primaryTypeDisplayName?.text),
    types: Array.isArray(p?.types) ? p.types.filter((t: unknown) => typeof t === "string") : [],
    business_status: status,
    closed: status === "CLOSED_PERMANENTLY" || status === "CLOSED_TEMPORARILY",
    rating: num(p?.rating),
    user_rating_count: num(p?.userRatingCount),
    price_level: str(p?.priceLevel),
    price_level_label: level?.label ?? null,
    price_symbol: level?.symbol ?? null,
    price_range: priceRangeOf(p?.priceRange),
    open_now: googleOpen ?? computed,
    open_now_source: googleOpen !== null ? "google" : computed !== null ? "calculado" : null,
    hours_today: hoursToday(p?.currentOpeningHours?.weekdayDescriptions ?? p?.regularOpeningHours?.weekdayDescriptions, clock),
    weekday_hours: Array.isArray(p?.regularOpeningHours?.weekdayDescriptions) ? p.regularOpeningHours.weekdayDescriptions : null,
    opening_periods: periodsOf(p?.regularOpeningHours?.periods),
    time_zone: tz,
    utc_offset_minutes: offset,
    editorial_summary: str(p?.editorialSummary?.text),
    reservable: bool(p?.reservable),
    serves: {
      breakfast: bool(p?.servesBreakfast), brunch: bool(p?.servesBrunch), lunch: bool(p?.servesLunch), dinner: bool(p?.servesDinner),
      vegetarian: bool(p?.servesVegetarianFood), cocktails: bool(p?.servesCocktails), wine: bool(p?.servesWine),
    },
    outdoor_seating: bool(p?.outdoorSeating),
    good_for_groups: bool(p?.goodForGroups),
    photos,
    photo_ref: photos[0]?.ref ?? null,
    fuente: "google_places",
    estado_dato: "CONSULTADO_EN_VIVO",
    consultado_at: consultadoAt,
    atribucion: "Google Maps",
  };
}

/** Recalcula "abierto ahora" para otro momento (p. ej. al mostrar un resultado más tarde). */
export function openNowAt(place: Pick<GooglePlace, "time_zone" | "utc_offset_minutes">, periods: unknown, nowMs: number): boolean | null {
  return isOpenAt(periods, localClock(nowMs, place.time_zone, place.utc_offset_minutes));
}

// ─── Llamadas ───

export type PlacesResult =
  | { ok: true; places: GooglePlace[]; consultado_at: string; sku: string; fuente: "google_places" }
  | { ok: false; error: GoogleError; sku: string };

export type TextSearchRequest = {
  query: string;
  language?: string;
  region?: string;
  maxResults?: number;
  preset?: PlacePreset;
  /** Sesgo de ubicación (círculo). */
  near?: { lat: number; lng: number; radius?: number };
  /** Un solo tipo de la Tabla A (p. ej. "restaurant", "tourist_attraction", "lodging"). */
  includedType?: string;
  openNow?: boolean;
  minRating?: number;
  priceLevels?: PriceLevel[];
  /** Quitar lugares cerrados permanente o temporalmente (default true). */
  dropClosed?: boolean;
  /** Tiempo máximo de la llamada (default 12 s). */
  timeoutMs?: number;
};

export type CallOptions = { now?: () => number };

const clamp = (n: unknown, lo: number, hi: number, dflt: number) => {
  const v = Number(n);
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : dflt;
};

/** Cuerpo de Text Search (exportado para probar exactamente lo que se manda). */
export function textSearchBody(r: TextSearchRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    textQuery: String(r.query ?? "").replace(/\s+/g, " ").trim().slice(0, 200),
    languageCode: r.language ?? "es",
    pageSize: clamp(r.maxResults, 1, 20, 10),
  };
  if (r.region) body.regionCode = r.region;
  if (r.includedType) body.includedType = r.includedType;
  if (typeof r.openNow === "boolean") body.openNow = r.openNow;
  if (typeof r.minRating === "number") body.minRating = Math.min(5, Math.max(0, Math.round(r.minRating * 2) / 2));
  if (r.priceLevels?.length) body.priceLevels = r.priceLevels;
  if (r.near && Number.isFinite(r.near.lat) && Number.isFinite(r.near.lng)) {
    body.locationBias = { circle: { center: { latitude: r.near.lat, longitude: r.near.lng }, radius: clamp(r.near.radius, 1, 50000, 5000) } };
  }
  return body;
}

function finish(raw: any[], sku: string, consultadoAt: string, dropClosed: boolean): PlacesResult {
  const places = raw.map((p) => normalizePlace(p, consultadoAt)).filter((p) => p.place_id && (!dropClosed || !p.closed));
  return { ok: true, places, consultado_at: consultadoAt, sku, fuente: "google_places" };
}

/** Text Search (New). preset por defecto: "rich" (Enterprise). */
export async function searchText(t: GoogleTransport, r: TextSearchRequest, o: CallOptions = {}): Promise<PlacesResult> {
  const preset = r.preset ?? "rich";
  const sku = skuFor("text", preset);
  const body = textSearchBody(r);
  if (!body.textQuery) return { ok: false, sku, error: { kind: "invalid_request", status: 400, message: "query vacía" } };
  const mask = fieldMask("text", preset);
  return coalesce(`text|${mask}|${JSON.stringify(body)}`, async () => {
    const res = await googleJson<{ places?: any[] }>(t, "places", sku, "/v1/places:searchText", { body, fieldMask: mask, timeoutMs: r.timeoutMs });
    if (!res.ok) return { ok: false as const, sku, error: callError(res) };
    const at = new Date((o.now ?? Date.now)()).toISOString();
    return finish(res.data?.places ?? [], sku, at, r.dropClosed !== false);
  });
}

export type NearbyRequest = {
  lat: number;
  lng: number;
  radius?: number;
  includedTypes: string[];
  maxResults?: number;
  rankPreference?: "POPULARITY" | "DISTANCE";
  language?: string;
  preset?: Exclude<PlacePreset, "ids">;
  dropClosed?: boolean;
};

/** Nearby Search (New). preset por defecto: "rich". */
export async function searchNearby(t: GoogleTransport, r: NearbyRequest, o: CallOptions = {}): Promise<PlacesResult> {
  const preset = r.preset ?? "rich";
  const sku = skuFor("nearby", preset);
  if (!Number.isFinite(r.lat) || !Number.isFinite(r.lng) || !r.includedTypes?.length) {
    return { ok: false, sku, error: { kind: "invalid_request", status: 400, message: "lat, lng e includedTypes requeridos" } };
  }
  const body = {
    includedTypes: r.includedTypes.slice(0, 50),
    maxResultCount: clamp(r.maxResults, 1, 20, 10),
    locationRestriction: { circle: { center: { latitude: r.lat, longitude: r.lng }, radius: clamp(r.radius, 1, 50000, 1500) } },
    rankPreference: r.rankPreference ?? "POPULARITY",
    languageCode: r.language ?? "es",
  };
  const mask = fieldMask("nearby", preset);
  return coalesce(`nearby|${mask}|${JSON.stringify(body)}`, async () => {
    const res = await googleJson<{ places?: any[] }>(t, "places", sku, "/v1/places:searchNearby", { body, fieldMask: mask });
    if (!res.ok) return { ok: false as const, sku, error: callError(res) };
    const at = new Date((o.now ?? Date.now)()).toISOString();
    return finish(res.data?.places ?? [], sku, at, r.dropClosed !== false);
  });
}

export type DetailsResult = { ok: true; place: GooglePlace; sku: string } | { ok: false; error: GoogleError; sku: string };

/** Place Details (New). preset por defecto: "atmosphere" (ficha completa de un lugar). */
export async function placeDetails(
  t: GoogleTransport, placeId: string, opts: { language?: string; preset?: PlacePreset } & CallOptions = {},
): Promise<DetailsResult> {
  const preset = opts.preset ?? "atmosphere";
  const sku = skuFor("details", preset);
  const id = String(placeId ?? "").replace(/^places\//, "").trim();
  if (!/^[A-Za-z0-9_-]{10,300}$/.test(id)) return { ok: false, sku, error: { kind: "invalid_request", status: 400, message: "place_id inválido" } };
  const mask = fieldMask("details", preset);
  const query = new URLSearchParams({ languageCode: opts.language ?? "es" });
  return coalesce(`details|${mask}|${id}|${query}`, async () => {
    const res = await googleJson<any>(t, "places", sku, `/v1/places/${encodeURIComponent(id)}`, { method: "GET", fieldMask: mask, query });
    if (!res.ok) return { ok: false as const, sku, error: callError(res) };
    const at = new Date((opts.now ?? Date.now)()).toISOString();
    return { ok: true as const, place: normalizePlace(res.data, at), sku };
  });
}

/**
 * place_id de un nombre ("Pujol, Ciudad de México") con Text Search IDs Only (gratis). El place_id
 * es lo único que los términos de Google permiten guardar sin límite: se guarda 30 días en la caché
 * compartida para no repetir la búsqueda.
 */
export async function findPlaceId(t: GoogleTransport, query: string, store?: CacheStore | null, language = "es"): Promise<string | null> {
  const q = String(query ?? "").replace(/\s+/g, " ").trim();
  if (!q) return null;
  const key = await cacheKey("gplaces_id", { q, language });
  const row = await cacheGet(store, key);
  const cached = (row?.response as { place_id?: unknown } | undefined)?.place_id;
  if (typeof cached === "string" && cached) return cached;
  const r = await searchText(t, { query: q, language, preset: "ids", maxResults: 1, dropClosed: false });
  const id = r.ok ? r.places[0]?.place_id ?? null : null;
  if (id && store) {
    try { await store.put(key, "gplaces_id", { place_id: id }, 30 * 86400); } catch { /* sin caché sigue funcionando */ }
  }
  return id;
}

// ─── Ayudas para las funciones ───

const normName = (v: unknown) =>
  String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Mismo lugar: nombres iguales o el corto (de 2+ palabras) dentro del largo. */
export function samePlaceName(a: unknown, b: unknown): boolean {
  const x = normName(a), y = normName(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.split(" ").length >= 2 && ` ${long} `.includes(` ${short} `);
}

/** Ordena por calidad real: calificación ponderada por número de reseñas (sin reseñas al final). */
export function rankByQuality(places: GooglePlace[], minReviews = 20): GooglePlace[] {
  const score = (p: GooglePlace) => {
    const n = p.user_rating_count ?? 0;
    const r = p.rating ?? 0;
    if (!n || !r) return -1;
    // Promedio bayesiano hacia 4.0 con peso de minReviews reseñas.
    return (r * n + 4.0 * minReviews) / (n + minReviews);
  };
  return [...places].sort((a, b) => score(b) - score(a));
}

/** "4.6 ★ (1,234 reseñas en Google)" o null. */
export function ratingText(p: Pick<GooglePlace, "rating" | "user_rating_count">): string | null {
  if (p.rating === null) return null;
  const n = p.user_rating_count;
  return `${p.rating.toFixed(1)} ★${n ? ` (${n.toLocaleString("es-MX")} reseñas en Google)` : ""}`;
}

/** Restaurante de Google → forma de restaurantes_json (la que muestran TripDetail y el PDF). */
export function restaurantFromPlace(p: GooglePlace, city: string): Record<string, unknown> {
  const extras: string[] = [];
  if (p.reservable === true) extras.push("Acepta reservaciones");
  if (p.serves.dinner === true) extras.push("sirve cena");
  if (p.serves.vegetarian === true) extras.push("tiene opciones vegetarianas");
  if (p.outdoor_seating === true) extras.push("mesas al aire libre");
  const rating = ratingText(p);
  return {
    nombre: p.name,
    ciudad: city,
    cocina: p.primary_type_label ?? "Restaurante",
    // Nivel de precio de Google ($–$$$$); si Google no lo publica, se dice.
    rango_precio: p.price_range?.text ?? p.price_symbol ?? "Precio no publicado",
    por_que: p.editorial_summary ?? (rating ? `Calificación ${rating}.` : "Restaurante listado en Google Maps."),
    tip: extras.length ? `${extras.join(", ").replace(/^./, (c) => c.toUpperCase())}.` : null,
    rating: p.rating,
    num_reviews: p.user_rating_count,
    nivel_precio: p.price_level_label,
    place_id: p.place_id,
    direccion: p.address,
    maps_url: p.maps_url,
    website: p.website,
    telefono: p.phone,
    telefono_internacional: p.phone_international,
    reservable: p.reservable,
    sirve: { desayuno: p.serves.breakfast, brunch: p.serves.brunch, comida: p.serves.lunch, cena: p.serves.dinner },
    abierto_ahora: p.open_now,
    horario_hoy: p.hours_today,
    photo_ref: p.photo_ref,
    cta_action: p.website ?? p.maps_url,
    fuente: "google_places",
    estado_dato: "CONSULTADO_EN_VIVO",
    consultado_at: p.consultado_at,
  };
}

/** Búsqueda de Text Search por categoría (mismo vocabulario que tripadvisor-search). */
export const CATEGORY_SEARCH: Record<string, { prefix: string; includedType?: string }> = {
  attractions: { prefix: "Atracciones turísticas en", includedType: "tourist_attraction" },
  restaurants: { prefix: "Restaurantes en", includedType: "restaurant" },
  hotels: { prefix: "Hoteles en", includedType: "lodging" },
};

/**
 * Lugar de Google → misma forma que los resultados de tripadvisor-search (TripActivities,
 * analizar-viaje, logistics-plan y el chat la leen). `photos` va vacío: las fotos de Places son
 * nombres de recurso que se piden por place-photo (`photo_ref`), no URLs públicas.
 */
export function placeCard(p: GooglePlace, category: string | null = null) {
  return {
    id: p.place_id,
    place_id: p.place_id,
    name: p.name ?? "",
    address: p.address ?? "",
    rating: p.rating,
    num_reviews: p.user_rating_count,
    price_level: p.price_symbol,
    price_level_label: p.price_level_label,
    ranking: null,
    web_url: p.maps_url,
    phone: p.phone,
    website: p.website,
    latitude: p.lat,
    longitude: p.lng,
    description: p.editorial_summary,
    photos: [] as string[],
    photo_ref: p.photo_ref,
    photo_refs: p.photos.map((ph) => ph.ref),
    category: p.primary_type_label ?? category,
    open_now: p.open_now,
    hours_today: p.hours_today,
    fuente: "google_places" as const,
    estado_dato: "CONSULTADO_EN_VIVO" as const,
    consultado_at: p.consultado_at,
  };
}
