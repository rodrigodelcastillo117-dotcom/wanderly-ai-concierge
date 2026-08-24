// Envía el correo de bienvenida al usuario autenticado (solo a su propio email).
import { getAuthUser, unauthorizedResponse } from "../_shared/verify-auth.ts";
import { enforceRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { sendEmail, welcomeEmail } from "../_shared/email.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const user = await getAuthUser(req);
  if (!user) return unauthorizedResponse(corsHeaders);

  const rl = await enforceRateLimit(req, "email-bienvenida", user.id, {
    perMinute: 1, perHour: 3, ipPerMinute: 5,
  });
  if (!rl.allowed) return rateLimitResponse(rl, corsHeaders);

  const body = await req.json().catch(() => ({}));
  const nombre = typeof body?.nombre === "string" ? body.nombre.slice(0, 80) : null;

  // Solo se puede enviar al email del propio usuario autenticado.
  const to = user.email;
  if (!to) {
    return new Response(JSON.stringify({ ok: false, error: "sin_email" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { subject, html } = welcomeEmail(nombre);
  const res = await sendEmail({ to, subject, html });

  return new Response(JSON.stringify(res), {
    status: res.ok ? 200 : 502,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
