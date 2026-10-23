/**
 * Clima actual del destino para el centro de mando de Inicio. Datos de MET Norway (CC BY 4.0, uso
 * comercial permitido, sin llave; ver src/lib/metNorway.ts) y coordenadas de la tabla de ciudades o de la
 * función "geocode" de la app (src/lib/cityLocation.ts). Antes era Open-Meteo gratis, que solo permite uso
 * no comercial. Solo se pide cuando el viaje está en curso o sale en los próximos 7 días; si algo falla se
 * devuelve null y la tarjeta simplemente no muestra clima.
 */
import { resolveCityLocation, type Geocoder } from "@/lib/cityLocation";
import { fetchMetForecast, nowFromMet } from "@/lib/metNorway";

export type WeatherNow = { tempC: number; label: string; source: "MET Norway" };

const CODES: Array<[number[], string]> = [
  [[0], "Despejado"], [[1, 2], "Parcialmente nublado"], [[3], "Nublado"], [[45, 48], "Niebla"],
  [[51, 53, 55, 56, 57], "Llovizna"], [[61, 63, 65, 66, 67, 80, 81, 82], "Lluvia"], [[71, 73, 75, 77, 85, 86], "Nieve"], [[95, 96, 99], "Tormenta"],
];

export function weatherLabel(code: number): string {
  return CODES.find(([cs]) => cs.includes(code))?.[1] ?? "Clima variable";
}

export async function fetchWeatherNow(city: string, fetchImpl: typeof fetch = fetch, geocoder?: Geocoder): Promise<WeatherNow | null> {
  if (!String(city ?? "").trim()) return null;
  try {
    const loc = await resolveCityLocation(city, geocoder);
    if (!loc) return null;
    const now = nowFromMet(await fetchMetForecast(loc.lat, loc.lng, fetchImpl));
    return now ? { tempC: now.tempC, label: weatherLabel(now.code), source: "MET Norway" } : null;
  } catch {
    return null;
  }
}
