// La tabla `bookings` mezcla dos cosas distintas:
//  - clics de salida hacia un socio (trackBookingClick inserta status="pending" en cada clic),
//  - reservas reales (con confirmación del socio o marcadas como confirmadas).
// Mostrar los clics como "reservas" engañaba al usuario; aquí las separamos.

// Una sola definición de "reserva confirmada" para la pantalla de reservas, el expediente del
// viaje y el contexto de Iato (supabase/functions/_shared/bookingState.ts).
import { isConfirmedBooking, type BookingLike } from "./bookingState";
export { isConfirmedBooking, type BookingLike };

/**
 * Visitas a socios sin duplicados: abrir dos veces el mismo enlace (mismo socio, título, ciudad, fecha y
 * enlace) era una fila por clic («Cabo da Roca» ×2, auditoría 10/10 P2-12). Se queda la más reciente y
 * cuántas veces se abrió. Las filas llegan de la más reciente a la más vieja.
 */
export function dedupeVisits<T extends { provider?: string | null; title?: string | null; city?: string | null; start_at?: string | null; booking_url?: string | null; category?: string | null }>(rows: T[]): Array<T & { times: number }> {
  const out = new Map<string, T & { times: number }>();
  for (const r of rows) {
    const k = [r.category, r.provider, r.title, r.city, String(r.start_at ?? "").slice(0, 10), r.booking_url]
      .map((x) => String(x ?? "").trim().toLowerCase()).join("|");
    const prev = out.get(k);
    if (prev) prev.times += 1;
    else out.set(k, { ...r, times: 1 });
  }
  return [...out.values()];
}

export function splitBookings<T extends BookingLike>(rows: T[]): { confirmed: T[]; visits: T[] } {
  const confirmed: T[] = [];
  const visits: T[] = [];
  for (const r of rows) (isConfirmedBooking(r) ? confirmed : visits).push(r);
  return { confirmed, visits };
}
