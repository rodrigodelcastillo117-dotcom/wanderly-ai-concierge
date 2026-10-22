/**
 * Lógica de la cotización que ve el usuario en TripDetail (pura, para probarla).
 *
 * - Para cuántos viajeros y qué fechas se calculó el total (snapshot de trip_quotes o
 *   trips.quote_basis) y si el usuario los cambió después: entonces la cotización ya no
 *   corresponde y NO se reparte el total viejo entre el nuevo número de viajeros.
 * - Cuándo se cotizó y hasta cuándo es válida.
 * - El desglose según lo que el usuario seleccione.
 */
import { diffDateOnlyDays, formatDateOnly } from "@/lib/dateUtils";
import { formatAge, LIVE_TTL_HOURS } from "@/lib/provenance";
import { sameSelections } from "@/lib/tripSelections";

export type QuoteSnapshot = {
  id: string;
  created_at: string;
  valid_until: string;
  travelers: number;
  nights: number;
  rooms: number;
  date_from: string | null;
  date_to: string | null;
  total: number;
  currency: string;
  fx_rate: number;
  fx_source: string;
  fx_at: string;
  fx_is_fallback: boolean;
  line_items?: Array<{ category: string; amount: number; state: string }>;
};

export type QuoteBasis = { travelers: number; dateFrom: string | null; dateTo: string | null };

/** Base con que se calculó el total vigente: snapshot > trips.quote_basis > nada (viaje viejo). */
export function quoteBasis(trip: any, snapshot?: QuoteSnapshot | null): QuoteBasis | null {
  if (snapshot) return { travelers: Number(snapshot.travelers) || 1, dateFrom: snapshot.date_from, dateTo: snapshot.date_to };
  const b = trip?.quote_basis;
  if (b && typeof b === "object" && b.num_viajeros != null) {
    return { travelers: Number(b.num_viajeros) || 1, dateFrom: b.fecha_salida ?? null, dateTo: b.fecha_regreso ?? null };
  }
  return null;
}

export type Staleness = { stale: boolean; basis: QuoteBasis | null; reasons: Array<"viajeros" | "fechas" | "seleccion"> };

/**
 * ¿Cambiaron viajeros, fechas o la selección (vuelo, hotel, experiencias) desde que se cotizó?
 * La selección con que se cotizó la guarda el servidor en quote_basis.selections (null = la
 * cotización tal cual); trips.selections es la del usuario ahora (E-12).
 */
export function quoteStaleness(trip: any, snapshot?: QuoteSnapshot | null): Staleness {
  const basis = quoteBasis(trip, snapshot);
  if (!basis) return { stale: false, basis: null, reasons: [] };
  const reasons: Staleness["reasons"] = [];
  if (Number(trip?.num_viajeros || 1) !== basis.travelers) reasons.push("viajeros");
  if ((trip?.fecha_salida ?? null) !== basis.dateFrom || (trip?.fecha_regreso ?? null) !== basis.dateTo) reasons.push("fechas");
  if (!sameSelections(trip?.selections ?? null, trip?.quote_basis?.selections ?? null)) reasons.push("seleccion");
  return { stale: reasons.length > 0 || trip?.quote_needs_update === true, basis, reasons };
}

/** "Cotización para 2 viajeros del 10 nov al 15 nov 2026; actualiza la cotización". */
export function staleQuoteMessage(basis: QuoteBasis, reasons: Staleness["reasons"] = []): string {
  if (reasons.length > 0 && reasons.every((r) => r === "seleccion")) {
    return "Cambiaste tu selección de vuelo, hotel o experiencias después de cotizar; actualiza la cotización";
  }
  const who = `${basis.travelers} ${basis.travelers === 1 ? "viajero" : "viajeros"}`;
  const fechas = basis.dateFrom && basis.dateTo
    ? ` del ${formatDateOnly(basis.dateFrom, { day: "numeric", month: "short" })} al ${formatDateOnly(basis.dateTo, { day: "numeric", month: "short", year: "numeric" })}`
    : "";
  const sel = reasons.includes("seleccion") ? " y cambiaste tu selección" : "";
  return `Cotización para ${who}${fechas}${sel}; actualiza la cotización`;
}

export type Validity = {
  quotedAt: Date | null;
  validUntil: Date | null;
  expired: boolean;
  /** Texto para mostrar: "Cotizado el … · válido hasta …" o "Precio de hace 3 días; verifica antes de reservar". */
  label: string;
};

const fmtDateTime = (d: Date) =>
  d.toLocaleString("es-MX", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

/**
 * Fecha de la cotización y vigencia. Con snapshot se usa su valid_until. Sin snapshot (viajes
 * anteriores) solo se sabe cuándo se guardó el viaje: pasadas 24 h se avisa que el precio es viejo.
 */
export function quoteValidity(trip: any, snapshot: QuoteSnapshot | null | undefined, now: Date = new Date()): Validity {
  // Sin snapshot se usa la creación del viaje (cuando se cotizó): updated_at cambia con cualquier
  // edición (p. ej. restaurantes sugeridos) y haría parecer reciente un precio viejo.
  const quotedRaw = snapshot?.created_at ?? trip?.created_at ?? trip?.updated_at ?? null;
  const quotedAt = quotedRaw ? new Date(quotedRaw) : null;
  const q = quotedAt && Number.isFinite(quotedAt.getTime()) ? quotedAt : null;
  const vu = snapshot?.valid_until ? new Date(snapshot.valid_until) : q ? new Date(q.getTime() + LIVE_TTL_HOURS * 3600_000) : null;
  const validUntil = vu && Number.isFinite(vu.getTime()) ? vu : null;
  const expired = !!validUntil && now.getTime() > validUntil.getTime();
  let label: string;
  if (!q) label = "Sin fecha de cotización; verifica los precios antes de reservar";
  else if (expired) label = `Precio de ${formatAge(q, now)}; verifica antes de reservar`;
  else if (snapshot && validUntil) label = `Cotizado el ${fmtDateTime(q)} · válido hasta ${fmtDateTime(validUntil)}`;
  else label = `Cotizado el ${fmtDateTime(q)}`;
  return { quotedAt: q, validUntil, expired, label };
}

/** Noches del viaje: por fechas; si no hay fechas, por el itinerario (días − 1). */
export function tripNights(trip: any, itineraryDays: number): number {
  const byDates = diffDateOnlyDays(trip?.fecha_salida, trip?.fecha_regreso);
  if (byDates > 0) return byDates;
  return Math.max(1, (Number(itineraryDays) || 0) - 1);
}

export const roomsFor = (travelers: number) => Math.max(1, Math.ceil((Number(travelers) || 1) / 2));

export type Selection = {
  /** -1 = sin selección (usa la cotización) · -2 = "ya lo tengo" (0) · ≥0 = opción elegida. */
  selVuelo: number;
  selHospedaje: number;
  nochesHospedaje: number;
  selTours: Set<number>;
};

/**
 * Desglose según las selecciones. Vuelos y tours por persona, hospedaje por habitación y noche
 * (habitaciones = ceil(viajeros/2), igual que el servidor). Sin tours seleccionados se usa el
 * renglón de la cotización.
 */
export function computeTripDesglose(trip: any, sel: Selection, viajeros: number): Record<string, number> {
  if (!trip) return {};
  const base = trip.desglose_presupuesto ?? {};
  const n = Math.max(1, Number(viajeros) || 1);
  const vuelo = sel.selVuelo >= 0 ? trip.vuelos_json?.[sel.selVuelo] : null;
  const hosp = sel.selHospedaje >= 0 ? trip.hospedaje_json?.[sel.selHospedaje] : null;
  const toursSum = (trip.tours_json ?? []).reduce(
    (s: number, t: any, i: number) => (sel.selTours.has(i) ? s + (Number(t?.precio_por_persona) || 0) * n : s),
    0,
  );
  return {
    vuelos: sel.selVuelo === -2 ? 0 : vuelo ? (Number(vuelo.precio_por_persona) || 0) * n : Number(base.vuelos) || 0,
    hospedaje: sel.selHospedaje === -2
      ? 0
      : hosp
        ? (Number(hosp.precio_por_noche) || 0) * Math.max(0, Number(sel.nochesHospedaje) || 0) * roomsFor(n)
        : Number(base.hospedaje) || 0,
    comida: Number(base.comida) || 0,
    tours: sel.selTours.size > 0 ? toursSum : Number(base.tours) || 0,
    transporte_local: Number(base.transporte_local) || 0,
    extras: Number(base.extras) || 0,
  };
}
