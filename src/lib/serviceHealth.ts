/** El chequeo corre a diario; si el último tiene más de esto, el chequeo mismo dejó de correr. */
export const HEALTH_STALE_HOURS = 26;

export function isHealthStale(ranAt: string | null | undefined, now: Date = new Date()): boolean {
  if (!ranAt) return false;
  const t = Date.parse(ranAt);
  return Number.isFinite(t) && now.getTime() - t > HEALTH_STALE_HOURS * 3_600_000;
}

/** Texto para el administrador sobre el correo de alerta de ese chequeo. */
export function emailStatusLabel(status: string | null | undefined): string | null {
  switch (status) {
    case "sent": return "Se mandó el correo de alerta.";
    case "partial": return "El correo de alerta solo llegó a algunos destinatarios.";
    case "failed": return "No se pudo mandar el correo de alerta.";
    case "no_recipient": return "No hay a quién mandar el correo de alerta (configura HEALTH_ALERT_EMAIL).";
    case "skipped_unchanged": return "Sin correo: lo pendiente es lo mismo que ya se avisó.";
    default: return null;
  }
}
