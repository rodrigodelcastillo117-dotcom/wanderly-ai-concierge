// Clima de MET Norway (Instituto Meteorológico de Noruega) para toda la app: pronóstico por día, "Hoy",
// el clima de Inicio y del Concierge, y el viento y la lluvia de las próximas horas del radar.
//
// FUENTE Y TÉRMINOS (consultados el 23-oct-2026):
//  - Locationforecast 2.0, endpoint "complete": https://api.met.no/weatherapi/locationforecast/2.0/documentation
//  - Licencia: CC BY 4.0 / NLOD (uso comercial permitido, con atribución "Datos: MET Norway"):
//    https://api.met.no/doc/License
//  - Términos: https://api.met.no/doc/TermsOfService . Hay que identificarse: desde el navegador (peticiones
//    CORS de JavaScript) MET acepta el encabezado Origin que manda el navegador, así que no hace falta una
//    Edge Function con User-Agent propio. Máximo 4 decimales en lat/lon (si no, 403). No pedir de más: se
//    guarda en memoria hasta el `Expires` que manda MET (≈30 min) y una sola petición sirve a todas las
//    pantallas para el mismo punto.
//  - Sin llave. Da unos 9–10 días: horario los primeros ~2.5 días y después cada 6 h.
// Reemplaza a Open-Meteo gratis, que solo permite uso NO comercial (https://open-meteo.com/en/terms).

export const MET_ATTRIBUTION = { label: "Datos: MET Norway (CC BY 4.0)", href: "https://api.met.no/doc/License" } as const;

/** MET pide como máximo 4 decimales. */
export const round4 = (v: number) => Math.round(v * 10000) / 10000;

type Entry = { time: string; data: any };
export type MetForecast = { timeseries: Entry[]; updatedAt: string | null };

const cache = new Map<string, { at: number; until: number; p: Promise<MetForecast | null> }>();
const DEFAULT_TTL_MS = 30 * 60_000;

/** Pronóstico de un punto (con caché en memoria hasta el Expires de MET). null si falla. */
export function fetchMetForecast(lat: number, lng: number, fetchImpl: typeof fetch = fetch, now = Date.now()): Promise<MetForecast | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return Promise.resolve(null);
  const key = `${round4(lat)},${round4(lng)}`;
  const hit = cache.get(key);
  if (hit && now < hit.until) return hit.p;
  const entry = { at: now, until: now + DEFAULT_TTL_MS, p: Promise.resolve<MetForecast | null>(null) };
  entry.p = (async () => {
    try {
      const r = await fetchImpl(`https://api.met.no/weatherapi/locationforecast/2.0/complete?lat=${round4(lat)}&lon=${round4(lng)}`);
      if (!r.ok) throw new Error(String(r.status));
      const exp = Date.parse(r.headers?.get?.("expires") ?? "");
      if (Number.isFinite(exp) && exp > now) entry.until = exp;
      const j = await r.json();
      const ts: Entry[] = Array.isArray(j?.properties?.timeseries) ? j.properties.timeseries : [];
      if (!ts.length) throw new Error("vacío");
      return { timeseries: ts, updatedAt: j?.properties?.meta?.updated_at ?? null };
    } catch {
      cache.delete(key);
      return null;
    }
  })();
  cache.set(key, entry);
  return entry.p;
}

/** Solo para pruebas. */
export const __resetMetCache = () => cache.clear();

// ── Símbolos de MET → código tipo WMO que ya usan los iconos y etiquetas de la app ─────────────────
export function metSymbolToCode(symbol: string | null | undefined): number {
  const s = String(symbol ?? "").replace(/_(day|night|polartwilight)$/, "");
  if (!s) return 3;
  if (s.includes("thunder")) return 95;
  if (s.includes("snow")) return s.includes("heavy") ? 75 : s.includes("light") ? 71 : 73;
  if (s.includes("sleet")) return 67;
  if (s.includes("rainshowers")) return s.includes("heavy") ? 82 : s.includes("light") ? 80 : 81;
  if (s.includes("rain")) return s.includes("heavy") ? 65 : s.includes("light") ? 61 : 63;
  if (s === "fog") return 45;
  if (s === "cloudy") return 3;
  if (s === "partlycloudy") return 2;
  if (s === "fair") return 1;
  if (s === "clearsky") return 0;
  return 3;
}

const SEVERITY = (code: number) => (code >= 95 ? 9 : code >= 71 && code <= 77 ? 8 : code >= 80 ? 7 : code >= 61 ? 6 : code >= 51 ? 5 : code === 45 ? 4 : code);

/**
 * Desfase aproximado de la hora local por longitud (sin zona horaria de la ciudad): solo para agrupar
 * las horas por día; un error de 1 h no cambia el máximo ni el mínimo del día.
 */
export const approxOffsetHours = (lng: number) => Math.round(lng / 15);

const localDate = (iso: string, offsetH: number) => new Date(Date.parse(iso) + offsetH * 3600_000).toISOString().slice(0, 10);
const localHour = (iso: string, offsetH: number) => new Date(Date.parse(iso) + offsetH * 3600_000).getUTCHours();

export type MetDay = { date: string; tmax: number; tmin: number; code: number; precipMm: number; windKmh: number };

/**
 * Resumen por día local: máxima/mínima (temperaturas de cada hora y máximos/mínimos de 6 h), lluvia
 * total (sin contar dos veces: bloques de 1 h mientras los hay y de 6 h después), viento máximo y el
 * símbolo más significativo de la parte de día. Solo días con datos de la mañana o la tarde.
 */
export function dailyFromMet(f: MetForecast | null, lng: number): MetDay[] {
  if (!f) return [];
  const off = approxOffsetHours(lng);
  const ts = [...f.timeseries].sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
  type Acc = { temps: number[]; precip: number; wind: number; codes: number[]; daytime: boolean };
  const by = new Map<string, Acc>();
  const acc = (d: string) => { let a = by.get(d); if (!a) { a = { temps: [], precip: 0, wind: 0, codes: [], daytime: false }; by.set(d, a); } return a; };
  let covered = 0;
  ts.forEach((e, i) => {
    const t = Date.parse(e.time);
    const d = localDate(e.time, off);
    const h = localHour(e.time, off);
    const a = acc(d);
    const det = e.data?.instant?.details ?? {};
    if (typeof det.air_temperature === "number") a.temps.push(det.air_temperature);
    if (typeof det.wind_speed === "number") a.wind = Math.max(a.wind, det.wind_speed);
    const n6 = e.data?.next_6_hours;
    const n1 = e.data?.next_1_hours;
    if (typeof n6?.details?.air_temperature_max === "number") a.temps.push(n6.details.air_temperature_max);
    if (typeof n6?.details?.air_temperature_min === "number") a.temps.push(n6.details.air_temperature_min);
    if (h >= 6 && h <= 18) {
      a.daytime = true;
      const sym = n1?.summary?.symbol_code ?? n6?.summary?.symbol_code;
      if (sym) a.codes.push(metSymbolToCode(sym));
    }
    if (t >= covered) {
      const gap = i + 1 < ts.length ? (Date.parse(ts[i + 1].time) - t) / 3600_000 : Infinity;
      if (n1 && gap <= 1) { a.precip += Number(n1.details?.precipitation_amount) || 0; covered = t + 3600_000; }
      else if (n6) { a.precip += Number(n6.details?.precipitation_amount) || 0; covered = t + 6 * 3600_000; }
      else if (n1) { a.precip += Number(n1.details?.precipitation_amount) || 0; covered = t + 3600_000; }
    }
  });
  return [...by.entries()].filter(([, a]) => a.daytime && a.temps.length > 0).map(([date, a]) => ({
    date,
    tmax: Math.round(Math.max(...a.temps)),
    tmin: Math.round(Math.min(...a.temps)),
    code: a.codes.length ? a.codes.reduce((best, c) => (SEVERITY(c) > SEVERITY(best) ? c : best), a.codes[0]) : 3,
    precipMm: Math.round(a.precip * 10) / 10,
    windKmh: Math.round(a.wind * 3.6),
  }));
}

export type MetNow = { tempC: number; code: number; windKmh: number; windFromDeg: number | null };

/** Lo de ahora: la primera hora que no ha pasado (o la última pasada). */
export function nowFromMet(f: MetForecast | null, now = Date.now()): MetNow | null {
  if (!f) return null;
  const ts = [...f.timeseries].sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
  const cur = ts.find((e) => Date.parse(e.time) >= now - 3600_000) ?? ts[ts.length - 1];
  const det = cur?.data?.instant?.details;
  if (typeof det?.air_temperature !== "number") return null;
  const sym = cur.data?.next_1_hours?.summary?.symbol_code ?? cur.data?.next_6_hours?.summary?.symbol_code;
  return {
    tempC: Math.round(det.air_temperature),
    code: metSymbolToCode(sym),
    windKmh: Math.round((Number(det.wind_speed) || 0) * 3.6),
    windFromDeg: typeof det.wind_from_direction === "number" ? det.wind_from_direction : null,
  };
}
