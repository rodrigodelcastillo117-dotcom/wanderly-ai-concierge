// Activa / desactiva el rastreo de un vuelo para el usuario autenticado
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { enforceRateLimit, rateLimitResponse } from '../_shared/rate-limit.ts';
import { MAX_ACTIVE_PER_USER, normalizeFlight, trackError } from './rules.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const auth = req.headers.get('Authorization') ?? '';
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: auth } } }
    );
    const { data: u } = await supabase.auth.getUser();
    if (!u?.user) return new Response(JSON.stringify({ error: 'no auth' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const rl = await enforceRateLimit(req, 'track-flight', u.user.id, { perMinute: 10, perHour: 60, ipPerMinute: 30 });
    if (!rl.allowed) return rateLimitResponse(rl, corsHeaders);

    const { flight, flight_date, route, trip_id, active = true, today } = await req.json();
    const bad = (msg: string) => new Response(JSON.stringify({ error: msg }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    if (typeof flight !== 'string' || !flight.trim()) return bad('flight requerido');

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const code = normalizeFlight(flight);

    // Desactivar nunca se bloquea: apaga todas las filas de ese vuelo (incluidas las viejas sin fecha).
    if (!active) {
      let q = admin.from('tracked_flights').update({ active: false }).eq('user_id', u.user.id).eq('flight', code);
      if (typeof flight_date === 'string') q = q.or(`flight_date.eq.${flight_date},flight_date.is.null`);
      const { error } = await q;
      if (error) throw error;
      return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // "Hoy" del usuario (lo manda la app en su zona horaria); si no llega, el de UTC.
    const todayISO = typeof today === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(today) ? today : new Date().toISOString().slice(0, 10);
    const why = trackError({ flight, flight_date }, todayISO);
    if (why) return bad(why);

    const { data: existing } = await admin.from('tracked_flights').select('id')
      .eq('user_id', u.user.id).eq('flight', code).eq('flight_date', flight_date).maybeSingle();
    if (!existing) {
      const { count } = await admin.from('tracked_flights').select('id', { count: 'exact', head: true })
        .eq('user_id', u.user.id).eq('active', true);
      if ((count ?? 0) >= MAX_ACTIVE_PER_USER) return bad(`Puedes seguir hasta ${MAX_ACTIVE_PER_USER} vuelos a la vez`);
    }

    const { error } = await admin.from('tracked_flights').upsert({
      user_id: u.user.id,
      flight: code,
      flight_date,
      route: route ?? null,
      trip_id: trip_id ?? null,
      active: true,
    }, { onConflict: 'user_id,flight,flight_date' });
    if (error) throw error;

    return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
