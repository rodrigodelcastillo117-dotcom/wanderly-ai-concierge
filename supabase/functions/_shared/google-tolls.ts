// Casetas (peajes) REALES de Google Routes API: computeRoutes con extraComputations ["TOLLS"].
// Sin dependencias de Deno: se prueba con Vitest (src/test/googleTolls.test.ts) con fixtures del
// formato documentado. La conexión real (llave del entorno, caché en serp_cache) la ponen
// get-routes y logistics-plan.
//
// Documentación oficial (consultada 2026-10-24):
// - https://developers.google.com/maps/documentation/routes/calculate_toll_fees
//   "Set the extraComputations array field to TOLLS"; máscara routes.travelAdvisory.tollInfo y
//   routes.legs.travelAdvisory.tollInfo. "If there is no available toll price for a given route, the
//   Routes API indicates the existence of a toll with an unknown fee" (tollInfo sin estimatedPrice).
//   Money: currencyCode + units (int64 en texto) + nanos; "units and nanos are omitted when their
//   value is zero". Pases: solo DRIVE/TWO_WHEELER; un pase inválido se ignora.
//   "Requests that calculate toll fees are billed at a higher rate."
// - https://developers.google.com/maps/documentation/routes/reference/rest/v2/RouteModifiers#tollpass
//   Lista oficial de pases (México: MX_IAVE, MX_PASE, MX_QUICKPASS, MX_SISTEMA_TELEPEAJE_CHIHUAHUA,
//   MX_TAG_IAVE, MX_TAG_TELEVIA, MX_TELEVIA, MX_VIAPASS). Prefijos de país en la lista: AR, AU, BR,
//   CA, ID, IN, JP, MX, US.
//
// Reglas de honestidad:
// - Con estimatedPrice → monto real de Google ("Casetas: $X MXN · Google Maps · consultado HH:MM").
//   Se convierte a MXN SOLO con una tasa verificable de _shared/fx.ts (frankfurter/BCE, con fecha);
//   con la tabla de respaldo o sin tasa se muestra la moneda original.
// - tollInfo sin precio → "Hay casetas en la ruta; Google no publica el monto".
// - Sin tollInfo → "Información de casetas no disponible para esta ruta". Nunca "sin casetas": la
//   cobertura de Google no es total y la ausencia no prueba que no haya casetas.
// - Nunca se inventa un monto.
//
// SKU: la página de facturación (usage-and-billing, actualizada 2026-10-21) no nombra el SKU de las
// casetas, solo que se cobra "a un precio más alto". Por prudencia se registra con el SKU más caro
// de Compute Routes (Enterprise, 15 USD por 1,000; 1,000 gratis al mes en la tabla de google-maps.ts).
import { callError, type GoogleError, type GoogleTransport, googleJson } from "./google-maps.ts";
import { parseDuration, routeBody, type Waypoint } from "./google-routes.ts";
import { type CacheStore, cacheKey, freshnessOf } from "./serpCache.ts";
import type { FxInfo } from "./fx.ts";
import type { TollAmount, TollEstado, TollFx, TollQuote } from "./tollQuote.ts";

export { type TollAmount, type TollEstado, type TollFx, tollLine, type TollQuote, tollTime } from "./tollQuote.ts";

export const TOLL_FIELDS = ["routes.travelAdvisory.tollInfo", "routes.legs.travelAdvisory.tollInfo"] as const;
export const TOLLS_SKU = "Compute Routes Enterprise";
export const TOLLS_CACHE_ENGINE = "google_routes_tolls";
export const TOLLS_TTL_SECONDS = 24 * 3600;

/** Pases de México de la lista oficial de TollPass (los demás países se aceptan si tienen el formato). */
export const MX_TOLL_PASSES = [
  "MX_IAVE", "MX_PASE", "MX_QUICKPASS", "MX_SISTEMA_TELEPEAJE_CHIHUAHUA", "MX_TAG_IAVE", "MX_TAG_TELEVIA", "MX_TELEVIA", "MX_VIAPASS",
] as const;
const PASS_PREFIXES = ["AR_", "AU_", "BR_", "CA_", "ID_", "IN_", "JP_", "MX_", "US_"];

/** Un pase con el formato de la lista oficial (p. ej. "MX_TAG_IAVE") o null. */
export function normalizeTollPass(x: unknown): string | null {
  const s = String(x ?? "").trim().toUpperCase();
  if (!/^[A-Z]{2}_[A-Z0-9_]{2,60}$/.test(s) || !PASS_PREFIXES.some((p) => s.startsWith(p))) return null;
  if (s.startsWith("MX_") && !(MX_TOLL_PASSES as readonly string[]).includes(s)) return null;
  return s;
}

/** Agrega el cálculo de casetas (y el pase, si hay) al cuerpo de computeRoutes. */
export function withTolls(body: Record<string, unknown>, pase?: string | null): Record<string, unknown> {
  const out: Record<string, unknown> = { ...body, extraComputations: ["TOLLS"] };
  const p = normalizeTollPass(pase);
  if (p) out.routeModifiers = { ...((body.routeModifiers as Record<string, unknown>) ?? {}), tollPasses: [p] };
  return out;
}

/** Money de Google → { moneda, monto }. null si no es un monto válido. */
export function parseMoney(m: unknown): TollAmount | null {
  const x = (m ?? {}) as { currencyCode?: unknown; units?: unknown; nanos?: unknown };
  const moneda = typeof x.currencyCode === "string" && /^[A-Z]{3}$/.test(x.currencyCode) ? x.currencyCode : null;
  if (!moneda) return null;
  const units = x.units === undefined ? 0 : Number(x.units);
  const nanos = x.nanos === undefined ? 0 : Number(x.nanos);
  if (!Number.isFinite(units) || !Number.isFinite(nanos)) return null;
  const monto = Math.round((units + nanos / 1e9) * 100) / 100;
  return monto >= 0 ? { moneda, monto } : null;
}

/** Qué dice Google de las casetas de una ruta (sin convertir moneda). */
export function readTollInfo(route: unknown): { estado: TollEstado; montos: TollAmount[] } {
  const r = (route ?? {}) as { travelAdvisory?: { tollInfo?: unknown }; legs?: Array<{ travelAdvisory?: { tollInfo?: unknown } }> };
  const legInfos = (Array.isArray(r.legs) ? r.legs : []).map((l) => l?.travelAdvisory?.tollInfo).filter((x) => x && typeof x === "object");
  // La ruta completa manda; si no viene, los tramos (legs) de la misma ruta.
  const infos = r.travelAdvisory?.tollInfo && typeof r.travelAdvisory.tollInfo === "object" ? [r.travelAdvisory.tollInfo] : legInfos;
  if (!infos.length) return { estado: "NO_DISPONIBLE", montos: [] };
  const by = new Map<string, number>();
  for (const info of infos) {
    const prices = Array.isArray((info as { estimatedPrice?: unknown }).estimatedPrice) ? (info as { estimatedPrice: unknown[] }).estimatedPrice : [];
    for (const p of prices) {
      const a = parseMoney(p);
      if (a) by.set(a.moneda, Math.round(((by.get(a.moneda) ?? 0) + a.monto) * 100) / 100);
    }
  }
  const montos = [...by.entries()].map(([moneda, monto]) => ({ moneda, monto }));
  return montos.length ? { estado: "CON_MONTO", montos } : { estado: "SIN_MONTO", montos: [] };
}

export type RateFn = (code: string) => Promise<FxInfo | null>;

/** Convierte a MXN solo con tasa verificable (nunca con la tabla de respaldo de fx.ts). */
export async function toMxn(montos: TollAmount[], rate: RateFn | null): Promise<{ monto_mxn: number | null; fx: TollFx[] }> {
  if (!montos.length) return { monto_mxn: null, fx: [] };
  let total = 0;
  const fx: TollFx[] = [];
  for (const m of montos) {
    if (m.moneda === "MXN") { total += m.monto; continue; }
    let info: FxInfo | null = null;
    try { info = rate ? await rate(m.moneda) : null; } catch { info = null; }
    if (!info || info.is_fallback || !(info.rate > 0)) return { monto_mxn: null, fx: [] };
    total += m.monto * info.rate;
    fx.push({ moneda: m.moneda, tasa: info.rate, fuente: info.source, fecha: info.fetched_at });
  }
  return { monto_mxn: Math.round(total), fx };
}

export async function quoteFromRoute(route: unknown, o: { pase?: string | null; rate?: RateFn | null; now?: () => number } = {}): Promise<TollQuote> {
  const { estado, montos } = readTollInfo(route);
  const { monto_mxn, fx } = await toMxn(montos, o.rate ?? null);
  return {
    estado, montos, monto_mxn, fx, fuente: "google_routes",
    consultado_at: new Date((o.now ?? Date.now)()).toISOString(), pase: normalizeTollPass(o.pase), from_cache: false,
  };
}

// ─── Caché de 24 h (serp_cache) por origen, destino y pase ───

const wpKey = (w: Waypoint) => ("placeId" in w ? `place:${w.placeId}` : "lat" in w ? `${w.lat.toFixed(5)},${w.lng.toFixed(5)}` : `addr:${w.address}`);

export const tollsCacheKey = (origin: Waypoint, destination: Waypoint, pase: string | null) =>
  cacheKey(TOLLS_CACHE_ENGINE, { origin: wpKey(origin), destination: wpKey(destination), pase: pase ?? "ninguno" });

/** Lo que se guarda: casetas + distancia y tiempo de la MISMA respuesta (para no volver a pagar). */
export type CachedTolls = { tolls: TollQuote; distance_meters: number | null; duration_seconds: number | null };

export async function readCachedTolls(store: CacheStore | null | undefined, key: string, now = Date.now()): Promise<CachedTolls | null> {
  if (!store) return null;
  try {
    const row = await store.get(key);
    if (!row || !freshnessOf(row, now).fresh) return null;
    const c = row.response as CachedTolls | null;
    if (!c?.tolls || !["CON_MONTO", "SIN_MONTO", "NO_DISPONIBLE"].includes(c.tolls.estado)) return null;
    return { ...c, tolls: { ...c.tolls, from_cache: true } };
  } catch {
    return null;
  }
}

export async function saveCachedTolls(store: CacheStore | null | undefined, key: string, c: CachedTolls): Promise<void> {
  if (!store) return;
  try { await store.put(key, TOLLS_CACHE_ENGINE, c, TOLLS_TTL_SECONDS); } catch { /* la caché es una ayuda */ }
}

// ─── Tramo en coche con casetas (logistics-plan) ───

export type DriveWithTolls =
  | { ok: true; distance_meters: number | null; duration_seconds: number; consultado_at: string; tolls: TollQuote; from_cache: boolean }
  | { ok: false; error: GoogleError };

/**
 * Tramo en coche: distancia, tiempo (sin tráfico) y casetas en UNA llamada. Con la caché de 24 h
 * vigente no se llama a Google. Solo se llama cuando el usuario genera el viaje.
 */
export async function driveWithTolls(
  t: GoogleTransport,
  r: { origin: Waypoint; destination: Waypoint; pase?: string | null; language?: string },
  o: { store?: CacheStore | null; rate?: RateFn | null; now?: () => number } = {},
): Promise<DriveWithTolls> {
  const now = o.now ?? Date.now;
  const pase = normalizeTollPass(r.pase);
  const key = await tollsCacheKey(r.origin, r.destination, pase);
  const hit = await readCachedTolls(o.store, key, now());
  if (hit && hit.duration_seconds) {
    // La conversión a MXN se rehace con la tasa de hoy; el monto y la hora son los de Google.
    const conv = await toMxn(hit.tolls.montos, o.rate ?? null);
    return { ok: true, distance_meters: hit.distance_meters, duration_seconds: hit.duration_seconds, consultado_at: hit.tolls.consultado_at, tolls: { ...hit.tolls, ...conv }, from_cache: true };
  }
  const base = routeBody({ origin: r.origin, destination: r.destination, mode: "DRIVE", language: r.language });
  if (!base) return { ok: false, error: { kind: "invalid_request", status: 400, message: "origen o destino inválido" } };
  const res = await googleJson<{ routes?: unknown[] }>(t, "routes", TOLLS_SKU, "/directions/v2:computeRoutes", {
    body: withTolls(base, pase),
    fieldMask: ["routes.duration", "routes.distanceMeters", ...TOLL_FIELDS].join(","),
  });
  if (!res.ok) return { ok: false, error: callError(res) };
  const route = (res.data?.routes?.[0] ?? null) as { duration?: unknown; distanceMeters?: unknown } | null;
  const sec = parseDuration(route?.duration);
  if (!route || sec === null) return { ok: false, error: { kind: "not_found", status: 200, message: "Google no encontró ruta en coche" } };
  const tolls = await quoteFromRoute(route, { pase, rate: o.rate, now });
  const meters = typeof route.distanceMeters === "number" ? route.distanceMeters : null;
  await saveCachedTolls(o.store, key, { tolls: { ...tolls, monto_mxn: null, fx: [] }, distance_meters: meters, duration_seconds: sec });
  return { ok: true, distance_meters: meters, duration_seconds: sec, consultado_at: tolls.consultado_at, tolls, from_cache: false };
}
