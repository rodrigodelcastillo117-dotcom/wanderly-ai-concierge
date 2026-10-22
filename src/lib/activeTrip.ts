// Viaje activo único: la misma función que usa el concierge en el servidor (Deno). Dashboard,
// Cercanos, Gastos y Fixer deben llamarla con profiles.active_trip_id en lugar de elegir por su cuenta.
export {
  resolveActiveTrip, tripsMentioned, tripLabel, buildTripQuestion, needsSpecificTrip, isTripEnded, isTripInProgress,
  type ActiveTripReason, type ActiveTripResult, type TripLike,
} from "../../supabase/functions/_shared/activeTrip.ts";
