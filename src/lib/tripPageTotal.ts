// El total que muestra la página del viaje, en UNA función (caso E2E 28-oct-2026, hermano del dueño):
// tras elegir vuelo y hotel el viaje decía $81,273 y Inicio ("Total cotizado") y Mis viajes seguían con
// $81,831, el total_estimado guardado de la cotización. Inicio, Mis viajes y el detalle llaman aquí con la
// selección guardada (trips.selections o su respaldo local) y la cotización vigente, así dicen lo mismo.
import { computeTripDesglose, quoteStaleness, tripNights, type QuoteSnapshot } from "@/lib/quote";
import { readLocalSelections, restoreSelections, serializeSelections, type UiSelection } from "@/lib/tripSelections";
import { isBroughtTrip } from "@/lib/broughtTrip";

/**
 * Total del viaje a partir de la cotización guardada. Nunca se recorta al presupuesto: si la
 * cotización lo rebasa se informa la diferencia (antes se mostraba el presupuesto como si fuera
 * el precio y se decía que la IA "ajustaba la selección", sin ajustar nada).
 */
export function tripTotals(trip: any, viajeros: number, selectionDesglose?: Record<string, number> | null) {
  const vuelos: any[] = Array.isArray(trip?.vuelos_json) ? trip.vuelos_json : [];
  const hoteles: any[] = Array.isArray(trip?.hospedaje_json) ? trip.hospedaje_json : [];
  const cruceros: any[] = Array.isArray(trip?.cruceros_json) ? trip.cruceros_json : [];

  const sumNumber = (n: any) => Number(n) || 0;
  const desglose = trip?.desglose_presupuesto ?? {};
  const explicitBreakdownTotal = Object.values(desglose).reduce((s: number, v) => s + sumNumber(v), 0);

  const totalVuelos = vuelos.reduce((s, v) => {
    if (v.precio_total) return s + sumNumber(v.precio_total);
    if (v.precio_por_persona) return s + sumNumber(v.precio_por_persona) * viajeros;
    return s;
  }, 0);

  const totalHoteles = hoteles.reduce((s, h) => {
    if (h.costo_cero) return s;
    if (h.precio_total) return s + sumNumber(h.precio_total);
    if (h.precio_por_noche && h.noches) return s + sumNumber(h.precio_por_noche) * sumNumber(h.noches);
    return s;
  }, 0);

  const totalCruceros = cruceros.reduce((s, c) => {
    if (c.precio_total) return s + sumNumber(c.precio_total);
    if (c.precio_por_persona) return s + sumNumber(c.precio_por_persona) * viajeros;
    return s;
  }, 0);

  const itemSubtotal = totalVuelos + totalHoteles + totalCruceros;
  const quotedTotal = sumNumber(trip?.total_estimado) || explicitBreakdownTotal || itemSubtotal;
  // Con selección del usuario (E-12) el total es el de su selección; la cotización guardada se
  // conserva aparte para decir de cuánto era.
  const fromSelection = !!selectionDesglose && Object.keys(selectionDesglose).length > 0;
  const total = fromSelection
    ? Object.values(selectionDesglose!).reduce((s: number, v) => s + sumNumber(v), 0)
    : quotedTotal;
  const presupuesto = sumNumber(trip?.presupuesto_objetivo);
  const excedente = presupuesto > 0 && total > presupuesto ? total - presupuesto : 0;
  const porPersona = viajeros > 0 ? total / viajeros : total;
  return { total, porPersona, presupuesto, excedente, quotedTotal, fromSelection };
}


/** Días del itinerario (array de días o { days }). */
function itineraryDays(trip: any): number {
  const it = trip?.itinerario_json;
  if (Array.isArray(it)) return it.length;
  return Array.isArray(it?.days) ? it.days.length : 0;
}

export type PageTotals = {
  /** Viajeros y noches con que se cotizó (si cambiaron después, los de la cotización). */
  quoteTravelers: number;
  quoteNights: number;
  nochesEfectivas: number;
  staleness: ReturnType<typeof quoteStaleness>;
  /** computeTripDesglose con la selección. */
  desglose: Record<string, number>;
  /** Suma del desglose (la barra móvil y "Comprar"). */
  computedTotal: number;
  /** Desglose que usa la cifra grande (null = la cotización guardada tal cual). */
  pageSelDesglose: Record<string, number> | null;
  totals: ReturnType<typeof tripTotals>;
};

/** Lo que calcula la página del viaje con una selección dada (la de la pantalla o la guardada). */
export function tripPageTotals(trip: any, sel: UiSelection, quote?: QuoteSnapshot | null): PageTotals {
  const days = itineraryDays(trip);
  const noches = trip ? tripNights(trip, days) : 1;
  const viajeros = Number(trip?.num_viajeros) || 1;
  const currentSel = trip ? serializeSelections(trip, sel) : null;
  const staleness = quoteStaleness(trip ? { ...trip, selections: currentSel } : trip, quote);
  const quoteTravelers = staleness.stale && staleness.basis ? staleness.basis.travelers : viajeros;
  const quoteNights = staleness.stale && staleness.basis?.dateFrom && staleness.basis?.dateTo
    ? tripNights({ fecha_salida: staleness.basis.dateFrom, fecha_regreso: staleness.basis.dateTo }, days)
    : noches;
  const nochesEfectivas = sel.nochesHospedaje ?? quoteNights;
  const desglose = computeTripDesglose(trip, { ...sel, nochesHospedaje: nochesEfectivas }, quoteTravelers);
  const computedTotal = Object.values(desglose).reduce((s: number, v) => s + Number(v ?? 0), 0);
  // Sin selección, el desglose recalculado puede diferir del guardado (viaje corto: el coche suma casetas +
  // gasolina, no el precio de la IA): entonces la cifra grande usa el recalculado, igual que la barra y Comprar.
  const recalculated = !!trip && Object.keys(desglose).some((k) => Math.round(Number(desglose[k]) || 0) !== Math.round(Number(trip.desglose_presupuesto?.[k]) || 0));
  const pageSelDesglose = currentSel || recalculated ? desglose : null;
  return { quoteTravelers, quoteNights, nochesEfectivas, staleness, desglose, computedTotal, pageSelDesglose, totals: tripTotals(trip, quoteTravelers, pageSelDesglose) };
}

/** Selección guardada del viaje: la columna trips.selections si existe; si no, el respaldo local. */
export function storedSelection(trip: any): UiSelection {
  const raw = trip && "selections" in trip ? trip.selections : trip?.id ? readLocalSelections(String(trip.id)) : null;
  return restoreSelections(trip, raw);
}

/**
 * La cifra grande de la página del viaje con la selección guardada: la que muestran Inicio y Mis viajes.
 * 0 si el viaje no tiene cotización (borrador) o lo trajo la persona ("Ya tengo mi viaje").
 */
export function displayedTripTotal(trip: any, quote?: QuoteSnapshot | null): number {
  if (!trip || isBroughtTrip(trip)) return 0;
  const it = trip.itinerario_json;
  const hasQuoted = !!((it && !Array.isArray(it) && it.from_pdf) || (trip.vuelos_json?.length ?? 0) > 0 || (trip.hospedaje_json?.length ?? 0) > 0);
  if (!hasQuoted) return Number(trip.total_estimado) || 0;
  return Math.round(tripPageTotals(trip, storedSelection(trip), quote).totals.total) || 0;
}
