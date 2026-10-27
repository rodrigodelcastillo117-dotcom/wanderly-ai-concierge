// Tripadvisor Terra (plan Discover) para tripadvisor-search y la sonda de health-check.
// Sin dependencias de Deno (se prueba con Vitest). Documentación oficial consultada el 27-oct-2026
// en https://docs.terra.tripadvisor.com (llms.txt):
//   - Base: https://terra.tripadvisor.com/api ; versión por parámetro (?version=1).
//   - Llave: SOLO en el encabezado `X-API-Key` (api-security). Nunca en la URL.
//   - GET /locations/search: query (1–500), category RESTAURANT|ATTRACTION|HOTEL, locale (es-MX),
//     size ≤ 20 (20 por omisión). Respuesta { data: [{ location: Location, matched_value }], pagination }.
//     Cada Location ya trae nombre, dirección, coordenadas, calificación (traveler_ratings.overall:
//     rating, count, icon_url), URLs de Tripadvisor y categorías: no hace falta "enriquecer".
//     Solo devuelve lugares de la allowlist de la cuenta (vacío ≠ error).
//   - GET /locations/{id}/photos: size (100 por omisión: pedir solo lo que se muestra).
//   - Cobro Discover (usage-based-pricing): 1 entidad por cada location ID devuelto en búsqueda,
//     nearby, catálogo y multi-get; 1 por llamada a fotos o reseñas. 4xx/5xx no cuentan. Las primeras
//     1,000 entidades de la VIDA de la cuenta son gratis; después USD 0.015 → 0.009 por entidad.
//   - Caché (caching-policy): prohibido guardar contenido; solo el Location ID. Por eso aquí NO se
//     guarda nada de Tripadvisor en serp_cache (solo la bandera de pausa propia).
//   - Límites: 10 req/s y 10,000 al día (ventana móvil de 24 h); búsqueda/nearby: 1 req/s, ráfaga 5.
//     Al pasarse: 429. Llave mala: 401 (`detail`); endpoint fuera del plan: 403 (`message`).
//   - Términos (api-master-terms 3.1.2): el contenido NO se puede usar con IA (salvo pruebas internas),
//     así que solo se consulta para pantallas (uso: "pantalla"), nunca para análisis o concierge.

export const TERRA_BASE = "https://terra.tripadvisor.com/api";
export const TERRA_VERSION = "1";
export const TERRA_TIMEOUT_MS = 6000;
/** Precio de lista del primer escalón (USD por entidad). Estimación conservadora para ai_usage_log
 *  (no descuenta las 1,000 gratis de por vida ni los escalones de volumen): la factura manda. */
export const TERRA_USD_PER_ENTITY = 0.015;

export const TERRA_DEFAULTS = {
  /** Resultados por búsqueda = entidades máximas por búsqueda. */
  searchSize: 5,
  /** Fotos por lugar abierto (1 entidad por llamada, sin importar cuántas fotos). */
  photosSize: 5,
  /** Tope global de entidades en 24 h (todas las personas). */
  dailyEntities: 200,
  /** Llamadas a Terra por persona en 24 h (búsquedas + fotos). */
  userDailyCalls: 20,
};

export type TerraConfig = typeof TERRA_DEFAULTS;

const intIn = (v: unknown, min: number, max: number, dflt: number) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n >= min && n <= max ? n : dflt;
};

/** Configuración desde variables opcionales (sin variable → valores por omisión). */
export function terraConfig(env: (k: string) => string | undefined): TerraConfig {
  return {
    searchSize: intIn(env("TRIPADVISOR_SEARCH_SIZE"), 1, 20, TERRA_DEFAULTS.searchSize),
    photosSize: intIn(env("TRIPADVISOR_PHOTOS_SIZE"), 1, 20, TERRA_DEFAULTS.photosSize),
    dailyEntities: intIn(env("TRIPADVISOR_DAILY_ENTITIES"), 0, 10_000, TERRA_DEFAULTS.dailyEntities),
    userDailyCalls: intIn(env("TRIPADVISOR_USER_DAILY_CALLS"), 0, 1_000, TERRA_DEFAULTS.userDailyCalls),
  };
}

export type AppCategory = "hotels" | "attractions" | "restaurants" | "geos";
export const TERRA_CATEGORY: Record<string, "HOTEL" | "ATTRACTION" | "RESTAURANT"> = {
  hotels: "HOTEL",
  attractions: "ATTRACTION",
  restaurants: "RESTAURANT",
};

/** "es_MX" (formato de la API vieja y de la app) → "es-MX" (Terra acepta el formato con guion). */
export function terraLocale(language?: string | null): string {
  const raw = String(language ?? "").trim().replace(/_/g, "-");
  const m = /^([a-z]{2})(?:-([a-z]{2}))?$/i.exec(raw);
  if (!m) return "es-MX";
  return m[2] ? `${m[1].toLowerCase()}-${m[2].toUpperCase()}` : m[1].toLowerCase();
}

export function searchUrl(p: { query: string; category?: string | null; locale: string; size: number; catalog?: boolean }): string {
  const u = new URL(`${TERRA_BASE}${p.catalog ? "/catalog" : ""}/locations/search`);
  u.searchParams.set("version", TERRA_VERSION);
  u.searchParams.set("query", p.query.trim().slice(0, 500));
  const cat = p.category ? TERRA_CATEGORY[p.category] : undefined;
  if (cat) u.searchParams.set("category", cat);
  u.searchParams.set("locale", p.locale);
  u.searchParams.set("size", String(Math.max(1, Math.min(20, Math.floor(p.size)))));
  return u.toString();
}

export function photosUrl(p: { locationId: string | number; locale: string; size: number }): string {
  const id = String(p.locationId).replace(/\D/g, "");
  const u = new URL(`${TERRA_BASE}/locations/${id}/photos`);
  u.searchParams.set("version", TERRA_VERSION);
  u.searchParams.set("locale", p.locale);
  u.searchParams.set("size", String(Math.max(1, Math.min(20, Math.floor(p.size)))));
  return u.toString();
}

export type TerraResponse = { ok: boolean; status: number | null; json: unknown; error?: "timeout" | "network" };

/** GET a Terra con la llave en `X-API-Key`. Nunca lanza. */
export async function terraGet(fetchImpl: typeof fetch, url: string, apiKey: string, timeoutMs = TERRA_TIMEOUT_MS): Promise<TerraResponse> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { signal: ctrl.signal, headers: { accept: "application/json", "X-API-Key": apiKey } });
    const text = await res.text();
    let json: unknown = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* no JSON */ }
    return { ok: res.ok, status: res.status, json };
  } catch (e) {
    return { ok: false, status: null, json: null, error: (e as Error)?.name === "AbortError" ? "timeout" : "network" };
  } finally {
    clearTimeout(t);
  }
}

/** Mensaje de error de Terra (401 en `detail`, 403 en `message`), sin la llave y recortado. */
export function terraErrorDetail(r: TerraResponse, apiKey?: string | null): string | null {
  if (r.ok) return null;
  if (r.error) return r.error === "timeout" ? "timeout" : "sin respuesta";
  const j = (r.json ?? {}) as Record<string, unknown>;
  const parts = [j.title, j.message, j.detail].filter((v) => typeof v === "string" && v.trim()) as string[];
  let msg = [...new Set(parts)].join(" · ").replace(/\s+/g, " ").trim().slice(0, 200);
  if (apiKey) msg = msg.split(apiKey).join("***");
  return msg || null;
}

/** Pausa tras un rechazo, en segundos (no reintentar en bucle: la documentación lo pide). */
export function pauseSecondsFor(status: number | null): number {
  if (status === 429) return 60;
  if (status === 401 || status === 402 || status === 403) return 15 * 60;
  return 0;
}

// ───────────────────────────── respuesta → forma de la app

type Tr = { language?: string; value?: string; primary?: boolean };
const lang2 = (l: unknown) => String(l ?? "").slice(0, 2).toLowerCase();

function pickText(list: unknown, locale: string): string | null {
  if (!Array.isArray(list)) return null;
  const items = list.filter((x): x is Tr => !!x && typeof (x as Tr).value === "string" && !!(x as Tr).value!.trim());
  const want = lang2(locale);
  const hit = items.find((x) => lang2(x.language) === want) ?? items.find((x) => x.primary) ?? items[0];
  return hit?.value?.trim() ?? null;
}

function pickAddress(list: unknown, locale: string): string {
  if (!Array.isArray(list) || !list.length) return "";
  const want = lang2(locale);
  const a = (list.find((x: any) => lang2(x?.language) === want) ?? list[0]) as Record<string, unknown>;
  if (typeof a?.formatted === "string" && a.formatted.trim()) return a.formatted.trim();
  return [a?.street_address, a?.city, a?.state, a?.country_name].filter((v) => typeof v === "string" && v).join(", ");
}

const https = (u: unknown): string | null => {
  if (typeof u !== "string") return null;
  try { return new URL(u).protocol === "https:" ? u : null; } catch { return null; }
};
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);

export type TaResult = {
  id: string;
  name: string;
  address: string;
  rating: number | null;
  num_reviews: number | null;
  /** Imagen oficial de la calificación (burbujas) que manda Tripadvisor. */
  rating_image_url: string | null;
  price_level: string | null;
  ranking: string | null;
  web_url: string | null;
  photos_url: string | null;
  write_review_url: string | null;
  phone: string | null;
  website: string | null;
  latitude: number | null;
  longitude: number | null;
  description: string | null;
  /** La búsqueda no trae fotos: se piden solo al abrir el lugar (acción "fotos"). */
  photos: string[];
  photo_count: number | null;
  category: string | null;
  fuente: "tripadvisor";
};

/** Location de Terra → la misma forma que usaban las pantallas (TripActivities). */
export function mapLocation(loc: unknown, locale: string, fallbackCategory: string | null = null): TaResult | null {
  const l = (loc ?? {}) as Record<string, any>;
  const id = num(l.id);
  const name = pickText(l.names, locale);
  if (id == null || !name) return null;
  const overall = l.traveler_ratings?.overall ?? l.overall_rating ?? {};
  const ta = l.urls?.tripadvisor ?? {};
  const phone = Array.isArray(l.phone_numbers) ? l.phone_numbers.find((p: any) => typeof p?.value === "string" && p.value)?.value ?? null : null;
  const cat = Array.isArray(l.categories) ? l.categories.find((c: any) => typeof c?.display_name === "string")?.display_name ?? null : null;
  return {
    id: String(id),
    name,
    address: pickAddress(l.addresses, locale),
    rating: num(overall.rating),
    num_reviews: num(overall.count),
    rating_image_url: https(overall.icon_url),
    price_level: typeof l.price_level === "string" ? l.price_level : null,
    ranking: Array.isArray(l.rankings) && typeof l.rankings[0]?.display_text === "string" ? l.rankings[0].display_text : null,
    web_url: https(ta.main),
    photos_url: https(ta.photos),
    write_review_url: https(ta.write_review),
    phone,
    website: https(l.urls?.official),
    latitude: num(l.coordinates?.latitude),
    longitude: num(l.coordinates?.longitude),
    description: pickText(l.descriptions, locale),
    photos: [],
    photo_count: num(l.photos?.total_count),
    category: cat ?? fallbackCategory,
    fuente: "tripadvisor",
  };
}

/** Entidades que Tripadvisor cobra por una respuesta de búsqueda: una por location ID devuelto. */
export function searchEntities(json: unknown): number {
  const data = (json as { data?: unknown[] } | null)?.data;
  if (!Array.isArray(data)) return 0;
  return new Set(data.map((d: any) => d?.location?.id ?? d?.id).filter((v) => v != null)).size;
}

/** Respuesta de /locations/search (o del catálogo) → resultados de la app, en el orden de Tripadvisor. */
export function parseSearch(json: unknown, locale: string, category: string | null = null): TaResult[] {
  const data = (json as { data?: unknown[] } | null)?.data;
  if (!Array.isArray(data)) return [];
  return data.map((d: any) => mapLocation(d?.location ?? d, locale, category)).filter((x): x is TaResult => !!x);
}

/** Respuesta de /locations/{id}/photos → URLs del CDN de Tripadvisor (sin volver a alojarlas). */
export function parsePhotos(json: unknown, max = TERRA_DEFAULTS.photosSize): string[] {
  const data = (json as { data?: unknown[] } | null)?.data;
  if (!Array.isArray(data)) return [];
  // La documentación sugiere las de la administración como principales: van primero.
  const rows = data as any[];
  const sorted = [...rows.filter((p) => p?.source?.name === "Management"), ...rows.filter((p) => p?.source?.name !== "Management")];
  return sorted.map((p) => https(p?.photo?.original_size_url)).filter((u): u is string => !!u).slice(0, max);
}

// ───────────────────────────── control de gasto

/** Golpe a check_rate_limit: true = cabe, false = se pasó, null = no se pudo verificar. */
export type HitFn = (subject: string, bucket: string, rule: { limit: number; windowSeconds: number }) => Promise<boolean | null>;

export const GLOBAL_SUBJECT = "global:tripadvisor-terra";
export const GLOBAL_BUCKET = "tripadvisor-terra:entidades:24h";
export const USER_BUCKET = "tripadvisor-terra:llamadas:24h";
const DAY = 86_400;

/**
 * Aparta hasta `wanted` entidades del tope global de 24 h (una fila de rate_limits por entidad, con
 * el candado de check_rate_limit: dos peticiones a la vez no rebasan el tope). Devuelve cuántas se
 * apartaron: la búsqueda pide `size` = apartadas, así que nunca se gasta más que el tope. Si la base
 * no responde se cuenta como NO apartada (falla cerrada: es dinero).
 */
export async function reserveEntities(hit: HitFn, wanted: number, dailyCap: number): Promise<number> {
  if (dailyCap <= 0 || wanted <= 0) return 0;
  const n = Math.min(wanted, dailyCap);
  const rule = { limit: dailyCap, windowSeconds: DAY };
  const got = await Promise.all(Array.from({ length: n }, () => hit(GLOBAL_SUBJECT, GLOBAL_BUCKET, rule).catch(() => null)));
  return got.filter((g) => g === true).length;
}

/** Límite por persona: llamadas a Terra en 24 h. Falla cerrada. */
export async function userAllowed(hit: HitFn, userId: string, perDay: number): Promise<boolean> {
  if (perDay <= 0) return false;
  try {
    return (await hit(`user:${userId}`, USER_BUCKET, { limit: perDay, windowSeconds: DAY })) === true;
  } catch {
    return false;
  }
}

/** Fila para ai_usage_log (provider "tripadvisor"; searches = entidades cobrables). */
export function terraUsage(userId: string | null, endpoint: "locations/search" | "locations/photos" | "catalog/locations/search", entities: number) {
  const n = Math.max(0, Math.round(entities));
  return {
    user_id: userId,
    function: "tripadvisor-search",
    provider: "tripadvisor",
    model: `terra:${endpoint}`,
    searches: n,
    cost_estimate_usd: Math.round(n * TERRA_USD_PER_ENTITY * 1e6) / 1e6,
  };
}

// ───────────────────────────── sonda (health-check ?action=tripadvisor)

/** Consulta sin coincidencias posibles: valida llave y permiso del endpoint con 0 entidades cobrables. */
export const PROBE_QUERY = "zzqx iatos sonda 0";

export type TerraProbe = {
  api: string;
  llave_configurada: boolean;
  ok: boolean;
  http: number | null;
  resultados: number | null;
  entidades_cobrables: number;
  detail: string | null;
  ms: number;
  catalogo?: { http: number | null; resultados: number | null };
};

/**
 * UNA búsqueda mínima. Por omisión con una consulta que no coincide con nada (size=1): Terra solo
 * cobra location IDs devueltos, así que cuesta 0 entidades y aun así prueba llave + permiso.
 * Con `muestra` busca un lugar real (size=1, máximo 1 entidad) y, si la allowlist lo esconde, revisa
 * el catálogo (máximo 1 entidad más) para distinguir "sin allowlist" de "no existe".
 */
export async function probeTripadvisor(deps: { fetchImpl: typeof fetch; apiKey?: string | null; muestra?: boolean; timeoutMs?: number; now?: () => number }): Promise<TerraProbe> {
  const now = deps.now ?? Date.now;
  const t0 = now();
  const base = { api: "Tripadvisor Terra (Partner API v1)", llave_configurada: !!deps.apiKey };
  if (!deps.apiKey) return { ...base, ok: false, http: null, resultados: null, entidades_cobrables: 0, detail: "Falta TRIPADVISOR_API_KEY", ms: 0 };
  const query = deps.muestra ? "Museo Frida Kahlo" : PROBE_QUERY;
  const r = await terraGet(deps.fetchImpl, searchUrl({ query, locale: "es-MX", size: 1 }), deps.apiKey, deps.timeoutMs);
  const resultados = r.ok ? searchEntities(r.json) : null;
  const out: TerraProbe = {
    ...base, ok: r.ok, http: r.status, resultados, entidades_cobrables: resultados ?? 0,
    detail: terraErrorDetail(r, deps.apiKey), ms: now() - t0,
  };
  if (deps.muestra && r.ok && resultados === 0) {
    const c = await terraGet(deps.fetchImpl, searchUrl({ query, locale: "es-MX", size: 1, catalog: true }), deps.apiKey, deps.timeoutMs);
    const n = c.ok ? searchEntities(c.json) : null;
    out.catalogo = { http: c.status, resultados: n };
    out.entidades_cobrables += n ?? 0;
    if (n) out.detail = "El lugar existe en el catálogo pero no en tu allowlist: agrega IDs en el portal o con la Allowlist API";
    out.ms = now() - t0;
  }
  return out;
}
