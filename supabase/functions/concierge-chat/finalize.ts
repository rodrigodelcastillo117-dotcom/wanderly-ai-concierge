// Respuesta final de un turno de Iato (Concierge 2.0). Lógica pura, probada con Vitest.
//
// Orden (todo determinista, después del modelo):
//   1. Separar el texto visible del bloque de datos {cards, actions} (o leer el JSON viejo).
//   2. Cards validadas contra los resultados de herramientas de ESTE turno (precios, enlaces, tipos),
//      más las cards del planeador (transporte con Uber/Maps, alerta de emergencia) y los botones de
//      cómo llegar / Uber / llamar / reservar armados con la evidencia.
//   3. Acciones validadas con los viajes del usuario (y las sugeridas del planeador, máximo 3).
//   4. "Agregar a tu viaje" solo si el lugar está en una ciudad del viaje o el usuario lo pidió
//      (location.ts); un lugar local se ofrece para guardar en favoritos.
//   5. Brevedad (brevity.ts): lo mostrado en vivo se queda completo; solo lo que nadie vio se recorta,
//      por bloques completos y sin quitar la fuente.
//   6. Honestidad: motivo correcto de cada falla, "sin verificar en vivo" en datos sin fuente,
//      nunca "reservé", aviso si una búsqueda no trajo datos, transfers con datos del viaje.

import { splitAnswer } from "./stream.ts";
import { collectEvidence, type ConciergeCard, enforceAvailabilityHonesty, enforceFlightSellerHonesty, enrichCardLinks, eventCards, isTourDuplicate, MAX_CARDS, tourCards, tourTitlesOf, type ToolRun, validateCards } from "./cards.ts";
import { correctFailureClaims, enforceNoFakeBooking, enforceNoFakeRequest, labelUnverifiedFacts } from "./guard.ts";
import { type ActionContext, isGooglePlaceId, type ProposedAction, restaurantBookingLinks, validateAction, validateActions } from "./actions.ts";
import { directionsLink, uberLink, type TurnPlan } from "./planner.ts";
import { ensureTransferUsesKnownData, normText } from "./context.ts";
import { itineraryActionScope, type TripPosition, type UserLocation, userTripPosition } from "./location.ts";
import { compactReply, dropUnaskedFlightAdvice } from "./brevity.ts";
import { scrubProviders } from "../_shared/providerNames.ts";
import { applyHonesty, type HonestyCtx } from "./honesty.ts";

export interface FinalTurn {
  text: string;
  cards: ConciergeCard[];
  actions: ProposedAction[];
  dropped: { cards: { type: string; reason: string }[]; actions: { type: string; reason: string }[] };
  /** Etiquetas de honestidad que se aplicaron (para registro y pruebas). */
  guards: string[];
}

export interface FinalizeInput {
  raw: string;
  toolRuns: ToolRun[];
  plan: Pick<TurnPlan, "cards" | "suggestedActions"> & Partial<Pick<TurnPlan, "avoidTopics">>;
  actionCtx: ActionContext;
  requestIntel?: unknown;
  hasConfirmedBookings?: boolean;
  /** God Mode F1: solicitudes abiertas (reservation_state_v) para decir su estado real si el texto miente. */
  openRequests?: { title: string; label: string }[];
  /** Todas las solicitudes y reservas reales del usuario (cualquier estado), para la regla #10. */
  knownRequests?: { title: string }[];
  city?: string;
  party?: number;
  now?: Date;
  makeId?: () => string;
  /** Modo exigente: tope de largo mayor (brevity.ts). */
  exigente?: boolean;
  /** Último mensaje del usuario (¿pidió agregarlo al viaje?, ¿habló del vuelo?). */
  userMessage?: string;
  /** Viaje en contexto y dónde está el usuario frente a él (regla de "Agregar a tu viaje"). */
  tripScope?: { trip: any | null; position: TripPosition; user?: UserLocation | null } | null;
  /**
   * Texto que el usuario YA vio en vivo (turn.ts, ya sin los consejos del vuelo que no pidió). Con él,
   * la respuesta final es ese texto: nada de lo mostrado se recorta (P0 auditoría 10). Sin él (JSON),
   * se aplica el recorte seguro de brevity.ts.
   */
  liveText?: string;
  /** Oraciones que el filtro en vivo no mostró (consejos del vuelo que no pidió). */
  liveDropped?: number;
  /** Oraciones que los guardarraíles de honestidad en vivo quitaron o corrigieron (honesty.ts). */
  liveRevised?: number;
  /** Contexto de los guardarraíles de honestidad (honesty.ts): se aplica también a la respuesta en JSON. */
  honesty?: HonestyCtx | null;
}

export function finalizeTurn(i: FinalizeInput): FinalTurn {
  const guards: string[] = [];
  const split = splitAnswer(i.raw);
  const data = split.data ?? {};
  const ev = collectEvidence(i.toolRuns);

  const fromModel = validateCards(data.cards, ev, (i.now ?? new Date()).toISOString());
  const planCards = validateCards(i.plan.cards, ev, (i.now ?? new Date()).toISOString());
  // Las del planeador solo si el modelo no trajo una del mismo tipo.
  const modelTypes = new Set(fromModel.cards.map((c) => c.type));
  const merged = [...fromModel.cards, ...planCards.cards.filter((c) => !modelTypes.has(c.type))]
    // Las cards del planeador traen enlaces armados por IATOS (Uber/Maps): se conservan validados.
    .map((c) => {
      const src = (i.plan.cards as Record<string, unknown>[]).find((p) => p.type === c.type && p.title === c.title);
      return src?.links && !c.links ? { ...c, links: src.links as ConciergeCard["links"] } : c;
    });
  // Event Radar: las cards de eventos salen SOLO de search_events de este turno (el modelo no las escribe).
  const events = eventCards(i.toolRuns, (i.now ?? new Date()).toISOString());
  // Tours de Viator: igual, solo de search_tours de este turno.
  const tours = tourCards(i.toolRuns, (i.now ?? new Date()).toISOString());
  // Un tour que el modelo reescribió como "atracción" no se repite (ni se le ponen boletos oficiales).
  const tourTitles = tourTitlesOf(i.toolRuns);
  const notTours = merged.filter((c) => {
    if (!isTourDuplicate(c, tourTitles, ev.places)) return true;
    fromModel.dropped.push({ type: c.type, reason: "tour_repetido" });
    return false;
  });
  const cards = [...events, ...tours, ...enrichCardLinks(notTours, ev, {
    directions: (t) => directionsLink(t),
    ride: (t) => uberLink(t),
    booking: (v) => restaurantBookingLinks(v),
  }, { date: i.actionCtx.todayISO, party: i.party, city: i.city })].slice(0, MAX_CARDS);

  // Reservas IA: solo se le escribe a un lugar de Google que devolvieron las herramientas en este turno.
  const places = ev.places.filter((p) => isGooglePlaceId(p.placeId)).map((p) => ({ placeId: p.placeId!, name: p.name, ...(p.city ? { city: p.city } : {}) }));
  const ctx: ActionContext = { ...i.actionCtx, priveExperienceIds: ev.priveIds, places };
  const acts = validateActions(data.actions, i.plan.suggestedActions, ctx, i.makeId);
  // Viaje nacional: la lista de empaque no lleva adaptador de corriente (auditoría 10, N10).
  if (i.honesty?.domesticTrip) {
    for (const a of acts.actions) {
      if (a.type !== "add_packing_items" || !Array.isArray(a.params.items)) continue;
      const items = (a.params.items as unknown[]).filter((x) => !/adaptador/i.test(String(x)));
      if (items.length !== (a.params.items as unknown[]).length) { a.params = { ...a.params, items }; guards.push("sin_adaptador_nacional"); }
    }
    acts.actions = acts.actions.filter((a) => a.type !== "add_packing_items" || (a.params.items as unknown[]).length > 0);
  }

  // "Agregar a tu viaje X" para un restaurante de otra ciudad no tiene sentido: se quita y, si el lugar
  // salió de los resultados, se ofrece guardarlo en favoritos.
  if (i.tripScope) {
    const sc = i.tripScope;
    const kept: ProposedAction[] = [];
    let local: { name: string; address?: string; lat?: number; lng?: number; mapsUrl?: string; website?: string } | null = null;
    for (const a of acts.actions) {
      if (a.type !== "add_itinerary_item") { kept.push(a); continue; }
      // El viaje de la acción: el de contexto (con hoteles) u otro de sus viajes (con su destino).
      const isCtx = !!sc.trip && a.params.trip_id === sc.trip.id;
      const trip = isCtx ? sc.trip : ctx.trips.find((t) => t.id === a.params.trip_id) ?? null;
      if (!trip) { kept.push(a); continue; }
      const position = isCtx ? sc.position : userTripPosition(trip, sc.user ?? null);
      const scope = itineraryActionScope({ trip, params: a.params, places: ev.places, position, userMessage: i.userMessage ?? "" });
      if (scope.keep) { kept.push(a); continue; }
      acts.dropped.push({ type: a.type, reason: scope.why });
      guards.push("agregar_al_viaje_fuera_de_destino");
      if (scope.keep === false && scope.place) local = local ?? scope.place;
    }
    if (local && !kept.some((a) => a.type === "save_place") && kept.length < 3) {
      const v = validateAction("save_place", {
        nombre: local.name, direccion: local.address, maps_url: local.mapsUrl, sitio: local.website, lat: local.lat, lng: local.lng, tipo: "restaurante",
      }, ctx);
      if (v.ok) kept.push({ id: (i.makeId ?? (() => crypto.randomUUID()))(), ...v.action });
    }
    acts.actions = kept;
  }

  // "Agregar al itinerario" (acción existente, la confirma el usuario) para el primer evento con fecha
  // dentro del viaje en contexto.
  // Sin viaje en contexto, otro de sus viajes cuyas fechas incluyan el evento y cuyo destino nombre la ciudad.
  const inTrip = (t: { fecha_salida?: string | null; fecha_regreso?: string | null } | null | undefined, d?: string) =>
    !!(t && d && t.fecha_salida && String(t.fecha_salida).slice(0, 10) <= d && (!t.fecha_regreso || d <= String(t.fecha_regreso).slice(0, 10)));
  const tripCtx = i.tripScope?.trip ?? null;
  let evTrip: { id: string } | null = null;
  let ev0 = events.find((e) => inTrip(tripCtx, e.event_date));
  if (ev0 && tripCtx?.id) evTrip = tripCtx;
  else if (!tripCtx) {
    for (const e of events) {
      const place = normText(`${e.meta ?? ""} ${e.address ?? ""}`);
      const t = ctx.trips.find((x) => inTrip(x, e.event_date) && normText(x.destino).split(/[\s,·→-]+/).some((w) => w.length > 3 && place.includes(w)));
      if (t) { ev0 = e; evTrip = t; break; }
    }
  }
  if (ev0 && evTrip && acts.actions.length < 3 && !acts.actions.some((a) => a.type === "add_itinerary_item")) {
    const tm = ev0.fuente === "ticketmaster";
    const v = validateAction("add_itinerary_item", {
      trip_id: evTrip.id, fecha: ev0.event_date, hora: ev0.event_time, titulo: ev0.title,
      lugar: [ev0.meta, ev0.address].filter(Boolean).join(", ") || undefined,
      nota: tm ? "Evento de Ticketmaster; los boletos se compran en Ticketmaster." : "Evento de Google Events; los boletos se compran en el sitio de boletos.",
    }, ctx);
    if (v.ok) acts.actions.push({ id: (i.makeId ?? (() => crypto.randomUUID()))(), ...v.action, confirm_label: "Guardar en mi viaje" });
  }

  const live = typeof i.liveText === "string" && i.liveText.trim() ? i.liveText.trim() : null;
  let text = (live ?? split.text).slice(0, 4000);
  if (live) {
    // Ya se mostró en vivo: se queda completo (la brevedad la pide el prompt). Solo se registra si el
    // filtro en vivo no mostró consejos del vuelo que no pidió.
    if (i.liveDropped) guards.push("sin_consejo_no_pedido");
    if (i.liveRevised) guards.push("honestidad_en_vivo");
  } else {
    // Respuesta que nadie vio todavía: primero lo que no pidió, luego el tope del modo (por bloques
    // completos, sin dejar nada colgando ni quitar la fuente). Los guardarraíles van después.
    if (i.plan.avoidTopics?.includes("vuelo") && i.userMessage !== undefined) {
      const t = dropUnaskedFlightAdvice(text, i.userMessage);
      if (t !== text && t.trim()) { text = t; guards.push("sin_consejo_no_pedido"); }
    }
    const short = compactReply(text, { exigente: i.exigente });
    if (short.trimmed && short.text.trim()) { text = short.text; guards.push("respuesta_recortada"); }
    if (i.honesty) {
      const h = applyHonesty(text, i.honesty);
      if (h.revised && h.text.trim()) { text = h.text.trim(); guards.push("honestidad_en_vivo"); }
    }
  }
  const before = text;
  text = correctFailureClaims(text, ev.unavailableState);
  if (text !== before) guards.push("motivo_corregido");
  const b2 = text;
  text = labelUnverifiedFacts(text, ev.available);
  if (text !== b2) guards.push("sin_verificar");
  const b3 = text;
  text = enforceNoFakeBooking(text, { hasConfirmedBookings: i.hasConfirmedBookings, openRequests: i.openRequests });
  if (text !== b3) guards.push("sin_reserva_falsa");
  const b3b = text;
  text = enforceNoFakeRequest(text, { openRequests: [...(i.openRequests ?? []), ...(i.knownRequests ?? [])] });
  if (text !== b3b) guards.push("sin_solicitud_falsa");
  const b4 = text;
  text = enforceAvailabilityHonesty(text, ev);
  if (text !== b4) guards.push("aviso_disponibilidad");
  const b5 = text;
  text = enforceFlightSellerHonesty(text, ev);
  if (text !== b5) guards.push("vuelo_misma_fuente");

  // Sin nombres técnicos de proveedores ("Google Hotels vía SerpApi", auditoría 10 #8).
  const b6 = text;
  text = scrubProviders(text);
  if (text !== b6) guards.push("sin_nombres_tecnicos");

  let out: { text: string; cards: ConciergeCard[] } = { text, cards };
  if (i.requestIntel) {
    const g = ensureTransferUsesKnownData(i.requestIntel, out);
    if (g !== out) { guards.push("transfer_con_datos_del_viaje"); out = { text: g.text, cards: g.cards ?? cards }; }
  }
  if (!out.text.trim()) {
    out.text = out.cards.length || acts.actions.length ? "Esto es lo que encontré:" : "No alcancé a armar una respuesta. ¿Me lo pides de nuevo?";
  }
  return { text: out.text, cards: out.cards, actions: acts.actions, dropped: { cards: [...fromModel.dropped, ...planCards.dropped], actions: acts.dropped }, guards };
}
