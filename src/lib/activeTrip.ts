// Viaje activo único: la misma función que usa el concierge en el servidor (Deno). Dashboard,
// Cercanos, Gastos y Fixer deben llamarla con profiles.active_trip_id en lugar de elegir por su cuenta.
import { tripLabel as serverTripLabel, type TripLike } from "../../supabase/functions/_shared/activeTrip.ts";
import { shortTripName } from "../../supabase/functions/_shared/tripName.ts";

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
