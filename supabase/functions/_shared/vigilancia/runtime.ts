// Vigilancia proactiva · conexión real (Deno). Arma VigilanciaDeps con: base (service_role), SerpApi con la caché
// compartida de 10 min y el freno de la cuenta (serpRuntime.ts; cada búsqueda real queda en ai_usage_log como
// 'vigilancia-cron', que es lo que cuenta el cupo diario; el freno global se respeta además antes de cada consulta),
// la entrega de canales al viajero (la del Operador: push, Telegram, WhatsApp y correo con sus preferencias), correo a
// proveedores (Resend), avisos al equipo (incident-runtime.ts), el Operador IA, MET Norway y las alertas oficiales
// (GOV.UK / State Dept, caché compartida de 6 h, sin traducción con IA). La lógica vive en runner.ts y entrante.ts (puras).
import { fetchFlightStatus } from "../flight-serpapi.ts";
import { accountBrake, dbCacheStore, serpFetchFor } from "../serpRuntime.ts";
import { sendEmail } from "../email.ts";
import { deliverIncidentAlerts } from "../incident-alerts.ts";
import { incidentAlertDeps } from "../incident-runtime.ts";
import { entregaDeps } from "../channels/entregaRuntime.ts";
import { adminClient, dbDe, despertarOperador } from "../operador/runtime.ts";
import { WEATHER_USER_AGENT } from "../weather.ts";
import type { MetForecast } from "../weatherCore.ts";
import { getTravelAdvisory } from "../travelAdvisories.ts";
import { DEFAULT_REPLY_DOMAIN } from "../ai-reservations/core.ts";
import { redactPii } from "../redact.ts";
import type { VigilanciaDeps } from "./runner.ts";

const env = (k: string) => Deno.env.get(k) ?? undefined;
export const VIGILANCIA_FROM = "IATOS Concierge <concierge@traveliatos.life>";

export function buildVigilanciaDeps(): VigilanciaDeps {
  const admin = adminClient();
  const db = dbDe(admin);
  const key = env("SERPAPI_PRIVATE_KEY");
  const serp = serpFetchFor("vigilancia-cron", null);
  // Freno global de la cuenta (prioridad "normal": deja la reserva para búsquedas de vuelos). runner.ts lo consulta
  // antes de cada búsqueda nueva; con freno no consulta y lo anota.
  const freno = accountBrake(dbCacheStore(), "normal");
  const alertDeps = incidentAlertDeps(admin);
  return {
    db,
    consultarVuelo: (vuelo, fecha, ruta) => key
      ? fetchFlightStatus(key, vuelo, fecha, ruta ?? undefined, { fetch: serp.fetch, timeoutMs: 10_000 })
      : Promise.resolve({ kind: "provider_error", message: "serpapi_not_configured" }),
    frenoSerp: () => freno.paused(),
    notificarApp: async (n) => {
      const { data, error } = await admin.rpc("notify_once", { p_user_id: n.user_id, p_type: "vigilancia", p_title: n.title.slice(0, 140),
        p_body: n.body, p_related_id: n.related_id, p_dedup_key: n.dedup_key });
      if (error) throw new Error(error.message);
      return data != null;
    },
    // Al viajero por la MISMA entrega que el Operador: canal preferido, no molestar, WhatsApp (ventana/plantilla), urgente → todos.
    entrega: entregaDeps(admin),
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
