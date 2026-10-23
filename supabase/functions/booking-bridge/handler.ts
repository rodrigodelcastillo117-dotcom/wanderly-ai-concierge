// booking-bridge: API tipada del Booking Bridge (sin Deno.serve: se prueba con Vitest inyectando
// las dependencias). Contrato completo en docs/iatos/IATOS_BOOKING_BRIDGE.md §API.
//
// El servidor NUNCA confía en una URL del cliente: reconstruye la oferta con los adaptadores de
// _shared/booking a partir de datos que él mismo carga (viaje con el JWT del usuario, catálogo Privé
// con service role) o de parámetros estructurados, vuelve a correr el resolver y solo entonces guarda
// el destino de la intención y firma el enlace de salida (booking-go).
import { checkAllowlisted, checkTrustedSource, checkUntrusted } from "../_shared/booking/allowlist.ts";
import { containsCardNumber, countryIso } from "../_shared/booking/channels.ts";
import { offerForIato } from "../_shared/booking/iato.ts";
import { langForCountry, REQUEST_LANGS, type RequestLang } from "../_shared/booking/messages.ts";
import {
  type FlightResultLike, type FlightSearchMeta, type HotelResultLike, type HotelSearchMeta, offerFromFlightResult, offerFromHotelResult,
  offerFromTripFlight, offerFromTripHotel, offerFromTripRestaurant, offerFromTripTour, offerFromVenue, type TripLike, type VenueInfo,
  venueFromTripPlace,
} from "../_shared/booking/offers.ts";
import type { RecheckResult } from "../_shared/booking/recheck.ts";
// roadtrip (cambio mínimo, ver docs/iatos/cierre2/ROADTRIP.md): renta de auto del road trip.
import { offerFromCarRental } from "../_shared/booking/carRental.ts";
import { type FollowUpOutcome, followUpTarget, intentStatusText, type Verification } from "../_shared/booking/states.ts";
import type { ActionKind, BookingAction, BookingOffer, IntentState } from "../_shared/booking/types.ts";

export type Rpc = (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: any; error: { message: string } | null }>;

export type TripRow = TripLike & {
  user_id?: string;
  vuelos_json?: any[] | null;
  hospedaje_json?: any[] | null;
  tours_json?: any[] | null;
  restaurantes_json?: any[] | null;
};

export type BridgeDeps = {
  userId: string;
  userLabel: string;
  /** Viaje leído con el JWT del usuario (RLS: dueño o colaborador aceptado). */
  loadTrip(tripId: string): Promise<TripRow | null>;
  /** Lugar del catálogo Privé por nombre+ciudad o por slug (service role, solo campos públicos). */
  venueLookup(q: { name?: string | null; city?: string | null; slug?: string | null }): Promise<VenueInfo | null>;
  /** RPC con service role (booking_intent_*). */
  rpc: Rpc;
  /** RPC con el JWT del usuario (prive_request_create exige su sesión Privé). */
  userRpc: Rpc;
  /** Intenciones del usuario (RLS). */
  listIntents(f: { trip_id?: string | null; id?: string | null }): Promise<any[]>;
  createAssistRequest(row: { trip_id: string | null; title: string; payload: Record<string, unknown> }): Promise<string | null>;
  notifyTeam(subject: string, html: string): Promise<boolean>;
  /** ¿El documento existe en trip_documents del viaje y lo subió este usuario? */
  tripDocumentOk(docId: string, tripId: string | null): Promise<boolean>;
  recheckFlight(q: Parameters<typeof import("../_shared/booking/recheck.ts").recheckFlight>[0]): Promise<RecheckResult>;
  recheckHotel(q: Parameters<typeof import("../_shared/booking/recheck.ts").recheckHotel>[0]): Promise<RecheckResult>;
  /** URL de booking-go firmada para la intención, atada al destino guardado y a su nivel (AUD-04). */
  /** `uses`: cuántas veces se había abierto ya la intención (redirect_count) al firmar (A2-T1). */
  goUrl(intentId: string, target: { url: string; tier: SignTier; uses?: number }): Promise<string | null>;
  /** Destino guardado de una intención del usuario (service role, filtrado por dueño) y la fuente de su acción. */
  intentTarget(intentId: string): Promise<{ target_url: string | null; action_trust: string | null } | null>;
  priveSession?: string | null;
  now?: () => number;
  flags?: { exact_flight_form?: boolean; reservas_email?: boolean };
};

export type Out = { status: number; body: Record<string, unknown> };
const ok = (body: Record<string, unknown>): Out => ({ status: 200, body: { ok: true, ...body } });
const fail = (status: number, code: string, message: string, extra: Record<string, unknown> = {}): Out =>
  ({ status, body: { ok: false, code, message, ...extra } });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IDEM = /^[A-Za-z0-9_-]{8,100}$/;
const COLS = ["vuelos_json", "hospedaje_json", "tours_json", "restaurantes_json"] as const;
type Col = typeof COLS[number];
const ACTION_KINDS: ActionKind[] = ["exact_offer", "equivalent_search", "official_booking_page", "official_website", "whatsapp", "email", "sms", "phone",
  "maps_listing", "assisted_request", "prive_request", "save_for_later"];

const str = (v: unknown, max = 200) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max) : "");
const normName = (s: unknown) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export type Draft = { date?: string | null; time?: string | null; party_size?: number | null; lang?: RequestLang; names?: string | null;
  occasion?: string | null; dietary?: string | null; accessibility?: string | null; notes?: string | null; contact?: string | null };

function parseDraft(d: any): Draft | null {
  if (!d || typeof d !== "object") return null;
  const date = typeof d.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d.date) ? d.date : null;
  const time = typeof d.time === "string" && /^\d{2}:\d{2}$/.test(d.time) ? d.time : null;
  const party = Number.isFinite(Number(d.party_size)) ? Math.min(30, Math.max(1, Math.round(Number(d.party_size)))) : null;
  const lang = REQUEST_LANGS.includes(d.lang) ? d.lang : undefined;
  return { date, time, party_size: party, lang, names: str(d.names, 120) || null, occasion: str(d.occasion, 120) || null,
    dietary: str(d.dietary, 300) || null, accessibility: str(d.accessibility, 300) || null, notes: str(d.notes, 500) || null, contact: str(d.contact, 120) || null };
}

// ───────────────────────────── Construcción de la oferta en el servidor ─────────────────────────────

type Source =
  | { type: "trip_item"; trip_id: string; col: Col; index: number; name?: string }
  | { type: "flight_result"; result: FlightResultLike; meta: FlightSearchMeta; trip_id?: string | null }
  | { type: "hotel_result"; result: HotelResultLike; meta: HotelSearchMeta; trip_id?: string | null }
  | { type: "venue"; name: string; city?: string | null; country?: string | null; prive_slug?: string | null;
      product_type?: "restaurant" | "experience" | "tour" | "event"; trip_id?: string | null }
  // roadtrip: búsqueda de auto de renta con ciudades y fechas (sin URL del cliente: la arma carRental.ts).
  | { type: "car_rental"; pickup_city: string; dropoff_city: string | null; pickup_date: string; dropoff_date: string; trip_id?: string | null };

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function parseSource(s: any): Source | null {
  if (!s || typeof s !== "object") return null;
  if (s.type === "trip_item" && UUID.test(String(s.trip_id)) && COLS.includes(s.col) && Number.isInteger(s.index) && s.index >= 0 && s.index < 200) {
    return { type: "trip_item", trip_id: s.trip_id, col: s.col, index: s.index, name: str(s.name) || undefined };
  }
  if (s.type === "flight_result" && s.result && typeof s.result === "object" && s.meta && typeof s.meta === "object") {
    return { type: "flight_result", result: s.result, meta: s.meta, trip_id: UUID.test(String(s.trip_id)) ? s.trip_id : null };
  }
  if (s.type === "hotel_result" && s.result && typeof s.result === "object" && s.meta && typeof s.meta === "object") {
    return { type: "hotel_result", result: s.result, meta: s.meta, trip_id: UUID.test(String(s.trip_id)) ? s.trip_id : null };
  }
  if (s.type === "car_rental" && str(s.pickup_city) && ISO_DAY.test(String(s.pickup_date)) && ISO_DAY.test(String(s.dropoff_date))) {
    return { type: "car_rental", pickup_city: str(s.pickup_city, 80), dropoff_city: str(s.dropoff_city, 80) || null,
      pickup_date: String(s.pickup_date), dropoff_date: String(s.dropoff_date), trip_id: UUID.test(String(s.trip_id)) ? s.trip_id : null };
  }
  if (s.type === "venue" && str(s.name)) {
    const pt = ["restaurant", "experience", "tour", "event"].includes(s.product_type) ? s.product_type : "restaurant";
    return { type: "venue", name: str(s.name, 160), city: str(s.city) || null, country: str(s.country, 2) || null,
      prive_slug: /^[a-z0-9-]{3,120}$/.test(String(s.prive_slug ?? "")) ? s.prive_slug : null, product_type: pt, trip_id: UUID.test(String(s.trip_id)) ? s.trip_id : null };
  }
  return null;
}

/** Resultados de búsqueda que manda el cliente: solo datos simples (sin URLs que no pasen la lista blanca). */
function sanitizeFlight(r: any): FlightResultLike {
  return {
    price_usd: Number(r?.price_usd) || null, price_per_person_usd: Number(r?.price_per_person_usd) || null, airline: str(r?.airline, 80) || null,
    stops: Number.isInteger(r?.stops) ? r.stops : null, duration: str(r?.duration, 20) || null,
    departure: { id: str(r?.departure?.id, 3).toUpperCase() || null, time: str(r?.departure?.time, 30) || null },
    arrival: { id: str(r?.arrival?.id, 3).toUpperCase() || null, time: str(r?.arrival?.time, 30) || null },
    booking_token: typeof r?.booking_token === "string" && r.booking_token.length <= 4000 ? r.booking_token : null,
    airline_buy_url: typeof r?.airline_buy_url === "string" && checkAllowlisted(r.airline_buy_url).ok ? r.airline_buy_url : null,
  };
}

async function buildOffer(src: Source, deps: BridgeDeps, draft: Draft | null): Promise<{ offer: BookingOffer; trip: TripRow | null } | Out> {
  const now = deps.now?.() ?? Date.now();
  const flags = { exact_flight_form: !!deps.flags?.exact_flight_form };
  const tripId = src.type === "trip_item" ? src.trip_id : src.trip_id ?? null;
  const trip = tripId ? await deps.loadTrip(tripId) : null;
  if (tripId && !trip) return fail(404, "TRIP_NOT_FOUND", "No encontramos ese viaje en tu cuenta.");

  if (src.type === "trip_item") {
    const item = (trip as any)?.[src.col]?.[src.index];
    if (!item) return fail(404, "ITEM_NOT_FOUND", "Esa opción ya no está en tu viaje (¿se volvió a cotizar?).");
    const name = String(item?.nombre ?? item?.aerolinea ?? "");
    // Evita reservar otra opción si la lista cambió entre que se pintó y se tocó (índices corridos).
    if (src.name && normName(src.name) !== normName(name)) return fail(409, "ITEM_CHANGED", "La opción cambió; recarga el viaje.");
    const city = str(item?.ciudad) || trip!.destino || null;
    const country = countryIso(trip!.pais_destino);
    if (src.col === "vuelos_json") return { offer: offerFromTripFlight(item, { trip: trip!, city, index: src.index, now, flags }), trip };
    // Catálogo Privé primero; si no está, los datos de Google Places que el viaje ya trae (googlemax).
    const venue = (await deps.venueLookup({ name: name.replace(` · ${city}`, ""), city }))
      ?? (src.col === "restaurantes_json" ? venueFromTripPlace(item, city, trip!.pais_destino) : null);
    const vCountry = venue?.country ?? country;
    const product = src.col === "restaurantes_json" ? "restaurant" : src.col === "hospedaje_json" ? "hotel" : "tour";
    const ctx = { trip: trip!, city, index: src.index, now, venue, country: vCountry,
      draft: draft ? { venue: venue?.name ?? name, product_type: product, ...draft, lang: draft.lang ?? langForCountry(vCountry) } as any : null };
    if (src.col === "hospedaje_json") return { offer: offerFromTripHotel(item, ctx), trip };
    if (src.col === "tours_json") return { offer: offerFromTripTour(item, ctx), trip };
    return { offer: offerFromTripRestaurant(item, ctx), trip };
  }
  if (src.type === "flight_result") {
    const meta: FlightSearchMeta = {
      dep_iata: str(src.meta.dep_iata, 3).toUpperCase(), arr_iata: str(src.meta.arr_iata, 3).toUpperCase(), depart: str(src.meta.depart, 10),
      return_date: str(src.meta.return_date, 10) || null, travelers: Number(src.meta.travelers) || 1, consulted_at: str(src.meta.consulted_at, 40) || null,
      source: src.meta.source === "serpapi" ? "serpapi" : src.meta.source === "travelpayouts" ? "travelpayouts" : null,
      // Viene del cliente: solo una búsqueda de Google Flights de verdad (lista blanca estricta).
      google_flights_url: checkAllowlisted(src.meta.google_flights_url).ok && /^https:\/\/www\.google\.com\/travel\/flights/.test(String(src.meta.google_flights_url))
        ? String(src.meta.google_flights_url) : null,
    };
    return { offer: offerFromFlightResult(sanitizeFlight(src.result), meta, { trip, now, flags }), trip };
  }
  if (src.type === "hotel_result") {
    const r = src.result as any;
    const h: HotelResultLike = { name: str(r?.name, 160) || null, nightly_usd: Number(r?.nightly_usd) || null, total_usd: Number(r?.total_usd) || null,
      rating: Number(r?.rating) || null, link: typeof r?.link === "string" ? r.link : null,
      property_token: typeof r?.property_token === "string" && r.property_token.length <= 1000 ? r.property_token : null };
    const meta: HotelSearchMeta = { city: str(src.meta.city), checkin: str(src.meta.checkin, 10), checkout: str(src.meta.checkout, 10),
      adults: Number(src.meta.adults) || 1, consulted_at: str(src.meta.consulted_at, 40) || null, source: src.meta.source === "serpapi" ? "serpapi" : null };
    // El sitio del hotel lo manda el cliente: offerFromHotelResult lo trata como "client" (lista blanca).
    return { offer: offerFromHotelResult(h, { ...meta, source: null }, { trip, now }), trip };
  }
  if (src.type === "car_rental") {
    return { offer: offerFromCarRental({ ...src, trip_id: trip?.id ?? null }, { now }), trip };
  }
  const venue = await deps.venueLookup({ name: src.name, city: src.city, slug: src.prive_slug });
  const country = venue?.country ?? countryIso(src.country) ?? countryIso(trip?.pais_destino);
  const d = draft ? { venue: venue?.name ?? src.name, product_type: src.product_type ?? "restaurant", ...draft, lang: draft.lang ?? langForCountry(country) } : null;
  return {
    offer: offerFromVenue(venue ?? { name: src.name, city: src.city, country }, src.product_type ?? "restaurant", { trip, now, country, draft: d as any }),
    trip,
  };
}

export type SignTier = "allowlist" | "trusted_source";

/**
 * ¿booking-go puede firmar la salida a este destino, y con qué nivel? (AUD-04)
 *  * "allowlist": la URL pasa la lista estricta; si la escribió la IA o la mandó el cliente, además
 *    sin redirects opacos (google.com/aclk, /travel/clk).
 *  * "trusted_source": fuera de la lista, solo si vino del catálogo curado o del escaneo del sitio
 *    oficial (datos que el usuario no puede editar).
 *  * null: no se firma. Un sitio que vino de trips.*_json (editable) se abre directo en el cliente,
 *    así nadie fabrica un enlace de IATOS hacia otro dominio.
 */
function signTier(url: string | null, trust: string | null | undefined): SignTier | null {
  if (!url) return null;
  if ((trust === "ai" || trust === "client" || trust === "google_places" ? checkUntrusted(url) : checkAllowlisted(url)).ok) return "allowlist";
  if ((trust === "curated_catalog" || trust === "official_site_scan") && checkTrustedSource(url).ok) return "trusted_source";
  return null;
}

const PRE_EXIT: IntentState[] = ["SELECTED", "PRICE_RECHECK_REQUIRED", "READY_TO_BOOK"];

function pickAction(offer: BookingOffer, kind: ActionKind): BookingAction | null {
  return offer.actions.find((a) => a.kind === kind) ?? null;
}

function snapshot(offer: BookingOffer, a: BookingAction | null, extra: Record<string, unknown> = {}) {
  return {
    offer_id: offer.offer_id, provider: offer.provider, product_type: offer.product_type, title: offer.title, city: offer.city,
    price: offer.price, currency: offer.currency, taxes: offer.taxes, price_checked_at: offer.price_checked_at, offer_expires_at: offer.offer_expires_at,
    price_is_estimate: offer.price_is_estimate, availability_status: offer.availability_status, traveler_count: offer.traveler_count,
    travel_dates: offer.travel_dates, booking_conditions: offer.booking_conditions, verification_status: offer.verification_status,
    action: a ? { kind: a.kind, label: a.label, processor: a.processor, preserves: a.preserves, disclosures: a.disclosures, evidence: a.evidence, trust: a.trust } : null,
    details: { search: (offer.details as any)?.search ?? null, booking_token: (offer.details as any)?.booking_token ?? null, property_token: (offer.details as any)?.property_token ?? null },
    ...extra,
  };
}

const CHANNEL: Partial<Record<ActionKind, string>> = { whatsapp: "whatsapp", email: "email", sms: "sms", phone: "phone", assisted_request: "iatos_team",
  prive_request: "prive", save_for_later: "none" };

function withStatus(i: any) {
  return { ...i, status_text: intentStatusText(i.state as IntentState, (i.verification ?? "none") as Verification, i.processor ?? "el proveedor") };
}

// ───────────────────────────── Acciones ─────────────────────────────

export async function handleBridge(action: string, body: any, deps: BridgeDeps): Promise<Out> {
  const draft = parseDraft(body?.draft);
  switch (action) {
    case "list_offers_for_trip": {
      if (!UUID.test(String(body?.trip_id))) return fail(400, "BAD_INPUT", "Falta el viaje.");
      const trip = await deps.loadTrip(body.trip_id);
      if (!trip) return fail(404, "TRIP_NOT_FOUND", "No encontramos ese viaje en tu cuenta.");
      const offers: Record<string, Array<ReturnType<typeof offerForIato> & { index: number; actions: BookingAction[] }>> = {};
      let lookups = 0;
      for (const col of COLS) {
        const items = Array.isArray((trip as any)[col]) ? (trip as any)[col].slice(0, 40) : [];
        offers[col] = [];
        for (let i = 0; i < items.length; i++) {
          // El catálogo solo se consulta para lugares (con tope por llamada).
          const r = col === "vuelos_json" || lookups++ < 40
            ? await buildOffer({ type: "trip_item", trip_id: trip.id!, col, index: i }, { ...deps, loadTrip: async () => trip }, null)
            : await buildOffer({ type: "trip_item", trip_id: trip.id!, col, index: i }, { ...deps, loadTrip: async () => trip, venueLookup: async () => null }, null);
          if ("offer" in r) offers[col].push({ ...offerForIato(r.offer), index: i, actions: r.offer.actions });
        }
      }
      const intents = (await deps.listIntents({ trip_id: trip.id })).map(withStatus);
      return ok({ trip_id: trip.id, offers, intents });
    }

    case "resolve": {
      const src = parseSource(body?.source);
      if (!src) return fail(400, "BAD_INPUT", "Faltan los datos de la opción.");
      const r = await buildOffer(src, deps, draft);
      if (!("offer" in r)) return r;
      return ok({ offer: r.offer, iato: offerForIato(r.offer) });
    }

    case "start_booking": {
      const src = parseSource(body?.source);
      const kind = body?.action_kind as ActionKind;
      const key = String(body?.idempotency_key ?? "");
      if (!src || !ACTION_KINDS.includes(kind) || !IDEM.test(key)) return fail(400, "BAD_INPUT", "Faltan datos para continuar.");
      // Paso 1 del dueño: guardar la selección en el viaje requiere consentimiento explícito.
      if (body?.consent !== true) return fail(400, "CONSENT_REQUIRED", "Confirma que quieres guardar esta selección en tu viaje.");
      const built = await buildOffer(src, deps, draft);
      if (!("offer" in built)) return built;
      const { offer } = built;
      const a = pickAction(offer, kind);
      if (!a) return fail(409, "ACTION_UNAVAILABLE", "Esa acción ya no está disponible para esta opción.", { offer });
      const expired = !!(offer.details as any)?.price_expired && (a.kind === "exact_offer" || a.kind === "equivalent_search");
      // Precio vencido: hay que comprobarlo o aceptar explícitamente que el proveedor mostrará el final.
      const state: IntentState = a.mode === "REQUEST" ? "REQUESTED"
        : a.kind === "save_for_later" ? "SELECTED"
        : expired && body?.ack_price_may_change !== true ? "PRICE_RECHECK_REQUIRED" : "READY_TO_BOOK";
      // Los canales (wa.me, mailto:, tel:, sms:) los abre el propio teléfono del usuario en el mismo
      // toque; no pasan por booking-go.
      const isWeb = !!a.url && a.url.startsWith("https://") && !["whatsapp", "email", "sms", "phone"].includes(a.kind);
      // booking-go solo firma destinos de la lista blanca o de fuentes que el usuario NO puede editar
      // (catálogo y escaneo de sitios oficiales); ver signTier.
      const tier = isWeb ? signTier(a.url, a.trust) : null;
      const web = isWeb && tier !== null;
      let conciergeId: string | null = null;

      if (a.kind === "prive_request") {
        const pid = (offer.details as any)?.prive_experience_id;
        const { data, error } = await deps.userRpc("prive_request_create", {
          _ps: deps.priveSession ?? "", _experience_id: pid, _requested_for: draft?.date ? `${draft.date}T${draft.time ?? "20:00"}:00` : null,
          _party_size: draft?.party_size ?? null, _preferences: draft?.notes ?? null, _contact_method: "app", _trip_id: built.trip?.id ?? null, _plan_group: null,
        });
        const code = /PRIVE_[A-Z_]+/.exec(error?.message ?? "")?.[0];
        if (error || !data?.ok) return fail(code ? 403 : 400, code ?? data?.code ?? "PRIVE_REQUEST_FAILED", "No se pudo enviar la solicitud Privé.");
        conciergeId = data.id;
      } else if (a.kind === "assisted_request") {
        conciergeId = await deps.createAssistRequest({ trip_id: built.trip?.id ?? null, title: offer.title.slice(0, 200),
          payload: { offer_id: offer.offer_id, product_type: offer.product_type, city: offer.city, draft } });
        if (!conciergeId) return fail(500, "REQUEST_NOT_SAVED", "No se pudo guardar la solicitud. Intenta de nuevo.");
      }

      const { data, error } = await deps.rpc("booking_intent_start", {
        _user: deps.userId,
        _p: {
          idempotency_key: key, offer_id: offer.offer_id, trip_id: built.trip?.id ?? null, product_type: offer.product_type, provider: offer.provider,
          provider_offer_id: offer.provider_offer_id, action_kind: a.kind, booking_mode: a.mode, state, title: offer.title,
          target_url: web ? a.url : null, target_host: isWeb ? a.host : null, processor: a.processor, channel: web ? "web" : CHANNEL[a.kind] ?? "none",
          offer: snapshot(offer, a, draft ? { request: { date: draft.date, time: draft.time, party_size: draft.party_size, lang: draft.lang ?? null } } : {}),
          price: offer.price, currency: offer.currency, price_checked_at: offer.price_checked_at, offer_expires_at: offer.offer_expires_at,
          consent: true, concierge_request_id: conciergeId,
        },
      });
      if (error || !data?.ok) return fail(error ? 500 : 409, data?.code ?? "INTENT_NOT_SAVED", "No se pudo guardar tu selección.");
      let intent = data.intent;
      // Ya había una intención viva de esta oferta (o es un reintento): su destino guardado puede ser
      // OTRO (el usuario eligió antes "Buscar en Booking" y ahora "Ver en Google Maps"). La salida
      // firmada siempre lleva al destino guardado, así que primero se alinea con lo que eligió ahora
      // (queda en el historial); si ya salió al proveedor, no se reescribe y no se firma (AUD-04).
      let canSign = web;
      if (web && (data.existing || data.replay) && !data.already_confirmed) {
        const stored = await deps.intentTarget(intent.id);
        if (stored?.target_url !== a.url) {
          canSign = false;
          if (PRE_EXIT.includes(intent.state)) {
            const t = await deps.rpc("booking_intent_transition", { _id: intent.id, _user: deps.userId, _to: intent.state, _actor: "usuario",
              _note: `Cambió la forma de continuar: ${a.label}`, _patch: { target_url: a.url, target_host: a.host, processor: a.processor, channel: "web",
                action_kind: a.kind, booking_mode: a.mode, offer: snapshot(offer, a) } });
            if (!t.error && t.data?.ok) { intent = t.data.intent; canSign = true; }
          }
        }
      }
      if (data.already_confirmed) {
        return ok({ intent: withStatus(intent), already_confirmed: true, message: "Ya tienes esta reserva confirmada en tu viaje." });
      }
      if (a.kind === "assisted_request" && !data.replay && !data.existing) {
        const { assistedRequestTeamEmail } = await import("../_shared/booking/emails.ts");
        const mail = assistedRequestTeamEmail({ title: offer.title, product_type: offer.product_type, city: offer.city, dates: draft?.date ?? offer.travel_dates.start,
          party: draft?.party_size ?? offer.traveler_count, state: "REQUESTED", user_label: deps.userLabel, message: draft?.notes ?? null, intent_id: intent.id });
        await deps.notifyTeam(mail.subject, mail.html).catch(() => false);
      }
      const go = canSign && tier && intent.state !== "PRICE_RECHECK_REQUIRED" ? await deps.goUrl(intent.id, { url: a.url!, tier, uses: Number(intent.redirect_count ?? 0) || 0 }) : null;
      return ok({
        intent: withStatus(intent), replay: !!data.replay, existing: !!data.existing,
        go_url: go, direct_url: isWeb && !canSign ? a.url : null,
        booking_mode: a.mode, target_host: a.host, processor: a.processor, disclosures: a.disclosures, preserves: a.preserves,
        // Canales: el cliente abre su propio enlace (wa.me / mailto / tel) en el mismo toque.
        channel: a.channel ?? null,
        needs_price_ack: intent.state === "PRICE_RECHECK_REQUIRED",
      });
    }

    case "confirm_price_ack": {
      // El usuario acepta continuar sin reconfirmar (el proveedor mostrará el precio final).
      if (!UUID.test(String(body?.intent_id))) return fail(400, "BAD_INPUT", "Falta la intención.");
      // Con accepted_price: aceptó el precio que acaba de comprobar "Actualizar precio" (queda en el historial).
      const accepted = Number(body?.accepted_price);
      const { data, error } = await deps.rpc("booking_intent_transition", { _id: body.intent_id, _user: deps.userId, _to: "READY_TO_BOOK", _actor: "usuario",
        _note: accepted > 0 ? `Aceptó el precio actualizado: ${Math.round(accepted * 100) / 100} ${str(body?.currency, 3) || "USD"}` : "Continuar sin reconfirmar el precio", _patch: {} });
      if (error || !data?.ok) return fail(409, data?.code ?? "TRANSITION_FAILED", "No se pudo continuar.");
      // Se firma el destino que quedó guardado, con el nivel de la fuente de su acción (AUD-04).
      const stored = await deps.intentTarget(body.intent_id);
      const tier = signTier(stored?.target_url ?? null, stored?.action_trust);
      return ok({ intent: withStatus(data.intent), go_url: tier ? await deps.goUrl(body.intent_id, { url: stored!.target_url!, tier, uses: Number(data.intent?.redirect_count ?? 0) || 0 }) : null });
    }

    case "recheck_price": {
      const src = parseSource(body?.source);
      if (!src || (src.type !== "flight_result" && src.type !== "hotel_result")) return fail(400, "NOT_RECHECKABLE", "Esta opción no se puede volver a consultar con su fuente.");
      const built = await buildOffer(src, deps, null);
      if (!("offer" in built)) return built;
      const o = built.offer;
      const det = o.details as any;
      let res: RecheckResult;
      if (o.product_type === "flight") {
        if (!det?.booking_token) return fail(400, "NOT_RECHECKABLE", "Esta opción no se puede volver a consultar con su fuente.");
        res = await deps.recheckFlight({ booking_token: det.booking_token, origin: det.search.origin, destination: det.search.destination, depart: det.search.depart,
          return_date: det.search.return_date, adults: det.search.adults, old_price: o.price });
      } else {
        if (!det?.property_token) return fail(400, "NOT_RECHECKABLE", "Esta opción no se puede volver a consultar con su fuente.");
        res = await deps.recheckHotel({ property_token: det.property_token, q: det.search.q, checkin: det.search.checkin, checkout: det.search.checkout,
          adults: det.search.adults, old_price: o.price, room: str(body?.room, 120) || null });
      }
      if (!res.ok) return ok({ recheck: res });
      // Compra exacta por formulario (booking_request de Google Flights): solo con la bandera encendida.
      // Apagada, el formulario ni siquiera llega al cliente (BB-08).
      if (!deps.flags?.exact_flight_form) res = { ...res, options: res.options.map((x) => (x.form ? { ...x, form: null } : x)) };
      // Si hay una intención viva, se actualiza su foto (precio y vigencia de la fuente). Si el precio
      // CAMBIÓ, queda en PRICE_RECHECK_REQUIRED: el usuario ve la diferencia y la acepta
      // (confirm_price_ack con accepted_price) antes de salir al proveedor.
      if (UUID.test(String(body?.intent_id))) {
        const sold = res.availability === "sold_out";
        const changed = !sold && res.price_change.changed;
        const to: IntentState = sold ? "FAILED" : changed ? "PRICE_RECHECK_REQUIRED" : "READY_TO_BOOK";
        const t = await deps.rpc("booking_intent_transition", {
          _id: body.intent_id, _user: deps.userId, _to: to, _actor: "usuario",
          _note: sold ? "La fuente ya no tiene precio para esas fechas" : `Precio comprobado (${res.price_change.direction})`,
          _patch: { price: res.price, currency: res.currency, price_checked_at: res.checked_at,
            offer_expires_at: new Date(Date.parse(res.checked_at) + (o.product_type === "flight" ? 6 : 12) * 3600_000).toISOString() },
        });
        const intent = !t.error && t.data?.ok ? t.data.intent : null;
        let go: string | null = null;
        if (intent && intent.state === "READY_TO_BOOK") {
          const stored = await deps.intentTarget(body.intent_id);
          const tier = signTier(stored?.target_url ?? null, stored?.action_trust);
          go = tier ? await deps.goUrl(body.intent_id, { url: stored!.target_url!, tier, uses: Number(intent.redirect_count ?? 0) || 0 }) : null;
        }
        return ok({ recheck: res, intent: intent ? withStatus(intent) : null, needs_price_ack: changed, go_url: go });
      }
      return ok({ recheck: res, needs_price_ack: res.availability !== "sold_out" && res.price_change.changed });
    }

    case "mark_returned": {
      const outcome = body?.outcome as FollowUpOutcome;
      if (!UUID.test(String(body?.intent_id)) || !["completed", "venue_confirmed", "other_time", "not_available", "not_completed", "still_waiting"].includes(outcome)) {
        return fail(400, "BAD_INPUT", "Faltan datos.");
      }
      const [cur] = await deps.listIntents({ id: body.intent_id });
      if (!cur) return fail(404, "NOT_FOUND", "No encontramos esa reserva.");
      const t = followUpTarget(cur.state, outcome);
      const note = str(body?.note, 500) || null;
      if (containsCardNumber(note)) return fail(400, "CARD_DATA_REJECTED", "No escribas datos de tarjeta: IATOS no los guarda.");
      const { data, error } = await deps.rpc("booking_intent_transition", {
        _id: body.intent_id, _user: deps.userId, _to: t.to ?? cur.state, _actor: "usuario", _note: `Seguimiento: ${outcome}`,
        _patch: { ...(t.verification !== "none" ? { verification: t.verification } : {}),
          user_report: { ...(cur.user_report ?? {}), outcome, note, reported_at: new Date(deps.now?.() ?? Date.now()).toISOString() } },
      });
      if (error || !data?.ok) return fail(409, data?.code ?? "TRANSITION_FAILED", "No se pudo guardar.");
      return ok({ intent: withStatus(data.intent) });
    }

    case "attach_user_proof": {
      if (!UUID.test(String(body?.intent_id))) return fail(400, "BAD_INPUT", "Falta la reserva.");
      if (body?.consent !== true) return fail(400, "CONSENT_REQUIRED", "Confirma que quieres guardar este comprobante.");
      const code = str(body?.confirmation_code, 60);
      const note = str(body?.note, 500);
      const doc = UUID.test(String(body?.trip_document_id)) ? String(body.trip_document_id) : null;
      if (!code && !doc) return fail(400, "BAD_INPUT", "Escribe el número de confirmación o adjunta el comprobante.");
      if (containsCardNumber(code) || containsCardNumber(note)) return fail(400, "CARD_DATA_REJECTED", "No escribas datos de tarjeta: IATOS no los guarda.");
      const [cur] = await deps.listIntents({ id: body.intent_id });
      if (!cur) return fail(404, "NOT_FOUND", "No encontramos esa reserva.");
      if (doc && !(await deps.tripDocumentOk(doc, cur.trip_id ?? null))) return fail(400, "BAD_DOCUMENT", "Ese documento no es de este viaje.");
      const t = followUpTarget(cur.state, "completed");
      const { data, error } = await deps.rpc("booking_intent_transition", {
        _id: body.intent_id, _user: deps.userId, _to: t.to ?? cur.state, _actor: "usuario", _note: "Comprobante registrado por el usuario",
        _patch: { verification: cur.state === "CONFIRMED" ? cur.verification : "user_declared",
          user_report: { ...(cur.user_report ?? {}), confirmation_code: code || null, note: note || null, trip_document_id: doc, consent: true,
            reported_at: new Date(deps.now?.() ?? Date.now()).toISOString() } },
      });
      if (error || !data?.ok) return fail(409, data?.code ?? "TRANSITION_FAILED", "No se pudo guardar el comprobante.");
      return ok({ intent: withStatus(data.intent), note: "Guardado como reserva declarada por ti (sin verificar con el proveedor)." });
    }

    case "status": {
      const f = UUID.test(String(body?.intent_id)) ? { id: body.intent_id } : UUID.test(String(body?.trip_id)) ? { trip_id: body.trip_id } : {};
      return ok({ intents: (await deps.listIntents(f)).map(withStatus) });
    }

    case "cancel": {
      if (!UUID.test(String(body?.intent_id))) return fail(400, "BAD_INPUT", "Falta la reserva.");
      const [cur] = await deps.listIntents({ id: body.intent_id });
      if (!cur) return fail(404, "NOT_FOUND", "No encontramos esa reserva.");
      if (cur.state === "CONFIRMED") {
        return fail(409, "CANCEL_WITH_PROVIDER", "Esta reserva está confirmada con el proveedor: cancélala con ellos (IATOS no puede hacerlo por ti).");
      }
      const { data, error } = await deps.rpc("booking_intent_transition", { _id: body.intent_id, _user: deps.userId, _to: "CANCELLED", _actor: "usuario",
        _note: "Cancelada por el usuario en IATOS", _patch: {} });
      if (error || !data?.ok) return fail(409, data?.code ?? "TRANSITION_FAILED", "No se pudo cancelar.");
      return ok({ intent: withStatus(data.intent) });
    }
  }
  return fail(400, "UNKNOWN_ACTION", "Acción desconocida.");
}
