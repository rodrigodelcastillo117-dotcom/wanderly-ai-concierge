// Nombre del lugar de unas coordenadas (ciudad y país) con el Geocoding de Google del servidor y la
// caché compartida (public.serp_cache). Auditoría 10 #15 (ronda 2): el navegador llamaba a
// api.bigdatacloud.net y a veces respondía 400 (error rojo en la consola). Ahora el navegador solo
// llama a la función geocode de IATOS, que siempre responde 200 (sin nombre = null, nunca un error).
// Sin Deno: se prueba con Vitest.
import { cacheGet, cacheKey, cachePut, type CacheStore, freshnessOf } from "./serpCache.ts";

export const REVERSE_ENGINE = "google_reverse_geocode";

export interface ReversePlace { city: string | null; country_code: string | null; label: string | null }

/** Coordenadas a 2 decimales (~1 km): basta para nombrar la ciudad y no guarda la ubicación exacta. */
export function roundLatLng(latlng: string): { lat: number; lng: number; key: string } | null {
  const m = String(latlng ?? "").match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (!m) return null;
  const lat = Math.round(Number(m[1]) * 100) / 100, lng = Math.round(Number(m[2]) * 100) / 100;
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng, key: `${lat.toFixed(2)},${lng.toFixed(2)}` };
}

/** results[] del Geocoding de Google → ciudad (locality, o la alcaldía/estado) y país ISO-2. */
export function placeFromGeocode(json: any): ReversePlace {
  const results = Array.isArray(json?.results) ? json.results : [];
  const comp = (types: string[]) => {
    for (const r of results) {
      for (const c of Array.isArray(r?.address_components) ? r.address_components : []) {
        const t: string[] = Array.isArray(c?.types) ? c.types : [];
        if (types.some((x) => t.includes(x))) return c;
      }
    }
    return null;
  };
  const cityC = comp(["locality"]) ?? comp(["postal_town"]) ?? comp(["administrative_area_level_2"]) ?? comp(["administrative_area_level_1"]);
  const countryC = comp(["country"]);
  const city = typeof cityC?.long_name === "string" && cityC.long_name.trim() ? cityC.long_name.trim().slice(0, 80) : null;
  const cc = typeof countryC?.short_name === "string" && /^[A-Za-z]{2}$/.test(countryC.short_name) ? countryC.short_name.toUpperCase() : null;
  const label = city ?? (typeof countryC?.long_name === "string" ? countryC.long_name : null);
  return { city, country_code: cc, label };
}

/** Con caché de 30 días por zona; si Google falla, { city: null } (nunca lanza). */
export async function reversePlace(latlng: string, deps: {
  store?: CacheStore | null; geocode: (latlng: string) => Promise<{ ok: boolean; json: any }>; now?: () => number;
}): Promise<ReversePlace & { from_cache?: boolean }> {
  const empty: ReversePlace = { city: null, country_code: null, label: null };
  const r = roundLatLng(latlng);
  if (!r) return empty;
  const key = await cacheKey(REVERSE_ENGINE, { ll: r.key });
  const cached = await cacheGet(deps.store, key);
  if (cached && freshnessOf(cached, (deps.now ?? Date.now)()).fresh) return { ...(cached.response as ReversePlace), from_cache: true };
  try {
    const g = await deps.geocode(r.key);
    if (!g.ok) return empty;
    const place = placeFromGeocode(g.json);
    if (place.city || place.country_code) await cachePut(deps.store, key, REVERSE_ENGINE, place);
    return place;
  } catch {
    return empty;
  }
}
