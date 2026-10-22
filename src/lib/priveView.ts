// Qué pantalla de /prive corresponde a cada estado del servidor (contrato Privé §4). Es una función
// pura para poder probar cada estado. Ocultar pantallas no da acceso: el servidor vuelve a revisar
// todo (PRO vigente, 90 días o concesión, membresía activa y sesión Privé) en cada llamada.
import type { PriveErrorCode, PriveStatus } from "@/lib/priveApi";

export type PriveView =
  | "teaser" // cuenta sin PRO y sin membresía
  | "progress" // PRO con menos de 90 días pagados
  | "preparing" // ya cumple, la invitación se está generando (cron)
  | "invitation" // invitación lista
  | "set_password" // membresía activa sin contraseña (ceremonia a medias)
  | "paused_pro" // membresía activa, pero PRO terminó
  | "paused_tenure" // membresía activa, pero un reembolso dejó la antigüedad bajo 90 (D3)
  | "revoked"
  | "must_reset" // el servidor pide una contraseña nueva (o bloqueo total: solo el correo lo libera)
  | "locked" // pantalla de contraseña
  | "unlocked";

export function derivePriveView(s: PriveStatus, hasSession: boolean): PriveView {
  const m = s.membership_status;
  if (m === "revoked") return "revoked";
  if (m === "active") {
    if (!s.is_pro) return "paused_pro";
    if (!s.eligible) return "paused_tenure";
    if (!s.has_password) return "set_password";
    if (s.password_status === "must_reset" || s.password_status === "hard_locked") return "must_reset";
    return hasSession ? "unlocked" : "locked";
  }
  // Invitada pero sin PRO vigente: la invitación espera; la pausa se explica igual que a un miembro.
  if (!s.is_pro) return m === "invited" ? "paused_pro" : "teaser";
  if (!s.eligible) return "progress";
  if (m === "invited" || s.invitation_pending) return "invitation";
  return "preparing";
}

/** Fracción del anillo de progreso (0–1), nunca más de 1. */
export const tenureFraction = (s: Pick<PriveStatus, "tenure_days" | "required_days">) =>
  Math.max(0, Math.min(1, s.tenure_days / (s.required_days || 90)));

export type InvitationMessageKind = PriveErrorCode | "ALREADY_ACTIVE" | "REVOKED" | "RESENT" | "STATUS_ERROR";

/** Por dónde empieza /prive/invitacion según el estado del servidor. */
export function invitationStart(s: PriveStatus): { scene: "arrival" | "access" | "message"; message?: { kind: InvitationMessageKind } } {
  if (s.membership_status === "active") {
    if (s.has_password) return { scene: "message", message: { kind: "ALREADY_ACTIVE" } };
    // Aceptó pero no creó su contraseña: se reanuda en el paso 4.
    if (s.is_pro && s.eligible) return { scene: "access" };
  }
  if (s.membership_status === "revoked") return { scene: "message", message: { kind: "REVOKED" } };
  if (!s.is_pro) return { scene: "message", message: { kind: "NOT_PRO" } };
  if (!s.eligible) return { scene: "message", message: { kind: "NOT_ELIGIBLE" } };
  return { scene: "arrival" };
}

/**
 * ¿Hay que preguntarle al servidor de quién es el enlace antes de mostrar el mensaje inicial?
 * Una cuenta sin PRO (o sin antigüedad) que abre un enlace reenviado veía "Privé es parte de IATOS
 * PRO" en vez de "Esta invitación es para otra cuenta". Con token pendiente se consulta
 * accept_invitation: el servidor revisa el dueño del token ANTES que el plan y, para la dueña sin
 * derecho vigente, devuelve NOT_PRO/NOT_ELIGIBLE sin cambiar nada (no consume la invitación).
 */
export const shouldProbeInvitationOwner = (kind: InvitationMessageKind | undefined, hasToken: boolean) =>
  hasToken && (kind === "NOT_PRO" || kind === "NOT_ELIGIBLE");
