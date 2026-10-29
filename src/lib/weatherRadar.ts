// Radar de lluvia animado por ciudad (pantalla Clima del viaje). Solo lógica: teselas, cuadros de tiempo,
// pronóstico inmediato y viento. El componente (WeatherRadar) se carga diferido al abrir el radar.
//
// FUENTES Y TÉRMINOS (consultados el 23-oct-2026):
//  - Precipitación (cuadros animados): NASA GIBS, capa IMERG_Precipitation_Rate_30min (GPM IMERG, estimación
//    por satélite cada 30 min; llega con ~5–7 h de retraso). Datos de misiones de la NASA sin marca de
//    licencia = CC0, uso comercial permitido; la NASA pide reconocerla como fuente y no sugerir respaldo.
//    https://www.earthdata.nasa.gov/engage/open-data-services-software-policies/data-use-guidance
//    https://nasa-gibs.github.io/gibs-api-docs/access-basics/  (WMTS EPSG:3857, sin llave, CORS *)
//  - Mapa base: NASA GIBS BlueMarble_ShadedRelief_Bathymetry y Reference_Features_15m (mismos términos).
//  - Pronóstico inmediato (lluvia hora por hora) y viento: MET Norway Locationforecast 2.0, CC BY 4.0 / NLOD,
//    uso comercial permitido, sin llave. Reglas: identificarse (en el navegador basta el encabezado Origin),
//    no más de 4 decimales en lat/lon, no pedir de más (se pide solo al abrir el radar y se guarda en memoria).
//    https://api.met.no/doc/TermsOfService
//  Descartadas: RainViewer API (gratis "solo para uso personal o educativo"; comercial bajo contrato:
//  https://www.rainviewer.com/api.html), Open-Meteo gratis ("solo fines no comerciales":
//  https://open-meteo.com/en/terms), Windy Map Forecast API (versión Testing "solo desarrollo, no en
//  producción"), OpenWeatherMap (requiere llave de API).

import { fetchMetForecast, __resetMetCache } from "@/lib/metNorway";

export const GIBS_BASE = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best";
export const PRECIP_LAYER = "IMERG_Precipitation_Rate_30min";
/** Nivel máximo de la capa de precipitación (GoogleMapsCompatible_Level6). */
export const RADAR_ZOOM = 6;
export const TILE = 256;
export const FRAME_STEP_MIN = 30;

export const ATTRIBUTION = {
  precip: { label: "Lluvia: NASA GIBS · GPM IMERG (satélite)", href: "https://www.earthdata.nasa.gov/engage/open-data-services-software-policies/data-use-guidance" },
  base: { label: "Mapa: NASA Blue Marble", href: "https://nasa-gibs.github.io/gibs-api-docs/" },
  metno: { label: "Viento y próximas horas: Datos de MET Norway (CC BY 4.0)", href: "https://api.met.no/doc/License" },
} as const;

/** Coordenadas de píxel (mundo) en el nivel z de Web Mercator. */
export function lonLatToPixel(lat: number, lng: number, z: number): { x: number; y: number } {
  const n = TILE * 2 ** z;
  const s = Math.sin((Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI) / 180);
  return { x: ((lng + 180) / 360) * n, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n };
}

export type TileRef = { x: number; y: number; left: number; top: number };

/**
 * Teselas alrededor de la ciudad (cols × rows) y dónde queda la ciudad dentro de esa rejilla, para
 * centrarla en el contenedor sin depender de su ancho.
 */
export function tileGrid(lat: number, lng: number, z = RADAR_ZOOM, cols = 5, rows = 3) {
  const p = lonLatToPixel(lat, lng, z);
  const n = 2 ** z;
  const cx = Math.floor(p.x / TILE);
  const cy = Math.floor(p.y / TILE);
  const x0 = cx - Math.floor(cols / 2);
  const y0 = Math.max(0, Math.min(n - rows, cy - Math.floor(rows / 2)));
  const tiles: TileRef[] = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const x = (((x0 + i) % n) + n) % n;
      tiles.push({ x, y: y0 + j, left: i * TILE, top: j * TILE });
    }
  }
  return { tiles, width: cols * TILE, height: rows * TILE, cityX: p.x - x0 * TILE, cityY: p.y - y0 * TILE, centerTile: { x: cx, y: cy } };
}

export function precipTileUrl(time: string, z: number, x: number, y: number): string {
  return `${GIBS_BASE}/${PRECIP_LAYER}/default/${time}/GoogleMapsCompatible_Level6/${z}/${y}/${x}.png`;
}
export function baseTileUrl(z: number, x: number, y: number): string {
  return `${GIBS_BASE}/BlueMarble_ShadedRelief_Bathymetry/default/default/GoogleMapsCompatible_Level8/${z}/${y}/${x}.jpeg`;
}
export function bordersTileUrl(z: number, x: number, y: number): string {
  return `${GIBS_BASE}/Reference_Features_15m/default/default/GoogleMapsCompatible_Level13/${z}/${y}/${x}.png`;
}

/** "2026-10-22T18:30:00Z": la media hora anterior (o igual) a `d`. */
export function floorHalfHour(d: Date): string {
  const t = Math.floor(d.getTime() / (FRAME_STEP_MIN * 60000)) * FRAME_STEP_MIN * 60000;
  return new Date(t).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** `count` cuadros de 30 min que terminan en `latest` (del más viejo al más nuevo). */
export function frameTimes(latest: string, count = 8): string[] {
  const end = Date.parse(latest);
  if (!Number.isFinite(end)) return [];
  return Array.from({ length: count }, (_, i) => new Date(end - (count - 1 - i) * FRAME_STEP_MIN * 60000).toISOString().replace(/\.\d{3}Z$/, "Z"));
}

/**
 * Último cuadro publicado: IMERG llega con retraso (horas), así que se prueban las medias horas desde
 * `now - minLagHours` hacia atrás (en paralelo) y se queda la más reciente que exista. null si ninguna.
 */
export async function findLatestFrame(probe: (time: string) => Promise<boolean>, now: Date = new Date(), opts: { minLagHours?: number; steps?: number } = {}): Promise<string | null> {
  const lag = opts.minLagHours ?? 3;
  const steps = opts.steps ?? 16;
  const first = floorHalfHour(new Date(now.getTime() - lag * 3600_000));
  const candidates = frameTimes(first, steps).reverse(); // del más nuevo al más viejo
  const ok = await Promise.all(candidates.map((t) => probe(t).catch(() => false)));
  const i = ok.findIndex(Boolean);
  return i >= 0 ? candidates[i] : null;
}

/**
 * Último cuadro que GIBS ya publicó, según su DescribeDomains (rangos de tiempo disponibles de la capa).
 * Antes se "adivinaba" probando 16 medias horas desde hace 3 h, y como IMERG llega con ~6 h de retraso
 * la mitad respondía 404 y el navegador lo marcaba en rojo (auditoría 10/10, P2-11). Así no se pide
 * ningún cuadro que no exista. Verificado el 28-oct-2026: responde 200 con CORS *, p. ej.
 * <Domain>2026-10-27/2026-10-28T16:30:00Z/PT30M</Domain>.
 */
export function domainsUrl(now: Date = new Date()): string {
  const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z");
  const from = new Date(now.getTime() - 2 * 86400_000), to = new Date(now.getTime() + 3600_000);
  return `${GIBS_BASE}/1.0.0/${PRECIP_LAYER}/default/GoogleMapsCompatible_Level6/all/${iso(from)}--${iso(to)}.xml`;
}

/** Fin más reciente de los rangos de <Domain> ("inicio/fin/PT30M,…" o fechas sueltas), alineado a 30 min. */
export function latestFromDomains(xml: string): string | null {
  const m = /<Domain>([^<]+)<\/Domain>/.exec(String(xml ?? ""));
  if (!m) return null;
  let best = -Infinity;
  for (const part of m[1].split(",")) {
    const pieces = part.trim().split("/");
    const end = pieces.length >= 2 ? pieces[1] : pieces[0];
    const t = Date.parse(/T/.test(end) ? end : `${end}T00:00:00Z`);
    if (Number.isFinite(t) && t > best) best = t;
  }
  return Number.isFinite(best) ? floorHalfHour(new Date(best)) : null;
}

/** Último cuadro publicado (DescribeDomains). null si no se pudo saber (entonces se prueba con cuidado). */
export async function fetchLatestFrame(fetchImpl: typeof fetch = fetch, now: Date = new Date()): Promise<string | null> {
  try {
    const r = await fetchImpl(domainsUrl(now));
    if (!r.ok) return null;
    return latestFromDomains(await r.text());
  } catch {
    return null;
  }
}

export type NowcastHour = { time: string; precipMm: number | null };
export type Nowcast = { windMs: number | null; windFromDeg: number | null; hours: NowcastHour[] };

export { round4 } from "@/lib/metNorway";

/**
 * Viento actual y lluvia de las próximas `hours` horas (MET Norway Locationforecast 2.0). Usa la misma
 * petición (y caché) que el pronóstico de la pantalla: no se pide dos veces el mismo punto.
 */
export async function fetchNowcast(lat: number, lng: number, fetchImpl: typeof fetch = fetch, now: Date = new Date(), hours = 6): Promise<Nowcast | null> {
  const f = await fetchMetForecast(lat, lng, fetchImpl, now.getTime());
  return f ? parseNowcast({ properties: { timeseries: f.timeseries } }, now, hours) : null;
}

export function parseNowcast(json: any, now: Date = new Date(), hours = 6): Nowcast | null {
  const ts: any[] = Array.isArray(json?.properties?.timeseries) ? json.properties.timeseries : [];
  if (!ts.length) return null;
  const from = now.getTime() - 3600_000;
  const upcoming = ts.filter((t) => Date.parse(t?.time) >= from);
  const cur = upcoming[0] ?? ts[0];
  const d = cur?.data?.instant?.details ?? {};
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return {
    windMs: num(d.wind_speed),
    windFromDeg: num(d.wind_from_direction),
    hours: upcoming.filter((t) => t?.data?.next_1_hours).slice(0, hours)
      .map((t) => ({ time: String(t.time), precipMm: num(t.data.next_1_hours?.details?.precipitation_amount) })),
  };
}

const DIRS = ["N", "NE", "E", "SE", "S", "SO", "O", "NO"];
/** "del NO" a partir de la dirección de donde sopla (grados, 0 = norte). */
export function windFromLabel(deg: number | null): string | null {
  if (deg == null || !Number.isFinite(deg)) return null;
  return `del ${DIRS[Math.round((((deg % 360) + 360) % 360) / 45) % 8]}`;
}

/** Vector en pantalla (hacia dónde va el viento), unitario: x a la derecha, y hacia abajo. */
export function windVector(fromDeg: number): { dx: number; dy: number } {
  const to = ((fromDeg + 180) * Math.PI) / 180;
  return { dx: Math.sin(to), dy: -Math.cos(to) };
}

/** Solo para pruebas. */
export const __resetNowcastCache = () => __resetMetCache();
