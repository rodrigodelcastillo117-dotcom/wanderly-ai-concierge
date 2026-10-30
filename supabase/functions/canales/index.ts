// canales — la app vincula Telegram y WhatsApp con la cuenta IATOS y guarda las preferencias de avisos.
// verify_jwt = true (con sesión). `canal` = "telegram" (por omisión) o "whatsapp".
//   {accion: "estado"}                       → qué está prendido, si esta cuenta está vinculada y sus preferencias.
//   {accion: "codigo", canal}                → código de un solo uso (8 caracteres, 15 min) y el enlace que abre el chat
//                                              (t.me/<bot>?start=<código> o wa.me/<número>?text=IATOS <código>).
//   {accion: "desvincular", canal}           → quita el vínculo (si era su canal preferido, vuelve a "app").
//   {accion: "preferencias", preferido, noMolestarInicio, noMolestarFin, tz} → guarda canal preferido y no molestar.
//   {accion: "configurar_telegram"}          → SOLO administradores: registra el webhook del bot (una vez).
//   {accion: "configurar_whatsapp"}          → SOLO administradores: URL del webhook y token de verificación para pegar
//                                              en Meta, y el texto de las plantillas para someterlas.
// Sin los secretos de un canal: estado dice apagado y no se generan códigos.
import { createClient } from "npm:@supabase/supabase-js@2.45.0";
import { getAuthUser, unauthorizedResponse } from "../_shared/verify-auth.ts";
import { enforceRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { safeErrorMessage } from "../_shared/redact.ts";
import { configureTelegramWebhook, newLinkCode, sha256Hex, telegramBotName, telegramWebhookSecret } from "../_shared/channels/telegram.ts";
import { enlaceWaMe, numeroWhatsApp, PLANTILLAS_WHATSAPP, proveedorWhatsApp, secretosWhatsApp, whatsappVerifyToken } from "../_shared/channels/whatsapp.ts";
import { normalizarPreferencias } from "../_shared/channels/preferencias.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const env = (k: string) => Deno.env.get(k) ?? undefined;

type Link = { channel?: string; username?: string | null; linked_at?: string | null; external_id?: string | null };
const ocultarTel = (t?: string | null) => (t ? `${t.slice(0, 4)}•••${t.slice(-3)}` : null);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const user = await getAuthUser(req);
  if (!user) return unauthorizedResponse(corsHeaders);
  const rl = await enforceRateLimit(req, "canales", user.id, { perMinute: 10, perHour: 60, ipPerMinute: 30 });
  if (!rl.allowed) return rateLimitResponse(rl, corsHeaders);
  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown> & { accion?: string; canal?: string };
    const canal = body.canal === "whatsapp" ? "whatsapp" : "telegram";
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
    const token = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
    const waOn = secretosWhatsApp(env).length === 0;
    const { data: links } = await admin.rpc("channel_links_of", { _user: user.id });
    const lista: Link[] = Array.isArray(links) ? links : [];
    const tg = lista.find((l) => l.channel === "telegram") ?? null;
    const wa = lista.find((l) => l.channel === "whatsapp") ?? null;
    const esAdmin = async () => !!(await admin.from("admins").select("user_id").eq("user_id", user.id).maybeSingle()).data;

    switch (body.accion) {
      case "estado": {
        const bot = token ? (Deno.env.get("TELEGRAM_BOT_USERNAME") ?? await telegramBotName(token)) : null;
        const { data: prefs } = await admin.rpc("channel_prefs_get", { _user: user.id });
        return json({
          ok: true,
          telegram: { activo: !!token, bot, vinculado: !!tg, usuario: tg?.username ?? null, desde: tg?.linked_at ?? null },
          whatsapp: { activo: waOn, numero: waOn ? await numeroWhatsApp(env) : null, vinculado: !!wa, telefono: ocultarTel(wa?.external_id), desde: wa?.linked_at ?? null },
          preferencias: normalizarPreferencias(prefs),
        });
      }
      case "codigo": {
        let enlace: string;
        let destino: string;
        if (canal === "telegram") {
          const bot = token ? (Deno.env.get("TELEGRAM_BOT_USERNAME") ?? await telegramBotName(token)) : null;
          if (!token || !bot) return json({ ok: false, code: "TELEGRAM_OFF", message: "Telegram todavía no está activo en IATOS." }, 409);
          destino = bot;
          enlace = "";
        } else {
          const numero = waOn ? await numeroWhatsApp(env) : null;
          if (!numero) return json({ ok: false, code: "WHATSAPP_OFF", message: "WhatsApp todavía no está activo en IATOS." }, 409);
          destino = numero;
          enlace = "";
        }
        const code = newLinkCode();
        const { data, error } = await admin.rpc("channel_link_code_create", { _user: user.id, _channel: canal, _code_hash: await sha256Hex(code) });
        if (error || !data?.ok) return json({ ok: false, code: data?.code ?? "ERROR", message: data?.code === "RATE_LIMITED" ? "Pediste muchos códigos; espera un rato." : "No se pudo crear el código." }, data?.code === "RATE_LIMITED" ? 429 : 500);
        enlace = canal === "telegram" ? `https://t.me/${destino}?start=${code}` : enlaceWaMe(destino, code);
        return json({ ok: true, canal, codigo: code, expira: data.expires_at, enlace, ...(canal === "telegram" ? { bot: destino } : { numero: destino }) });
      }
      case "desvincular": {
        const { data } = await admin.rpc("channel_unlink", { _user: user.id, _channel: canal });
        return json({ ok: true, ...(data ?? {}) });
      }
      case "preferencias": {
        // La base valida todo (canal vinculado, horas HH:MM distintas, zona IANA real); aquí solo se limpian los tipos.
        const str = (v: unknown, n: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null);
        const { data, error } = await admin.rpc("channel_prefs_set", {
          _user: user.id, _preferred: str(body.preferido, 20) ?? "app", _quiet_start: str(body.noMolestarInicio, 5), _quiet_end: str(body.noMolestarFin, 5), _tz: str(body.tz, 64),
        });
        if (error || !data?.ok) {
          const msg: Record<string, string> = { NOT_LINKED: "Primero vincula ese canal.", BAD_CHANNEL: "Ese canal no es válido.", BAD_HOURS: "Revisa el horario de no molestar.", BAD_TZ: "Zona horaria no válida." };
          return json({ ok: false, code: data?.code ?? "ERROR", message: msg[data?.code ?? ""] ?? "No se pudo guardar." }, 400);
        }
        return json({ ok: true, preferencias: normalizarPreferencias(data) });
      }
      case "configurar_telegram": {
        if (!(await esAdmin())) return json({ ok: false, code: "FORBIDDEN" }, 403);
        if (!token) return json({ ok: false, code: "TELEGRAM_OFF", message: "Falta el secreto TELEGRAM_BOT_TOKEN." }, 409);
        const r = await configureTelegramWebhook({ token, url: `${Deno.env.get("SUPABASE_URL")}/functions/v1/telegram-webhook`, secret: await telegramWebhookSecret(token, Deno.env.get("TELEGRAM_WEBHOOK_SECRET")) });
        return json(r, r.ok ? 200 : 502);
      }
      case "configurar_whatsapp": {
        if (!(await esAdmin())) return json({ ok: false, code: "FORBIDDEN" }, 403);
        const faltan = secretosWhatsApp(env);
        const prov = proveedorWhatsApp(env);
        const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/whatsapp-webhook`;
        return json({
          ok: faltan.length === 0, proveedor: prov, faltan, webhook_url: url,
          // Lo que se pega en Meta → WhatsApp → Configuración → Webhook ("Token de verificación"). No es la llave de envío.
          verify_token: prov === "meta" && env("WHATSAPP_APP_SECRET") ? await whatsappVerifyToken(env("WHATSAPP_APP_SECRET")!, env("WHATSAPP_VERIFY_TOKEN") ?? null) : null,
          numero: faltan.length ? null : await numeroWhatsApp(env),
          plantillas: Object.values(PLANTILLAS_WHATSAPP),
        });
      }
      default:
        return json({ ok: false, code: "BAD_REQUEST" }, 400);
    }
  } catch (e) {
    console.error("canales error:", safeErrorMessage(e));
    return json({ ok: false, code: "INTERNAL" }, 500);
  }
});
