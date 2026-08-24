import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { getAuthUser, unauthorizedResponse } from "../_shared/verify-auth.ts";
import { enforceRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";

// Travelpayouts Data API — cached lowest prices (does not need user, real data)
// Docs: https://support.travelpayouts.com/hc/en-us/articles/360011498618
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const __user = await getAuthUser(req);
  if (!__user) return unauthorizedResponse(corsHeaders);

  const __rl = await enforceRateLimit(req, "travelpayouts-search", __user.id, { perMinute: 20, perHour: 200, ipPerMinute: 60 });
  if (!__rl.allowed) return rateLimitResponse(__rl, corsHeaders);

  try {
    const TOKEN = Deno.env.get('TRAVELPAYOUTS_TOKEN');
    if (!TOKEN) throw new Error('TRAVELPAYOUTS_TOKEN missing');

    const { kind, origin, destination, depart_date, return_date, currency = 'usd', limit = 10 } =
      await req.json();

    if (kind === 'cheap_flights') {
      if (!origin || !destination) {
        return new Response(JSON.stringify({ error: 'origin & destination (IATA) required' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const params = new URLSearchParams({
        origin, destination, currency, token: TOKEN,
      });
      if (depart_date) params.set('depart_date', depart_date);
      if (return_date) params.set('return_date', return_date);
      const url = `https://api.travelpayouts.com/v1/prices/cheap?${params}`;
      const r = await fetch(url);
      const data = await r.json();
      return new Response(JSON.stringify({ ok: true, kind, data }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (kind === 'calendar') {
      // Best prices by month
      const params = new URLSearchParams({
        origin, destination, currency, token: TOKEN,
        depart_date: depart_date || '',
      });
      const r = await fetch(`https://api.travelpayouts.com/v1/prices/calendar?${params}`);
      return new Response(JSON.stringify({ ok: true, kind, data: await r.json() }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (kind === 'hotels') {
      // Hotellook cached prices
      const { location, checkIn, checkOut, adults = 2 } = await req.json().catch(() => ({}));
      // Note: requires location id; for simplicity expose locations search
      const params = new URLSearchParams({
        location: location || destination || '',
        checkIn: checkIn || depart_date || '',
        checkOut: checkOut || return_date || '',
        currency, adults: String(adults), token: TOKEN,
      });
      const r = await fetch(`https://engine.hotellook.com/api/v2/cache.json?${params}`);
      return new Response(JSON.stringify({ ok: true, kind, data: await r.json() }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'kind must be cheap_flights | calendar | hotels' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : 'unknown' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
