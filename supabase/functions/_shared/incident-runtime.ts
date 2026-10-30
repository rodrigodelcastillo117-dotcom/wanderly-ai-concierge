// Incidentes: conexión con Deno (correo Resend, push web VAPID, canales con secretos del entorno). La lógica
// vive en incident-alerts.ts (pura). Lo usan incidente, ops-desk, incidentes-vigilante y concierge-chat.
import { sendEmail } from "./email.ts";
import { pushToUser } from "./push.ts";
import { teamEmails } from "./teamEmails.ts";
import { createChannelRegistry, type ChannelRegistry } from "./channels/registry.ts";
import { telegramChannel } from "./channels/telegram.ts";
import { whatsappChannel } from "./channels/whatsapp.ts";
import type { IncidentAlertDeps } from "./incident-alerts.ts";
import type { IncidentDb } from "./incidents.ts";

export const INCIDENT_ALERT_FROM = "IATOS Incidentes <hola@traveliatos.life>";

export function incidentChannels(): ChannelRegistry {
  return createChannelRegistry({
    env: (k) => Deno.env.get(k),
    sendEmail: (m) => sendEmail(m),
    emailFrom: INCIDENT_ALERT_FROM,
    // Telegram: prendido solo si existe TELEGRAM_BOT_TOKEN. WhatsApp: prendido con sus secretos (Meta o Twilio); sin
    // ventana conocida manda solo plantillas (alertas al equipo: el aviso de la Mesa sigue por correo y push). Voz: no se
    // registra (channels/voz.ts, apagado: llamadas solo con VOZ_LLAMADAS_REALES=true).
    adapters: {
      telegram: (env) => telegramChannel({ token: String(env("TELEGRAM_BOT_TOKEN") ?? ""), webhookSecret: env("TELEGRAM_WEBHOOK_SECRET") ?? null }),
      whatsapp: (env) => whatsappChannel({ env }),
    },
  });
}

// Cliente con la llave de servicio (cualquier versión de supabase-js: las funciones usan distintas).
// deno-lint-ignore no-explicit-any -- sin tipos generados
export function incidentAlertDeps(admin: any): IncidentAlertDeps & { admin: IncidentDb } {
  return {
    admin: admin as unknown as IncidentDb,
    rpc: (fn: string, args: Record<string, unknown>) => admin.rpc(fn, args),
    channels: incidentChannels(),
    push: (userId: string, payload: { title: string; body: string; url: string }) => pushToUser(admin, userId, payload, { TTL: 3600, urgency: "high" }),
    siteUrl: Deno.env.get("SITE_URL") ?? null,
    fallbackEmails: teamEmails(),
    emailFrom: INCIDENT_ALERT_FROM,
    warn: (...a: unknown[]) => console.warn(...a),
  };
}
