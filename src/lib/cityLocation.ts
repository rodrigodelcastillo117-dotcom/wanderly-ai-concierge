// Coordenadas de una ciudad para el clima: primero la tabla de ciudades de la app (airports.ts, sin red);
// si no está, la función "geocode" que ya usa la app (Google Maps a través de la Edge Function). Ya no se
// usa la geocodificación de Open-Meteo (su API gratis es solo para uso no comercial).
import { cityAirports } from "../../supabase/functions/_shared/airports.ts";
import { cityStays, tripDestinations } from "../../supabase/functions/_shared/booking/tripRoute.ts";

export type CityLocation = { lat: number; lng: number; source: "tabla" | "geocode" };
export type Geocoder = (address: string) => Promise<Array<{ lat?: number | null; lng?: number | null }>>;

const cache = new Map<string, Promise<CityLocation | null>>();

const defaultGeocoder: Geocoder = async (address) => {
  const { geocodeAddress } = await import("@/lib/googleMaps");
  return geocodeAddress(address, { language: "es" });
};

/** Coordenadas conocidas sin red (tabla de ciudades). */
export function knownCityLocation(city: string): CityLocation | null {
  const c = cityAirports(city);
  return c ? { lat: c.lat, lng: c.lng, source: "tabla" } : null;
}

/**
 * Coordenadas de la ciudad. La tabla de airports.ts tiene las del AEROPUERTO (Roma = Fiumicino, Florencia =
 * Peretola, Venecia = Marco Polo); con `center` (el clima) se pide primero el centro de la ciudad a la
 * geocodificación y la tabla queda de respaldo.
 */
export function resolveCityLocation(city: string, geocoder: Geocoder = defaultGeocoder, opts: { center?: boolean } = {}): Promise<CityLocation | null> {
  const key = String(city ?? "").trim().toLowerCase();
  if (!key) return Promise.resolve(null);
  const known = knownCityLocation(city);
  if (known && opts.center) {
    const ck = `centro:${key}`;
    if (!cache.has(ck)) {
      cache.set(ck, (async () => {
        try {
          const r = (await geocoder(city))?.[0];
          if (typeof r?.lat === "number" && typeof r?.lng === "number" && Math.hypot(r.lat - known.lat, r.lng - known.lng) < 1.5) {
            return { lat: r.lat, lng: r.lng, source: "geocode" as const };
          }
        } catch { /* sin red: el respaldo de la tabla */ }
        return known;
      })());
    }
    return cache.get(ck)!;
  }
  if (known) return Promise.resolve(known);
  if (!cache.has(key)) {
    cache.set(key, (async () => {
      try {
        const r = (await geocoder(city))?.[0];
        if (typeof r?.lat === "number" && typeof r?.lng === "number") return { lat: r.lat, lng: r.lng, source: "geocode" as const };
        return null;
      } catch {
        cache.delete(key);
        return null;
      }
    })());
  }
  return cache.get(key)!;
}

/**
 * Ciudad donde está (o estará) el viajero: en un viaje multi-destino, la de la estancia de hoy; si aún no
 * empieza, la primera. "Roma → Florencia → Venecia" no es una ciudad.
 */
export function currentTripCity(trip: any, today: string): string | null {
  const stays = cityStays(trip);
  if (stays.length) return (stays.find((s) => today >= s.checkin && today < s.checkout) ?? (today < stays[0].checkin ? stays[0] : stays[stays.length - 1])).city;
  return tripDestinations(trip)[0] ?? (trip?.destino ? String(trip.destino) : null);
}

/** Solo para pruebas. */
export const __resetCityLocationCache = () => cache.clear();
