// Reglas para dar de alta el seguimiento de un vuelo. Cada vuelo activo consulta SerpApi hasta su
// fecha, así que se exige una fecha válida y cercana y un máximo por usuario: el de su plan
// (plan_limits.tracked_flights: FREE 1, prueba 2, PRO 4 con pro_limits_enforced), nunca más que
// el tope de seguridad.

/** Tope de seguridad de vuelos activos por usuario, aunque el plan no tenga límite. */
export const HARD_CAP_ACTIVE_PER_USER = 10;
/** Nombre anterior del tope (antes era el mismo para todos los planes). */
export const MAX_ACTIVE_PER_USER = HARD_CAP_ACTIVE_PER_USER;
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

export const FREE_DAY_OF_FLIGHT_MESSAGE =
  "Con el plan gratuito el seguimiento es solo para vuelos de hoy o de mañana. Actívalo un día antes de tu vuelo, o activa IATOS PRO para seguirlo desde ahora.";

/** Plan gratuito ("básico"): solo el día del vuelo, es decir hoy o mañana en la zona del usuario. */
export function freePlanDateError(flightDate: string, todayISO: string): string | null {
  const days = (Date.parse(`${flightDate}T00:00:00Z`) - Date.parse(`${todayISO}T00:00:00Z`)) / DAY_MS;
  return days === 0 || days === 1 ? null : FREE_DAY_OF_FLIGHT_MESSAGE;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/**
 * AUD-SEG-04: el vuelo se guarda con la llave de servicio, que se salta la política
 * tf_insert_own (has_trip_access). Solo se acepta un trip_id que el usuario puede ver con SU sesión;
 * cualquier otro valor se guarda como null (el vuelo se sigue igual, sin ligarlo a un viaje ajeno).
 */
export async function tripIdForTracking(raw: unknown, canSee: (id: string) => Promise<boolean>): Promise<string | null> {
  if (typeof raw !== "string" || !UUID_RE.test(raw)) return null;
  try {
    return (await canSee(raw)) ? raw : null;
  } catch {
    return null;
  }
}
