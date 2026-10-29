// «Qué sigue» de Inicio y del viaje con la misma fuente (R3 viajes P1-2): para Valle de Bravo, que salía
// mañana sin hotel, Inicio decía «Prepara tu maleta» y el viaje «Elige y reserva · aún te falta elegir cómo
// llegar y hotel», porque Inicio no sabía qué faltaba. Aquí se calcula ese «qué falta» desde lo guardado
// (selección de Comprar y marcas de «Ya lo compré»), con el mismo tripTotalSummary que usa la página.
import { buildBuyFlow } from "@/lib/buyFlow";
import { itemPurchaseState, type PurchaseMarkRow } from "@/lib/purchasePlan";
import { marksFromBookings, marksFromGroup, type TripPurchaseMarkRow } from "@/lib/purchaseMarks";
import { restoreSelections } from "@/lib/tripSelections";
import { tripTotalSummary } from "@/lib/tripTotal";

export function savedTripMissing(
  trip: any,
  opts: { bookings?: PurchaseMarkRow[] | null; groupMarks?: TripPurchaseMarkRow[] | null; userId?: string | null } = {},
): string[] | null {
  if (!trip) return null;
  const sel = restoreSelections(trip, trip.selections);
  const items = buildBuyFlow(trip, sel).items;
  // Sin vuelo ni hotel que elegir (viaje aún sin opciones) no se sabe qué falta: null, no «ya elegiste todo».
  if (!items.some((it) => it.kind === "vuelo" || it.kind === "hospedaje")) return null;
  const rows = opts.bookings ?? [];
  // Las marcas del grupo y las propias de bookings (las de la versión anterior se copian al grupo al abrir el viaje).
  const marks = new Map([...marksFromBookings(rows, opts.userId ?? null), ...marksFromGroup(opts.groupMarks ?? [])]);
  return tripTotalSummary({ trip, sel, desglose: {}, items, itemState: (it) => itemPurchaseState(it, rows, marks) }).missing;
}
