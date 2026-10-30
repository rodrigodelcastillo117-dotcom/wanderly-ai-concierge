// whatsapp-webhook — WhatsApp Business Platform: Iato completo y el Operador por el mismo chat (igual que Telegram).
// verify_jwt = false (Meta/Twilio no mandan JWT). APAGADO sin sus secretos (503, no hace nada):
//   · Meta Cloud API: WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_APP_SECRET.
//       GET  → verificación de la suscripción (hub.mode=subscribe, hub.verify_token = WHATSAPP_VERIFY_TOKEN o el derivado
//              del app secret, que la app muestra a los administradores) → responde hub.challenge.
//       POST → firma X-Hub-Signature-256 (HMAC-SHA256 del cuerpo crudo con el app secret) o 401.
//   · Twilio: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM. POST con firma X-Twilio-Signature (sobre la
//     URL pública WHATSAPP_WEBHOOK_URL o <SUPABASE_URL>/functions/v1/whatsapp-webhook) o 401.
// Idempotente por id de mensaje. Responde 200 en seguida (Meta reintenta hasta 7 días si no) y trabaja en segundo plano.
// Lógica en _shared/channels/conversacion.ts.
import { safeErrorMessage } from "../_shared/redact.ts";
import {
  parseMetaWebhook, parseTwilioForm, proveedorWhatsApp, secretosWhatsApp, verificarSuscripcionMeta, verifyMetaSignature, verifyTwilioSignature,
  whatsappProveedor, whatsappVerifyToken,
} from "../_shared/channels/whatsapp.ts";
import { atenderCanal } from "../_shared/channels/conversacion.ts";
import { adminCanales, conversacionWhatsApp } from "../_shared/channels/runtime.ts";

declare const EdgeRuntime: { waitUntil?: (p: Promise<unknown>) => void } | undefined;
const env = (k: string) => Deno.env.get(k) ?? undefined;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (secretosWhatsApp(env).length) return json({ ok: false, code: "WHATSAPP_OFF" }, 503);
  const prov = proveedorWhatsApp(env);
  const appSecret = env("WHATSAPP_APP_SECRET") ?? "";

  if (req.method === "GET") {
    if (prov !== "meta") return json({ error: "method_not_allowed" }, 405);
    const challenge = verificarSuscripcionMeta(new URL(req.url), await whatsappVerifyToken(appSecret, env("WHATSAPP_VERIFY_TOKEN") ?? null));
    return challenge ? new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } }) : json({ ok: false, code: "INVALID_VERIFY_TOKEN" }, 403);
  }
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const raw = await req.text();
  let msgs;
  if (prov === "meta") {
    if (!(await verifyMetaSignature(req.headers.get("x-hub-signature-256"), raw, appSecret))) return json({ ok: false, code: "INVALID_SIGNATURE" }, 401);
    let body: unknown = null;
    try { body = JSON.parse(raw); } catch { return json({ ok: true, ignored: true }); }
    msgs = parseMetaWebhook(body);
  } else {
    const params = Object.fromEntries(new URLSearchParams(raw));
    const url = env("WHATSAPP_WEBHOOK_URL") ?? `${env("SUPABASE_URL")}/functions/v1/whatsapp-webhook`;
    if (!(await verifyTwilioSignature(req.headers.get("x-twilio-signature"), url, params, env("TWILIO_AUTH_TOKEN") ?? ""))) return json({ ok: false, code: "INVALID_SIGNATURE" }, 401);
    msgs = parseTwilioForm(params);
  }
  const ok = () => prov === "twilio" ? new Response("<Response/>", { status: 200, headers: { "Content-Type": "text/xml" } }) : json({ ok: true });
  // Estados de entrega (enviado/leído) y otros eventos: nada que hacer.
  if (!msgs.length) return ok();

  const trabajo = (async () => {
    try {
      const deps = conversacionWhatsApp(adminCanales(), whatsappProveedor({ env }));
      for (const m of msgs) {
        const r = await atenderCanal(deps, m);
        console.log("whatsapp-webhook:", r.accion);
      }
    } catch (e) {
      console.error("whatsapp-webhook error:", safeErrorMessage(e));
    }
  })();
  if (typeof EdgeRuntime !== "undefined" && typeof EdgeRuntime?.waitUntil === "function") {
    EdgeRuntime.waitUntil(trabajo);
    return ok();
  }
  await trabajo;
  return ok();
});
