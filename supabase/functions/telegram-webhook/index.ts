// telegram-webhook — entrada del bot de Telegram del Operador IATOS. verify_jwt = false (Telegram no manda JWT).
// APAGADO hasta que exista el secreto TELEGRAM_BOT_TOKEN (sin él responde 503 y no hace nada). Cada llamada debe
// traer el encabezado X-Telegram-Bot-Api-Secret-Token correcto (derivado del token, channels/telegram.ts): si no,
// 401. Idempotente por update_id. Responde 200 rápido a Telegram (si no, reintenta). Lógica en
// _shared/operador/telegramEntrada.ts: vincular cuenta con el código de la app, mensajes al caso abierto, abrir caso.
import { createClient } from "npm:@supabase/supabase-js@2.45.0";
import { safeErrorMessage } from "../_shared/redact.ts";
import { sha256Hex, telegramChannel } from "../_shared/channels/telegram.ts";
import { reportIncident } from "../_shared/incident-report.ts";
import { deliverIncidentAlerts } from "../_shared/incident-alerts.ts";
import { incidentAlertDeps } from "../_shared/incident-runtime.ts";
import { atenderTelegram } from "../_shared/operador/telegramEntrada.ts";
import { despertarOperador } from "../_shared/operador/runtime.ts";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const token = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
  if (!token) return json({ ok: false, code: "TELEGRAM_OFF" }, 503);
  const canal = telegramChannel({ token, webhookSecret: Deno.env.get("TELEGRAM_WEBHOOK_SECRET") ?? null });
  const msgs = await canal.parseInbound!(req);
  if (msgs === null) return json({ ok: false, code: "INVALID_SECRET" }, 401);
  if (!msgs.length) return json({ ok: true, ignored: true });
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
    const alerts = incidentAlertDeps(admin);
    const siteUrl = Deno.env.get("SITE_URL") ?? "https://traveliatos.life";
    for (const m of msgs) {
      const r = await atenderTelegram({
        db: alerts.admin,
        enviar: (chatId, texto) => canal.send(chatId, { text: texto }),
        reportar: (input) => reportIncident({ db: alerts.admin, deliver: (id) => deliverIncidentAlerts(alerts, { requestId: id }), deliverTimeoutMs: 4000 }, input),
        despertar: (id, motivo) => despertarOperador(id, motivo),
        sha256: sha256Hex,
        appUrl: `${siteUrl}/dashboard`,
      }, m);
      console.log("telegram-webhook:", r.accion);
    }
    return json({ ok: true });
  } catch (e) {
    console.error("telegram-webhook error:", safeErrorMessage(e));
    // 200 igual: Telegram reintentaría sin fin; el mensaje queda registrado como visto solo si se procesó.
    return json({ ok: false, code: "INTERNAL" });
  }
});
