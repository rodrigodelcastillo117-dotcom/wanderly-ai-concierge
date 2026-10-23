/**
 * Fechas en la zona horaria del dispositivo (una sola implementación para toda la app).
 *
 * Dos tipos de valor llegan de la base y NO se leen igual:
 *  - Fechas de calendario ("2026-10-01": fecha_salida, expense_date…). `new Date("2026-10-01")`
 *    las interpreta como medianoche UTC, y en la Ciudad de México eso es el 30 de septiembre a
 *    las 18:00: la app mostraba el día anterior. Se leen con `parseLocalDate` / `formatLocalDate`.
 *  - Instantes ("2026-10-01T03:00:00+00:00": created_at, start_at…). Esos sí son UTC y se
 *    muestran con `formatInstant`, que los pasa a la hora local (tomar solo la parte de fecha
 *    mostraría el día siguiente a partir de las 18:00).
 */

/**
 * Fecha YYYY-MM-DD en la zona horaria del dispositivo. `toISOString()` usa UTC: en la Ciudad de
 * México, a partir de las 18:00 ya devuelve el día siguiente.
 */
export function localISODate(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Hoy + n días, en la zona del dispositivo. */
export const localISODatePlus = (days: number, from: Date = new Date()) =>
  localISODate(new Date(from.getFullYear(), from.getMonth(), from.getDate() + days));

const DATE_PART = /^(\d{4})-(\d{1,2})-(\d{1,2})/;

/**
 * Fecha de calendario como fecha LOCAL. Acepta "YYYY-MM-DD" (o un valor que empiece así: se
 * toma la parte de fecha). Devuelve el mediodía local para que un cambio de horario no la mueva
 * de día. null si el valor no es una fecha válida.
 */
export function parseLocalDate(value?: string | null): Date | null {
  const m = DATE_PART.exec(String(value ?? "").trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const date = new Date(y, mo - 1, d, 12, 0, 0, 0);
  // "2026-02-31" no existe: Date lo convertiría en 3 de marzo.
  if (date.getMonth() !== mo - 1) return null;
  return date;
}

/** Muestra una fecha de calendario sin correrla un día. "—" si no hay fecha. */
export function formatLocalDate(
  value?: string | null,
  options: Intl.DateTimeFormatOptions = {},
  locale = "es-MX",
): string {
  const d = parseLocalDate(value);
  return d ? d.toLocaleDateString(locale, options) : "—";
}

/** Muestra un instante (timestamp con zona) en la fecha local del dispositivo. "—" si no es válido. */
export function formatInstant(
  value?: string | Date | null,
  options: Intl.DateTimeFormatOptions = {},
  locale = "es-MX",
): string {
  if (!value) return "—";
  const d = value instanceof Date ? value : new Date(value);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString(locale, options) : "—";
}

/** Días de calendario entre dos fechas (fin - inicio). 0 si falta alguna. */
export function diffLocalDays(start?: string | null, end?: string | null): number {
  const s = parseLocalDate(start);
  const e = parseLocalDate(end);
  if (!s || !e) return 0;
  const a = Date.UTC(s.getFullYear(), s.getMonth(), s.getDate());
  const b = Date.UTC(e.getFullYear(), e.getMonth(), e.getDate());
  return Math.round((b - a) / 86400000);
}

/**
 * Días de calendario desde hoy (local) hasta la fecha: 0 = hoy, negativo = ya pasó.
 * null si la fecha no es válida.
 */
export function daysFromToday(value?: string | null, now: Date = new Date()): number | null {
  if (!parseLocalDate(value)) return null;
  return diffLocalDays(localISODate(now), value);
}

/**
 * Rango legible de un viaje: "22 oct – 1 nov 2026 · 10 noches" (mismo formato que formatLocalDate).
 * Mismo mes: "10 – 15 nov 2026"; años distintos: "28 dic 2026 – 3 ene 2027". Si falta una fecha se
 * muestra solo la que hay, sin inventar la otra ("Desde 22 oct 2026 · sin fecha de regreso").
 * null si no hay ninguna fecha válida.
 */
export function formatTripDateRange(start?: string | null, end?: string | null, locale = "es-MX"): string | null {
  const s = parseLocalDate(start);
  const e = parseLocalDate(end);
  const full = (v?: string | null) => formatLocalDate(v, { day: "numeric", month: "short", year: "numeric" }, locale);
  if (!s && !e) return null;
  if (s && !e) return `Desde ${full(start)} · sin fecha de regreso`;
  if (!s && e) return `Hasta ${full(end)} · sin fecha de salida`;
  const nights = diffLocalDays(start, end);
  if (nights < 0) return `${full(start)} – ${full(end)}`;
  if (nights === 0) return full(start);
  const sameYear = s!.getFullYear() === e!.getFullYear();
  const sameMonth = sameYear && s!.getMonth() === e!.getMonth();
  const left = sameMonth
    ? String(s!.getDate())
    : formatLocalDate(start, sameYear ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" }, locale);
  return `${left} – ${full(end)} · ${nights} ${nights === 1 ? "noche" : "noches"}`;
}
