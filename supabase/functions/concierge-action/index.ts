import { createClient } from "npm:@supabase/supabase-js@2.45.0";
import { escapeHtml, oneLine, sendEmail } from "../_shared/email.ts";
import { enforceRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { redactPii } from "../_shared/redact.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const FIXER_EMAIL = Deno.env.get("FIXER_EMAIL") || "hola@traveliatos.life";
const FROM_ADDRESS = Deno.env.get("FIXER_FROM_ADDRESS") || "IATOS Fixer <hola@traveliatos.life>";

type Body = {
  // reservation | pickup | transport | jet | alert | members_nightlife_reservation …
  type: string;
  title: string;
  trip_id?: string | null;
  payload?: Record<string, unknown>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Texto honesto (B-04): esto crea una SOLICITUD que revisa un humano; no es una reserva ni
// confirma disponibilidad o precio. Antes decía "Jet privado solicitado ✦" y el botón "✓ Enviado".
const labelByType: Record<string, string> = {
  reservation: "Solicitud de mesa recibida",
  pickup: "Solicitud de cotización de equipaje recibida",
  transport: "Solicitud de transporte recibida",
  jet: "Solicitud de cotización de jet privado recibida",
  alert: "Alerta recibida",
  members_nightlife_reservation: "Solicitud de reserva recibida",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "missing_auth" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Resolve user from token
    const supaUser = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await supaUser.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "invalid_user" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = userData.user.id;

    // Cada solicitud manda un correo a una persona: límite para que nadie lo use para spam.
    const rl = await enforceRateLimit(req, "concierge-action", userId, { perMinute: 5, perHour: 30, ipPerMinute: 15 });
    if (!rl.allowed) return rateLimitResponse(rl, corsHeaders);

    const body = (await req.json().catch(() => null)) as Body | null;
    if (!body?.type || !body?.title || !/^[a-z_]{2,40}$/.test(String(body.type)) || typeof body.title !== "string") {
      return new Response(JSON.stringify({ error: "missing_fields" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const title = body.title.slice(0, 200);
    const payload = body.payload && typeof body.payload === "object" ? body.payload : {};

    // Solo se liga a un viaje al que el usuario tiene acceso (RLS de trips con su propio token).
    let tripId: string | null = null;
    if (typeof body.trip_id === "string" && UUID.test(body.trip_id)) {
      const { data: t } = await supaUser.from("trips").select("id").eq("id", body.trip_id).maybeSingle();
      tripId = t?.id ?? null;
    }

    // Service client for inserts (RLS still respected via explicit user_id)
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    // 1) Insert concierge_request (status = pending: espera respuesta humana)
    const { data: reqRow, error: reqErr } = await admin
      .from("concierge_requests")
      .insert({
        user_id: userId,
        trip_id: tripId,
        type: body.type,
        title,
        payload,
        status: "pending",
      })
      .select()
      .single();

    if (reqErr) {
      console.error("concierge_requests insert error", reqErr.code ?? "", redactPii(reqErr.message));
      return new Response(JSON.stringify({ code: "INTERNAL_ERROR", error: "request_not_saved" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2) Insert immediate "received" notification
    await admin.from("notifications").insert({
      user_id: userId,
      type: body.type,
      title: labelByType[body.type] ?? "Solicitud recibida",
      body: `Un humano revisará "${title}" y te responderá con disponibilidad y precio. Todavía no es una reserva.`,
      related_id: reqRow.id,
    });

    // 3) Notifica a un humano por email — sin esto la solicitud se queda en
    // "pending" para siempre y nadie la atiende de verdad.
    let humanNotified = false;
    try {
      const { data: profile } = await admin
        .from("profiles")
        .select("full_name")
        .eq("id", userId)
        .maybeSingle();
      const userEmail = userData.user.email ?? "sin email";
      // Asunto en una línea: un nombre con saltos de línea no puede inyectar encabezados.
      const subject = oneLine(`[IATOS Concierge] ${labelByType[body.type] ?? body.type} — ${profile?.full_name || userEmail}`, 180);
      // Todo lo que viene del cliente se escapa antes de ir al HTML del correo.
      const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;padding:20px">
        <h2>${escapeHtml(labelByType[body.type] ?? "Nueva solicitud de concierge")}</h2>
        <p><b>Cliente:</b> ${escapeHtml(profile?.full_name ?? "Sin nombre")} (${escapeHtml(userEmail)})</p>
        <p><b>Tipo:</b> ${escapeHtml(body.type)}</p>
        <p><b>Título:</b> ${escapeHtml(title)}</p>
        <p><b>Viaje:</b> ${escapeHtml(tripId ?? "sin viaje")}</p>
        <p><b>Detalle:</b> ${escapeHtml(JSON.stringify(payload).slice(0, 4000))}</p>
        <p>Responder al cliente con disponibilidad y precio reales. El cliente ve esto como "solicitud recibida", no como reserva.</p>
        <p style="color:#888;font-size:12px">concierge_requests.id = ${escapeHtml(reqRow.id)}</p>
      </body></html>`;
      const sent = await sendEmail({
        to: FIXER_EMAIL, from: FROM_ADDRESS, ...(userData.user.email ? { replyTo: userData.user.email } : {}), subject, html,
      });
      humanNotified = !!sent.ok;
      if (!sent.ok) console.error("concierge-action: no se pudo notificar al humano", sent.error);
    } catch (notifyErr) {
      console.error("concierge-action: error notificando al humano", redactPii((notifyErr as Error)?.message ?? notifyErr));
    }

    return new Response(
      JSON.stringify({ ok: true, request: { id: reqRow.id, status: reqRow.status }, human_notified: humanNotified, confirmation_required: true }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("concierge-action error", redactPii((e as Error)?.message ?? e));
    return new Response(JSON.stringify({ code: "INTERNAL_ERROR", error: "internal_error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
