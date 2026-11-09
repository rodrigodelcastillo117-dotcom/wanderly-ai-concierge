// ops-desk — manda al usuario el correo con la respuesta del equipo (mesa de operaciones).
// La acción (Tomar / Responder / Marcar resuelta / No se pudo) la hace la pantalla con la RPC
// admin_ops_act, que exige public.admins y deja el mensaje guardado; aquí solo se envía el correo de
// ESA respuesta: se reclama en la base (sin duplicados), se envía con Resend y se marca. Si falla,
// queda "fallido" y health-check lo reintenta. Solo administradores (verify_jwt + public.admins).
// Además (incidentes, 20261029080000): le manda push web al usuario con la respuesta del equipo, y con
// { incident_id } reparte en el acto los avisos de un incidente que se acaba de escalar desde la mesa.
import { createClient } from "npm:@supabase/supabase-js@2.45.0";
import { getAuthUser, unauthorizedResponse } from "../_shared/verify-auth.ts";
import { sendEmail } from "../_shared/email.ts";
import { enforceRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { sendTeamReply } from "../_shared/ops-desk.ts";
import { teamEmails } from "../_shared/teamEmails.ts";
import { redactPii } from "../_shared/redact.ts";
import { pushToUser } from "../_shared/push.ts";
import { deliverIncidentAlerts } from "../_shared/incident-alerts.ts";
import { incidentAlertDeps } from "../_shared/incident-runtime.ts";
import { teamReplyPush } from "../_shared/ops-desk.ts";
import { type AvisosDeps, cambiarGuardia, estadoAvisos, type PersonaGuardia, pruebaAvisos } from "../_shared/avisosEquipo.ts";

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
    const body = (await req.json().catch(() => null)) as { reply_id?: unknown; incident_id?: unknown; accion?: unknown; rol?: unknown } | null;
    // Avisos al equipo (Mesa → «Avisos a mi celular»): estado, prueba y entrar/salir de la guardia.
    if (body?.accion === "avisos_estado" || body?.accion === "avisos_prueba" || body?.accion === "avisos_unirme" || body?.accion === "avisos_salir") {
      const deps: AvisosDeps = {
        guardia: async () => {
          const { data } = await db.rpc("incident_oncall_now", { _level: 2, _fallback: teamEmails() });
          return (Array.isArray(data) ? data : []) as PersonaGuardia[];
        },
        guardiaConfigurada: async () => {
          const { count } = await db.from("incident_oncall").select("id", { count: "exact", head: true }).eq("active", true);
          return (count ?? 0) > 0;
        },
        dispositivos: async (uid) => {
          const { count } = await db.from("push_subscriptions").select("id", { count: "exact", head: true }).eq("user_id", uid);
          return count ?? 0;
        },
        correo: (to, subject, text, html) => sendEmail({ to, subject, text, html, from: Deno.env.get("OPS_REPLY_FROM") || "IATOS <hola@traveliatos.life>" }),
        // deno-lint-ignore no-explicit-any -- otra versión de supabase-js que la de push.ts
        push: (uid, p) => pushToUser(db as any, uid, p, { TTL: 3600, urgency: "high" }),
        unirse: async (p) => {
          // El índice único es sobre lower(email) (no sirve para upsert): se busca y se actualiza o se crea.
          const { data: ya } = await db.from("incident_oncall").select("id").ilike("email", p.email).maybeSingle();
          const { error } = ya
            ? await db.from("incident_oncall").update({ name: p.name, role: p.role, active: true }).eq("id", (ya as { id: string }).id)
            : await db.from("incident_oncall").insert({ email: p.email, name: p.name, role: p.role, active: true });
          return error ? { ok: false, error: "no se guardó" } : { ok: true };
        },
        salir: async (email) => {
          const { error } = await db.from("incident_oncall").update({ active: false }).ilike("email", email);
          return error ? { ok: false, error: "no se guardó" } : { ok: true };
        },
      };
      const { data: prof } = await db.from("profiles").select("full_name").eq("id", user.id).maybeSingle();
      const yo = { id: user.id, email: user.email ?? null, nombre: (prof as { full_name?: string | null } | null)?.full_name ?? null };
      if (body.accion === "avisos_estado") return json(await estadoAvisos(deps, yo));
      if (body.accion === "avisos_prueba") return json(await pruebaAvisos(deps, yo));
      const r = await cambiarGuardia(deps, yo, body.accion === "avisos_salir" ? "salir" : "unirme", body.rol);
      return json(r.ok ? await estadoAvisos(deps, yo) : r, r.ok ? 200 : 400);
    }
    // Incidente escalado desde la mesa: reparte ya sus avisos (si no salen, el vigilante reintenta).
    if (typeof body?.incident_id === "string" && UUID.test(body.incident_id)) {
      const out = await deliverIncidentAlerts(incidentAlertDeps(db), { requestId: body.incident_id });
      return json({ ok: !out.error, claimed: out.claimed, sent: out.sent, failed: out.failed });
    }
    const replyId = typeof body?.reply_id === "string" && UUID.test(body.reply_id) ? body.reply_id : null;
    if (!replyId) return json({ code: "INVALID_REQUEST", error: "reply_id requerido" }, 400);
    // La respuesta tiene que ser de una acción de la mesa (existe y la escribió el equipo).
    const { data: reply } = await db.from("team_request_replies").select("id, admin_id, user_id, kind, body, source, source_id").eq("id", replyId).maybeSingle();
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
    // Push web al usuario (si tiene la app con avisos activados). Sin VAPID no hace nada.
    let pushed = 0;
    try {
      // deno-lint-ignore no-explicit-any -- otra versión de supabase-js que la de push.ts
      pushed = await pushToUser(db as any, reply.user_id, teamReplyPush(reply), { TTL: 6 * 3600, urgency: "high" });
    } catch (e) {
      console.warn("ops-desk push", redactPii((e as Error)?.message ?? e));
    }
    return json({ pushed, ok: r.email_status === "enviado" || r.email_status === "sin_correo", ...r });
  } catch (e) {
    console.error("ops-desk error", redactPii((e as Error)?.message ?? e));
    return json({ code: "INTERNAL_ERROR", error: "internal_error" }, 500);
  }
});
