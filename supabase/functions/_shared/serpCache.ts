// Caché compartida entre usuarios para SerpApi (y Pexels), guardada en public.serp_cache.
// Sin dependencias de Deno: se prueba con Vitest (src/test/serpCache.test.ts) con un almacén en
// memoria; serpRuntime.ts conecta el almacén real (service_role).
//
// Reglas:
// - La llave es SHA-256 del motor + parámetros normalizados SIN la api_key: dos personas que buscan
//   la misma ruta y fechas pagan una sola búsqueda.
// - Una entrada solo se sirve como vigente dentro de su TTL. Pasado el TTL, nunca se presenta como
//   "en vivo": solo se usa como "precio guardado" (estado OBSOLETO) cuando el plan llegó a su uso
//   justo, y siempre con la fecha real de consulta (fetched_at).
// - Solo cuenta (gate) y se registra una búsqueda cuando de verdad se llama a SerpApi; un acierto de
//   caché no gasta la bolsa del usuario. Si SerpApi responde con error (no lo cobra), se devuelve.

const HOUR = 3600;
const DAY = 86400;

/** Cuánto vale cada respuesta guardada (segundos). */
export const CACHE_TTL_SECONDS: Record<string, number> = {
  google_flights: 6 * HOUR, // precios de vuelos
  google_hotels: 12 * HOUR, // tarifas de hoteles
  google_maps: 7 * DAY, // lugares
  google: 10 * 60, // estado de vuelo (widget de Google)
  pexels_photo: 7 * DAY,
  pexels_video: 7 * DAY,
  trip_quote: DAY, // cotización en vivo de un viaje manual (serpapi-quote)
  google_travel_explore: 12 * HOUR, // "Vuelos baratos desde…" / Explorar destinos (por origen y mes)
  google_events: 6 * HOUR, // Event Radar de Iato (por ciudad, fechas y consulta)
  viator_products: 6 * HOUR, // Viator Partner API: caché corta y privada, solo para la misma consulta (términos de Viator)
};

/** Ofertas por proveedor de un hotel (google_hotels con property_token). */
export const HOTEL_OFFERS_TTL_SECONDS = 3 * HOUR;

export type CacheRow = { response: unknown; fetched_at: string; ttl_seconds: number };

/**
 * TTL según qué tan lejos está el viaje: una tarifa para dentro de 3 meses cambia mucho menos que
 * una para pasado mañana. La banda de 8–30 días conserva el TTL base del motor (6 h vuelos, 12 h
 * hoteles). Siempre dentro del máximo de la tabla (30 días).
 *   vuelos:  ≤7 días 3 h · 8–30 días 6 h · 31–90 días 12 h · >90 días 24 h
 *   hoteles: ≤7 días 6 h · 8–30 días 12 h · 31–90 días 24 h · >90 días 48 h
 */
export function travelDateTtlSeconds(engine: string, params: URLSearchParams | Record<string, unknown>, now = Date.now()): number {
  const base = CACHE_TTL_SECONDS[engine] ?? 0;
  const get = (k: string) => (params instanceof URLSearchParams ? params.get(k) : (params as Record<string, unknown>)[k]);
  // Ofertas por proveedor de UN hotel (Property Details, hotels-search action "offers"): 3 h por
  // propiedad + fechas + huéspedes, sin importar qué tan lejos está el viaje.
  if (engine === "google_hotels" && get("property_token")) return HOTEL_OFFERS_TTL_SECONDS;
  const date = engine === "google_flights" ? get("outbound_date") : engine === "google_hotels" ? get("check_in_date") : null;
  if (!base || typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return base;
  const days = (Date.parse(`${date}T12:00:00Z`) - now) / 86400000;
  if (!Number.isFinite(days)) return base;
  const bands = engine === "google_flights" ? [3 * HOUR, 6 * HOUR, 12 * HOUR, DAY] : [6 * HOUR, 12 * HOUR, DAY, 2 * DAY];
  return days <= 7 ? bands[0] : days <= 30 ? bands[1] : days <= 90 ? bands[2] : bands[3];
}

export interface CacheStore {
  get(keyHash: string): Promise<CacheRow | null>;
  put(keyHash: string, engine: string, response: unknown, ttlSeconds: number): Promise<void>;
}

/** Almacén en memoria (pruebas y respaldo si la base no está disponible). */
export function memoryCacheStore(now: () => number = Date.now): CacheStore & { rows: Map<string, CacheRow & { engine: string }> } {
  const rows = new Map<string, CacheRow & { engine: string }>();
  return {
    rows,
    get: async (k) => rows.get(k) ?? null,
    put: async (k, engine, response, ttl) => {
      rows.set(k, { engine, response, ttl_seconds: ttl, fetched_at: new Date(now()).toISOString() });
    },
  };
}

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Parámetros que no cambian el resultado (o que son secretos) y no entran en la llave. */
const IGNORED_PARAMS = new Set(["api_key", "no_cache", "async", "output", "token"]);

/** key=value ordenados, en minúsculas y con espacios normalizados. */
export function canonicalParams(params: URLSearchParams | Record<string, unknown>): string {
  const entries: [string, string][] = params instanceof URLSearchParams
    ? Array.from(params.entries())
    : Object.entries(params).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => [k, String(v)]);
  return entries
    .filter(([k]) => !IGNORED_PARAMS.has(k.toLowerCase()))
    .map(([k, v]) => [k.toLowerCase(), v.replace(/\s+/g, " ").trim().toLowerCase()] as [string, string])
    .sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
}

export const cacheKey = (engine: string, params: URLSearchParams | Record<string, unknown>) =>
  sha256Hex(`${engine}|${canonicalParams(params)}`);

export type Freshness = { fetchedAt: string; ageSeconds: number; ttlSeconds: number; fresh: boolean };

export function freshnessOf(row: Pick<CacheRow, "fetched_at" | "ttl_seconds">, now = Date.now()): Freshness {
  const at = Date.parse(row.fetched_at);
  const ageSeconds = Number.isFinite(at) ? Math.max(0, Math.round((now - at) / 1000)) : Number.POSITIVE_INFINITY;
  return { fetchedAt: row.fetched_at, ageSeconds, ttlSeconds: row.ttl_seconds, fresh: ageSeconds < row.ttl_seconds };
}

/** Estado del dato (mismo vocabulario que src/lib/provenance.ts). */
export type CacheEstado = "CONSULTADO_EN_VIVO" | "OBSOLETO";
export const estadoDato = (fresh: boolean): CacheEstado => (fresh ? "CONSULTADO_EN_VIVO" : "OBSOLETO");

/** Lo que de verdad se usa de cada motor: las respuestas completas pesan cientos de KB. */
const KEEP: Record<string, string[]> = {
  google_flights: ["best_flights", "other_flights", "price_insights"],
  // properties: búsqueda por ciudad · name/featured_prices/prices: detalle de un hotel (ofertas por proveedor).
  google_hotels: ["properties", "name", "featured_prices", "prices"],
  google_maps: ["local_results", "place_results"],
  google: ["flight_result"],
  google_travel_explore: ["destinations", "search_parameters"],
};

export function trimForCache(engine: string, json: unknown): unknown {
  const keep = KEEP[engine];
  if (!keep || !json || typeof json !== "object" || Array.isArray(json)) return json;
  const src = json as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of keep) if (k in src) out[k] = src[k];
  const meta = src.search_metadata as { google_flights_url?: unknown } | undefined;
  if (engine === "google_flights" && meta?.google_flights_url) {
    out.search_metadata = { google_flights_url: meta.google_flights_url };
  }
  return out;
}

/** true si SerpApi respondió algo que cobra y que vale la pena guardar. */
const isBillableOk = (status: number, json: unknown) =>
  status >= 200 && status < 300 && !!json && typeof json === "object" && !(json as { error?: unknown }).error;

// ─── Límite de búsquedas en vivo (lo decide quien llama: live_search_take en la base) ───

export type GateDecision =
  | { allow: true; refund?: () => Promise<void> }
  | { allow: false; soft: boolean; info?: Record<string, unknown> };
export type LiveGate = () => Promise<GateDecision>;

/**
 * Freno de la cuenta de SerpApi (para todos los usuarios, incluidos los análisis):
 * - budget: el presupuesto mensual/diario configurado (SERPAPI_MONTHLY_BUDGET / SERPAPI_DAILY_BUDGET)
 *   ya se gastó (ver serpRuntime.ts).
 * - quota: SerpApi respondió que la cuenta se quedó sin búsquedas; se recuerda 1 h para no
 *   seguir pidiendo (y fallando) en cada petición.
 * En ambos casos se sirve el último precio guardado (marcado como tal, con su fecha) o "no disponible".
 */
export type AccountBrake = {
  /** null = se puede buscar; "budget" | "quota" = en pausa. */
  paused(): Promise<"budget" | "quota" | null>;
  /** SerpApi dijo que no hay búsquedas: pausar un rato. */
  tripQuota(): Promise<void>;
};

const SERP_QUOTA_RE = /run out of searches|searches? (?:left|limit)|plan.*(?:limit|exceeded)|account.*(?:limit|suspended)|quota/i;

/** ¿La respuesta de SerpApi dice que se acabó la cuota de la cuenta? */
export function isSerpQuotaError(status: number, json: unknown): boolean {
  const err = (json as { error?: unknown } | null)?.error;
  return status === 429 || (typeof err === "string" && SERP_QUOTA_RE.test(err));
}

/** Qué pasó con las llamadas de esta petición; con esto se arma la procedencia de la respuesta. */
export type SerpTrace = {
  live: number;
  hits: number;
  stale: number;
  /** El plan no permitió una búsqueda en vivo (soft = uso justo de PRO; si no, tope duro). */
  denied: { soft: boolean; info?: Record<string, unknown> } | null;
  /** Consulta más vieja que alimentó la respuesta (la que manda en la insignia). */
  oldestFetchedAt: string | null;
  /** Búsquedas idénticas en curso que se esperaron en lugar de pagar otra. */
  coalesced?: number;
  /** La cuenta de SerpApi está en pausa (presupuesto o cuota): no se buscó en vivo. */
  paused?: "budget" | "quota" | null;
};

export type SerpFetchOptions = {
  store?: CacheStore | null;
  fetchImpl?: typeof fetch;
  gate?: LiveGate;
  /** Freno de toda la cuenta (aplica aunque no haya `gate`, p. ej. en análisis). */
  brake?: AccountBrake;
  /** Mapa de búsquedas en curso (por defecto, uno por proceso). */
  inflight?: Map<string, Promise<InflightResult | null>>;
  /** Se llama tras cada búsqueda real (ok = SerpApi la cobra). Para ai_usage_log. */
  onLive?: (e: { engine: string; ok: boolean }) => void | Promise<void>;
  now?: () => number;
  log?: (...args: unknown[]) => void;
};

const SERP_HOST = "serpapi.com";

type InflightResult = { status: number; text: string; ok: boolean; fetchedAt: string };
/** Búsquedas en curso en este proceso: dos peticiones iguales al mismo tiempo pagan una sola. */
const INFLIGHT = new Map<string, Promise<InflightResult | null>>();

function synthetic(json: unknown, status: number, cache: "hit" | "stale" | "limit" | "paused", fetchedAt: string | null): Response {
  const headers: Record<string, string> = { "content-type": "application/json", "x-iatos-cache": cache };
  if (fetchedAt) headers["x-iatos-fetched-at"] = fetchedAt;
  return new Response(JSON.stringify(json), { status, headers });
}

/**
 * fetch compatible que pasa por la caché compartida cuando la URL es una búsqueda de SerpApi.
 * Cualquier otra URL va directo a fetchImpl. Nunca registra la URL (lleva la api_key).
 */
export function createSerpFetch(opts: SerpFetchOptions = {}) {
  const doFetch = opts.fetchImpl ?? fetch;
  const now = opts.now ?? Date.now;
  const log = opts.log ?? ((...a: unknown[]) => console.warn(...a));
  const inflight = opts.inflight ?? INFLIGHT;
  const trace: SerpTrace = { live: 0, hits: 0, stale: 0, denied: null, oldestFetchedAt: null, coalesced: 0, paused: null };
  const seen = (at: string) => {
    if (!trace.oldestFetchedAt || Date.parse(at) < Date.parse(trace.oldestFetchedAt)) trace.oldestFetchedAt = at;
  };

  const serpFetch = async (input: string | URL, init?: RequestInit): Promise<Response> => {
    let url: URL;
    try {
      url = new URL(String(input));
    } catch {
      return doFetch(input as string, init);
    }
    if (url.hostname !== SERP_HOST || !url.pathname.startsWith("/search")) return doFetch(input as string, init);

    const engine = url.searchParams.get("engine") ?? "google";
    const ttl = travelDateTtlSeconds(engine, url.searchParams, now());
    const noCache = url.searchParams.get("no_cache") === "true";
    const key = await cacheKey(engine, url.searchParams);

    // Otra petición idéntica (este proceso) ya está resolviendo esta búsqueda: se espera su
    // resultado en lugar de pagar otra. El turno se aparta ANTES de cualquier espera.
    const pending = inflight.get(key);
    if (pending) {
      const r = await pending.catch(() => null);
      if (r?.ok) {
        trace.hits++;
        trace.coalesced = (trace.coalesced ?? 0) + 1;
        seen(r.fetchedAt);
        return new Response(r.text, { status: r.status, headers: { "content-type": "application/json", "x-iatos-cache": "hit", "x-iatos-fetched-at": r.fetchedAt } });
      }
    }
    let share: (r: InflightResult | null) => void = () => {};
    const claim = new Promise<InflightResult | null>((res) => { share = res; });
    const owner = !inflight.has(key);
    if (owner) inflight.set(key, claim);
    try {
      return await resolve(url, init, engine, ttl, noCache, key, share);
    } finally {
      share(null); // sin efecto si ya se compartió un resultado
      if (owner) inflight.delete(key);
    }
  };

  const resolve = async (
    url: URL, init: RequestInit | undefined, engine: string, ttl: number, noCache: boolean, key: string,
    share: (r: InflightResult | null) => void,
  ): Promise<Response> => {
    let row: CacheRow | null = null;
    if (opts.store && ttl > 0 && !noCache) {
      try {
        row = await opts.store.get(key);
      } catch (e) {
        log("serp_cache get falló:", (e as Error)?.message);
      }
    }
    if (row && freshnessOf(row, now()).fresh) {
      trace.hits++;
      seen(row.fetched_at);
      share({ status: 200, text: JSON.stringify(row.response), ok: true, fetchedAt: row.fetched_at });
      return synthetic(row.response, 200, "hit", row.fetched_at);
    }

    // Último precio guardado (vencido), marcado como tal; o nada.
    const serveStale = (status: number, cache: "stale" | "limit" | "paused", body: unknown) => {
      if (row) {
        trace.stale++;
        seen(row.fetched_at);
        return synthetic(row.response, 200, "stale", row.fetched_at);
      }
      return synthetic(body, status, cache, null);
    };

    // Freno de la cuenta: sin búsquedas disponibles para nadie.
    if (opts.brake) {
      let paused: "budget" | "quota" | null = null;
      try { paused = await opts.brake.paused(); } catch (e) { log("serp brake falló:", (e as Error)?.message); }
      if (paused) {
        trace.paused = paused;
        return serveStale(429, "paused", { error: "serpapi_paused", reason: paused });
      }
    }

    let refund: (() => Promise<void>) | undefined;
    if (opts.gate) {
      const decision = await opts.gate();
      if (!decision.allow) {
        // (cast explícito: el tsconfig de la app no estrecha uniones sin strictNullChecks)
        const d = decision as Extract<GateDecision, { allow: false }>;
        trace.denied = { soft: d.soft, info: d.info };
        // Uso justo (PRO): el último precio conocido, marcado como guardado. Tope duro: nada.
        if (d.soft && row) return serveStale(429, "limit", null);
        return synthetic({ error: "live_search_limit" }, 429, "limit", null);
      }
      refund = (decision as Extract<GateDecision, { allow: true }>).refund;
    }

    let res: Response;
    try {
      res = await doFetch(url.toString(), init);
    } catch (e) {
      if (refund) await refund().catch(() => {});
      throw e;
    }
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch { /* no JSON */ }
    const ok = isBillableOk(res.status, json);
    trace.live++;
    const fetchedAt = new Date(now()).toISOString();
    if (ok) seen(fetchedAt);
    try {
      await opts.onLive?.({ engine, ok });
    } catch { /* registrar nunca rompe la búsqueda */ }
    if (!ok && refund) await refund().catch(() => {});
    if (ok && opts.store && ttl > 0) {
      try {
        await opts.store.put(key, engine, trimForCache(engine, json), ttl);
      } catch (e) {
        log("serp_cache put falló:", (e as Error)?.message);
      }
    }
    if (ok) share({ status: res.status, text, ok, fetchedAt });
    if (!ok && isSerpQuotaError(res.status, json)) {
      // SerpApi ya no tiene búsquedas: se pausa la cuenta un rato y se responde con el último
      // precio guardado (con su fecha) o "no disponible".
      if (opts.brake) {
        try { await opts.brake.tripQuota(); } catch { /* el freno es una ayuda, no un requisito */ }
      }
      trace.paused = "quota";
      return serveStale(429, "paused", { error: "serpapi_paused", reason: "quota" });
    }
    const headers: Record<string, string> = { "content-type": "application/json", "x-iatos-cache": "miss" };
    if (ok) headers["x-iatos-fetched-at"] = fetchedAt;
    return new Response(text, { status: res.status, headers });
  };

  return { fetch: serpFetch as typeof fetch, trace };
}

/** Fecha de consulta que manda la respuesta (de caché o de ahora). */
export const fetchedAtOf = (res: Response, fallback = new Date().toISOString()) =>
  res.headers.get("x-iatos-fetched-at") ?? fallback;

/**
 * Procedencia para la respuesta de una búsqueda: cuándo se consultó de verdad, si es un precio
 * guardado (vencido, servido por uso justo) y si salió de la caché.
 */
export function cacheProvenance(trace: SerpTrace, now = Date.now()) {
  const fetched_at = trace.oldestFetchedAt ?? new Date(now).toISOString();
  const precio_guardado = trace.stale > 0;
  const ageSeconds = Math.max(0, Math.round((now - Date.parse(fetched_at)) / 1000));
  return {
    fetched_at,
    estado_dato: estadoDato(!precio_guardado) as CacheEstado,
    precio_guardado,
    from_cache: trace.hits + trace.stale > 0,
    cache_age_seconds: Number.isFinite(ageSeconds) ? ageSeconds : 0,
  };
}

/** Procedencia de UNA entrada guardada (p. ej. la cotización de un viaje). */
export function rowProvenance(row: Pick<CacheRow, "fetched_at" | "ttl_seconds">, now = Date.now()) {
  const f = freshnessOf(row, now);
  return { fetched_at: f.fetchedAt, estado_dato: estadoDato(f.fresh), precio_guardado: !f.fresh, fresh: f.fresh, age_seconds: f.ageSeconds };
}

/** Lee una entrada con su propia llave (Pexels, cotización de viaje) sin tirar errores. */
export async function cacheGet(store: CacheStore | null | undefined, key: string, log: (...a: unknown[]) => void = console.warn) {
  if (!store) return null;
  try {
    return await store.get(key);
  } catch (e) {
    log("cache get falló:", (e as Error)?.message);
    return null;
  }
}

export async function cachePut(
  store: CacheStore | null | undefined, key: string, engine: string, response: unknown,
  log: (...a: unknown[]) => void = console.warn,
) {
  if (!store) return;
  try {
    await store.put(key, engine, response, CACHE_TTL_SECONDS[engine] ?? DAY);
  } catch (e) {
    log("cache put falló:", (e as Error)?.message);
  }
}
