// Clima del viaje por ciudad (pantalla Clima). Lógica pura y con `fetchImpl` inyectable para probarla.
//
// Bug del caso Roma → Florencia → Venecia (23-oct-2026): la sección de Roma mostraba el pronóstico del
// 22 oct al 1 nov completo aunque Roma son 4 noches, porque los hoteles no traen check-in/check-out y se
// usaba el rango de todo el viaje para cada ciudad. Ahora cada ciudad usa sus noches (cityStays, el mismo
// reparto que "Comprar" y los hoteles por ciudad): Roma 22–25 oct, Florencia 26–28 oct, Venecia 29 oct –
// 1 nov (la última ciudad incluye el día de regreso).
import { cityStays } from "../../supabase/functions/_shared/booking/tripRoute.ts";
import { daysFromToday, diffLocalDays } from "@/lib/localDate";

export type CityRange = { city: string; start: string; end: string };

export type DayData = {
  date: string;
  tmax: number;
  tmin: number;
  code: number;
  /** % de probabilidad (pronóstico) o mm (histórico). */
  precip: number;
  wind: number;
  source: "forecast" | "historical";
};

export type CityBlock = CityRange & {
  today: { tmax: number; tmin: number; code: number; wind: number; precip: number } | null;
  days: DayData[];
};

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const isIso = (v: unknown): v is string => typeof v === "string" && ISO.test(v);

/** "2026-10-26" + n días, sin zona horaria. */
export function addDaysIso(iso: string, n: number): string {
  const t = Date.parse(`${iso}T00:00:00Z`) + n * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

/** Días (YYYY-MM-DD) de start a end, ambos incluidos. */
export function daysInRange(start: string, end: string): string[] {
  const out: string[] = [];
  if (!isIso(start) || !isIso(end) || end < start) return out;
  for (let d = start; d <= end && out.length < 62; d = addDaysIso(d, 1)) out.push(d);
  return out;
}

/**
 * Ciudades del viaje con SUS días. Multi-destino: las noches de cada ciudad (cityStays): del check-in al
 * día antes del check-out (ese día ya duermes en la siguiente); la última ciudad hasta el regreso.
 * Un destino: las fechas del hotel si las trae, o las del viaje.
 */
export function cityWeatherRanges(trip: any): CityRange[] {
  if (!trip) return [];
  const stays = cityStays(trip);
  if (stays.length) {
    return stays.map((s, i) => {
      const last = i === stays.length - 1;
      const end = last ? s.checkout : addDaysIso(s.checkout, -1);
      return { city: s.city, start: s.checkin, end: end < s.checkin ? s.checkin : end };
    });
  }
  const map = new Map<string, { start: string; end: string }>();
  const hosp: any[] = Array.isArray(trip.hospedaje_json) ? trip.hospedaje_json : [];
  for (const h of hosp) {
    const c = String(h?.ciudad ?? h?.city ?? "").trim();
    const ci = h?.check_in ?? h?.entrada ?? h?.fecha_entrada ?? trip.fecha_salida;
    const co = h?.check_out ?? h?.salida ?? h?.fecha_salida ?? trip.fecha_regreso;
    if (!c || !isIso(ci) || !isIso(co)) continue;
    const cur = map.get(c);
    map.set(c, cur ? { start: ci < cur.start ? ci : cur.start, end: co > cur.end ? co : cur.end } : { start: ci, end: co });
  }
  if (map.size === 0 && isIso(trip.fecha_salida) && isIso(trip.fecha_regreso)) {
    const list: string[] = Array.isArray(trip.ciudades) && trip.ciudades.length ? trip.ciudades : String(trip.destino ?? "").split(/[,&]| y /);
    for (const c of list) {
      const cc = String(c ?? "").trim();
      if (cc) map.set(cc, { start: trip.fecha_salida, end: trip.fecha_regreso });
    }
  }
  return Array.from(map.entries()).map(([city, r]) => ({ city, ...r }));
}

type Fetch = (url: string) => Promise<{ json(): Promise<any> }>;

async function getJson(fetchImpl: Fetch, url: string): Promise<any> {
  try { return await (await fetchImpl(url)).json(); } catch { return null; }
}

/** Solo los días de la ciudad: aunque la API devuelva más, se filtran al rango. */
export function keepCityDays(days: DayData[], range: CityRange): DayData[] {
  return days.filter((d) => d.date >= range.start && d.date <= range.end);
}

/**
 * Pronóstico (si las fechas caen en los próximos 16 días) o clima esperado (mismas fechas del año
 * anterior) para los días de UNA ciudad. Usa los servicios que ya usaba la pantalla (Open-Meteo).
 */
export async function buildCityWeather(range: CityRange, fetchImpl: Fetch = fetch as any, now: Date = new Date()): Promise<CityBlock | null> {
  const g = await getJson(fetchImpl, `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(range.city)}&count=1`);
  const loc = g?.results?.[0];
  if (!loc) return null;

  const todayRes = await getJson(fetchImpl,
    `https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}&current=temperature_2m,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&forecast_days=1&timezone=auto`);
  const today = todayRes?.current
    ? {
        tmax: Math.round(todayRes.daily?.temperature_2m_max?.[0] ?? todayRes.current.temperature_2m),
        tmin: Math.round(todayRes.daily?.temperature_2m_min?.[0] ?? todayRes.current.temperature_2m),
        code: todayRes.current.weather_code ?? 0,
        wind: Math.round(todayRes.current.wind_speed_10m ?? 0),
        precip: todayRes.daily?.precipitation_probability_max?.[0] ?? 0,
      }
    : null;

  const untilStart = daysFromToday(range.start, now) ?? 0;
  const untilEnd = daysFromToday(range.end, now) ?? 0;
  const days: DayData[] = [];
  if (untilStart <= 16 && untilEnd <= 16) {
    const f = await getJson(fetchImpl,
      `https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max&start_date=${range.start}&end_date=${range.end}&timezone=auto`);
    (f?.daily?.time ?? []).forEach((d: string, i: number) => days.push({
      date: d,
      tmax: Math.round(f.daily.temperature_2m_max[i]),
      tmin: Math.round(f.daily.temperature_2m_min[i]),
      code: f.daily.weather_code[i] ?? 0,
      precip: f.daily.precipitation_probability_max?.[i] ?? 0,
      wind: Math.round(f.daily.wind_speed_10m_max?.[i] ?? 0),
      source: "forecast",
    }));
  } else {
    const back = (iso: string) => `${Number(iso.slice(0, 4)) - 1}${iso.slice(4)}`;
    const h = await getJson(fetchImpl,
      `https://archive-api.open-meteo.com/v1/archive?latitude=${loc.latitude}&longitude=${loc.longitude}&start_date=${back(range.start)}&end_date=${back(range.end)}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max&timezone=auto`);
    const year = range.start.slice(0, 4);
    const nextYear = String(Number(year) + 1);
    (h?.daily?.time ?? []).forEach((d: string, i: number) => {
      // Mismas fechas del año anterior, re-mapeadas al año del viaje (un viaje que cruza el año nuevo
      // conserva enero en el año siguiente).
      const mapped = `${d.slice(0, 4) === String(Number(year) - 1) ? year : nextYear}${d.slice(4)}`;
      days.push({
        date: mapped,
        tmax: Math.round(h.daily.temperature_2m_max[i]),
        tmin: Math.round(h.daily.temperature_2m_min[i]),
        code: h.daily.weather_code[i] ?? 0,
        precip: Math.round(h.daily.precipitation_sum?.[i] ?? 0),
        wind: Math.round(h.daily.wind_speed_10m_max?.[i] ?? 0),
        source: "historical",
      });
    });
  }
  return { ...range, today, days: keepCityDays(days, range) };
}

/** "4 días" del rango de una ciudad. */
export function rangeDays(range: CityRange): number {
  return Math.max(1, diffLocalDays(range.start, range.end) + 1);
}
