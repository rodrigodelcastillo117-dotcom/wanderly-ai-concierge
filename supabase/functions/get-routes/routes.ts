// Routes API v2 - computeRoutes para los 4 modos (lógica de get-routes, sin Deno: se prueba con
// Vitest en src/test/googleTolls.test.ts).
//
// Va por el transporte del conector de Google que ya existe (googleTransportFor en index.ts): la
// llave nunca sale en la respuesta ni en los mensajes de error (googleJson los limpia) y cada llamada
// queda en ai_usage_log con su SKU.
//
// Casetas: SOLO en el modo coche (DRIVE) se pide extraComputations ["TOLLS"] con la máscara de
// tollInfo (_shared/google-tolls.ts). Con casetas guardadas de las últimas 24 h (serp_cache, por
// origen, destino y pase) se pide la ruta sin TOLLS y se usan las guardadas, con su hora original.
import { callError, type GoogleTransport, googleErrorMessage, googleJson } from "../_shared/google-maps.ts";
import type { CacheStore } from "../_shared/serpCache.ts";
import {
  normalizeTollPass, quoteFromRoute, type RateFn, readCachedTolls, saveCachedTolls, TOLL_FIELDS, tollLine, tollsCacheKey, type TollQuote, TOLLS_SKU, toMxn, withTolls,
} from "../_shared/google-tolls.ts";
import type { Waypoint } from "../_shared/google-routes.ts";

export type Point = { lat?: number; lng?: number; placeId?: string; address?: string };
export type Mode = "DRIVE" | "TRANSIT" | "WALK" | "BICYCLE";

export type Body = {
  origin: Point;
  destination: Point;
  modes?: Mode[]; // default: los 4
  language?: string;
  units?: "METRIC" | "IMPERIAL";
  departureTime?: string; // ISO; útil para TRANSIT/DRIVE con tráfico
  /** Pase de casetas de la lista oficial de Google (p. ej. "MX_TAG_IAVE"). Solo modo coche. */
  tollPass?: string;
};

export const ALL_MODES: Mode[] = ["DRIVE", "TRANSIT", "WALK", "BICYCLE"];

export function waypoint(p: Point) {
  if (p.placeId) return { placeId: p.placeId };
  if (typeof p.lat === "number" && typeof p.lng === "number") {
    return { location: { latLng: { latitude: p.lat, longitude: p.lng } } };
  }
  if (p.address) return { address: p.address };
  return null;
}

/** El mismo punto en el formato de google-routes (para la llave de la caché de casetas). */
function asWaypoint(p: Point): Waypoint | null {
  if (p.placeId) return { placeId: p.placeId };
  if (typeof p.lat === "number" && typeof p.lng === "number") return { lat: p.lat, lng: p.lng };
  if (p.address) return { address: p.address };
  return null;
}

function mapsLink(origin: Point, destination: Point, mode: Mode): string {
  const travel = mode === "DRIVE" ? "driving" : mode === "TRANSIT" ? "transit" : mode === "WALK" ? "walking" : "bicycling";
  const o = typeof origin.lat === "number" ? `${origin.lat},${origin.lng}` : encodeURIComponent(origin.address ?? "");
  const d = typeof destination.lat === "number" ? `${destination.lat},${destination.lng}` : encodeURIComponent(destination.address ?? "");
  const placeIds =
    (origin.placeId ? `&origin_place_id=${encodeURIComponent(origin.placeId)}` : "") +
    (destination.placeId ? `&destination_place_id=${encodeURIComponent(destination.placeId)}` : "");
  return `https://www.google.com/maps/dir/?api=1&origin=${o}&destination=${d}&travelmode=${travel}${placeIds}`;
}

const BASE_MASK = [
  "routes.duration",
  "routes.distanceMeters",
  "routes.description",
  "routes.legs.duration",
  "routes.legs.distanceMeters",
  "routes.legs.steps.distanceMeters",
  "routes.legs.steps.staticDuration",
  "routes.legs.steps.navigationInstruction",
  "routes.legs.steps.travelMode",
  "routes.legs.steps.transitDetails",
];

/** Mismo mask para todos los modos (TRANSIT añade transitDetails); en coche con casetas, + tollInfo. */
export function fieldMaskFor(_mode: Mode, tolls = false): string {
  return (tolls ? [...BASE_MASK, ...TOLL_FIELDS] : BASE_MASK).join(",");
}

/** SKU con el que se registra cada llamada (ver google-tolls.ts: casetas al SKU más caro, por prudencia). */
export function skuFor(mode: Mode, tolls: boolean): string {
  if (mode === "DRIVE") return tolls ? TOLLS_SKU : "Compute Routes Pro"; // TRAFFIC_AWARE
  return "Compute Routes Essentials";
}

function parseDurationSec(d: string | number | undefined): number | null {
  if (d == null) return null;
  if (typeof d === "number") return d;
  // formato "123s"
  const m = /^(\d+(\.\d+)?)s$/.exec(d);
  return m ? Math.round(parseFloat(m[1])) : null;
}

function humanDuration(sec: number | null): string | null {
  if (sec == null) return null;
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  if (h && m) return `${h} h ${m} min`;
  if (h) return `${h} h`;
  return `${m} min`;
}

function humanDistance(meters: number | null, units: "METRIC" | "IMPERIAL"): string | null {
  if (meters == null) return null;
  if (units === "IMPERIAL") {
    const mi = meters / 1609.344;
    return mi < 0.1 ? `${Math.round(meters * 3.28084)} ft` : `${mi.toFixed(mi < 10 ? 1 : 0)} mi`;
  }
  return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(meters < 10000 ? 1 : 0)} km`;
}

export type RoutesDeps = {
  /** serp_cache (service_role) para las casetas de 24 h. */
  store?: CacheStore | null;
  /** Tasa a MXN verificable (_shared/fx.ts getRateToMxnInfo). */
  rate?: RateFn | null;
  now?: () => number;
};

export async function computeModeRoute(t: GoogleTransport, mode: Mode, body: Body, deps: RoutesDeps = {}) {
  const origin = waypoint(body.origin);
  const destination = waypoint(body.destination);
  if (!origin || !destination) {
    return { mode, available: false, reason: "origen/destino inválido" };
  }

  const payload: Record<string, unknown> = {
    origin,
    destination,
    travelMode: mode,
    languageCode: body.language ?? "es",
    units: body.units ?? "METRIC",
  };
  if (mode === "DRIVE") payload.routingPreference = "TRAFFIC_AWARE";
  if (mode === "DRIVE" || mode === "TRANSIT") {
    if (body.departureTime) payload.departureTime = body.departureTime;
  }
  if (mode === "TRANSIT") {
    payload.transitPreferences = { routingPreference: "LESS_WALKING" };
  }

  // Casetas: solo en coche. Primero la caché de 24 h; si no hay, se piden en esta misma llamada.
  let cachedTolls: TollQuote | null = null;
  let tollKey: string | null = null;
  const o = asWaypoint(body.origin);
  const d = asWaypoint(body.destination);
  if (mode === "DRIVE" && o && d) {
    tollKey = await tollsCacheKey(o, d, normalizeTollPass(body.tollPass));
    const hit = await readCachedTolls(deps.store, tollKey, (deps.now ?? Date.now)());
    if (hit) cachedTolls = { ...hit.tolls, ...(await toMxn(hit.tolls.montos, deps.rate ?? null)) };
  }
  const askTolls = mode === "DRIVE" && !cachedTolls;
  const req = askTolls ? withTolls(payload, body.tollPass) : payload;

  const res = await googleJson<{ routes?: any[] }>(t, "routes", skuFor(mode, askTolls), "/directions/v2:computeRoutes", {
    body: req,
    fieldMask: fieldMaskFor(mode, askTolls),
  });
  if (!res.ok) {
    const err = callError(res);
    return { mode, available: false, reason: googleErrorMessage(err.kind) };
  }
  const route = res.data?.routes?.[0];
  if (!route) {
    return { mode, available: false, reason: "Sin rutas disponibles para este modo" };
  }

  let tolls: TollQuote | null = null;
  if (mode === "DRIVE") {
    if (cachedTolls) tolls = cachedTolls;
    else {
      tolls = await quoteFromRoute(route, { pase: body.tollPass, rate: deps.rate ?? null, now: deps.now });
      const sec = parseDurationSec(route.duration);
      if (tollKey) await saveCachedTolls(deps.store, tollKey, { tolls: { ...tolls, monto_mxn: null, fx: [] }, distance_meters: typeof route.distanceMeters === "number" ? route.distanceMeters : null, duration_seconds: sec });
    }
  }

  const durSec = parseDurationSec(route.duration);
  const distM = typeof route.distanceMeters === "number" ? route.distanceMeters : null;
  const units = (body.units ?? "METRIC") as "METRIC" | "IMPERIAL";

  const steps: Array<{
    instruction: string | null;
    distance: string | null;
    duration: string | null;
    mode: string;
    transit: null | {
      line: string | null;
      line_short: string | null;
      vehicle: string | null;
      color: string | null;
      headsign: string | null;
      departure_stop: string | null;
      arrival_stop: string | null;
      departure_time: string | null;
      arrival_time: string | null;
      num_stops: number | null;
    };
  }> = [];
  const transitLegs: Array<NonNullable<(typeof steps)[number]["transit"]>> = [];

  for (const leg of route.legs ?? []) {
    for (const s of leg.steps ?? []) {
      let transit = null as (typeof steps)[number]["transit"];
      if (s.transitDetails) {
        const td = s.transitDetails;
        transit = {
          line: td.transitLine?.name ?? null,
          line_short: td.transitLine?.nameShort ?? null,
          vehicle: td.transitLine?.vehicle?.name?.text ?? td.transitLine?.vehicle?.type ?? null,
          color: td.transitLine?.color ?? null,
          headsign: td.headsign ?? null,
          departure_stop: td.stopDetails?.departureStop?.name ?? null,
          arrival_stop: td.stopDetails?.arrivalStop?.name ?? null,
          departure_time: td.stopDetails?.departureTime ?? td.localizedValues?.departureTime?.time?.text ?? null,
          arrival_time: td.stopDetails?.arrivalTime ?? td.localizedValues?.arrivalTime?.time?.text ?? null,
          num_stops: td.stopCount ?? null,
        };
        transitLegs.push(transit);
      }
      steps.push({
        instruction: s.navigationInstruction?.instructions ?? (transit ? `Toma ${transit.line_short ?? transit.line ?? "transporte"} hacia ${transit.headsign ?? transit.arrival_stop ?? ""}` : null),
        distance: humanDistance(typeof s.distanceMeters === "number" ? s.distanceMeters : null, units),
        duration: humanDuration(parseDurationSec(s.staticDuration)),
        mode: s.travelMode ?? mode,
        transit,
      });
    }
  }

  return {
    mode,
    available: true,
    duration_seconds: durSec,
    duration_text: humanDuration(durSec),
    distance_meters: distM,
    distance_text: humanDistance(distM, units),
    description: route.description ?? null,
    transit_summary: mode === "TRANSIT"
      ? {
          transfers: Math.max(0, transitLegs.length - 1),
          lines: transitLegs.map((t) => t.line_short ?? t.line).filter(Boolean),
          stops: transitLegs.map((t) => ({
            line: t.line_short ?? t.line,
            from: t.departure_stop,
            to: t.arrival_stop,
            num_stops: t.num_stops,
          })),
        }
      : null,
    steps: steps.slice(0, 25),
    maps_url: mapsLink(body.origin, body.destination, mode),
    // Solo en coche: casetas reales de Google (o por qué no hay monto). null en los demás modos.
    tolls,
    tolls_text: mode === "DRIVE" ? tollLine(tolls, "America/Mexico_City") : null,
  };
}

/** Las rutas pedidas (por defecto los 4 modos), en paralelo. */
export async function computeRoutes(t: GoogleTransport, body: Body, deps: RoutesDeps = {}) {
  const modes = (body.modes?.length ? body.modes : ALL_MODES).filter((m) => ALL_MODES.includes(m));
  return Promise.all(modes.map(async (m) => {
    try {
      return await computeModeRoute(t, m, body, deps);
    } catch {
      return { mode: m, available: false, reason: "No pudimos consultar Google Maps en este momento. Intenta más tarde." };
    }
  }));
}
