// Renta de auto del road trip en el Booking Bridge (grupo roadtrip). Sin Deno.
//
// Archivo NUEVO a propósito: no toca los generadores de enlaces que está cambiando el grupo
// `enlaces` (src/lib/affiliateLinks.ts, offers.ts) ni la seguridad del bridge del grupo `reservas`
// (allowlist.ts, resolver.ts, redirectToken.ts, handler.ts). Solo REUSA resolveBookingActions y
// stableId; booking-bridge lo llama con la fuente {type:"car_rental"} (cambio mínimo en handler.ts,
// anotado en docs/iatos/cierre2/ROADTRIP.md para la fusión).
//
// Enlace: búsqueda de Kayak Cars con recogida y devolución (también en ciudades distintas):
//   https://www.kayak.com/cars/<recogida>/<devolución>/<AAAA-MM-DD>/<AAAA-MM-DD>
// kayak.com ya está en la lista blanca (allowlist.ts, "kayakCarsLink"). Formato verificado con GET
// público el 2026-10-22: /cars/Florence/Rome/2026-11-10/2026-11-17 → 200, título
// "Florence to Rome, 11/10 – 11/17" (evidencia EV-KAYAK-CARS-ONEWAY en ROADTRIP.md).
import { isIsoDate } from "./links.ts";
import { stableId } from "./offers.ts";
import { resolveBookingActions } from "./resolver.ts";
import type { BookingOffer } from "./types.ts";
import { placeQuery } from "../roadtrip/plan.ts";

export const EV_KAYAK_CARS_ONEWAY = "EV-KAYAK-CARS-ONEWAY";

export type CarRentalQuery = {
  pickup_city: string;
  dropoff_city?: string | null;
  pickup_date: string;
  dropoff_date: string;
  trip_id?: string | null;
};

const clean = (s: unknown, max = 80) => (typeof s === "string" ? s.replace(/[\u0000-\u001f\u007f/\\?#%]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "");
const same = (a: string, b: string) => a.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase() === b.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Nombre del lugar para Kayak: el nombre en inglés de la ciudad conocida (sin país, que Kayak resuelve peor). */
function kayakPlace(city: string): string {
  const q = placeQuery(city);
  return clean(q.split(",")[0] || city);
}

/** URL de búsqueda de Kayak Cars; null si faltan datos o las fechas no son válidas. */
export function kayakCarsUrl(q: CarRentalQuery): string | null {
  const pick = kayakPlace(clean(q.pickup_city));
  const drop = q.dropoff_city ? kayakPlace(clean(q.dropoff_city)) : "";
  if (!pick || !isIsoDate(q.pickup_date) || !isIsoDate(q.dropoff_date) || q.dropoff_date < q.pickup_date) return null;
  const path = drop && !same(drop, pick)
    ? `${encodeURIComponent(pick)}/${encodeURIComponent(drop)}`
    : encodeURIComponent(pick);
  // Kayak México: la misma búsqueda en español ("Florencia a Roma, 10/5 – 17/5", GET del 28-oct-2026).
  return `https://www.kayak.com.mx/cars/${path}/${q.pickup_date}/${q.dropoff_date}`;
}

export function isOneWay(q: CarRentalQuery): boolean {
  return !!q.dropoff_city && !same(kayakPlace(clean(q.dropoff_city)), kayakPlace(clean(q.pickup_city)));
}

/** Oferta del bridge: búsqueda equivalente (no es una tarifa ni una reserva). */
export function offerFromCarRental(q: CarRentalQuery, ctx: { now?: number } = {}): BookingOffer {
  const pickup = clean(q.pickup_city) || "Ciudad de recogida";
  const dropoff = clean(q.dropoff_city) || pickup;
  const oneWay = isOneWay(q);
  const url = kayakCarsUrl(q);
  const title = oneWay ? `Auto de renta: ${pickup} → ${dropoff}` : `Auto de renta en ${pickup}`;
  const r = resolveBookingActions({
    product_type: "transport", title, city: pickup, now: ctx.now,
    searches: url ? [{ url, trust: "builder", evidence: EV_KAYAK_CARS_ONEWAY, provider_label: "Kayak",
      preserves: { product: false, dates: true, travelers: false, room_or_fare: false } }] : [],
    allow_assisted: false,
  });
  const conditions = [
    "Es una búsqueda de autos con tus ciudades y fechas: el precio, el seguro y las condiciones los da cada arrendadora.",
    ...(oneWay ? ["Devolver en otra ciudad o país suele tener un cargo extra: el monto lo da la arrendadora al cotizar."] : []),
  ];
  // El resolver nombra "Buscar boletos" a toda búsqueda de transporte: aquí es un auto.
  const actions = r.actions.map((a) => a.kind === "equivalent_search"
    ? { ...a, label: "Buscar auto de renta", disclosures: [...a.disclosures, ...conditions.slice(1)] }
    : a);
  return {
    offer_id: stableId(["transport", "kayak_cars", pickup, dropoff, q.pickup_date, q.dropoff_date]),
    provider: "kayak_cars",
    provider_offer_id: null,
    product_type: "transport",
    title,
    subtitle: `${q.pickup_date} – ${q.dropoff_date}`,
    city: pickup,
    source_url: null,
    booking_url: r.primary?.url && /^https:/.test(r.primary.url) ? r.primary.url : null,
    booking_mode: r.booking_mode,
    price: null,
    currency: null,
    taxes: null,
    price_checked_at: null,
    offer_expires_at: null,
    availability_status: "not_checked",
    traveler_count: null,
    travel_dates: { start: isIsoDate(q.pickup_date) ? q.pickup_date : null, end: isIsoDate(q.dropoff_date) ? q.dropoff_date : null },
    booking_conditions: conditions,
    trip_id: q.trip_id ?? null,
    verification_status: "unverified",
    price_is_estimate: false,
    recheckable: false,
    actions,
    rejected: r.rejected,
    details: { car_rental: { pickup_city: pickup, dropoff_city: dropoff, one_way: oneWay }, price_expired: false },
  };
}
