// La tabla `bookings` mezcla dos cosas distintas:
//  - clics de salida hacia un socio (trackBookingClick inserta status="pending" en cada clic),
//  - reservas reales (con confirmación del socio o marcadas como confirmadas).
// Mostrar los clics como "reservas" engañaba al usuario; aquí las separamos.

// Una sola definición de "reserva confirmada" para la pantalla de reservas, el expediente del
// viaje y el contexto de Iato (supabase/functions/_shared/bookingState.ts).
import { isConfirmedBooking, type BookingLike } from "./bookingState";
export { isConfirmedBooking, type BookingLike };

export function splitBookings<T extends BookingLike>(rows: T[]): { confirmed: T[]; visits: T[] } {
  const confirmed: T[] = [];
  const visits: T[] = [];
  for (const r of rows) (isConfirmedBooking(r) ? confirmed : visits).push(r);
  return { confirmed, visits };
}
