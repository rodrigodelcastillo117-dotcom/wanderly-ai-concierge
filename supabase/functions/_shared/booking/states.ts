// Ciclo de vida de una intención de reserva (Fase 8). Sin Deno. La MISMA tabla de transiciones vive
// en SQL (public.booking_intent_transition_ok, migración 20261023180000): la base es la autoridad y
// esta copia sirve para la pantalla y las pruebas (src/test/bookingBridge*.test.ts las comparan).
//
// Reglas:
//  * REDIRECTED_TO_PROVIDER nunca pasa solo a CONFIRMED: un clic no es una compra.
//  * CONFIRMED exige evidencia del proveedor (API/webhook) o del equipo; lo que declara el usuario se
//    guarda como "declarada por ti", sin verificar (verification = user_declared).
import type { IntentState } from "./types.ts";

export const INTENT_STATES: IntentState[] = [
  "SELECTED", "PRICE_RECHECK_REQUIRED", "READY_TO_BOOK", "REDIRECTED_TO_PROVIDER", "REQUESTED",
  "PENDING_CONFIRMATION", "CONFIRMED", "FAILED", "CANCELLED", "EXPIRED",
];

export const TERMINAL_STATES: IntentState[] = ["FAILED", "CANCELLED", "EXPIRED"];

export const TRANSITIONS: Record<IntentState, IntentState[]> = {
  SELECTED: ["PRICE_RECHECK_REQUIRED", "READY_TO_BOOK", "REQUESTED", "CANCELLED", "EXPIRED", "FAILED"],
  PRICE_RECHECK_REQUIRED: ["READY_TO_BOOK", "FAILED", "CANCELLED", "EXPIRED"],
  READY_TO_BOOK: ["REDIRECTED_TO_PROVIDER", "PRICE_RECHECK_REQUIRED", "REQUESTED", "CANCELLED", "EXPIRED", "FAILED"],
  REDIRECTED_TO_PROVIDER: ["PENDING_CONFIRMATION", "READY_TO_BOOK", "CONFIRMED", "FAILED", "CANCELLED", "EXPIRED"],
  REQUESTED: ["PENDING_CONFIRMATION", "CONFIRMED", "FAILED", "CANCELLED", "EXPIRED"],
  PENDING_CONFIRMATION: ["CONFIRMED", "FAILED", "CANCELLED", "EXPIRED"],
  CONFIRMED: ["CANCELLED"],
  FAILED: [],
  CANCELLED: [],
  EXPIRED: [],
};

export const canTransition = (from: IntentState, to: IntentState) => TRANSITIONS[from]?.includes(to) ?? false;

/** Evidencia aceptada para CONFIRMED (CHECK en la base). La del usuario no cuenta. */
export const CONFIRMING_EVIDENCE = ["provider_api", "provider_webhook", "team_verified", "prive_request_confirmed"] as const;

export type Verification = "none" | "user_declared" | "provider_verified" | "team_verified";

/** Texto honesto para el usuario. */
export function intentStatusText(state: IntentState, verification: Verification = "none", provider = "el proveedor"): string {
  if (state === "PENDING_CONFIRMATION" && verification === "user_declared") {
    return `Reserva declarada por ti · sin verificar con ${provider}`;
  }
  switch (state) {
    case "SELECTED": return "Seleccionado · aún no reservado";
    case "PRICE_RECHECK_REQUIRED": return "Comprueba el precio antes de continuar";
    case "READY_TO_BOOK": return "Listo para continuar en el proveedor";
    case "REDIRECTED_TO_PROVIDER": return `Abriste ${provider} · aún no sabemos si completaste la compra`;
    case "REQUESTED": return "Solicitud enviada · aún no es una reserva";
    case "PENDING_CONFIRMATION": return "Pendiente de confirmación · aún no es una reserva";
    case "CONFIRMED": return verification === "team_verified" ? "Confirmada (verificada por el equipo de IATOS)" : "Confirmada por el proveedor";
    case "FAILED": return "No se pudo reservar";
    case "CANCELLED": return "Cancelada";
    case "EXPIRED": return "Vencida";
  }
}

/** Solicitud Privé (20261023100300) → estado de la intención ligada. */
export function priveStatusToIntent(status: string): IntentState | null {
  switch (status) {
    case "solicitado": return "REQUESTED";
    case "pendiente_confirmacion": return "PENDING_CONFIRMATION";
    case "confirmado_externamente": return "CONFIRMED";
    case "cancelado": return "CANCELLED";
    case "rechazado": return "FAILED";
    case "caducado": return "EXPIRED";
    default: return null;
  }
}

/**
 * Reservas IA v1 (grupo reservas, tabla ai_reservations) → intención. Igual que su toBridgeState
 * (_shared/ai-reservations/core.ts) salvo needs_user sin motivo, que aquí queda pendiente; un estado
 * desconocido queda pendiente (nunca confirmado) y "confirmed" exige evidencia en la base.
 */
export function reservasStatusToIntent(status: string): IntentState {
  switch (String(status ?? "").toLowerCase()) {
    case "draft": case "borrador": return "SELECTED";
    case "awaiting_user_ok": return "READY_TO_BOOK"; // el usuario aún no confirma el envío
    case "queued": case "sent": case "enviada": case "enviado": case "requested": return "REQUESTED";
    case "awaiting_reply": case "replied": case "respondida": case "alternative_offered": case "otra_hora": case "needs_user": return "PENDING_CONFIRMATION";
    case "confirmed": case "confirmada": return "CONFIRMED"; // solo si el flujo de reservas guardó la respuesta del lugar (evidencia)
    case "declined": case "rechazada": case "no_availability": case "sin_disponibilidad": case "failed": case "bounced": return "FAILED";
    case "cancelled": case "cancelada": return "CANCELLED";
    case "expired": case "vencida": return "EXPIRED";
    default: return "PENDING_CONFIRMATION";
  }
}

/** Respuesta del usuario a "¿Completaste tu reserva?" / "¿Te respondieron?". */
export type FollowUpOutcome = "completed" | "venue_confirmed" | "other_time" | "not_available" | "not_completed" | "still_waiting";

/** Siguiente estado según lo que DECLARA el usuario (nunca CONFIRMED). */
export function followUpTarget(from: IntentState, outcome: FollowUpOutcome): { to: IntentState | null; verification: Verification } {
  switch (outcome) {
    case "completed":
    case "venue_confirmed":
      // Si ya estaba pendiente, solo cambia la verificación a "declarada por el usuario".
      return { to: canTransition(from, "PENDING_CONFIRMATION") ? "PENDING_CONFIRMATION" : null, verification: "user_declared" };
    case "other_time":
    case "still_waiting":
      return { to: canTransition(from, "PENDING_CONFIRMATION") ? "PENDING_CONFIRMATION" : null, verification: "none" };
    case "not_available":
      return { to: canTransition(from, "FAILED") ? "FAILED" : null, verification: "none" };
    case "not_completed":
      return { to: canTransition(from, "READY_TO_BOOK") ? "READY_TO_BOOK" : null, verification: "none" };
  }
}
