// Canales · conexión real (Deno). Arma con los secretos del entorno:
//   · iatoParaCanal: Iato en nombre del viajero (sesión real del usuario vinculado + firma canal_<canal>).
//   · conversacionTelegram / conversacionWhatsApp: dependencias de conversacion.ts para cada webhook.
//   · entregaDeps: avisos al viajero (Operador y vigilancia) por push, Telegram, WhatsApp y correo con sus preferencias.
// La lógica vive en los módulos puros (conversacion.ts, iatoCanal.ts, sesionUsuario.ts, entrega.ts, formato.ts).
import { createClient } from "npm:@supabase/supabase-js@2.45.0";
import { redactPii } from "../redact.ts";
import { signInternal } from "../internalCall.ts";
import { reportIncident } from "../incident-report.ts";
import { deliverIncidentAlerts } from "../incident-alerts.ts";
import { incidentAlertDeps } from "../incident-runtime.ts";
import { despertarOperador } from "../operador/runtime.ts";
import type { IncidentDb } from "../incidents.ts";
import type { CanalConversacion, MensajeCanal } from "./formato.ts";
import type { CanalDeps } from "./conversacion.ts";
import { crearIatoCanal } from "./iatoCanal.ts";
import { abrirSesionDeUsuario, type AdminAuthLike, type AnonAuthLike } from "./sesionUsuario.ts";
import { sha256Hex, telegramDescargar, telegramEnviar, telegramEscribiendo, telegramResponderBoton } from "./telegram.ts";
import type { WhatsAppProveedor } from "./whatsapp.ts";
import { whatsappPrendido } from "./entregaRuntime.ts";

const env = (k: string) => Deno.env.get(k) ?? undefined;
const SUPABASE_URL = () => env("SUPABASE_URL") ?? "";
const ANON = () => env("SUPABASE_PUBLISHABLE_KEY") ?? env("SUPABASE_ANON_KEY") ?? "";
const SERVICE = () => env("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// deno-lint-ignore no-explicit-any -- cliente sin tipos generados
export function adminCanales(): any {
  return createClient(SUPABASE_URL(), SERVICE(), { auth: { persistSession: false, autoRefreshToken: false } });
}
// deno-lint-ignore no-explicit-any
function anonSinSesion(): any {
  return createClient(SUPABASE_URL(), ANON(), { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}
// deno-lint-ignore no-explicit-any
export function dbCanales(admin: any): IncidentDb {
  return {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      const { data, error } = await admin.rpc(fn, args ?? {});
      return { data, error: error ? { message: redactPii(error.message) ?? "db_error", code: error.code } : null };
    },
  };
}

/** ¿Iato completo por los chats? Prendido por omisión cuando el canal está prendido; CANALES_IATO=off lo apaga. */
export const iatoEnChatsPrendido = () => String(env("CANALES_IATO") ?? "on").toLowerCase() !== "off";

// deno-lint-ignore no-explicit-any
export function iatoParaCanal(admin: any, canal: CanalConversacion) {
  const db = dbCanales(admin);
  return crearIatoCanal({
    supabaseUrl: SUPABASE_URL(), anonKey: ANON(), canal,
    sesion: (userId) => abrirSesionDeUsuario({ admin: admin as AdminAuthLike, anon: anonSinSesion() as AnonAuthLike, userId }),
    firmar: (userId) => signInternal(SERVICE(), userId, canal === "telegram" ? "canal_telegram" : "canal_whatsapp"),
    zona: async (userId) => {
      const r = await db.rpc("channel_prefs_get", { _user: userId });
      return (r.data as { tz?: string | null } | null)?.tz ?? null;
    },
    log: (...a) => console.warn(...a.map((x) => redactPii(String(x), 200))),
  });
}

// deno-lint-ignore no-explicit-any
function baseConversacion(admin: any): Omit<CanalDeps, "canal" | "enviar"> {
  const alerts = incidentAlertDeps(admin);
  const siteUrl = env("SITE_URL") ?? "https://traveliatos.life";
  return {
    db: alerts.admin,
    reportar: (input) => reportIncident({ db: alerts.admin, deliver: (id) => deliverIncidentAlerts(alerts, { requestId: id }), deliverTimeoutMs: 4000 }, input),
    despertar: (id, motivo) => despertarOperador(id, motivo),
    sha256: sha256Hex,
    appUrl: `${siteUrl}/dashboard`,
  };
}

// deno-lint-ignore no-explicit-any
export function conversacionTelegram(admin: any, token: string): CanalDeps {
  const o = { token };
  return {
    ...baseConversacion(admin), canal: "telegram",
    enviar: (chat, m: MensajeCanal) => telegramEnviar(o, chat, { html: m.texto, botones: m.botones }),
    escribiendo: (chat) => telegramEscribiendo(o, chat),
    responderBoton: (id, t) => telegramResponderBoton(o, id, t),
    descargar: (ref) => telegramDescargar(o, ref),
    iato: iatoEnChatsPrendido() ? iatoParaCanal(admin, "telegram") : null,
  };
}

/** WhatsApp: los botones de enlace (sin `data`) van como "texto: url" dentro del mensaje. */
function mensajeWhatsApp(m: MensajeCanal): { texto: string; botones: Array<{ id: string; titulo: string }> } {
  const enlaces = m.botones.filter((b) => b.url && !b.data).map((b) => `${b.texto}: ${b.url}`);
  return { texto: [m.texto, ...enlaces].join("\n"), botones: m.botones.filter((b) => b.data).map((b) => ({ id: b.data!, titulo: b.texto })) };
}

// deno-lint-ignore no-explicit-any
export function conversacionWhatsApp(admin: any, prov: WhatsAppProveedor): CanalDeps {
  return {
    ...baseConversacion(admin), canal: "whatsapp", twilio: prov.proveedor === "twilio",
    enviar: (to, m) => {
      const x = mensajeWhatsApp(m);
      return x.botones.length ? prov.botones(to, x.texto, x.botones) : prov.texto(to, x.texto);
    },
    descargar: (ref) => prov.descargar(ref, 8 * 1024 * 1024),
    iato: iatoEnChatsPrendido() ? iatoParaCanal(admin, "whatsapp") : null,
  };
}


export { AVISOS_FROM, entregaDeps, whatsappPrendido } from "./entregaRuntime.ts";
