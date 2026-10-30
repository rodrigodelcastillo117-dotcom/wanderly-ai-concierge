// Avisos al viajero (Operador, vigilancia de vuelos y diferidos) con sus preferencias: conexión real (Deno).
// Separado de runtime.ts para que el Operador lo use sin importar los webhooks (sin ciclos).
import { createClient } from "npm:@supabase/supabase-js@2.45.0";
import { pushToUser } from "../push.ts";
import { sendEmail } from "../email.ts";
import { redactPii } from "../redact.ts";
import type { IncidentDb } from "../incidents.ts";
import { telegramChannel } from "./telegram.ts";
import { secretosWhatsApp, whatsappProveedor, type WhatsAppProveedor } from "./whatsapp.ts";
import type { EntregaDeps } from "./entrega.ts";

const env = (k: string) => Deno.env.get(k) ?? undefined;
export const AVISOS_FROM = "IATOS <hola@traveliatos.life>";

export function whatsappPrendido(): WhatsAppProveedor | null {
  return secretosWhatsApp(env).length ? null : whatsappProveedor({ env });
}

// deno-lint-ignore no-explicit-any -- cliente sin tipos generados
function db(admin: any): IncidentDb {
  return {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      const { data, error } = await admin.rpc(fn, args ?? {});
      return { data, error: error ? { message: redactPii(error.message) ?? "db_error", code: error.code } : null };
    },
  };
}

// deno-lint-ignore no-explicit-any
export function adminEntrega(): any {
  return createClient(env("SUPABASE_URL")!, env("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Avisos al viajero (Operador, vigilancia de vuelos y diferidos) con sus preferencias. */
// deno-lint-ignore no-explicit-any
export function entregaDeps(admin: any): EntregaDeps {
  const token = env("TELEGRAM_BOT_TOKEN") ?? "";
  const tg = token ? telegramChannel({ token, webhookSecret: env("TELEGRAM_WEBHOOK_SECRET") ?? null }) : null;
  const emailOn = !!(env("RESEND_API_KEY") && env("LOVABLE_API_KEY"));
  return {
    db: db(admin),
    siteUrl: env("SITE_URL") ?? "https://traveliatos.life",
    push: (userId, p, urgente) => pushToUser(admin, userId, p, { TTL: 3600, urgency: urgente ? "high" : "normal" }).catch(() => 0),
    telegram: tg ? (chat, texto) => tg.send(chat, { text: texto }, { purpose: "usuario" }) : null,
    whatsapp: whatsappPrendido(),
    email: emailOn
      ? async (to, asunto, texto) => {
        const r = await sendEmail({ to, subject: asunto.slice(0, 180), html: `<div style="font-family:sans-serif;white-space:pre-line">${texto.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!))}</div>`, text: texto, from: AVISOS_FROM });
        return r.ok ? { ok: true, channel: "email", to, providerMessageId: r.id ?? null } : { ok: false, channel: "email", to, code: "SEND_FAILED", error: String(r.error ?? "error").slice(0, 200) };
      }
      : null,
  };
}
