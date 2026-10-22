// Texto de ubicación del encabezado del Concierge. Antes, si el permiso se negaba, el GPS no
// respondía o el clima fallaba, se quedaba para siempre en "Detectando tu ubicación real…".
/** Tiempo máximo esperando la ubicación antes de decir "no disponible". */
export const GEO_GIVE_UP_MS = 12_000;

export type LocationState = "pending" | "ok" | "unavailable";

export function conciergeLocationLabel(state: LocationState, weather: { place: string; temp: number } | null): string {
  if (weather) return `${weather.place} · ${weather.temp}°C`;
  return state === "unavailable" ? "Ubicación no disponible" : "Detectando tu ubicación real…";
}
