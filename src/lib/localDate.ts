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
