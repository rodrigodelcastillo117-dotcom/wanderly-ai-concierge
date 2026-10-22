// Reglas para dar de alta el seguimiento de un vuelo. Cada vuelo activo consulta SerpApi cada
// 15 minutos hasta su fecha, así que se exige una fecha válida y cercana y un máximo por usuario.

export const MAX_ACTIVE_PER_USER = 10;
/** Las aerolíneas venden hasta ~330 días antes; más allá no hay estado que vigilar. */
export const MAX_DAYS_AHEAD = 330;

const DAY_MS = 86_400_000;

export const normalizeFlight = (f: string) => f.toUpperCase().replace(/\s/g, "");

/** Devuelve el motivo de rechazo, o null si se puede activar. `todayISO` en la zona del usuario. */
export function trackError(input: { flight?: unknown; flight_date?: unknown }, todayISO: string): string | null {
  if (typeof input.flight !== "string" || !/^[A-Z0-9]{2,3}\d{1,4}[A-Z]?$/.test(normalizeFlight(input.flight))) {
    return "Número de vuelo no válido (ej. AM 401)";
  }
  if (typeof input.flight_date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(input.flight_date)) {
    return "Falta la fecha del vuelo";
  }
  const days = (Date.parse(`${input.flight_date}T00:00:00Z`) - Date.parse(`${todayISO}T00:00:00Z`)) / DAY_MS;
  if (!Number.isFinite(days)) return "Fecha no válida";
  // Un día de margen hacia atrás: un vuelo nocturno sigue en el aire tras la medianoche.
  if (days < -1) return "Ese vuelo ya pasó";
  if (days > MAX_DAYS_AHEAD) return "Solo podemos seguir vuelos de los próximos 11 meses";
  return null;
}
