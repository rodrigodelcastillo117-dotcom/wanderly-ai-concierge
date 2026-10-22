// Acciones de reserva calculadas por booking-bridge para todo el viaje (con el catálogo Privé y las
// verificaciones de enlaces que el cliente no tiene). Mientras no responde, o si no está desplegada,
// la página usa las acciones calculadas en el cliente (mismo resolver, sin datos del servidor).
import { useEffect, useState } from "react";
import { bridge } from "@/lib/bookingBridgeApi";
import type { BookingAction } from "@/lib/booking";

export type TripOfferActions = Partial<Record<"vuelos_json" | "hospedaje_json" | "tours_json" | "restaurantes_json", Record<number, BookingAction[]>>>;

export function useTripOffers(tripId: string | null | undefined, version: unknown): TripOfferActions {
  const [map, setMap] = useState<TripOfferActions>({});
  useEffect(() => {
    if (!tripId) return;
    let alive = true;
    void bridge("list_offers_for_trip", { trip_id: tripId }).then((r) => {
      if (!alive || !r.ok || !r.offers) return;
      const out: TripOfferActions = {};
      for (const [col, list] of Object.entries(r.offers as Record<string, Array<{ index: number; actions: BookingAction[] }>>)) {
        out[col as keyof TripOfferActions] = Object.fromEntries(list.map((o) => [o.index, o.actions]));
      }
      setMap(out);
    });
    return () => { alive = false; };
  }, [tripId, version]);
  return map;
}
