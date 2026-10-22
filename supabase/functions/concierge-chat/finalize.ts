// Respuesta final de un turno de Iato (Concierge 2.0). Lógica pura, probada con Vitest.
//
// Orden (todo determinista, después del modelo):
//   1. Separar el texto visible del bloque de datos {cards, actions} (o leer el JSON viejo).
//   2. Cards validadas contra los resultados de herramientas de ESTE turno (precios, enlaces, tipos),
//      más las cards del planeador (transporte con Uber/Maps, alerta de emergencia) y los botones de
//      cómo llegar / Uber / llamar / reservar armados con la evidencia.
//   3. Acciones validadas con los viajes del usuario (y las sugeridas del planeador, máximo 3).
//   4. Honestidad: motivo correcto de cada falla, "sin verificar en vivo" en datos sin fuente,
//      nunca "reservé", aviso si una búsqueda no trajo datos, transfers con datos del viaje.

import { splitAnswer } from "./stream.ts";
import { collectEvidence, type ConciergeCard, enforceAvailabilityHonesty, enrichCardLinks, type ToolRun, validateCards } from "./cards.ts";
import { correctFailureClaims, enforceNoFakeBooking, labelUnverifiedFacts } from "./guard.ts";
import { type ActionContext, type ProposedAction, restaurantBookingLinks, validateActions } from "./actions.ts";
import { directionsLink, uberLink, type TurnPlan } from "./planner.ts";
import { ensureTransferUsesKnownData } from "./context.ts";

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
  plan: Pick<TurnPlan, "cards" | "suggestedActions">;
  actionCtx: ActionContext;
  requestIntel?: unknown;
  hasConfirmedBookings?: boolean;
  city?: string;
  party?: number;
  now?: Date;
  makeId?: () => string;
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

  let text = split.text.slice(0, 4000);
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
