// canales — la app vincula la cuenta de Telegram del viajero con su cuenta IATOS. verify_jwt = true (con sesión).
//   {accion: "estado"}               → si Telegram está prendido, el nombre del bot y si esta cuenta ya está vinculada.
//   {accion: "codigo"}               → código de un solo uso (8 caracteres, 15 min) y el enlace t.me/<bot>?start=<código>.
//   {accion: "desvincular"}          → quita el vínculo.
//   {accion: "configurar_telegram"}  → SOLO administradores: registra el webhook del bot (una vez, tras pegar el token).
// Sin TELEGRAM_BOT_TOKEN: estado dice apagado y no se generan códigos.
import { createClient } from "npm:@supabase/supabase-js@2.45.0";
import { getAuthUser, unauthorizedResponse } from "../_shared/verify-auth.ts";
import { enforceRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { safeErrorMessage } from "../_shared/redact.ts";
import { configureTelegramWebhook, newLinkCode, sha256Hex, telegramBotName, telegramWebhookSecret } from "../_shared/channels/telegram.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const user = await getAuthUser(req);
  if (!user) return unauthorizedResponse(corsHeaders);
  const rl = await enforceRateLimit(req, "canales", user.id, { perMinute: 10, perHour: 60, ipPerMinute: 30 });
  if (!rl.allowed) return rateLimitResponse(rl, corsHeaders);
  try {
    const body = await req.json().catch(() => ({})) as { accion?: string };
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
    const token = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
    const bot = token ? (Deno.env.get("TELEGRAM_BOT_USERNAME") ?? await telegramBotName(token)) : null;
    const { data: links } = await admin.rpc("channel_links_of", { _user: user.id });
    const tg = Array.isArray(links) ? links.find((l: { channel?: string }) => l.channel === "telegram") ?? null : null;
    switch (body.accion) {
      case "estado":
        return json({ ok: true, telegram: { activo: !!token, bot, vinculado: !!tg, usuario: tg?.username ?? null, desde: tg?.linked_at ?? null } });
      case "codigo": {
        if (!token || !bot) return json({ ok: false, code: "TELEGRAM_OFF", message: "Telegram todavía no está activo en IATOS." }, 409);
        const code = newLinkCode();
        const { data, error } = await admin.rpc("channel_link_code_create", { _user: user.id, _channel: "telegram", _code_hash: await sha256Hex(code) });
        if (error || !data?.ok) return json({ ok: false, code: data?.code ?? "ERROR", message: data?.code === "RATE_LIMITED" ? "Pediste muchos códigos; espera un rato." : "No se pudo crear el código." }, data?.code === "RATE_LIMITED" ? 429 : 500);
        return json({ ok: true, codigo: code, expira: data.expires_at, enlace: `https://t.me/${bot}?start=${code}`, bot });
      }
      case "desvincular": {
        const { data } = await admin.rpc("channel_unlink", { _user: user.id, _channel: "telegram" });
        return json({ ok: true, ...(data ?? {}) });
      }
      case "configurar_telegram": {
        const { data: isAdmin } = await admin.from("admins").select("user_id").eq("user_id", user.id).maybeSingle();
        if (!isAdmin) return json({ ok: false, code: "FORBIDDEN" }, 403);
        if (!token) return json({ ok: false, code: "TELEGRAM_OFF", message: "Falta el secreto TELEGRAM_BOT_TOKEN." }, 409);
        const r = await configureTelegramWebhook({ token, url: `${Deno.env.get("SUPABASE_URL")}/functions/v1/telegram-webhook`, secret: await telegramWebhookSecret(token, Deno.env.get("TELEGRAM_WEBHOOK_SECRET")) });
        return json(r, r.ok ? 200 : 502);
      }
      default:
        return json({ ok: false, code: "BAD_REQUEST" }, 400);
    }
  } catch (e) {
    console.error("canales error:", safeErrorMessage(e));
    return json({ ok: false, code: "INTERNAL" }, 500);
  }
});
