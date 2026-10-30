// Vigilancia proactiva · conexión real (Deno). Arma VigilanciaDeps con: base (service_role), SerpApi con la caché
// compartida de 10 min y el freno de la cuenta (serpRuntime.ts; cada búsqueda real queda en ai_usage_log como
// 'vigilancia-cron', que es lo que cuenta el cupo diario), push web, Telegram si está prendido, correo (Resend), avisos
// al equipo (incident-runtime.ts), el Operador IA, MET Norway y las alertas oficiales (GOV.UK / State Dept, caché
// compartida de 6 h, sin traducción con IA). La lógica vive en runner.ts y entrante.ts (puras).
import { fetchFlightStatus } from "../flight-serpapi.ts";
import { dbCacheStore, serpFetchFor } from "../serpRuntime.ts";
import { pushToUser } from "../push.ts";
import { sendEmail } from "../email.ts";
import { deliverIncidentAlerts } from "../incident-alerts.ts";
import { incidentAlertDeps, incidentChannels } from "../incident-runtime.ts";
import { adminClient, dbDe, despertarOperador } from "../operador/runtime.ts";
import { WEATHER_USER_AGENT } from "../weather.ts";
import type { MetForecast } from "../weatherCore.ts";
import { getTravelAdvisory } from "../travelAdvisories.ts";
import { DEFAULT_REPLY_DOMAIN } from "../ai-reservations/core.ts";
import { redactPii } from "../redact.ts";
import type { CanalResultado, VigilanciaDeps } from "./runner.ts";

const env = (k: string) => Deno.env.get(k) ?? undefined;
export const VIGILANCIA_FROM = "IATOS Concierge <concierge@traveliatos.life>";

export function buildVigilanciaDeps(): VigilanciaDeps {
  const admin = adminClient();
  const db = dbDe(admin);
  const key = env("SERPAPI_PRIVATE_KEY");
  const serp = serpFetchFor("vigilancia-cron", null);
  const channels = incidentChannels();
  const alertDeps = incidentAlertDeps(admin);
  const siteUrl = env("SITE_URL") ?? "https://traveliatos.life";
  return {
    db,
    consultarVuelo: (vuelo, fecha, ruta) => key
      ? fetchFlightStatus(key, vuelo, fecha, ruta ?? undefined, { fetch: serp.fetch, timeoutMs: 10_000 })
      : Promise.resolve({ kind: "provider_error", message: "serpapi_not_configured" }),
    notificarApp: async (n) => {
      const { data, error } = await admin.rpc("notify_once", { p_user_id: n.user_id, p_type: "vigilancia", p_title: n.title.slice(0, 140),
        p_body: n.body, p_related_id: n.related_id, p_dedup_key: n.dedup_key });
      if (error) throw new Error(error.message);
      return data != null;
    },
    avisarViajero: async (userId, m) => {
      const out: CanalResultado[] = [];
      const n = await pushToUser(admin, userId, { title: m.titulo.slice(0, 120), body: m.texto.slice(0, 180), url: m.url },
        { TTL: m.urgente ? 6 * 3600 : 24 * 3600, urgency: m.urgente ? "high" : "normal" }).catch(() => 0);
      out.push({ canal: "push", ok: n > 0, detalle: n > 0 ? `${n} dispositivo(s)` : "sin suscripción push" });
      const { data: links } = await admin.rpc("channel_links_of", { _user: userId });
      const tg = Array.isArray(links) ? links.find((l: { channel?: string }) => l.channel === "telegram") : null;
      if (tg?.external_id && channels.isEnabled("telegram")) {
        const r = await channels.send("telegram", String(tg.external_id), { text: `${m.titulo}\n\n${m.texto}\n\n${siteUrl}${m.url}` }, { purpose: "usuario" });
        out.push({ canal: "telegram", ok: r.ok, detalle: r.ok ? null : r.code ?? null });
      }
      if (m.correo === "siempre" || !out.some((c) => c.ok)) {
        const { data: u } = await admin.auth.admin.getUserById(userId);
        const email = u?.user?.email;
        if (email) {
          const r = await channels.send("email", email, { subject: m.titulo, text: `${m.texto}\n\nÁbrelo en IATOS: ${siteUrl}${m.url}` }, { purpose: "usuario" });
          out.push({ canal: "correo", ok: r.ok, detalle: r.ok ? null : r.code ?? null });
        }
      }
      return out;
    },
    alertarEquipo: async (id) => { await deliverIncidentAlerts(alertDeps, { requestId: id }); },
    despertarOperador: (id) => despertarOperador(id, "nuevo"),
    operadorActivo: async () => {
      const { data } = await admin.rpc("operator_enabled", {});
      return data === true;
    },
    enviarCorreo: (m) => sendEmail(m),
    clima: async (lat, lng) => {
      const res = await fetch(`https://api.met.no/weatherapi/locationforecast/2.0/complete?lat=${lat.toFixed(4)}&lon=${lng.toFixed(4)}`, {
        headers: { "User-Agent": WEATHER_USER_AGENT }, signal: AbortSignal.timeout(6_000),
      }).catch(() => null);
      if (!res || !res.ok) return null;
      const j = await res.json().catch(() => null);
      const ts = j?.properties?.timeseries;
      return Array.isArray(ts) && ts.length ? { timeseries: ts, updatedAt: j?.properties?.meta?.updated_at ?? null } as MetForecast : null;
    },
    avisosOficiales: (pais) => getTravelAdvisory(pais, { fetchImpl: fetch, store: dbCacheStore(), translate: null }),
    ahora: () => new Date(),
    config: {
      dominioRespuesta: env("RECLAMOS_REPLY_DOMAIN") ?? env("AI_RESERVATIONS_REPLY_DOMAIN") ?? DEFAULT_REPLY_DOMAIN,
      remitente: env("VIGILANCIA_FROM_ADDRESS") ? `IATOS Concierge <${env("VIGILANCIA_FROM_ADDRESS")}>` : VIGILANCIA_FROM,
    },
    log: (...a) => console.warn(...a.map((x) => redactPii(String(x)) ?? "")),
  };
}
