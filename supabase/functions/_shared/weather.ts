// Herramienta de clima de Iato (concierge-chat: get_weather). Usa la MISMA fuente y el MISMO cálculo
// que la pantalla Clima de la app (src/lib/tripWeather.ts): pronóstico de MET Norway (≈9 días) y, para
// fechas más lejanas, el clima típico del mes de NASA POWER (climatología 2001–2025). E2E 28-oct-2026:
// Iato decía "No tengo una herramienta de pronóstico del clima" y, con el viaje elegido, adivinaba
// "13–15 °C / 4–6 °C" para Madrid en marzo cuando la pantalla Clima decía 14°/2° (NASA POWER).
// Sin Deno: la red llega por parámetro (Vitest la simula).
//
// MET Norway desde un servidor exige identificarse con User-Agent (https://api.met.no/doc/TermsOfService)
// y máximo 4 decimales; NASA POWER no pide llave. Cada respuesta lleva su fuente y la hora de consulta.
import { cityAirports } from "./airports.ts";
import { formatLocalStamp, longDay } from "./localTime.ts";
import {
  approxOffsetHours, dailyFromMet, MES_LARGO, MET_ATTRIBUTION, type MetForecast, parsePowerClimatology, POWER_ATTRIBUTION, round4,
} from "./weatherCore.ts";

export const WEATHER_USER_AGENT = "IATOS-Concierge/2.0 (hola@traveliatos.life)";

export type WeatherDeps = {
  fetchImpl: typeof fetch;
  /** Coordenadas de una ciudad que no está en la tabla (la función geocode de la app, con Google). */
  geocode?: (city: string) => Promise<{ lat: number; lng: number } | null>;
  now?: () => number;
  timeoutMs?: number;
  /** Zona horaria del usuario (IANA): la hora de consulta se entrega ya escrita en ella (N2). */
  userTz?: string | null;
};

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const isIso = (v: unknown): v is string => typeof v === "string" && ISO.test(v);
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/**
 * Cielo del DÍA para Iato con la lluvia acumulada (ola 9.5): "chubascos" con 0.1 mm en todo el día se leía
 * como un día lluvioso ("se esperan chubascos… lluvia de apenas 0.1 mm"). Con menos de 1 mm es "chubascos
 * aislados"; la pantalla Clima no usa esta función.
 */
export function dayskyLabel(code: number, precipMm: number | null | undefined): string {
  const label = skyLabel(code);
  if (typeof precipMm === "number" && precipMm < 1 && (label === "chubascos" || label === "lluvia" || label === "lluvia ligera")) return "chubascos aislados";
  return label;
}

/** Cielo en palabras a partir del código tipo WMO de metSymbolToCode. */
export function skyLabel(code: number): string {
  if (code >= 95) return "tormenta";
  if (code >= 80) return "chubascos";
  if (code >= 71 && code <= 77) return "nieve";
  if (code === 67) return "aguanieve";
  if (code >= 61) return code >= 65 ? "lluvia fuerte" : code >= 63 ? "lluvia" : "lluvia ligera";
  if (code === 45) return "niebla";
  if (code === 0) return "despejado";
  if (code === 1) return "mayormente despejado";
  if (code === 2) return "parcialmente nublado";
  return "nublado";
}

async function getJson(fetchImpl: typeof fetch, url: string, timeoutMs: number, headers?: Record<string, string>): Promise<{ ok: boolean; status: number; json: any }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetchImpl(url, { signal: ctrl.signal, headers });
    const json = await r.json().catch(() => null);
    return { ok: r.ok, status: r.status, json };
  } catch (e) {
    return { ok: false, status: (e as Error)?.name === "AbortError" ? 408 : 0, json: null };
  } finally {
    clearTimeout(t);
  }
}

export async function runWeather(args: Record<string, unknown>, d: WeatherDeps): Promise<Record<string, unknown>> {
  const city = String(args.city ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
  const now = d.now ?? Date.now;
  const timeoutMs = d.timeoutMs ?? 5000;
  let lat = Number(args.lat), lng = Number(args.lng);
  let coordSource = "coordenadas dadas";
  if (!(Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180)) {
    if (!city) return { ok: false, error: "falta_ciudad", motivo: "Falta la ciudad." };
    const known = cityAirports(city);
    let loc: { lat: number; lng: number } | null = known ? { lat: known.lat, lng: known.lng } : null;
    coordSource = "tabla de ciudades de IATOS";
    if (!loc && d.geocode) {
      try { loc = await d.geocode(city); } catch { loc = null; }
      coordSource = "Google Maps (geocodificación)";
    }
    if (!loc) return { ok: false, error: "ciudad_no_encontrada", motivo: `No encontramos ${city} para consultar el clima. No des cifras: pide la ciudad exacta.` };
    lat = loc.lat; lng = loc.lng;
  }

  const off = approxOffsetHours(lng);
  const today = new Date(now() + off * 3600_000).toISOString().slice(0, 10);
  const from = isIso(args.date_from) && args.date_from >= today ? args.date_from : today;
  const to0 = isIso(args.date_to) && args.date_to >= from ? args.date_to : isIso(args.date_from) && args.date_from >= today ? from : addDays(from, 6);
  const to = to0 > addDays(from, 30) ? addDays(from, 30) : to0;
  const consultadoAt = new Date(now()).toISOString();

  const met = await getJson(d.fetchImpl, `https://api.met.no/weatherapi/locationforecast/2.0/complete?lat=${round4(lat)}&lon=${round4(lng)}`, timeoutMs, { "User-Agent": WEATHER_USER_AGENT });
  const ts = Array.isArray(met.json?.properties?.timeseries) ? met.json.properties.timeseries : [];
  const forecast: MetForecast | null = met.ok && ts.length ? { timeseries: ts, updatedAt: met.json?.properties?.meta?.updated_at ?? null } : null;
  const all = dailyFromMet(forecast, lng);
  const lastForecastDay = all.length ? all[all.length - 1].date : null;
  const days = all.filter((x) => x.date >= from && x.date <= to).map((x) => ({
    fecha: x.date, dia: longDay(x.date), max_c: x.tmax, min_c: x.tmin, cielo: dayskyLabel(x.code, x.precipMm), lluvia_mm: x.precipMm, viento_max_kmh: x.windKmh,
  }));
  const have = new Set(days.map((x) => x.fecha));
  const pending: string[] = [];
  for (let x = from; x <= to && pending.length < 31; x = addDays(x, 1)) if (!have.has(x)) pending.push(x);

  const fuentes: Array<{ label: string; url: string }> = [];
  if (forecast) fuentes.push({ label: MET_ATTRIBUTION.label, url: MET_ATTRIBUTION.href });
  let tipico: Array<Record<string, unknown>> = [];
  let powerFailed = false;
  if (pending.length) {
    const p = await getJson(d.fetchImpl, `https://power.larc.nasa.gov/api/temporal/climatology/point?parameters=T2M,T2M_RANGE,PRECTOTCORR&community=AG&longitude=${Math.round(lng * 100) / 100}&latitude=${Math.round(lat * 100) / 100}&format=JSON`, timeoutMs);
    const clim = p.ok ? parsePowerClimatology(p.json) : null;
    powerFailed = !clim;
    if (clim) {
      fuentes.push({ label: `${POWER_ATTRIBUTION.label} (promedio 2001–2025)`, url: POWER_ATTRIBUTION.href });
      const months = [...new Set(pending.map((x) => Number(x.slice(5, 7))))];
      tipico = months.map((m) => {
        const c = clim.find((x) => x.month === m);
        return c ? { mes: MES_LARGO[m - 1], max_tipica_c: c.tmax, min_tipica_c: c.tmin, lluvia_mm_dia: c.precipMmDay, dias: pending.filter((x) => Number(x.slice(5, 7)) === m) } : null;
      }).filter((x): x is NonNullable<typeof x> => !!x);
    }
  }

  if (!days.length && !tipico.length) {
    return {
      ok: false, error: forecast ? "sin_datos_para_esas_fechas" : "clima_no_respondio", ciudad: city || null, consultado_at: consultadoAt,
      motivo: "El servicio de clima no respondió. Dilo así y NO des temperaturas de memoria; sugiere ver la pantalla Clima del viaje.",
    };
  }
  const fuera = pending.length > 0;
  const notas: string[] = [];
  if (fuera) {
    notas.push(lastForecastDay
      ? `El pronóstico de MET Norway llega hasta el ${lastForecastDay}; para ${pending.length === 1 ? "el día" : "los días"} posterior${pending.length === 1 ? "" : "es"} no hay pronóstico todavía.`
      : "Para esas fechas todavía no hay pronóstico.");
    notas.push(tipico.length
      ? "Lo de \"tipico\" es el clima típico del mes (promedio de 25 años de NASA POWER), no un pronóstico: dilo así y cita la fuente."
      : powerFailed ? "El clima típico (NASA POWER) no respondió: no des cifras para esas fechas." : "");
  }
  return {
    ok: true, source: "met_norway", ciudad: city || null, lat: round4(lat), lng: round4(lng), coordenadas: coordSource,
    rango: { desde: from, hasta: to }, consultado_at: consultadoAt,
    // Hora de consulta ya en la zona del usuario (o del destino si no se sabe la suya): el modelo la copia.
    consultado_local: formatLocalStamp(consultadoAt, d.userTz) ?? formatLocalStamp(consultadoAt, "UTC"),
    pronostico_actualizado: forecast?.updatedAt ?? null,
    pronostico: days, fuera_de_pronostico: fuera, ...(tipico.length ? { tipico } : {}),
    fuentes, nota: [...notas.filter(Boolean), "Para la hora de consulta usa consultado_local tal cual (no conviertas consultado_at, que está en UTC) y para cada día usa su campo dia (el día de la semana ya está calculado)."].join(" ") || "Pronóstico de MET Norway: cita la fuente y la hora de consulta.",
  };
}

/** ¿El mensaje pregunta por el clima? (para consultar antes de llamar al modelo). */
export function weatherRequested(message: unknown): boolean {
  const t = String(message ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  return /\b(clima|pronostico|temperatura\w*|va a llover|llovera|lluvia|hara (frio|calor)|que tiempo hara|el tiempo (en|para)|frio|calor|nieve|nevara)\b/.test(t)
    && !/\b(tiempo de (vuelo|viaje|traslado|manejo)|cuanto tiempo)\b/.test(t);
}
