/**
 * Clima actual del destino para el centro de mando de Inicio. Open-Meteo es gratuito y sin llave
 * (el mismo que usa la pantalla Clima del viaje). Solo se pide cuando el viaje está en curso o sale
 * en los próximos 7 días; si algo falla se devuelve null y la tarjeta simplemente no muestra clima.
 */
export type WeatherNow = { tempC: number; label: string; source: "Open-Meteo" };

const cache = new Map<string, Promise<WeatherNow | null>>();

const CODES: Array<[number[], string]> = [
  [[0], "Despejado"], [[1, 2], "Parcialmente nublado"], [[3], "Nublado"], [[45, 48], "Niebla"],
  [[51, 53, 55, 56, 57], "Llovizna"], [[61, 63, 65, 66, 67, 80, 81, 82], "Lluvia"], [[71, 73, 75, 77, 85, 86], "Nieve"], [[95, 96, 99], "Tormenta"],
];

export function weatherLabel(code: number): string {
  return CODES.find(([cs]) => cs.includes(code))?.[1] ?? "Clima variable";
}

export function fetchWeatherNow(city: string, fetchImpl: typeof fetch = fetch): Promise<WeatherNow | null> {
  const key = city.trim().toLowerCase();
  if (!key) return Promise.resolve(null);
  if (!cache.has(key)) {
    cache.set(key, (async () => {
      try {
        const g = await fetchImpl(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=es`);
        const loc = (await g.json())?.results?.[0];
        if (!loc) return null;
        const f = await fetchImpl(`https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}&current=temperature_2m,weather_code&timezone=auto`);
        const cur = (await f.json())?.current;
        if (typeof cur?.temperature_2m !== "number") return null;
        return { tempC: Math.round(cur.temperature_2m), label: weatherLabel(Number(cur.weather_code)), source: "Open-Meteo" as const };
      } catch {
        cache.delete(key);
        return null;
      }
    })());
  }
  return cache.get(key)!;
}

/** Solo para pruebas. */
export const __resetWeatherCache = () => cache.clear();
