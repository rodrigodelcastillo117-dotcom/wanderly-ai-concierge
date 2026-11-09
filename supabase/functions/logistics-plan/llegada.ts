// La primera noche de un vuelo largo se pasa en el avión (México → Europa sale el 10 y llega el 11): el primer hotel
// empieza el día que LLEGA el vuelo, no el día que sale. Antes se contaban las noches desde fecha_salida y el viajero
// pagaba una noche que no usaba (y en Booking, no llegar la primera noche puede cancelar toda la estancia).
// Hallazgo del recorrido en producción del 9-nov-2026 (Madrid → París → Roma, 10–20 abr 2027: vuelos que llegan el
// 11 y hotel en Madrid 10–14). Puro.

const ISO = /^(\d{4})-(\d{2})-(\d{2})/;

function diasEntre(desde: string, hasta: string): number | null {
  const a = ISO.exec(desde), b = ISO.exec(hasta);
  if (!a || !b) return null;
  const da = Date.UTC(+a[1], +a[2] - 1, +a[3]), db = Date.UTC(+b[1], +b[2] - 1, +b[3]);
  return Math.round((db - da) / 86400000);
}

function sumarDias(iso: string, n: number): string {
  const m = ISO.exec(iso)!;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + n)).toISOString().slice(0, 10);
}

/**
 * Noches que el viajero pasa volando antes de llegar a la primera ciudad: días entre la fecha de salida y la fecha de
 * llegada del vuelo de ida (hora LOCAL de llegada, como la da Google Flights: "2027-04-11 12:35"). 0 si no se sabe.
 * Más de 2 no es creíble (dato raro): se ignora.
 */
export function nochesEnVuelo(fechaSalida: string | null | undefined, llegada: string | null | undefined): number {
  if (!fechaSalida || !llegada) return 0;
  const d = diasEntre(fechaSalida, String(llegada));
  return d != null && d >= 1 && d <= 2 ? d : 0;
}

/** Cambia las fechas de un enlace de búsqueda de Booking.com (checkin/checkout); otros enlaces quedan igual. */
export function fechasEnlaceBooking(url: unknown, checkin: string, checkout: string): unknown {
  if (typeof url !== "string" || !/^https:\/\/(www\.)?booking\.com\//.test(url)) return url;
  try {
    const u = new URL(url);
    if (!u.searchParams.has("checkin")) return url;
    u.searchParams.set("checkin", checkin);
    u.searchParams.set("checkout", checkout);
    return u.toString();
  } catch {
    return url;
  }
}

/**
 * Recorre la llegada de la primera ciudad: empieza `noches` días después y pierde esas noches (mínimo 1 noche; la
 * salida de la ciudad no cambia, así que las demás ciudades quedan igual). Ajusta también los enlaces de Booking de
 * sus hoteles. Sin noches en vuelo devuelve la misma ciudad.
 */
export function primeraCiudadDesdeLlegada<T extends { checkin?: string; checkout?: string; nights?: number; hospedaje?: unknown[] }>(
  pd: T, noches: number,
): T & { noches_en_vuelo?: number } {
  if (!(noches > 0) || !pd?.checkin || !pd.checkout || !ISO.test(pd.checkin) || !ISO.test(pd.checkout)) return pd;
  const total = diasEntre(pd.checkin, pd.checkout);
  if (total == null || total < 2) return pd; // una sola noche: no se le quita (se avisa en el vuelo, no se inventa otra fecha)
  const quita = Math.min(noches, total - 1);
  const checkin = sumarDias(pd.checkin, quita);
  const nights = total - quita;
  const hospedaje = Array.isArray(pd.hospedaje)
    ? pd.hospedaje.map((h) => (h && typeof h === "object" && "booking_url" in (h as object)
      ? { ...(h as Record<string, unknown>), booking_url: fechasEnlaceBooking((h as { booking_url?: unknown }).booking_url, checkin, pd.checkout!) }
      : h))
    : pd.hospedaje;
  return { ...pd, checkin, nights, hospedaje, noches_en_vuelo: quita };
}
