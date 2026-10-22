// Routes API: tiempos puerta a puerta reales (auto, transporte público, caminando, bici) con
// computeRoutes y computeRouteMatrix. Sin dependencias de Deno (se prueba con Vitest).
//
// Costo (https://developers.google.com/maps/documentation/routes/usage-and-billing, consultado
// 2026-10-22): por defecto se pide la ruta SIN tráfico en tiempo real (SKU Essentials, 10,000 gratis
// al mes). Con `trafficAware: true` se usa TRAFFIC_AWARE (SKU Pro): solo para "salgo ahora".
// La matriz se cobra por elemento (orígenes × destinos) y tiene límites por petición (625; 100 en
// transporte público).
// Caché: los términos de Google restringen guardar contenido de Routes; aquí solo se juntan
// peticiones idénticas en curso. Si Google no responde, `estimatedLeg` da una aproximación por
// línea recta SIEMPRE etiquetada ESTIMADO (nunca se presenta como dato de Google).
import { callError, coalesce, type GoogleError, type GoogleTransport, googleJson } from "./google-maps.ts";
import { haversineKm } from "./geo-distance.ts";

export type TravelMode = "DRIVE" | "TRANSIT" | "WALK" | "BICYCLE";
export type Waypoint = { lat: number; lng: number } | { placeId: string } | { address: string };

export function waypointBody(w: Waypoint | null | undefined): Record<string, unknown> | null {
  if (!w || typeof w !== "object") return null;
  if ("placeId" in w && typeof w.placeId === "string" && w.placeId.trim()) return { placeId: w.placeId.replace(/^places\//, "") };
  if ("lat" in w && Number.isFinite(w.lat) && Number.isFinite(w.lng)) return { location: { latLng: { latitude: w.lat, longitude: w.lng } } };
  if ("address" in w && typeof w.address === "string" && w.address.trim()) return { address: w.address.trim().slice(0, 300) };
  return null;
}

/** "1234s" → 1234; null si no se entiende. */
export function parseDuration(d: unknown): number | null {
  if (typeof d === "number" && Number.isFinite(d)) return Math.round(d);
  const m = /^(\d+(?:\.\d+)?)s$/.exec(String(d ?? ""));
  return m ? Math.round(parseFloat(m[1])) : null;
}

export function durationText(sec: number | null): string | null {
  if (sec === null) return null;
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  if (h && m) return `${h} h ${m} min`;
  if (h) return `${h} h`;
  return `${Math.max(1, m)} min`;
}

export function distanceText(meters: number | null): string | null {
  if (meters === null) return null;
  return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(meters < 10000 ? 1 : 0)} km`;
}

const TRAVEL: Record<TravelMode, string> = { DRIVE: "driving", TRANSIT: "transit", WALK: "walking", BICYCLE: "bicycling" };

/** Liga a Google Maps con la ruta (no cuesta nada: la abre el usuario). */
export function mapsDirectionsUrl(origin: Waypoint, destination: Waypoint, mode: TravelMode): string {
  const fmt = (w: Waypoint) => ("lat" in w ? `${w.lat},${w.lng}` : "address" in w ? w.address : "");
  const p = new URLSearchParams({ api: "1", origin: fmt(origin), destination: fmt(destination), travelmode: TRAVEL[mode] });
  if ("placeId" in origin) p.set("origin_place_id", origin.placeId);
  if ("placeId" in destination) p.set("destination_place_id", destination.placeId);
  return `https://www.google.com/maps/dir/?${p.toString()}`;
}

export type RouteLeg =
  | {
    ok: true;
    mode: TravelMode;
    duration_seconds: number;
    duration_text: string;
    distance_meters: number | null;
    distance_text: string | null;
    /** "google_routes" = Google lo calculó; "estimado_linea_recta" = aproximación nuestra. */
    fuente: "google_routes" | "estimado_linea_recta";
    estado_dato: "CONSULTADO_EN_VIVO" | "ESTIMADO";
    consultado_at: string | null;
    /** Con tráfico en tiempo real (solo si se pidió trafficAware). */
    con_trafico: boolean;
    maps_url: string;
    nota: string | null;
  }
  | { ok: false; mode: TravelMode; error: GoogleError };

export type RouteRequest = {
  origin: Waypoint;
  destination: Waypoint;
  mode?: TravelMode;
  /** Tráfico en tiempo real (SKU Pro). Default false (Essentials). */
  trafficAware?: boolean;
  /** ISO; para TRANSIT (horarios) o DRIVE con tráfico. */
  departureTime?: string;
  language?: string;
};

export const ROUTE_FIELD_MASK = "routes.duration,routes.staticDuration,routes.distanceMeters";

export function routeSku(mode: TravelMode, trafficAware: boolean): string {
  return mode === "DRIVE" && trafficAware ? "Compute Routes Pro" : "Compute Routes Essentials";
}

/** Cuerpo de computeRoutes (exportado para probar lo que se manda y el SKU que implica). */
export function routeBody(r: RouteRequest): Record<string, unknown> | null {
  const origin = waypointBody(r.origin);
  const destination = waypointBody(r.destination);
  if (!origin || !destination) return null;
  const mode = r.mode ?? "DRIVE";
  const body: Record<string, unknown> = { origin, destination, travelMode: mode, languageCode: r.language ?? "es", units: "METRIC" };
  if (mode === "DRIVE") body.routingPreference = r.trafficAware ? "TRAFFIC_AWARE" : "TRAFFIC_UNAWARE";
  if (r.departureTime && (mode === "TRANSIT" || (mode === "DRIVE" && r.trafficAware))) body.departureTime = r.departureTime;
  return body;
}

export async function computeRoute(t: GoogleTransport, r: RouteRequest, o: { now?: () => number } = {}): Promise<RouteLeg> {
  const mode = r.mode ?? "DRIVE";
  const body = routeBody(r);
  if (!body) return { ok: false, mode, error: { kind: "invalid_request", status: 400, message: "origen o destino inválido" } };
  const sku = routeSku(mode, !!r.trafficAware);
  return coalesce(`route|${JSON.stringify(body)}`, async (): Promise<RouteLeg> => {
    const res = await googleJson<{ routes?: any[] }>(t, "routes", sku, "/directions/v2:computeRoutes", { body, fieldMask: ROUTE_FIELD_MASK });
    if (!res.ok) return { ok: false, mode, error: callError(res) };
    const route = res.data?.routes?.[0];
    // Sin tráfico, `duration` ya es el tiempo sin tráfico; con tráfico es el tiempo con tráfico.
    const sec = parseDuration(route?.duration) ?? parseDuration(route?.staticDuration);
    if (!route || sec === null) return { ok: false, mode, error: { kind: "not_found", status: 200, message: "Google no encontró ruta para este modo" } };
    const meters = typeof route.distanceMeters === "number" ? route.distanceMeters : null;
    return {
      ok: true, mode,
      duration_seconds: sec, duration_text: durationText(sec)!,
      distance_meters: meters, distance_text: distanceText(meters),
      fuente: "google_routes", estado_dato: "CONSULTADO_EN_VIVO",
      consultado_at: new Date((o.now ?? Date.now)()).toISOString(),
      con_trafico: mode === "DRIVE" && !!r.trafficAware,
      maps_url: mapsDirectionsUrl(r.origin, r.destination, mode),
      nota: mode === "DRIVE" && !r.trafficAware ? "Tiempo de manejo sin tráfico en tiempo real (Google Maps)." : null,
    };
  });
}

// ─── Matriz ───

export type MatrixElement = {
  origin_index: number;
  destination_index: number;
  ok: boolean;
  duration_seconds: number | null;
  duration_text: string | null;
  distance_meters: number | null;
};

export type MatrixResult =
  | { ok: true; mode: TravelMode; elements: MatrixElement[]; fuente: "google_routes"; estado_dato: "CONSULTADO_EN_VIVO"; consultado_at: string; sku: string; billed_elements: number }
  | { ok: false; mode: TravelMode; error: GoogleError };

export const MATRIX_FIELD_MASK = "originIndex,destinationIndex,status,condition,distanceMeters,duration";
export const MATRIX_MAX_ELEMENTS = 625;
export const MATRIX_MAX_ELEMENTS_TRANSIT = 100;

/** Matriz de tiempos (p. ej. hotel → cada actividad del día). Se cobra por elemento. */
export async function computeRouteMatrix(
  t: GoogleTransport,
  r: { origins: Waypoint[]; destinations: Waypoint[]; mode?: TravelMode; trafficAware?: boolean; departureTime?: string; language?: string },
  o: { now?: () => number } = {},
): Promise<MatrixResult> {
  const mode = r.mode ?? "DRIVE";
  const origins = (r.origins ?? []).map(waypointBody);
  const destinations = (r.destinations ?? []).map(waypointBody);
  const n = origins.length * destinations.length;
  const max = mode === "TRANSIT" ? MATRIX_MAX_ELEMENTS_TRANSIT : MATRIX_MAX_ELEMENTS;
  if (!n || origins.some((x) => !x) || destinations.some((x) => !x)) {
    return { ok: false, mode, error: { kind: "invalid_request", status: 400, message: "orígenes o destinos inválidos" } };
  }
  if (n > max) return { ok: false, mode, error: { kind: "invalid_request", status: 400, message: `máximo ${max} elementos por consulta` } };
  const body: Record<string, unknown> = {
    origins: origins.map((w) => ({ waypoint: w })),
    destinations: destinations.map((w) => ({ waypoint: w })),
    travelMode: mode,
    languageCode: r.language ?? "es",
  };
  if (mode === "DRIVE") body.routingPreference = r.trafficAware ? "TRAFFIC_AWARE" : "TRAFFIC_UNAWARE";
  if (r.departureTime && (mode === "TRANSIT" || (mode === "DRIVE" && r.trafficAware))) body.departureTime = r.departureTime;
  const sku = mode === "DRIVE" && r.trafficAware ? "Compute Route Matrix Pro" : "Compute Route Matrix Essentials";
  return coalesce(`matrix|${JSON.stringify(body)}`, async (): Promise<MatrixResult> => {
    const res = await googleJson<any[]>(t, "routes", sku, "/distanceMatrix/v2:computeRouteMatrix", { body, fieldMask: MATRIX_FIELD_MASK });
    if (!res.ok) return { ok: false, mode, error: callError(res) };
    const rows = Array.isArray(res.data) ? res.data : [];
    const elements: MatrixElement[] = rows.map((e: any) => {
      const sec = parseDuration(e?.duration);
      const ok = (e?.condition ?? "ROUTE_EXISTS") === "ROUTE_EXISTS" && !e?.status?.code && sec !== null;
      return {
        origin_index: Number(e?.originIndex ?? 0),
        destination_index: Number(e?.destinationIndex ?? 0),
        ok,
        duration_seconds: ok ? sec : null,
        duration_text: ok ? durationText(sec) : null,
        distance_meters: ok && typeof e?.distanceMeters === "number" ? e.distanceMeters : null,
      };
    }).sort((a, b) => a.origin_index - b.origin_index || a.destination_index - b.destination_index);
    return {
      ok: true, mode, elements, fuente: "google_routes", estado_dato: "CONSULTADO_EN_VIVO",
      consultado_at: new Date((o.now ?? Date.now)()).toISOString(), sku, billed_elements: n,
    };
  });
}

// ─── Respaldo honesto ───

/** Factor carretera/ciudad y velocidad media por modo, para la aproximación por línea recta. */
const ESTIMATE: Record<TravelMode, { factor: number; kmh: number; extraMin: number }> = {
  DRIVE: { factor: 1.3, kmh: 60, extraMin: 5 },
  TRANSIT: { factor: 1.4, kmh: 22, extraMin: 10 },
  WALK: { factor: 1.25, kmh: 4.5, extraMin: 0 },
  BICYCLE: { factor: 1.3, kmh: 14, extraMin: 0 },
};

/** Aproximación por línea recta, etiquetada ESTIMADO. null sin coordenadas. */
export function estimatedLeg(a: { lat: number; lng: number } | null, b: { lat: number; lng: number } | null, mode: TravelMode = "DRIVE"): RouteLeg | null {
  if (!a || !b || ![a.lat, a.lng, b.lat, b.lng].every(Number.isFinite)) return null;
  const e = ESTIMATE[mode];
  const km = haversineKm(a, b) * e.factor;
  const sec = Math.round(((km / e.kmh) * 60 + e.extraMin) * 60);
  const meters = Math.round(km * 1000);
  return {
    ok: true, mode,
    duration_seconds: sec, duration_text: `~${durationText(sec)}`,
    distance_meters: meters, distance_text: `~${distanceText(meters)}`,
    fuente: "estimado_linea_recta", estado_dato: "ESTIMADO", consultado_at: null, con_trafico: false,
    maps_url: mapsDirectionsUrl(a, b, mode),
    nota: "Tiempo aproximado (distancia en línea recta); Google Maps no respondió. Verifícalo en el mapa.",
  };
}

/**
 * Tiempo real de Google si se puede; si no, la aproximación ESTIMADO (si hay coordenadas); si no,
 * el error tal cual (quien llama dice "no disponible").
 */
export async function travelTime(
  t: GoogleTransport | null, r: RouteRequest,
  coords?: { origin?: { lat: number; lng: number } | null; destination?: { lat: number; lng: number } | null },
): Promise<RouteLeg> {
  const mode = r.mode ?? "DRIVE";
  const real = t ? await computeRoute(t, r) : null;
  if (real?.ok) return real;
  const pick = (w: Waypoint, c?: { lat: number; lng: number } | null) => c ?? ("lat" in w ? w : null);
  const est = estimatedLeg(pick(r.origin, coords?.origin), pick(r.destination, coords?.destination), mode);
  if (est) return est;
  return real ?? { ok: false, mode, error: { kind: "error", status: 0, message: "Google Maps no está configurado" } };
}
