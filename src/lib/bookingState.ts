// Reservado vs. cotizado: la misma lógica que usa el concierge en el servidor (Deno).
export {
  isConfirmedBooking, itemBookingState, deriveTripBookingState, bookingsByTrip,
  BOOKING_KIND, TRIP_STATE_LABEL, ITEM_STATE_LABEL,
  type BookingLike, type ItemKind, type ItemState, type TripBookingState, type TripBookingSummary,
} from "../../supabase/functions/_shared/bookingState.ts";
