// Incidentes: conexión con Deno (correo Resend, push web VAPID, canales con secretos del entorno). La lógica
// vive en incident-alerts.ts (pura). Lo usan incidente, ops-desk, incidentes-vigilante y concierge-chat.
import { sendEmail } from "./email.ts";
import { pushToUser } from "./push.ts";
import { teamEmails } from "./teamEmails.ts";
import { createChannelRegistry, type ChannelRegistry } from "./channels/registry.ts";
import type { IncidentAlertDeps } from "./incident-alerts.ts";
import type { IncidentDb } from "./incidents.ts";

export const INCIDENT_ALERT_FROM = "IATOS Incidentes <hola@traveliatos.life>";

export function incidentChannels(): ChannelRegistry {
  return createChannelRegistry({
    env: (k) => Deno.env.get(k),
    sendEmail: (m) => sendEmail(m),
    emailFrom: INCIDENT_ALERT_FROM,
    // Aquí se registran los adaptadores de Telegram / WhatsApp / SMS / voz cuando existan (otro módulo).
    adapters: {},
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
