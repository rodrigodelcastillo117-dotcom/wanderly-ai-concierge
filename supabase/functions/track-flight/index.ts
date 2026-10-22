// Activa / desactiva el rastreo de un vuelo para el usuario autenticado
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { enforceRateLimit, rateLimitResponse } from '../_shared/rate-limit.ts';
import { freePlanDateError, HARD_CAP_ACTIVE_PER_USER, normalizeFlight, trackError, tripIdForTracking } from './rules.ts';
import { planLimit, serviceUnavailableResponse } from '../_shared/entitlements.ts';
import { activeLimitDecision } from '../_shared/planGate.ts';

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
    // code + message: la app muestra el texto tal cual (src/lib/functionErrors.ts); error por compatibilidad.
    const bad = (msg: string) => new Response(JSON.stringify({ code: 'INVALID_REQUEST', message: msg, error: msg }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
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

    // Límite del plan (plan_limits.tracked_flights). Si no se puede leer, se niega con 503: no se
    // regala seguimiento (cada vuelo consulta SerpApi) ni se culpa al usuario.
    const rule = await planLimit(u.user.id, 'tracked_flights');
    if (!rule) return serviceUnavailableResponse(corsHeaders);
    // Plan gratuito ("básico"): solo el día del vuelo (hoy o mañana del usuario).
    if (rule.plan === 'free') {
      const dayRule = freePlanDateError(flight_date, todayISO);
      if (dayRule) return new Response(JSON.stringify({ code: 'INVALID_REQUEST', message: dayRule, error: 'free_day_of_flight_only' }), {
        status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Seguir otra vez un vuelo que ya está activo no cuenta como uno nuevo; reactivar uno apagado sí.
    const { data: existing } = await admin.from('tracked_flights').select('id, active')
      .eq('user_id', u.user.id).eq('flight', code).eq('flight_date', flight_date).maybeSingle();
    if (!existing?.active) {
      const { count, error: countErr } = await admin.from('tracked_flights').select('id', { count: 'exact', head: true })
        .eq('user_id', u.user.id).eq('active', true);
      if (countErr) return serviceUnavailableResponse(corsHeaders);
      const gate = activeLimitDecision('tracked_flights', rule, count ?? 0, HARD_CAP_ACTIVE_PER_USER);
      if (!gate.allowed) {
        if (gate.kind === 'unavailable') return serviceUnavailableResponse(corsHeaders);
        return new Response(JSON.stringify(gate.body), { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    }

    // Con la sesión del usuario: RLS de trips decide si el viaje es suyo o colabora en él.
    const safeTripId = await tripIdForTracking(trip_id, async (id) => {
      const { data } = await supabase.from('trips').select('id').eq('id', id).maybeSingle();
      return !!data;
    });
    const { error } = await admin.from('tracked_flights').upsert({
      user_id: u.user.id,
      flight: code,
      flight_date,
      route: route ?? null,
      trip_id: safeTripId,
      active: true,
    }, { onConflict: 'user_id,flight,flight_date' });
    if (error) throw error;

    return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
