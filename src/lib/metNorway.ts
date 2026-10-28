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

// La lógica pura (símbolos, resumen por día, "ahora") vive en _shared/weatherCore.ts: Iato la usa igual.
import { round4, type MetForecast } from "../../supabase/functions/_shared/weatherCore.ts";
export {
  approxOffsetHours, dailyFromMet, MET_ATTRIBUTION, metSymbolToCode, nowFromMet, round4, type MetDay, type MetForecast, type MetNow,
} from "../../supabase/functions/_shared/weatherCore.ts";

type Entry = MetForecast["timeseries"][number];

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

