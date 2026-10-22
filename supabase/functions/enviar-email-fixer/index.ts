// Edge function: enviar-email-fixer
// Envía un email al Fixer humano vía el gateway de Resend de Lovable
// cuando un usuario escala desde el Concierge.
// Si el envío falla, el cliente hace fallback a mailto:.
// Seguridad (F-08): la identidad (correo y replyTo) sale de la sesión, no del cuerpo; todo el HTML
// se escapa (template.ts) y hay límite de frecuencia. Las respuestas solo llevan códigos estables.
import { getAuthUser, unauthorizedResponse } from "../_shared/verify-auth.ts";
import { sendEmail } from "../_shared/email.ts";
import { enforceRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { redactPii } from "../_shared/redact.ts";
import { buildFixerEmail, parseFixerPayload } from "./template.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const FIXER_EMAIL = Deno.env.get("FIXER_EMAIL") || "hola@traveliatos.life";
const FROM_ADDRESS =
  Deno.env.get("FIXER_FROM_ADDRESS") ||
  "IATOS Fixer <hola@traveliatos.life>";

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  const user = await getAuthUser(req);
  if (!user) return unauthorizedResponse(corsHeaders);
  if (req.method !== "POST") return json(405, { code: "METHOD_NOT_ALLOWED", error: "method_not_allowed" });

  // Cada llamada manda un correo a una persona del staff: límite para que no sirva de spam.
  const rl = await enforceRateLimit(req, "enviar-email-fixer", user.id, { perMinute: 3, perHour: 20, ipPerMinute: 10 });
  if (!rl.allowed) return rateLimitResponse(rl, corsHeaders);

  if (!RESEND_API_KEY) {
    console.error("enviar-email-fixer: falta RESEND_API_KEY");
    return json(503, { code: "SERVICE_UNAVAILABLE", error: "email_not_configured" });
  }

  try {
    const parsed = parseFixerPayload(await req.json().catch(() => null));
    if (!parsed.ok) return json(400, { code: "INVALID_REQUEST", error: parsed.error });

    const { subject, html, text } = buildFixerEmail(parsed.value, { email: user.email ?? null, userId: user.id });
    const sent = await sendEmail({
      to: FIXER_EMAIL,
      from: FROM_ADDRESS,
      ...(user.email ? { replyTo: user.email } : {}),
      subject,
      html,
      text,
    });

    if (!sent.ok) {
      console.error("enviar-email-fixer: envío falló", redactPii(sent.error));
      return json(502, { code: "EMAIL_SEND_FAILED", error: "email_send_failed" });
    }
    return json(200, { success: true, email_id: sent.id });
  } catch (err) {
    console.error("enviar-email-fixer: error", redactPii((err as Error)?.message ?? err));
    return json(500, { code: "INTERNAL_ERROR", error: "internal_error" });
  }
});
