// Road trips en el cliente: la MISMA lógica que el servidor (supabase/functions/_shared/roadtrip).
// La pantalla la usa para la vista previa ESTIMADA (sin costo de API) y para pintar el plan que
// devolvió logistics-plan; nunca presenta una estimación como dato consultado.
export {
  buildRoadTripPlan, countryOf, detectRoadTrip, estimateLeg, findCity, findCuratedRoute, mapsDrivingUrl, placeQuery, resolveLegModes,
  routePlannerPath, splitDays, suggestedStopsFor, uniqueStops,
  type CostItem, type DataState, type LegMode, type RoadLeg, type RoadTripPlan, type Rental, type TransportMode,
} from "../../supabase/functions/_shared/roadtrip/plan.ts";
export { COUNTRIES, CURATED_ROUTES, NOTICES, type CuratedRoute, type Iso, type Notice } from "../../supabase/functions/_shared/roadtrip/data.ts";
export { CONSULTED_AT, SOURCES, type Source } from "../../supabase/functions/_shared/roadtrip/sources.ts";
export { isOneWay, kayakCarsUrl, offerFromCarRental } from "../../supabase/functions/_shared/booking/carRental.ts";
