// ops-desk — manda al usuario el correo con la respuesta del equipo (mesa de operaciones).
// La acción (Tomar / Responder / Marcar resuelta / No se pudo) la hace la pantalla con la RPC
// admin_ops_act, que exige public.admins y deja el mensaje guardado; aquí solo se envía el correo de
// ESA respuesta: se reclama en la base (sin duplicados), se envía con Resend y se marca. Si falla,
// queda "fallido" y health-check lo reintenta. Solo administradores (verify_jwt + public.admins).
import { createClient } from "npm:@supabase/supabase-js@2.45.0";
import { getAuthUser, unauthorizedResponse } from "../_shared/verify-auth.ts";
import { sendEmail } from "../_shared/email.ts";
import { enforceRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { sendTeamReply } from "../_shared/ops-desk.ts";
import { teamEmails } from "../_shared/teamEmails.ts";
import { redactPii } from "../_shared/redact.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const user = await getAuthUser(req);
  if (!user) return unauthorizedResponse(corsHeaders);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: isAdmin } = await db.from("admins").select("user_id").eq("user_id", user.id).maybeSingle();
  if (!isAdmin) return json({ code: "FORBIDDEN", error: "solo administradores" }, 403);

  // Cada llamada puede mandar un correo: límite por persona aunque sea del equipo.
  const rl = await enforceRateLimit(req, "ops-desk", user.id, { perMinute: 20, perHour: 300, ipPerMinute: 30 });
  if (!rl.allowed) return rateLimitResponse(rl, corsHeaders);

  try {
    const body = (await req.json().catch(() => null)) as { reply_id?: unknown } | null;
    const replyId = typeof body?.reply_id === "string" && UUID.test(body.reply_id) ? body.reply_id : null;
    if (!replyId) return json({ code: "INVALID_REQUEST", error: "reply_id requerido" }, 400);
    // La respuesta tiene que ser de una acción de la mesa (existe y la escribió el equipo).
    const { data: reply } = await db.from("team_request_replies").select("id, admin_id").eq("id", replyId).maybeSingle();
    if (!reply) return json({ code: "NOT_FOUND" }, 404);

    const r = await sendTeamReply({
      rpc: (fn, args) => db.rpc(fn, args),
      send: (m) => sendEmail(m),
      siteUrl: Deno.env.get("SITE_URL") ?? null,
      ownerEmail: teamEmails(),
      replyFrom: Deno.env.get("OPS_REPLY_FROM") || "IATOS <hola@traveliatos.life>",
      // Si el usuario contesta el correo, le llega al equipo.
      replyTo: teamEmails()[0],
      supportEmail: Deno.env.get("SUPPORT_EMAIL") ?? null,
    }, replyId);
    return json({ ok: r.email_status === "enviado" || r.email_status === "sin_correo", ...r });
  } catch (e) {
    console.error("ops-desk error", redactPii((e as Error)?.message ?? e));
    return json({ code: "INTERNAL_ERROR", error: "internal_error" }, 500);
  }
});
