// Clima del viaje por ciudad (pantalla Clima). Lógica pura y con `fetchImpl` inyectable para probarla.
//
// Bug del caso Roma → Florencia → Venecia (23-oct-2026): la sección de Roma mostraba el pronóstico del
// 22 oct al 1 nov completo aunque Roma son 4 noches, porque los hoteles no traen check-in/check-out y se
// usaba el rango de todo el viaje para cada ciudad. Ahora cada ciudad usa sus noches (cityStays, el mismo
// reparto que "Comprar" y los hoteles por ciudad): Roma 22–25 oct, Florencia 26–28 oct, Venecia 29 oct –
// 1 nov (la última ciudad incluye el día de regreso).
//
// Datos (23-oct-2026, ya sin Open-Meteo, cuya API gratis es solo para uso no comercial): pronóstico y "Hoy"
// de MET Norway (CC BY 4.0, src/lib/metNorway.ts), clima típico del mes de NASA POWER (dominio público,
// src/lib/nasaPower.ts) y coordenadas de la tabla de ciudades o de la función "geocode" (cityLocation.ts).
import { cityStays } from "../../supabase/functions/_shared/booking/tripRoute.ts";
import { diffLocalDays } from "@/lib/localDate";
import { resolveCityLocation, type Geocoder } from "@/lib/cityLocation";
import { approxOffsetHours, dailyFromMet, fetchMetForecast, nowFromMet } from "@/lib/metNorway";
import { fetchMonthlyClimate, MES_LARGO } from "@/lib/nasaPower";

export type CityRange = { city: string; start: string; end: string };

export type DayData = {
  date: string;
  tmax: number;
  tmin: number;
  code: number;
  /** Lluvia del día en mm (MET Norway). */
  precip: number;
  /** Viento máximo, km/h. */
  wind: number;
  source: "forecast";
};

/** Días sin pronóstico todavía (más de ~9 días): el clima típico de ese mes (NASA POWER). */
export type TypicalMonth = { month: number; label: string; days: string[]; tmax: number | null; tmin: number | null; precipMmDay: number | null };

export type CityBlock = CityRange & {
  lat: number;
  lng: number;
  today: { tmax: number; tmin: number; code: number; wind: number; precip: number } | null;
  days: DayData[];
  /** Días del rango que aún no tienen pronóstico, agrupados por mes con su clima típico. */
  typical: TypicalMonth[];
  /** Días del rango que ya pasaron (MET no da datos de días pasados). */
  pastDays: string[];
  sources: Array<"met" | "power">;
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

/** Solo los días de la ciudad: aunque la fuente devuelva más, se filtran al rango. */
export function keepCityDays<T extends { date: string }>(days: T[], range: CityRange): T[] {
  return days.filter((d) => d.date >= range.start && d.date <= range.end);
}

export type WeatherDeps = { fetchImpl?: typeof fetch; geocoder?: Geocoder; now?: Date };

/**
 * Clima de los días de UNA ciudad: pronóstico de MET Norway (≈9 días) y, para los días que aún no tienen
 * pronóstico, el clima típico de ese mes (NASA POWER). Nada se inventa: sin datos, se dice.
 * Fuentes, términos y fechas de consulta: src/lib/metNorway.ts y src/lib/nasaPower.ts.
 */
export async function buildCityWeather(range: CityRange, deps: WeatherDeps = {}): Promise<CityBlock | null> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now ?? new Date();
  const loc = await resolveCityLocation(range.city, deps.geocoder);
  if (!loc) return null;
  const met = await fetchMetForecast(loc.lat, loc.lng, fetchImpl, now.getTime());
  const all = dailyFromMet(met, loc.lng);
  const off = approxOffsetHours(loc.lng);
  const todayLocal = new Date(now.getTime() + off * 3600_000).toISOString().slice(0, 10);
  const cur = nowFromMet(met, now.getTime());
  const td = all.find((d) => d.date === todayLocal);
  const today = cur
    ? { tmax: td?.tmax ?? cur.tempC, tmin: td?.tmin ?? cur.tempC, code: cur.code, wind: cur.windKmh, precip: td?.precipMm ?? 0 }
    : null;

  const days: DayData[] = keepCityDays(all, range).map((d) => ({
    date: d.date, tmax: d.tmax, tmin: d.tmin, code: d.code, precip: d.precipMm, wind: d.windKmh, source: "forecast" as const,
  }));
  const have = new Set(days.map((d) => d.date));
  const rangeDaysList = daysInRange(range.start, range.end);
  const pastDays = rangeDaysList.filter((d) => d < todayLocal && !have.has(d));
  const pending = rangeDaysList.filter((d) => d >= todayLocal && !have.has(d));

  const typical: TypicalMonth[] = [];
  const sources: CityBlock["sources"] = met ? ["met"] : [];
  if (pending.length) {
    const clim = await fetchMonthlyClimate(loc.lat, loc.lng, fetchImpl);
    if (clim) sources.push("power");
    const byMonth = new Map<number, string[]>();
    for (const d of pending) {
      const m = Number(d.slice(5, 7));
      byMonth.set(m, [...(byMonth.get(m) ?? []), d]);
    }
    for (const [m, ds] of byMonth) {
      const c = clim?.find((x) => x.month === m) ?? null;
      typical.push({ month: m, label: MES_LARGO[m - 1], days: ds, tmax: c?.tmax ?? null, tmin: c?.tmin ?? null, precipMmDay: c?.precipMmDay ?? null });
    }
  }
  return { ...range, lat: loc.lat, lng: loc.lng, today, days, typical, pastDays, sources };
}

/** "4 días" del rango de una ciudad. */
export function rangeDays(range: CityRange): number {
  return Math.max(1, diffLocalDays(range.start, range.end) + 1);
}
