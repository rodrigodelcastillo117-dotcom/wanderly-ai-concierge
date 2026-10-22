// La tabla `bookings` mezcla dos cosas distintas:
//  - clics de salida hacia un socio (trackBookingClick inserta status="pending" en cada clic),
//  - reservas reales (con confirmación del socio o marcadas como confirmadas).
// Mostrar los clics como "reservas" engañaba al usuario; aquí las separamos.

const CONFIRMED_STATUSES = new Set(["confirmed", "booked", "completed", "paid"]);

export interface BookingLike {
  status?: string | null;
  confirmation_code?: string | null;
  partner_reference?: string | null;
}

/** true solo si hay evidencia de una reserva real (estado confirmado o código del socio). */
export function isConfirmedBooking(b: BookingLike): boolean {
  if (b.confirmation_code && String(b.confirmation_code).trim()) return true;
  if (b.partner_reference && String(b.partner_reference).trim()) return true;
  return CONFIRMED_STATUSES.has(String(b.status ?? "").toLowerCase());
}

export function splitBookings<T extends BookingLike>(rows: T[]): { confirmed: T[]; visits: T[] } {
  const confirmed: T[] = [];
  const visits: T[] = [];
  for (const r of rows) (isConfirmedBooking(r) ? confirmed : visits).push(r);
  return { confirmed, visits };
}
