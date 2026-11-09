// Viaje activo único: la misma función que usa el concierge en el servidor (Deno). Dashboard,
// Cercanos, Gastos y Fixer deben llamarla con profiles.active_trip_id en lugar de elegir por su cuenta.
import { tripLabel as serverTripLabel, type TripLike } from "../../supabase/functions/_shared/activeTrip.ts";
import { shortTripName } from "../../supabase/functions/_shared/tripName.ts";
import { isTripEnded as isEndedForPin } from "../../supabase/functions/_shared/activeTrip.ts";

export {
  resolveActiveTrip, tripsMentioned, buildTripQuestion, needsSpecificTrip, isTripEnded, isTripInProgress,
  type ActiveTripReason, type ActiveTripResult, type TripLike,
} from "../../supabase/functions/_shared/activeTrip.ts";

/**
 * "Madrid (4 may al 19 may)" para selectores de la app. Con el nombre corto del viaje: si el destino
 * guardado es la frase que escribió la persona, se muestra lo que se entendió de ella (auditoría 10/10).
 */
export const tripLabel = (t: TripLike & { pais_destino?: string | null; itinerario_json?: unknown }) =>
  serverTripLabel({ ...t, destino: shortTripName(t) });

/**
 * El viaje fijado en el perfil solo cuenta mientras no haya terminado (igual que resolveActiveTrip). Recorrido en
 * producción (9-nov-2026): con «Valle de Bravo (30 oct–1 nov)» fijado y ya terminado, el selector del Inicio, Cerca
 * de ti y el chat lo mostraban como el viaje activo, mientras las herramientas hablaban de Puerto Escondido.
 */
export function pinVigente(trips: TripLike[], pinnedId: string | null, todayLocal: string): string | null {
  if (!pinnedId) return null;
  const t = trips.find((x) => x.id === pinnedId);
  // Si todavía no cargan los viajes, no se decide nada (se respeta lo fijado).
  if (!t) return trips.length ? null : pinnedId;
  return isEndedForPin(t, todayLocal) ? null : pinnedId;
}
