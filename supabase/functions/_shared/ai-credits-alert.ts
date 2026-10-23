// Aviso al equipo cuando la IA de imágenes se queda sin créditos (gateway 402) o sin llave. Sin Deno ni
// SDK: quien lo usa inyecta la base y el correo; se prueba con Vitest (src/test/aiCreditsAlert.test.ts).
//
// · A la persona se le sigue mostrando el mensaje amable de siempre (no cambia).
// · Al equipo: campana a cada administrador con alert_admins_ai_credits (una vez por servicio, motivo
//   y día UTC; migración 20261027100100). Si la campana es nueva (o no hay administradores) y hay
//   correo configurado (RESEND_API_KEY y HEALTH_ALERT_EMAIL, los mismos de health-check), también un
//   correo. Así no se repite: muchas personas fallando el mismo día = un solo aviso.
// · Además, cada instancia de la función recuerda el último aviso (30 min; 6 h si no hay
//   administradores, porque entonces la base no puede deduplicar) para no llamar a la base ni mandar
//   correos en cada intento fallido.
// · Nunca lanza ni retrasa la respuesta a la persona más de lo necesario.

export type AiCreditsReason = "sin_saldo" | "sin_llave";

export interface AiCreditsAlertDeps {
  /** RPC alert_admins_ai_credits: n > 0 campanas nuevas, 0 ya avisado hoy, -1 sin administradores. */
  rpc(service: "imagenes", reason: AiCreditsReason): PromiseLike<{ data: unknown; error: { message: string } | null }>;
  /** Correos fijos de alerta (HEALTH_ALERT_EMAIL, ya limpios); vacío = sin correo. */
  emailTo: string[];
  sendEmail?: (to: string[], subject: string, text: string) => Promise<boolean>;
  now?: () => number;
  log?: (...a: unknown[]) => void;
}

export type AiCreditsAlertStatus = "omitido_reciente" | "ya_avisado" | "campana" | "campana_y_correo" | "solo_correo" | "sin_destinatarios" | "fallido";

const MEMO_MS = 30 * 60 * 1000;
/** Sin administradores la base no puede deduplicar: el correo se limita a uno cada 6 h por instancia. */
const MEMO_NO_ADMINS_MS = 6 * 60 * 60 * 1000;
/** Hasta cuándo no se vuelve a intentar (por servicio y motivo). */
const lastSent = new Map<string, number>();
export function resetAiCreditsAlertMemo() { lastSent.clear(); }

export const AI_CREDITS_EMAIL_SUBJECT = "IATOS: se acabaron los créditos de IA (imágenes)";
export function aiCreditsEmailText(reason: AiCreditsReason): string {
  return reason === "sin_saldo"
    ? "El gateway de IA de Lovable respondió sin saldo (HTTP 402) al crear un Travel Avatar.\n"
      + "Las personas ven: «El servicio de imágenes no está disponible en este momento».\n"
      + "Qué hacer: recargar los créditos de IA en Lovable. Este aviso se manda una vez al día."
    : "Falta la llave LOVABLE_API_KEY en las funciones: no se pueden crear Travel Avatars.\n"
      + "Las personas ven: «El servicio de imágenes no está disponible en este momento».\n"
      + "Este aviso se manda una vez al día.";
}

/** Avisa (con límite) que la IA de imágenes no tiene créditos. Devuelve qué pasó. */
export async function alertAiCredits(reason: AiCreditsReason, deps: AiCreditsAlertDeps): Promise<AiCreditsAlertStatus> {
  const now = deps.now ?? Date.now;
  const key = `imagenes:${reason}`;
  const until = lastSent.get(key);
  if (until != null && now() < until) return "omitido_reciente";
  try {
    const { data, error } = await deps.rpc("imagenes", reason);
    if (error) throw new Error(error.message);
    const n = Number(data);
    if (!Number.isFinite(n)) throw new Error(`alert_admins_ai_credits respondió ${String(data)}`);
    lastSent.set(key, now() + (n < 0 ? MEMO_NO_ADMINS_MS : MEMO_MS));
    if (n === 0) return "ya_avisado";
    let mailed = false;
    if (deps.emailTo.length && deps.sendEmail) {
      mailed = await deps.sendEmail(deps.emailTo, AI_CREDITS_EMAIL_SUBJECT, aiCreditsEmailText(reason)).catch(() => false);
    }
    if (n < 0) return mailed ? "solo_correo" : "sin_destinatarios";
    return mailed ? "campana_y_correo" : "campana";
  } catch (e) {
    deps.log?.("aviso de créditos de IA falló:", (e as Error).message);
    return "fallido";
  }
}
