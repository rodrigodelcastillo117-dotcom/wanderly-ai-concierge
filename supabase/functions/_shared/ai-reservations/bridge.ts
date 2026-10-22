// Entrada del Booking Bridge (grupo bridge) a Reservas IA. Cuando una oferta de restaurante no
// tiene sistema de reservas en línea (modo REQUEST), el bridge la convierte en una intención de
// reserva por correo con fromBridgeOffer() y la crea desde el SERVIDOR:
//
//   import { buildServiceDeps } from "../_shared/ai-reservations/runtime.ts";
//   import { createIntentFromBridgeOffer } from "../_shared/ai-reservations/bridge.ts";
//   const r = await createIntentFromBridgeOffer(buildServiceDeps(), userId, offer);
//
// (o por HTTP: POST /functions/v1/ai-reservations {action:"create_intent", source:"booking_bridge", ...}
// con el JWT del usuario). La intención nace en READY_TO_BOOK (awaiting_user_ok) o FAILED (sin
// correo verificable); el usuario SIEMPRE confirma el envío con confirm_send. Los estados se
// traducen con toBridgeState() (core.ts). Nunca devolvemos CONFIRMED sin confirmación escrita.
// Sin Deno: probado en src/test/aiReservationsService.test.ts.
import { createIntent, type CreateIntentInput, type ServiceDeps } from "./service.ts";

export type BridgeRestaurantOffer = {
  offer_id: string;
  product_type: "restaurant";
  provider?: string;
  provider_offer_id?: string | null; // Google place_id cuando provider = "google_places"
  venue: { name: string; place_id?: string | null; experience_id?: string | null; city?: string | null; country?: string | null; timezone?: string | null };
  /** Fecha y hora LOCAL del restaurante, "YYYY-MM-DDTHH:MM". */
  datetime_local: string;
  traveler_count: number;
  language?: string | null;
  /** Alergias, ocasión, accesibilidad… (se incluyen en el correo; máx. 500 caracteres). */
  restrictions?: string | null;
  trip_id?: string | null;
  customer?: { name?: string; email?: string; phone?: string };
};

export function fromBridgeOffer(offer: BridgeRestaurantOffer): CreateIntentInput {
  const placeId = offer.venue.place_id ?? (offer.provider === "google_places" ? offer.provider_offer_id ?? undefined : undefined);
  return {
    venue: {
      name: offer.venue.name,
      place_id: placeId ?? undefined,
      experience_id: offer.venue.experience_id ?? undefined,
      city: offer.venue.city ?? undefined,
      country: offer.venue.country ?? undefined,
      timezone: offer.venue.timezone ?? undefined,
      language: offer.language ?? undefined,
    },
    datetime_local: offer.datetime_local,
    party_size: offer.traveler_count,
    notes: offer.restrictions ? String(offer.restrictions).slice(0, 500) : undefined,
    trip_id: offer.trip_id ?? undefined,
    customer: offer.customer,
    source: "booking_bridge",
    bridge_offer_id: offer.offer_id,
    // La misma oferta dos veces devuelve la misma intención (sin duplicados).
    idempotency_key: `bridge:${offer.offer_id}`.slice(0, 120),
  };
}

export function createIntentFromBridgeOffer(deps: ServiceDeps, userId: string, offer: BridgeRestaurantOffer) {
  return createIntent(deps, userId, fromBridgeOffer(offer));
}
