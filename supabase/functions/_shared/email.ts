// Envío de emails transaccionales vía el gateway de Resend de Lovable.
// Uso server-side (edge functions): no requiere JWT de usuario.
import { redactPii } from "./redact.ts";
import { opsNoticeEmail } from "./email-ops.ts";

// Para importar las plantillas desde Vitest (Node) sin el runtime de Deno.
declare const Deno: { env: { get(name: string): string | undefined } };

const GATEWAY_URL = "https://connector-gateway.lovable.dev/resend";
const FROM_DEFAULT = "IATOS AI <hola@traveliatos.life>";
// Remitente compartido de Resend: se usa solo si el dominio propio
// todavía no está verificado, para no perder el envío.
const FROM_FALLBACK = "IATOS AI <onboarding@resend.dev>";

export async function sendEmail(opts: {
  to: string | string[];
  subject: string;
  html: string;
  /** Versión en texto plano (opcional; los clientes sin HTML la muestran). */
  text?: string;
  from?: string;
  replyTo?: string;
}): Promise<{ ok: boolean; id?: string; error?: string }> {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
  if (!LOVABLE_API_KEY || !RESEND_API_KEY) {
    console.warn("sendEmail: faltan LOVABLE_API_KEY o RESEND_API_KEY");
    return { ok: false, error: "email_not_configured" };
  }

  const post = async (from: string) => {
    const r = await fetch(`${GATEWAY_URL}/emails`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "X-Connection-Api-Key": RESEND_API_KEY,
      },
      body: JSON.stringify({
        from,
        to: Array.isArray(opts.to) ? opts.to : [opts.to],
        subject: opts.subject,
        html: opts.html,
        ...(opts.text ? { text: opts.text } : {}),
        ...(opts.replyTo ? { reply_to: opts.replyTo } : {}),
      }),
    });
    const data = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, data };
  };

  try {
    const from = opts.from ?? FROM_DEFAULT;
    let res = await post(from);

    if (!res.ok && /not verified/i.test(String(res.data?.message ?? ""))) {
      console.warn("sendEmail: dominio no verificado, usando remitente compartido");
      res = await post(FROM_FALLBACK);
    }

    if (!res.ok) {
      // Resend incluye direcciones en sus mensajes de error: nunca se registran tal cual (F-18).
      const error = redactPii(res.data?.message) ?? `resend_${res.status}`;
      console.error("sendEmail error", res.status, error);
      return { ok: false, error };
    }
    return { ok: true, id: res.data?.id };
  } catch (e) {
    const error = redactPii((e as Error).message) ?? "send_exception";
    console.error("sendEmail exception", error);
    return { ok: false, error };
  }
}


// Utilidades de texto (comparten implementación con el sistema de correo premium).
export { escapeHtml, oneLine } from "./email-format.ts";

/**
 * Envoltura de los avisos internos (health-check, stripe-webhook): mismo sistema visual que el resto
 * de los correos (_shared/email-kit.ts), versión compacta para el equipo. `title` e `inner` llegan
 * como HTML ya escapado por quien llama.
 */
export function layout(title: string, inner: string) {
  return opsNoticeEmail({ title, html: inner });
}

// Las plantillas de la persona viven en _shared/email-templates.ts (cotización, bienvenida,
// invitación, alertas, cuenta eliminada) y las internas en _shared/email-ops.ts.
