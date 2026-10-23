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
//   5. Brevedad (brevity.ts): sin consejos del vuelo que no pidió y recortado al tope del modo.
//   6. Honestidad: motivo correcto de cada falla, "sin verificar en vivo" en datos sin fuente,
//      nunca "reservé", aviso si una búsqueda no trajo datos, transfers con datos del viaje.

import { splitAnswer } from "./stream.ts";
import { collectEvidence, type ConciergeCard, enforceAvailabilityHonesty, enrichCardLinks, type ToolRun, validateCards } from "./cards.ts";
import { correctFailureClaims, enforceNoFakeBooking, labelUnverifiedFacts } from "./guard.ts";
import { type ActionContext, type ProposedAction, restaurantBookingLinks, validateAction, validateActions } from "./actions.ts";
import { directionsLink, uberLink, type TurnPlan } from "./planner.ts";
import { ensureTransferUsesKnownData } from "./context.ts";
import { itineraryActionScope, type TripPosition, type UserLocation, userTripPosition } from "./location.ts";
import { compactReply, dropUnaskedFlightAdvice } from "./brevity.ts";

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
  const cards = enrichCardLinks(merged, ev, {
    directions: (t) => directionsLink(t),
    ride: (t) => uberLink(t),
    booking: (v) => restaurantBookingLinks(v),
  }, { date: i.actionCtx.todayISO, party: i.party, city: i.city });

  const ctx: ActionContext = { ...i.actionCtx, priveExperienceIds: ev.priveIds };
  const acts = validateActions(data.actions, i.plan.suggestedActions, ctx, i.makeId);

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

  let text = split.text.slice(0, 4000);
  // Brevedad: primero lo que no pidió, luego el tope del modo; los guardarraíles van después.
  if (i.plan.avoidTopics?.includes("vuelo") && i.userMessage !== undefined) {
    const t = dropUnaskedFlightAdvice(text, i.userMessage);
    if (t !== text && t.trim()) { text = t; guards.push("sin_consejo_no_pedido"); }
  }
  const short = compactReply(text, { exigente: i.exigente });
  if (short.trimmed && short.text.trim()) { text = short.text; guards.push("respuesta_recortada"); }
  const before = text;
  text = correctFailureClaims(text, ev.unavailableState);
  if (text !== before) guards.push("motivo_corregido");
  const b2 = text;
  text = labelUnverifiedFacts(text, ev.available);
  if (text !== b2) guards.push("sin_verificar");
  const b3 = text;
  text = enforceNoFakeBooking(text, { hasConfirmedBookings: i.hasConfirmedBookings });
  if (text !== b3) guards.push("sin_reserva_falsa");
  const b4 = text;
  text = enforceAvailabilityHonesty(text, ev);
  if (text !== b4) guards.push("aviso_disponibilidad");

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
