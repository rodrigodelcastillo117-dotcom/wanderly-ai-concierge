import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { getAuthUser, unauthorizedResponse } from "../_shared/verify-auth.ts";
import { sendEmail } from "../_shared/email.ts";

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const __user = await getAuthUser(req);
  if (!__user) return unauthorizedResponse(corsHeaders);

  try {
    const body = await req.json();
    const { to, subject, html, from, replyTo } = body ?? {};
    if (!to || !subject || !html) {
      return new Response(JSON.stringify({ error: 'to, subject, html required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Delega al helper compartido: usa el dominio propio (traveliatos.life) y
    // solo cae al remitente compartido de Resend si ese dominio no está verificado.
    const res = await sendEmail({ to, subject, html, from, replyTo });
    if (!res.ok) {
      return new Response(JSON.stringify({ error: res.error || 'Resend error' }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ ok: true, id: res.id }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : 'unknown' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
