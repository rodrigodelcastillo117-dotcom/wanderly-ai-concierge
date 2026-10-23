// Arma los datos del correo "Tu viaje está cotizado" a partir del snapshot de la cotización
// (_shared/quotes.ts) y de las listas en vivo que ya trajo analizar-viaje. Sin Deno, probado en
// src/test/emailSystem.test.ts.
//
// YA NO SE ENVÍA al crear el viaje (23-oct-2026): leía los renglones del snapshot, que salen de
// desglose_presupuesto y pueden quedar en 0 aunque vuelos_json / hospedaje_json traigan precios en vivo,
// y llegaba todo "NO DISPONIBLE" antes de que la persona eligiera nada. El correo con lo elegido es
// _shared/selection-email.ts (enviar-seleccion). Se conserva para las muestras y sus pruebas.
//
// Nada se inventa: los horarios y aeropuertos del vuelo solo se muestran si el vuelo sugerido es
// el mismo de la lista en vivo (mismo precio ±3 % y misma aerolínea); la foto y las estrellas del
// hotel, solo si el nombre coincide con el de Google Hotels. Si no, la tarjeta va sin esos datos.
import type { HeroImage, QuoteEmailInput, QuoteFlight, QuoteHotel } from "../_shared/email-templates.ts";
import type { QuoteRow } from "../_shared/quotes.ts";
import { sameName, samePrice } from "./sources.ts";

const norm = (v: unknown) => String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const sameAirline = (a: unknown, b: unknown) => {
  const x = norm(a), y = norm(b);
  return !!x && !!y && (x === y || x.includes(y) || y.includes(x));
};

const httpsOnly = (u: unknown) => (typeof u === "string" && /^https:\/\//.test(u) ? u : null);

export type QuoteEmailSources = {
  trip: { id: string; destino: string; ciudad_origen?: string | null; fecha_salida?: string | null; fecha_regreso?: string | null; num_viajeros?: number | null };
  snapshot: QuoteRow;
  saved?: { id: string; created_at?: string | null; valid_until?: string | null } | null;
  firstName?: string | null;
  vueloReferencia?: any;
  hotelReferencia?: any;
  /** flights-search (Google Flights), solo si la lista fue en vivo. */
  googleFlights?: any[];
  /** travelpayouts-flights (Aviasales). */
  tpFlights?: any[];
  /** hotels-search (Google Hotels), solo si la lista fue en vivo. */
  liveHotels?: any[];
  fxUsd: number;
  hero?: HeroImage | null;
  siteUrl?: string | null;
  now?: Date;
};

// Con tipo de cambio de respaldo el monto en MXN no está verificado: la tarjeta tampoco dice "en vivo"
// (igual que el renglón del desglose, ver lineStateFor en _shared/quotes.ts).
const isLive = (x: any, src: QuoteEmailSources) =>
  String(x?.estado_dato ?? "").toUpperCase() === "CONSULTADO_EN_VIVO" && !src.snapshot.fx_is_fallback;

function flightFrom(src: QuoteEmailSources): QuoteFlight | null {
  const v = src.vueloReferencia;
  if (!v || typeof v !== "object" || !v.aerolinea) return null;
  const live = isLive(v, src);
  const pp = Number(v.precio_por_persona) || 0;
  const flight: QuoteFlight = {
    airline: String(v.aerolinea),
    tier: v.tier ?? null,
    duration: v.duracion ?? null,
    stops: v.escalas ?? null,
    pricePerPerson: pp > 0 ? pp : null,
    source: v.fuente_precio ?? null,
    live,
    consultedAt: v.consultado_at ?? null,
    approximateDates: !!v.approximate_dates,
    mode: v.modo ?? null,
  };
  if (String(v.estado_dato ?? "").toUpperCase() === "CONSULTADO_EN_VIVO" && src.fxUsd > 0 && pp > 0) {
    if (v.fuente_precio === "serpapi") {
      const hit = (src.googleFlights ?? []).find((f) => samePrice(pp, Number(f?.price_per_person_usd) * src.fxUsd) && sameAirline(f?.airline, v.aerolinea));
      if (hit) {
        flight.departure = { code: hit.departure?.id ?? null, time: hit.departure?.time ?? null };
        flight.arrival = { code: hit.arrival?.id ?? null, time: hit.arrival?.time ?? null };
      }
    } else if (v.fuente_precio === "travelpayouts") {
      const hit = (src.tpFlights ?? []).find((f) => samePrice(pp, Number(f?.price) * src.fxUsd) && sameAirline(f?.airline, v.aerolinea));
      // Aviasales da la fecha de salida pero no la hora de llegada: solo aeropuertos.
      if (hit) {
        flight.departure = { code: hit.origin_airport ?? null, time: null };
        flight.arrival = { code: hit.destination_airport ?? null, time: null };
      }
    }
  }
  return flight;
}

function hotelFrom(src: QuoteEmailSources): QuoteHotel | null {
  const h = src.hotelReferencia;
  if (!h || typeof h !== "object" || !h.nombre) return null;
  const live = isLive(h, src);
  const match = (src.liveHotels ?? []).find((x) => sameName(x?.name, h.nombre)) ?? null;
  const cls = Number(String(match?.hotel_class ?? "").match(/\d/)?.[0]);
  return {
    name: String(h.nombre),
    type: h.tipo ?? null,
    area: h.barrio ?? null,
    // El rating de la lista en vivo manda sobre el que escribió el modelo.
    rating: Number(match?.rating) > 0 ? Number(match.rating) : null,
    stars: cls >= 1 && cls <= 5 ? cls : null,
    pricePerNight: Number(h.precio_por_noche) > 0 ? Number(h.precio_por_noche) : null,
    source: h.fuente_precio ?? null,
    live,
    consultedAt: h.consultado_at ?? null,
    photoUrl: httpsOnly(match?.thumbnail),
  };
}

export function buildQuoteEmailInput(src: QuoteEmailSources): QuoteEmailInput {
  const s = src.snapshot;
  const flight = flightFrom(src);
  return {
    firstName: src.firstName ?? null,
    tripId: src.trip.id,
    quoteId: src.saved?.id ?? null,
    destination: src.trip.destino,
    origin: src.trip.ciudad_origen ?? null,
    originCode: flight?.departure?.code ?? null,
    destinationCode: flight?.arrival?.code ?? null,
    dateFrom: s.date_from ?? src.trip.fecha_salida ?? null,
    dateTo: s.date_to ?? src.trip.fecha_regreso ?? null,
    travelers: s.travelers,
    rooms: s.rooms,
    nights: s.nights,
    currency: s.currency,
    lines: s.line_items.map((l) => ({
      category: l.category, label: l.label, amount: l.amount, state: l.state, source: l.source,
      consultedAt: l.consultado_at, qty: l.qty, qtyBasis: l.qty_basis,
    })),
    quotedAt: src.saved?.created_at ?? (src.now ?? new Date()).toISOString(),
    validUntil: src.saved?.valid_until ?? s.valid_until,
    fxIsFallback: s.fx_is_fallback,
    flight,
    hotel: hotelFrom(src),
    hero: src.hero ?? null,
    siteUrl: src.siteUrl ?? null,
    now: src.now,
  };
}
