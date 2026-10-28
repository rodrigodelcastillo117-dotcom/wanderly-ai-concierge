// "Clima típico del mes" para fechas más allá del pronóstico (~9 días): NASA POWER, climatología mensual.
//
// FUENTE Y TÉRMINOS (consultados el 23-oct-2026):
//  - API: https://power.larc.nasa.gov/api/temporal/climatology/point (sin llave, CORS *). Docs:
//    https://power.larc.nasa.gov/docs/services/api/
//  - Climatología de 25 años (ene 2001 – dic 2025, MERRA-2/POWER). Parámetros: T2M (temperatura media),
//    T2M_RANGE (rango diario medio) y PRECTOTCORR (lluvia, mm/día). Máxima típica = T2M + rango/2 y mínima
//    típica = T2M − rango/2 (T2M_MAX/T2M_MAX_AVG son extremos del mes, no la máxima de un día normal).
//  - Datos de la NASA sin marca de licencia = CC0, sin restricciones de uso (incluido el comercial); la NASA
//    pide citarla y no sugerir respaldo: https://www.earthdata.nasa.gov/engage/open-data-services-software-policies/data-use-guidance
//    Cita que pide POWER: https://power.larc.nasa.gov/docs/referencing/
// Reemplaza al histórico de Open-Meteo (archive-api), que solo permite uso no comercial.

// La lectura de la climatología (parsePowerClimatology) vive en _shared/weatherCore.ts: Iato usa la misma.
import { parsePowerClimatology, type MonthClimate } from "../../supabase/functions/_shared/weatherCore.ts";
export { MES_LARGO, parsePowerClimatology, POWER_ATTRIBUTION, type MonthClimate } from "../../supabase/functions/_shared/weatherCore.ts";

const cache = new Map<string, Promise<MonthClimate[] | null>>();
const r2 = (v: number) => Math.round(v * 100) / 100;

/** Las 12 normales mensuales de un punto (la climatología no cambia: caché de por vida de la página). */
export function fetchMonthlyClimate(lat: number, lng: number, fetchImpl: typeof fetch = fetch): Promise<MonthClimate[] | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return Promise.resolve(null);
  const key = `${r2(lat)},${r2(lng)}`;
  if (!cache.has(key)) {
    cache.set(key, (async () => {
      try {
        const r = await fetchImpl(`https://power.larc.nasa.gov/api/temporal/climatology/point?parameters=T2M,T2M_RANGE,PRECTOTCORR&community=AG&longitude=${r2(lng)}&latitude=${r2(lat)}&format=JSON`);
        if (!r.ok) throw new Error(String(r.status));
        return parsePowerClimatology(await r.json());
      } catch {
        cache.delete(key);
        return null;
      }
    })());
  }
  return cache.get(key)!;
}

/** Solo para pruebas. */
export const __resetPowerCache = () => cache.clear();
