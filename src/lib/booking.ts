// Booking Bridge en el cliente: la MISMA lógica que el servidor (supabase/functions/_shared/booking).
// El cliente la usa para pintar los botones al instante; booking-bridge la vuelve a correr con sus
// propios datos antes de guardar o redirigir (el cliente nunca decide a qué URL se sale).
export { checkAllowlisted, checkTrustedSource, processorLabel } from "@/lib/bookingAllowlist";
export { resolveBookingActions } from "../../supabase/functions/_shared/booking/resolver.ts";
export {
  offerFromFlightResult, offerFromHotelResult, offerFromTripFlight, tripFlightProblems, isGroundTripOption, transportModeOf, isEstimatedTripFlight, isTripInternationalRow, durationHours, offerFromTripHotel, offerFromTripRestaurant, offerFromTripTour, offerFromVenue,
  venueFromTripPlace, type TransportMode,
  type FlightResultLike, type FlightSearchMeta, type HotelResultLike, type HotelSearchMeta, type VenueInfo,
} from "../../supabase/functions/_shared/booking/offers.ts";
export { intentStatusText, TERMINAL_STATES, type FollowUpOutcome, type Verification } from "../../supabase/functions/_shared/booking/states.ts";
export { draftRequest, langForCountry, REQUEST_LANGS, type RequestLang } from "../../supabase/functions/_shared/booking/messages.ts";
export { countryIso, mailtoLink, normalizePhone, smsLink, telLink, whatsappLink } from "../../supabase/functions/_shared/booking/channels.ts";
export { PRICE_MAY_CHANGE, type BookingAction, type BookingOffer, type IntentState, type ProductType } from "../../supabase/functions/_shared/booking/types.ts";
export { countryForStops, tripCountryLabel, tripDestinations, tripFlightRoute, tripFlightSearches, fareMatchesTrip, unresolvedCityLabel, tripCountry, type TripFlightRoute } from "../../supabase/functions/_shared/booking/tripRoute.ts";
