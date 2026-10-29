// Trenes con el viaje puesto (auditoría 28-oct-2026): con ?trip= la pantalla decía "Agregando a tu viaje:
// Roma → Florencia → Venecia" pero dejaba origen y destino vacíos, la fecha en hoy y 1 pasajero (el viaje
// era de 2), y con ?date=20270514 (formato de buyFlow) la fecha quedaba vacía. Puro.
import { cityStays, tripDestinations } from "../../supabase/functions/_shared/booking/tripRoute.ts";

/** "20270514" o "2027-05-14" → "2027-05-14"; cualquier otra cosa → null. */
export function trainDateParam(v: string | null | undefined): string | null {
  const s = String(v ?? "").trim();
  const m = /^(\d{4})-?(\d{2})-?(\d{2})$/.exec(s);
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === iso ? iso : null;
}

export type TrainPrefill = { origin: string; destination: string; date: string | null; pax: number | null };

/**
 * Lo que se precarga del viaje: el primer tramo entre ciudades (Roma → Florencia, el día que se deja Roma)
 * en un viaje de varias ciudades; en uno de un destino, el destino y la salida (el origen se escribe:
 * no hay tren de la Ciudad de México a Roma). Viajeros = los del viaje.
 */
export function trainPrefillFromTrip(trip: any): TrainPrefill | null {
  if (!trip) return null;
  const cities = tripDestinations(trip);
  const pax = Number(trip.num_viajeros) >= 1 ? Math.min(9, Math.round(Number(trip.num_viajeros))) : null;
  if (cities.length >= 2) {
    const stays = cityStays(trip);
    return { origin: cities[0], destination: cities[1], date: stays[1]?.checkin ?? trainDateParam(trip.fecha_salida), pax };
  }
  return { origin: "", destination: cities[0] ?? "", date: trainDateParam(trip.fecha_salida), pax };
}
