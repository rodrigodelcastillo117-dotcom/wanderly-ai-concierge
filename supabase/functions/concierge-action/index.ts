import { createClient } from "npm:@supabase/supabase-js@2.45.0";
import { escapeHtml, oneLine, sendEmail } from "../_shared/email.ts";
import { enforceRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { redactPii } from "../_shared/redact.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-prive-session",
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
  prive_request: "Solicitud Privé recibida",
  rebooking: "Solicitud de cambio de vuelo recibida",
  fixer_request: "Solicitud al Fixer recibida",
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

    // Reservas de Members Only: solo con derecho (PRO o contraseña temporal vigente), en el servidor.
    if (body.type === "members_nightlife_reservation") {
      const { data: entitled } = await supaUser.rpc("members_access");
      if (entitled !== true) {
        return new Response(JSON.stringify({ code: "MEMBERS_PRO_REQUIRED", error: "pro_required", message: "Members Only es exclusivo de IATOS PRO." }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const title = body.title.slice(0, 200);
    const payload = body.payload && typeof body.payload === "object" ? body.payload : {};

    // Solicitud Privé: la crea la RPC prive_request_create con el JWT y la sesión Privé del usuario
    // (valida acceso, experiencia publicable, edad y viaje; fija "solicitado" y escribe el historial).
    // Aquí solo se avisa al equipo. No es una reserva.
    let priveRow: { id: string; status: string } | null = null;
    if (body.type === "prive_request") {
      const ps = req.headers.get("x-prive-session") ?? "";
      const p = payload as Record<string, unknown>;
      const { data: created, error: pErr } = await supaUser.rpc("prive_request_create", {
        _ps: ps,
        _experience_id: typeof p.experience_id === "string" && UUID.test(p.experience_id) ? p.experience_id : null,
        _requested_for: typeof p.requested_for === "string" ? p.requested_for : null,
        _party_size: Number.isFinite(Number(p.party_size)) ? Math.round(Number(p.party_size)) : null,
        _preferences: typeof p.preferences === "string" ? p.preferences.slice(0, 1000) : null,
        _contact_method: typeof p.contact_method === "string" ? p.contact_method : "app",
        _trip_id: typeof body.trip_id === "string" && UUID.test(body.trip_id) ? body.trip_id : null,
        _plan_group: typeof p.plan_group === "string" && UUID.test(p.plan_group) ? p.plan_group : null,
      });
      const code = /PRIVE_[A-Z_]+/.exec(pErr?.message ?? "")?.[0];
      if (pErr || !(created as any)?.ok) {
        return new Response(JSON.stringify({ code: code ?? (created as any)?.code ?? "PRIVE_REQUEST_FAILED", error: "prive_request_not_created" }), {
          status: code ? 403 : 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      priveRow = { id: (created as any).id, status: (created as any).status };
    }

    // Solo se liga a un viaje al que el usuario tiene acceso (RLS de trips con su propio token).
    let tripId: string | null = null;
    if (typeof body.trip_id === "string" && UUID.test(body.trip_id)) {
      const { data: t } = await supaUser.from("trips").select("id").eq("id", body.trip_id).maybeSingle();
      tripId = t?.id ?? null;
    }

    // Service client for inserts (RLS still respected via explicit user_id)
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    // 1) Insert concierge_request (status = pending: espera respuesta humana). La Privé ya existe.
    const { data: reqRow, error: reqErr } = priveRow
      ? { data: priveRow, error: null }
      : await admin
        .from("concierge_requests")
        .insert({
          user_id: userId,
          trip_id: tripId,
          type: body.type,
          title,
          payload,
          // "solicitado": la atiende un humano; nunca nace como confirmada (mismo vocabulario que Privé).
          status: "solicitado",
        })
        .select()
        .single();

    if (reqErr) {
      console.error("concierge_requests insert error", reqErr.code ?? "", redactPii(reqErr.message));
      return new Response(JSON.stringify({ code: "INTERNAL_ERROR", error: "request_not_saved" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2) Insert immediate "received" notification (la Privé ya la dejó prive_request_create)
    if (!priveRow) await admin.from("notifications").insert({
      user_id: userId,
      type: body.type,
      title: labelByType[body.type] ?? "Solicitud recibida",
      body: `Un humano revisará "${title}" y te responderá con disponibilidad y precio. Todavía no es una reserva.`,
      related_id: reqRow.id,
    });

    // 3) Notifica a un humano por email — sin esto la solicitud se queda en
    // "solicitado" para siempre y nadie la atiende de verdad.
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
