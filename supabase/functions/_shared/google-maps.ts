// Base común para Google Maps Platform (Places API (New), Routes API, Geocoding y Time Zone).
// Sin dependencias de Deno: se prueba con Vitest con fetch simulado. La conexión real (llaves del
// entorno) vive en google-runtime.ts.
//
// Reglas:
// - La llave NUNCA llega al cliente ni a los logs. Por defecto se usa el conector de Google Maps de
//   Lovable (como todas las funciones actuales); si no hay LOVABLE_API_KEY se llama directo a
//   Google con el encabezado X-Goog-Api-Key (Geocoding y Time Zone, que son APIs anteriores, la
//   llevan en la URL: por eso jamás se registra una URL de Google).
// - Cada llamada lleva una máscara de campos explícita: la máscara decide el SKU que se cobra.
// - Términos de Google (https://developers.google.com/maps/documentation/places/web-service/policies,
//   consultado 2026-10-22): no se puede guardar contenido de Places salvo el place_id (sin límite)
//   y lat/lng hasta 30 días. Por eso aquí NO hay caché persistente de contenido: solo se juntan
//   peticiones idénticas que están en curso al mismo tiempo (coalesce) para no pagar dos veces.
import { redactSecrets } from "./redact.ts";

export type GoogleApi = "places" | "routes" | "geocoding" | "timezone";

export const GATEWAY_BASE = "https://connector-gateway.lovable.dev/google_maps";

/** Prefijo de cada API en el conector de Lovable y su host directo en Google. */
const GATEWAY_PREFIX: Record<GoogleApi, string> = { places: "/places", routes: "/routes", geocoding: "", timezone: "" };
const DIRECT_HOST: Record<GoogleApi, string> = {
  places: "https://places.googleapis.com",
  routes: "https://routes.googleapis.com",
  geocoding: "https://maps.googleapis.com",
  timezone: "https://maps.googleapis.com",
};

export type GoogleTransport = {
  mode: "gateway" | "direct";
  fetch: typeof fetch;
  /** URL completa. `path` es la ruta de la API (p. ej. "/v1/places:searchText"). */
  url(api: GoogleApi, path: string, query?: URLSearchParams): string;
  /** Encabezados de autenticación (+ los que se pasen). */
  headers(api: GoogleApi, extra?: Record<string, string>): Record<string, string>;
  /** Se llama después de cada llamada facturable (para ai_usage_log). Nunca lanza. */
  onCall?: (e: { api: GoogleApi; sku: string; ok: boolean }) => void | Promise<void>;
};

export type TransportKeys = {
  /** GOOGLE_MAPS_API_KEY (vive solo en el servidor). */
  mapsKey?: string | null;
  /** LOVABLE_API_KEY: con ella se usa el conector de Lovable. */
  lovableKey?: string | null;
  fetch?: typeof fetch;
  onCall?: GoogleTransport["onCall"];
};

/** null si no hay llave de Google: quien llama responde "no disponible", nunca inventa. */
export function createGoogleTransport(k: TransportKeys): GoogleTransport | null {
  const mapsKey = (k.mapsKey ?? "").trim();
  if (!mapsKey) return null;
  const lovableKey = (k.lovableKey ?? "").trim();
  const doFetch = k.fetch ?? fetch;
  if (lovableKey) {
    return {
      mode: "gateway",
      fetch: doFetch,
      onCall: k.onCall,
      url: (api, path, query) => `${GATEWAY_BASE}${GATEWAY_PREFIX[api]}${path}${query && [...query.keys()].length ? `?${query}` : ""}`,
      headers: (_api, extra = {}) => ({ Authorization: `Bearer ${lovableKey}`, "X-Connection-Api-Key": mapsKey, ...extra }),
    };
  }
  return {
    mode: "direct",
    fetch: doFetch,
    onCall: k.onCall,
    url: (api, path, query) => {
      const q = new URLSearchParams(query ?? undefined);
      // Las APIs anteriores (Geocoding, Time Zone) solo aceptan la llave en la URL.
      if (api === "geocoding" || api === "timezone") q.set("key", mapsKey);
      const qs = q.toString();
      return `${DIRECT_HOST[api]}${path}${qs ? `?${qs}` : ""}`;
    },
    headers: (api, extra = {}) => (api === "geocoding" || api === "timezone" ? { ...extra } : { "X-Goog-Api-Key": mapsKey, ...extra }),
  };
}

// ─── Errores ───

/**
 * - disabled: la API no está habilitada en el proyecto de Google Cloud (o no tiene facturación).
 * - denied: la llave no sirve para esta API (restringida, inválida o bloqueada).
 * - quota: se alcanzó una cuota (de Google o del conector de Lovable: 6,000 solicitudes / 24 h).
 * - invalid_request / not_found: la petición no era válida o el lugar no existe.
 * - network / error: no hubo respuesta útil.
 */
export type GoogleErrorKind = "disabled" | "denied" | "quota" | "invalid_request" | "not_found" | "network" | "error";

export type GoogleError = { kind: GoogleErrorKind; status: number; message: string };

const DISABLED_RE = /SERVICE_DISABLED|has not been used in project|is disabled|not authorized to use this API|API_NOT_ACTIVATED|billing (?:is )?not enabled|BILLING_DISABLED|enable billing/i;
const DENIED_RE = /API_KEY_INVALID|API key not valid|provided API key is invalid|API_KEY_SERVICE_BLOCKED|API_KEY_HTTP_REFERRER_BLOCKED|API_KEY_IP_ADDRESS_BLOCKED|referer restrictions|are blocked|PERMISSION_DENIED/i;
const QUOTA_RE = /RESOURCE_EXHAUSTED|OVER_QUERY_LIMIT|OVER_DAILY_LIMIT|quota|rate limit|too many requests/i;

/** Clasifica la respuesta de error de Google (APIs nuevas y anteriores) o del conector. */
export function classifyGoogleError(status: number, body: unknown): GoogleError {
  const b = (body ?? {}) as Record<string, any>;
  const err = b.error && typeof b.error === "object" ? b.error : null;
  const reasons = Array.isArray(err?.details) ? err.details.map((d: any) => `${d?.reason ?? ""} ${d?.metadata?.service ?? ""}`).join(" ") : "";
  const legacyStatus = typeof b.status === "string" ? b.status : "";
  const raw = [err?.status, err?.message, reasons, legacyStatus, b.error_message, typeof b.error === "string" ? b.error : "", typeof b.message === "string" ? b.message : ""]
    .filter(Boolean).join(" · ");
  const message = redactSecrets(raw || `HTTP ${status}`, 300) ?? `HTTP ${status}`;
  let kind: GoogleErrorKind = "error";
  if (status === 429 || QUOTA_RE.test(raw)) kind = "quota";
  else if (DISABLED_RE.test(raw)) kind = "disabled";
  else if (status === 401 || status === 403 || legacyStatus === "REQUEST_DENIED" || DENIED_RE.test(raw)) kind = "denied";
  else if (status === 404 || legacyStatus === "NOT_FOUND") kind = "not_found";
  else if (status === 400 || legacyStatus === "INVALID_REQUEST") kind = "invalid_request";
  return { kind, status, message };
}

/** Mensaje en español para el usuario (sin detalles técnicos). */
export function googleErrorMessage(kind: GoogleErrorKind): string {
  switch (kind) {
    case "quota": return "Google Maps no responde por ahora (límite de consultas). Intenta más tarde.";
    case "disabled":
    case "denied": return "La consulta a Google Maps no está disponible en este momento.";
    case "not_found": return "Google Maps no encontró ese lugar.";
    default: return "No pudimos consultar Google Maps en este momento. Intenta más tarde.";
  }
}

export type GoogleCall<T> = { ok: true; data: T; status: number } | { ok: false; error: GoogleError };

/** POST/GET con JSON. Nunca lanza ni deja la URL en el mensaje. */
export async function googleJson<T = unknown>(
  t: GoogleTransport,
  api: GoogleApi,
  sku: string,
  path: string,
  init: { method?: "GET" | "POST"; body?: unknown; fieldMask?: string; query?: URLSearchParams; timeoutMs?: number },
): Promise<GoogleCall<T>> {
  const headers: Record<string, string> = {};
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  if (init.fieldMask) headers["X-Goog-FieldMask"] = init.fieldMask;
  let res: Response;
  try {
    res = await t.fetch(t.url(api, path, init.query), {
      method: init.method ?? (init.body !== undefined ? "POST" : "GET"),
      headers: t.headers(api, headers),
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(init.timeoutMs ?? 12000),
    });
  } catch (e) {
    const name = (e as Error)?.name;
    const message = name === "TimeoutError" || name === "AbortError" ? "timeout" : redactSecrets((e as Error)?.message) ?? "network_error";
    return { ok: false, error: { kind: "network", status: 0, message } };
  }
  const text = await res.text().catch(() => "");
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { message: text.slice(0, 200) }; }
  // Las APIs anteriores responden 200 con status != OK.
  const legacy = (data as { status?: unknown } | null)?.status;
  const legacyBad = (api === "geocoding" || api === "timezone") && typeof legacy === "string" && legacy !== "OK" && legacy !== "ZERO_RESULTS";
  const ok = res.ok && !legacyBad;
  try { await t.onCall?.({ api, sku, ok }); } catch { /* registrar nunca rompe la consulta */ }
  if (!ok) return { ok: false, error: classifyGoogleError(res.status, data) };
  return { ok: true, data: data as T, status: res.status };
}

// ─── Juntar peticiones idénticas en curso ───

const INFLIGHT = new Map<string, Promise<unknown>>();

/**
 * Si ya hay una petición idéntica en curso (misma llave), se espera esa en lugar de pagar otra.
 * Al terminar se olvida: esto NO es una caché (los términos de Google no permiten guardar contenido).
 */
export function coalesce<T>(key: string, fn: () => Promise<T>, map: Map<string, Promise<unknown>> = INFLIGHT): Promise<T> {
  const pending = map.get(key) as Promise<T> | undefined;
  if (pending) return pending;
  const p = fn().finally(() => map.delete(key));
  map.set(key, p);
  return p;
}

// ─── Time Zone API ───

export type TimeZoneInfo = { ok: true; time_zone: string; utc_offset_minutes: number; name: string | null; consultado_at: string } | { ok: false; error: GoogleError };

/** Zona horaria IANA de una coordenada (Time Zone API, SKU Essentials). */
export async function timeZoneAt(t: GoogleTransport, lat: number, lng: number, atMs = Date.now()): Promise<TimeZoneInfo> {
  const query = new URLSearchParams({ location: `${lat},${lng}`, timestamp: String(Math.floor(atMs / 1000)) });
  const r = await googleJson<{ timeZoneId?: string; rawOffset?: number; dstOffset?: number; timeZoneName?: string }>(
    t, "timezone", "Time Zone", "/maps/api/timezone/json", { query },
  );
  if (!r.ok) return { ok: false, error: callError(r) };
  if (!r.data?.timeZoneId) return { ok: false, error: { kind: "not_found", status: 200, message: "sin zona horaria" } };
  return {
    ok: true,
    time_zone: r.data.timeZoneId,
    utc_offset_minutes: Math.round(((r.data.rawOffset ?? 0) + (r.data.dstOffset ?? 0)) / 60),
    name: r.data.timeZoneName ?? null,
    consultado_at: new Date().toISOString(),
  };
}

// ─── Precios de lista por SKU (USD por 1,000 eventos, franja 0–100k) ───
// Fuente: https://developers.google.com/maps/billing-and-pricing/pricing (última actualización
// 2026-10-21, consultado 2026-10-22). `free` = uso mensual gratis por SKU.
export const GOOGLE_SKU_PRICING: Record<string, { usdPer1000: number; free: number }> = {
  "Text Search Essentials (IDs Only)": { usdPer1000: 0, free: Number.POSITIVE_INFINITY },
  "Text Search Pro": { usdPer1000: 32, free: 5000 },
  "Text Search Enterprise": { usdPer1000: 35, free: 1000 },
  "Text Search Enterprise + Atmosphere": { usdPer1000: 40, free: 1000 },
  "Nearby Search Pro": { usdPer1000: 32, free: 5000 },
  "Nearby Search Enterprise": { usdPer1000: 35, free: 1000 },
  "Nearby Search Enterprise + Atmosphere": { usdPer1000: 40, free: 1000 },
  "Place Details Essentials": { usdPer1000: 5, free: 10000 },
  "Place Details Pro": { usdPer1000: 17, free: 5000 },
  "Place Details Enterprise": { usdPer1000: 20, free: 1000 },
  "Place Details Enterprise + Atmosphere": { usdPer1000: 25, free: 1000 },
  "Place Details Photos": { usdPer1000: 7, free: 1000 },
  "Compute Routes Essentials": { usdPer1000: 5, free: 10000 },
  "Compute Routes Pro": { usdPer1000: 10, free: 5000 },
  "Compute Routes Enterprise": { usdPer1000: 15, free: 1000 },
  "Compute Route Matrix Essentials": { usdPer1000: 5, free: 10000 },
  "Compute Route Matrix Pro": { usdPer1000: 10, free: 5000 },
  "Compute Route Matrix Enterprise": { usdPer1000: 15, free: 1000 },
  "Geocoding": { usdPer1000: 5, free: 10000 },
  "Time Zone": { usdPer1000: 5, free: 10000 },
};

/** Precio de lista de UNA llamada (sin descontar la franja gratis). 0 si el SKU no se conoce. */
export function googleListPriceUsd(sku: string, events = 1): number {
  const p = GOOGLE_SKU_PRICING[sku];
  return p ? Math.round(((p.usdPer1000 * events) / 1000) * 1e6) / 1e6 : 0;
}

/**
 * El error de un resultado fallido ({ ok: false, error }). Existe porque el tsconfig de la app (con
 * el que también se revisan estas pruebas) no estrecha uniones discriminadas sin strictNullChecks.
 */
export const callError = (r: unknown): GoogleError =>
  (r as { error?: GoogleError }).error ?? { kind: "error", status: 0, message: "error desconocido" };
