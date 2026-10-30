// telegram-webhook — el bot de Telegram de IATOS: Iato completo y el Operador por el mismo chat. verify_jwt = false
// (Telegram no manda JWT). APAGADO hasta que exista el secreto TELEGRAM_BOT_TOKEN (sin él responde 503 y no hace nada).
// Cada llamada debe traer el encabezado X-Telegram-Bot-Api-Secret-Token correcto (derivado del token,
// channels/telegram.ts): si no, 401. Idempotente por update_id. Responde 200 en seguida y trabaja en segundo plano
// (Iato puede tardar; Telegram reintenta si no le contestan). Lógica en _shared/channels/conversacion.ts: vincular con
// el código de la app, Iato con la sesión del viajero (RLS, plan y cuotas), botones de confirmar, ubicación, fotos de
// tickets, el caso abierto y casos nuevos. CANALES_IATO=off deja solo lo de problemas (como antes).
import { safeErrorMessage } from "../_shared/redact.ts";
import { telegramChannel } from "../_shared/channels/telegram.ts";
import { atenderCanal } from "../_shared/channels/conversacion.ts";
import { adminCanales, conversacionTelegram } from "../_shared/channels/runtime.ts";

declare const EdgeRuntime: { waitUntil?: (p: Promise<unknown>) => void } | undefined;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const token = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
  if (!token) return json({ ok: false, code: "TELEGRAM_OFF" }, 503);
  const canal = telegramChannel({ token, webhookSecret: Deno.env.get("TELEGRAM_WEBHOOK_SECRET") ?? null });
  const msgs = await canal.parseInbound!(req);
  if (msgs === null) return json({ ok: false, code: "INVALID_SECRET" }, 401);
  if (!msgs.length) return json({ ok: true, ignored: true });

  const trabajo = (async () => {
    try {
      const deps = conversacionTelegram(adminCanales(), token);
      for (const m of msgs) {
        const r = await atenderCanal(deps, m);
        console.log("telegram-webhook:", r.accion);
      }
    } catch (e) {
      console.error("telegram-webhook error:", safeErrorMessage(e));
    }
  })();
  if (typeof EdgeRuntime !== "undefined" && typeof EdgeRuntime?.waitUntil === "function") {
    EdgeRuntime.waitUntil(trabajo);
    return json({ ok: true, async: true });
  }
  await trabajo;
  return json({ ok: true });
});
