// Guarda una suscripción Web Push del usuario autenticado
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  // GET → devuelve VAPID public key (no requiere auth)
  if (req.method === 'GET') {
    return new Response(JSON.stringify({ vapidPublicKey: Deno.env.get('VAPID_PUBLIC_KEY') }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  try {
    const auth = req.headers.get('Authorization') ?? '';
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: auth } } }
    );
    const { data: u } = await supabase.auth.getUser();
    if (!u?.user) return new Response(JSON.stringify({ error: 'no auth' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const { subscription, user_agent } = await req.json();
    if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
      return new Response(JSON.stringify({ error: 'subscription inválida' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { error } = await admin.from('push_subscriptions').upsert({
      user_id: u.user.id,
      endpoint: subscription.endpoint,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
      user_agent: user_agent ?? null,
    }, { onConflict: 'endpoint' });
    if (error) throw error;

    return new Response(JSON.stringify({ ok: true, vapidPublicKey: Deno.env.get('VAPID_PUBLIC_KEY') }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
