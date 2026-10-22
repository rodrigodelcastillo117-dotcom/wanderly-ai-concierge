// Iato como asistente de reservas (Fase 9 y complemento, punto 9). Sin Deno: lo usa el grupo
// concierge2 en concierge-chat (al hablar de una oferta) y las pruebas.
//
// Iato solo dice lo que la oferta permite. Nunca afirma una compra, una reserva o una mesa confirmada
// salvo que la intención esté CONFIRMED con evidencia (provider/team), y nunca pide datos bancarios.
import type { BookingAction, BookingOffer, IntentState } from "./types.ts";

/** Frases del dueño, literales. */
export const IATO_PHRASES = {
  found_options: "Encontré estas opciones y puedes reservar aquí.",
  rate_pending: "El hotel seleccionado ofrece esta tarifa, pendiente de reconfirmación.",
  opentable: "Esta mesa se solicita en OpenTable.",
  operator: "La experiencia necesita confirmación del operador.",
  add_to_itinerary: "¿Quieres agregar la selección a tu itinerario?",
  price_may_change: "El precio puede cambiar al continuar en el proveedor.",
} as const;

/** Afirmaciones prohibidas sin una operación ejecutada y confirmada. */
export const FORBIDDEN_CLAIMS: RegExp[] = [
  /\bya\s+(te\s+)?(compr[eé]|pagu[eé]|emit[ií])\b/i,
  /\bya\s+(te\s+)?reserv[eé]\b/i,
  /\b(tu|la)\s+mesa\s+(est[aá]|qued[oó]|ya\s+est[aá])\s+confirmada/i,
  /\b(tu|la)\s+reserva(ci[oó]n)?\s+(est[aá]|qued[oó]|ya\s+est[aá])\s+confirmada/i,
  /\b(tu|el)\s+(vuelo|boleto|hotel)\s+(est[aá]|qued[oó]|ya\s+est[aá])\s+(comprado|reservado|pagado|confirmado)/i,
  /\bboleto\s+emitido\b/i,
  /\bhay\s+disponibilidad\s+(confirmada|garantizada)\b/i,
  /\b(n[uú]mero|datos)\s+de\s+(tu\s+)?tarjeta\b/i,
  /\bcvv\b|\bcvc\b/i,
];

/** Frases que violan la Fase 9 en un texto (vacío = aceptable). */
export function findFalseClaims(text: string, opts: { confirmed?: boolean } = {}): string[] {
  const out: string[] = [];
  for (const re of FORBIDDEN_CLAIMS) {
    const m = re.exec(String(text ?? ""));
    if (!m) continue;
    // Con una intención CONFIRMED con evidencia sí puede decir "tu reserva está confirmada"; nunca
    // puede pedir datos de tarjeta.
    if (opts.confirmed && !/tarjeta|cvv|cvc/i.test(m[0])) continue;
    out.push(m[0]);
  }
  return out;
}

function channelName(a: BookingAction): string {
  return a.kind === "whatsapp" ? "WhatsApp" : a.kind === "email" ? "correo" : a.kind === "sms" ? "SMS" : "teléfono";
}

/** Lo que Iato puede decir de una oferta según su acción principal (una o dos frases). */
export function iatoLineFor(offer: BookingOffer, state?: IntentState | null): string {
  if (state === "CONFIRMED") return "Tu reserva está confirmada por el proveedor. La puedes ver en tu viaje.";
  const a = offer.actions.find((x) => x.tier >= 1) ?? null;
  if (!a) return "No encontré una forma fiable de reservar esta opción. ¿Quieres que lo guarde en tu viaje para después?";
  const p = offer.product_type;
  switch (a.kind) {
    case "exact_offer":
      return `Puedes comprar esta oferta en ${a.processor}: la compra la haces con ellos. ${IATO_PHRASES.price_may_change}`;
    case "equivalent_search":
      if (p === "hotel" && offer.price) return `${IATO_PHRASES.rate_pending} Te abro sus tarifas en ${a.processor}.`;
      if (p === "flight") return `Te abro la búsqueda de este vuelo en ${a.processor}; ahí eliges y compras. No puedo llevar la tarifa exacta. ${IATO_PHRASES.price_may_change}`;
      return `${IATO_PHRASES.found_options} Es una búsqueda en ${a.processor}: confirma ahí fecha y precio.`;
    case "official_booking_page":
      if (p === "restaurant" && /opentable/i.test(a.processor)) return `${IATO_PHRASES.opentable} Elige ahí la fecha y hora; no te confirmo disponibilidad hasta que ellos lo hagan.`;
      return p === "restaurant"
        ? `Esta mesa se solicita en ${a.processor}. Elige ahí la fecha y hora; no te confirmo disponibilidad hasta que ellos lo hagan.`
        : `${IATO_PHRASES.found_options} Se reserva en ${a.processor}.`;
    case "whatsapp":
    case "email":
    case "sms":
    case "phone":
      return a.kind === "phone"
        ? `Te dejo el teléfono oficial y un guion para llamar. ${p === "restaurant" ? "La mesa queda confirmada solo cuando el restaurante te lo diga." : IATO_PHRASES.operator}`
        : `Te preparo el mensaje para enviarlo por ${channelName(a)} desde tu teléfono. ${p === "restaurant" ? "La mesa queda confirmada solo cuando el restaurante te responda." : IATO_PHRASES.operator}`;
    case "prive_request":
    case "assisted_request":
      return `${IATO_PHRASES.operator} Puedo enviar la solicitud al equipo de IATOS; no es una reserva hasta que confirmen.`;
    default:
      return `Puedes verlo en ${a.processor}. ${IATO_PHRASES.add_to_itinerary}`;
  }
}

/** Resumen compacto de una oferta para el modelo (sin URLs de afiliado ni datos internos). */
export function offerForIato(offer: BookingOffer) {
  return {
    offer_id: offer.offer_id,
    product_type: offer.product_type,
    title: offer.title,
    booking_mode: offer.booking_mode,
    price: offer.price,
    currency: offer.currency,
    price_checked_at: offer.price_checked_at,
    price_is_estimate: offer.price_is_estimate,
    actions: offer.actions.filter((a) => a.tier >= 1).map((a) => ({ kind: a.kind, label: a.label, processor: a.processor, mode: a.mode })),
    say: iatoLineFor(offer),
  };
}
