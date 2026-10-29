/**
 * Lógica de la cotización que ve el usuario en TripDetail (pura, para probarla).
 *
 * - Para cuántos viajeros y qué fechas se calculó el total (snapshot de trip_quotes o
 *   trips.quote_basis) y si el usuario cambió viajeros, fechas, origen o destino después: entonces
 *   la cotización ya no corresponde y NO se reparte el total viejo entre el nuevo número de viajeros.
 *   Elegir otra opción de la misma cotización no la invalida (el total se recalcula).
 * - Cuándo se cotizó y hasta cuándo es válida.
 * - El desglose según lo que el usuario seleccione.
 */
import { diffDateOnlyDays, formatDateOnly } from "@/lib/dateUtils";
import { formatAge, LIVE_TTL_HOURS } from "@/lib/provenance";
import { describeQuoteChanges, quoteChanges, type QuoteChange } from "@/lib/quoteChanges";
import { cityHotelChoices, hasCityHotels } from "@/lib/cityHotels";
import { groundGroupPrice } from "../../supabase/functions/_shared/carCost.ts";

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
  /** Fuentes de la cotización; `por_cotizar`: renglones sin precio (no suman al total). */
  sources?: { por_cotizar?: string[] } & Record<string, unknown>;
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

export type Staleness = { stale: boolean; basis: QuoteBasis | null; reasons: QuoteChange[] };

/**
 * ¿Cambiaron viajeros, fechas, ciudad de origen o destino desde que se cotizó? (quoteChanges)
 * Elegir otra opción (vuelo, hotel, experiencias) de la MISMA cotización NO la invalida: el total se
 * recalcula al momento con lo elegido (regla del dueño, E2E 28-oct-2026). Por eso un
 * trips.quote_needs_update que el servidor marcó solo por la selección no se respeta aquí.
 */
export function quoteStaleness(trip: any, snapshot?: QuoteSnapshot | null): Staleness {
  const basis = quoteBasis(trip, snapshot);
  if (!basis) return { stale: false, basis: null, reasons: [] };
  const reasons = quoteChanges(trip, snapshot ? basis : null) ?? [];
  return { stale: reasons.length > 0, basis, reasons };
}

/**
 * "Cambiaste el número de viajeros. Cotización para 2 viajeros del 10 nov al 15 nov 2026; actualiza la
 * cotización". Solo nombra lo que de verdad cambió; sin motivos, solo la base.
 */
export function staleQuoteMessage(basis: QuoteBasis, reasons: QuoteChange[] = []): string {
  const who = `${basis.travelers} ${basis.travelers === 1 ? "viajero" : "viajeros"}`;
  const fechas = basis.dateFrom && basis.dateTo
    ? ` del ${formatDateOnly(basis.dateFrom, { day: "numeric", month: "short" })} al ${formatDateOnly(basis.dateTo, { day: "numeric", month: "short", year: "numeric" })}`
    : "";
  const what = describeQuoteChanges(reasons);
  return `${what ? `${what}. ` : ""}Cotización para ${who}${fechas}; actualiza la cotización`;
}

export type Validity = {
  quotedAt: Date | null;
  validUntil: Date | null;
  expired: boolean;
  /** Texto para mostrar: "Cotizado el … · válido hasta …" o "Precio de hace 3 días; verifica antes de reservar". */
  label: string;
  /** "hace 27 h" cuando la cotización ya venció (para no llamar «en vivo» a esos precios); null si sigue vigente. */
  age: string | null;
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
  return { quotedAt: q, validUntil, expired, label, age: expired && q ? formatAge(q, now) : null };
}

/** Noches del viaje: por fechas; si no hay fechas, por el itinerario (días − 1). */
export function tripNights(trip: any, itineraryDays: number): number {
  const byDates = diffDateOnlyDays(trip?.fecha_salida, trip?.fecha_regreso);
  if (byDates > 0) return byDates;
  return Math.max(1, (Number(itineraryDays) || 0) - 1);
}

export const roomsFor = (travelers: number) => Math.max(1, Math.ceil((Number(travelers) || 1) / 2));

/**
 * Habitaciones por las que se multiplica el precio por noche de un hotel (mismo criterio que
 * supabase/functions/_shared/rooms.ts): un precio en vivo de Google Hotels se pidió para todos los
 * viajeros y ya es del grupo (1); uno estimado es por habitación doble (ceil(viajeros/2)).
 */
export function hotelPriceRooms(hotel: any, travelers: number): number {
  const fuente = String(hotel?.fuente_precio ?? hotel?.fuente ?? "").toLowerCase();
  const estado = String(hotel?.estado_dato ?? "").toUpperCase();
  const live = fuente === "serpapi" || estado === "CONSULTADO_EN_VIVO" || estado === "VERIFICADO";
  return live ? 1 : roomsFor(travelers);
}

export type Selection = {
  /** -1 = sin selección (usa la cotización) · -2 = "ya lo tengo" (0) · ≥0 = opción elegida. */
  selVuelo: number;
  selHospedaje: number;
  nochesHospedaje: number;
  selTours: Set<number>;
  /** Multi-destino: hotel elegido por ciudad (índice en hospedaje_json; -2 = "ya tengo"). */
  selHoteles?: Record<string, number> | null;
};

/**
 * Desglose según las selecciones. Vuelos y tours por persona, hospedaje por noche × habitaciones
 * (hotelPriceRooms: 1 si el precio en vivo ya es del grupo, ceil(viajeros/2) si es estimado; igual
 * que el servidor). Sin tours seleccionados se usa el
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
  // Multi-destino: un hotel por ciudad con las noches de esa ciudad (no un hotel por todo el viaje).
  // Sin ninguna elección se conserva el renglón de la cotización.
  const multiHotels = hasCityHotels(trip);
  const anyHotelSel = sel.selHospedaje !== -1 || Object.keys(sel.selHoteles ?? {}).length > 0;
  const multiHospedaje = multiHotels && anyHotelSel
    ? cityHotelChoices({ ...trip, num_viajeros: n }, sel).reduce((s2, c) => s2 + (c.index === -2 ? 0 : c.total ?? 0), 0)
    : null;
  // Trayecto corto por tierra (caso CDMX → Tepoztlán): el coche suma casetas reales + gasolina estimada y
  // el autobús no suma (precio en el sitio de la línea); nunca el precio por persona que escribió la IA.
  // Sin elección, si el renglón de la cotización es una opción terrestre, se recalcula igual.
  const vuelosList: any[] = Array.isArray(trip.vuelos_json) ? trip.vuelos_json : [];
  const quotedGround = !vuelo && sel.selVuelo === -1 && Number(base.vuelos) > 0
    ? vuelosList.find((v) => groundGroupPrice(v, trip) !== undefined && Math.round((Number(v?.precio_por_persona) || 0) * n) === Math.round(Number(base.vuelos)))
    : null;
  const ground = vuelo ?? quotedGround ?? null;
  const groundPrice = ground ? groundGroupPrice(ground, trip) : undefined;
  return {
    vuelos: sel.selVuelo === -2 ? 0 : groundPrice !== undefined ? Math.round(groundPrice ?? 0) : vuelo ? (Number(vuelo.precio_por_persona) || 0) * n : Number(base.vuelos) || 0,
    hospedaje: multiHospedaje != null
      ? (sel.selHospedaje === -2 && !Object.keys(sel.selHoteles ?? {}).length ? 0 : multiHospedaje)
      : sel.selHospedaje === -2
      ? 0
      : hosp
        ? (Number(hosp.precio_por_noche) || 0) * Math.max(0, Number(sel.nochesHospedaje) || 0) * hotelPriceRooms(hosp, n)
        : Number(base.hospedaje) || 0,
    comida: Number(base.comida) || 0,
    tours: sel.selTours.size > 0 ? toursSum : Number(base.tours) || 0,
    transporte_local: Number(base.transporte_local) || 0,
    extras: Number(base.extras) || 0,
    // Casetas reales de Google (en vivo) de los tramos en coche: solo si el servidor las sumó.
    ...(Number(base.casetas) > 0 ? { casetas: Number(base.casetas) } : {}),
  };
}
