import { createClient } from "npm:@supabase/supabase-js@2.45.0";
import { sendEmail } from "../_shared/email.ts";

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
  type: "reservation" | "pickup" | "transport" | "jet" | "alert";
  title: string;
  payload?: Record<string, unknown>;
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

    const body = (await req.json()) as Body;
    if (!body?.type || !body?.title) {
      return new Response(JSON.stringify({ error: "missing_fields" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Service client for inserts (RLS still respected via explicit user_id)
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    // 1) Insert concierge_request (status = processing)
    const { data: reqRow, error: reqErr } = await admin
      .from("concierge_requests")
      .insert({
        user_id: userId,
        type: body.type,
        title: body.title,
        payload: body.payload ?? {},
        status: "processing",
      })
      .select()
      .single();

    if (reqErr) {
      console.error("concierge_requests insert error", reqErr);
      return new Response(JSON.stringify({ error: reqErr.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const labelByType: Record<string, string> = {
      reservation: "Mesa solicitada",
      pickup: "Solicitud de equipaje preparada",
      transport: "Transporte solicitado",
      jet: "Jet privado solicitado",
      alert: "Alerta atendida",
    };

    // 2) Insert immediate "received" notification
    await admin.from("notifications").insert({
      user_id: userId,
      type: body.type,
      title: `${labelByType[body.type] ?? "Solicitud recibida"} ✦`,
      body: `Tu concierge está procesando: ${body.title}.`,
      related_id: reqRow.id,
    });

    // 3) Notifica a un humano por email — sin esto la solicitud se queda en
    // "processing" para siempre y nadie la atiende de verdad.
    try {
      const { data: profile } = await admin
        .from("profiles")
        .select("full_name")
        .eq("id", userId)
        .maybeSingle();
      const userEmail = userData.user.email ?? "sin email";
      const subject = `[IATOS Concierge] ${labelByType[body.type] ?? body.type} — ${profile?.full_name ?? userEmail}`;
      const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;padding:20px">
        <h2>${labelByType[body.type] ?? "Nueva solicitud de concierge"}</h2>
        <p><b>Cliente:</b> ${profile?.full_name ?? "Sin nombre"} (${userEmail})</p>
        <p><b>Tipo:</b> ${body.type}</p>
        <p><b>Título:</b> ${body.title}</p>
        <p><b>Detalle:</b> ${JSON.stringify(body.payload ?? {})}</p>
        <p style="color:#888;font-size:12px">concierge_requests.id = ${reqRow.id}</p>
      </body></html>`;
      const sent = await sendEmail({ to: FIXER_EMAIL, from: FROM_ADDRESS, replyTo: userEmail, subject, html });
      if (!sent.ok) console.error("concierge-action: no se pudo notificar al humano", sent.error);
    } catch (notifyErr) {
      console.error("concierge-action: error notificando al humano", notifyErr);
    }

    return new Response(
      JSON.stringify({ ok: true, request: reqRow, confirmation_required: true }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("concierge-action error", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
