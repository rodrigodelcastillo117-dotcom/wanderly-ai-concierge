// Aviso a administradores del webhook de Stripe (disputas, cobro doble, pago sin cuenta). Sin Deno ni
// SDK: index.ts inyecta la base y el correo; se prueba con Vitest (src/test/stripeAdminAlert.test.ts).
//
// D-P3-3 (segunda auditoría): notify_admins devuelve -1 cuando no hay administradores. Antes devolvía
// 0, igual que "ya se avisó", y el webhook respondía 200 sin que nadie se enterara de una disputa.
// Ahora, sin destinatarios de la campana se intenta el correo fijo (HEALTH_ALERT_EMAIL); si tampoco
// sale, el estado es "sin_destinatarios" y cuenta como NO enviado (el webhook responde 500).
import type { AdminAlert } from "./payments.ts";

export interface AlertDeps {
  /** RPC notify_admins: n > 0 campanas nuevas, 0 ya enviado antes, -1 sin administradores. */
  notifyAdmins(alert: AdminAlert): PromiseLike<{ data: unknown; error: { message: string } | null }>;
  /** ¿Hay Resend configurado? */
  emailConfigured: boolean;
  /** HEALTH_ALERT_EMAIL (lista separada por comas, ya limpia). */
  fixedRecipients: string[];
  /** Correos de las cuentas en public.admins. */
  adminEmails(): Promise<string[]>;
  sendEmail(to: string, alert: AdminAlert): Promise<boolean>;
  logError?: (...a: unknown[]) => void;
}

/** Estados que NO cuentan como aviso entregado: el webhook no debe marcar el evento como hecho. */
export const ALERT_NOT_DELIVERED: ReadonlySet<string> = new Set(["fallido", "sin_destinatarios"]);
export const alertDelivered = (status: string | null | undefined): boolean => !ALERT_NOT_DELIVERED.has(status ?? "fallido");

/** Nunca lanza: devuelve el estado del aviso (campana, campana_y_correo, correo_sin_campana, …). */
export async function deliverAdminAlert(alert: AdminAlert, deps: AlertDeps): Promise<string> {
  try {
    const { data, error } = await deps.notifyAdmins(alert);
    if (error) throw new Error(error.message);
    const n = Number(data);
    if (!Number.isFinite(n)) throw new Error(`notify_admins respondió ${String(data)}`);
    if (n === 0) return "campana_ya_enviada";
    const bell = n > 0;
    let to: string[] = [];
    let sent = 0;
    if (deps.emailConfigured) {
      to = deps.fixedRecipients.length ? deps.fixedRecipients : await deps.adminEmails();
      for (const address of to) if (await deps.sendEmail(address, alert)) sent++;
    }
    if (!bell) {
      // Sin administradores: solo cuenta si el correo de alerta llegó a todos sus destinatarios.
      return to.length && sent === to.length ? "correo_sin_campana" : "sin_destinatarios";
    }
    if (!to.length) return "campana";
    return sent === to.length ? "campana_y_correo" : "campana_correo_parcial";
  } catch (e) {
    deps.logError?.("webhook: aviso a administradores falló", (e as Error).message);
    return "fallido";
  }
}
