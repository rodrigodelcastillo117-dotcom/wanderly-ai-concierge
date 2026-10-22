// Delete only the authenticated caller; privileged credentials stay server-side.
// Ronda sec2-b: el borrado es una solicitud por pasos (deletion_requests), idempotente y reanudable
// (_shared/account-deletion.ts). Volver a pedirlo reanuda la misma solicitud; lo que quede pendiente
// lo reintenta account-deletion-retry. La identidad se borra solo cuando Stripe ya no puede cobrar,
// los archivos se borraron y la base se purgó.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getAuthUser, unauthorizedResponse } from "../_shared/verify-auth.ts";
import { enforceRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { processRequest } from "../_shared/account-deletion-runtime.ts";
import { confirmedDeletion } from "./validation.ts";
import { sendEmail } from "../_shared/email.ts";
import { accountDeletedEmail } from "../_shared/email-templates.ts";

const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
});

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return respond({ error: "method_not_allowed" }, 405);
  const user = await getAuthUser(req);
  if (!user) return unauthorizedResponse(corsHeaders);
  let body: unknown;
  try { body = await req.json(); } catch { return respond({ error: "invalid_json" }, 400); }
  if (!confirmedDeletion(body)) return respond({ error: "confirmation_required" }, 400);
  const verdict = await enforceRateLimit(req, "delete-account", user.id, { perMinute: 3, perHour: 10 });
  if (!verdict.allowed) return rateLimitResponse(verdict, corsHeaders);
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return respond({ error: "deletion_unavailable" }, 503);
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    const { data: requestId, error } = await admin.rpc("start_account_deletion", { _account_id: user.id });
    if (error || !requestId) throw new Error(error?.message ?? "no_request");
    const outcome = await processRequest(admin, String(requestId));
    if (outcome.identityDeleted) {
      // Confirmación por correo a la dirección de la sesión (ya no queda guardada en ningún lado).
      // Un envío fallido no cambia el resultado del borrado.
      if (user.email) {
        const mail = accountDeletedEmail({ pending: (outcome.pending?.length ?? 0) > 0, siteUrl: Deno.env.get("SITE_URL") });
        const sent = await sendEmail({ to: user.email, subject: mail.subject, html: mail.html, text: mail.text }).catch(() => ({ ok: false }));
        if (!sent.ok) console.error("delete-account: correo de confirmación no enviado");
      }
      // Lo no bloqueante (cliente de Stripe, PostHog) puede quedar pendiente: lo termina el reintento.
      return respond({ ok: true, request_id: requestId, pending: outcome.pending });
    }
    // Sin borrar la identidad: la persona puede volver a intentarlo y el cron lo reintenta.
    console.error("delete-account: pendiente en", outcome.blockedAt);
    return respond({ error: "deletion_pending", stage: outcome.blockedAt, request_id: requestId }, 503);
  } catch {
    // Do not log PII, tokens, storage paths or payloads.
    console.error("delete-account failed to start");
    return respond({ error: "deletion_failed" }, 500);
  }
});
