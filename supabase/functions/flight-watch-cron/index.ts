// Recorre vuelos rastreados, consulta flight-status, detecta cambios y dispara push notifications
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const VAPID_PUBLIC = Deno.env.get('VAPID_PUBLIC_KEY')!;
const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY')!;
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') || 'mailto:concierge@iatos.ai';

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

const admin = createClient(SUPABASE_URL, SERVICE_KEY);

async function callFlightStatus(flight: string, route?: string | null, date?: string | null) {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/flight-status`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ flight, route, date }),
  });
  return await r.json();
}

async function pushToUser(user_id: string, title: string, body: string, url: string) {
  const { data: subs } = await admin.from('push_subscriptions').select('*').eq('user_id', user_id);
  if (!subs?.length) return 0;
  let sent = 0;
  for (const s of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify({ title, body, url, icon: '/icons/icon-192.png', badge: '/icons/icon-192.png' })
      );
      sent++;
    } catch (e: any) {
      // 410/404 = suscripción expirada → borrar
      if (e?.statusCode === 410 || e?.statusCode === 404) {
        await admin.from('push_subscriptions').delete().eq('endpoint', s.endpoint);
      }
    }
  }
  return sent;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    // Vuelos activos cuya fecha sea hoy o futura (o sin fecha)
    const today = new Date().toISOString().slice(0, 10);
    const { data: flights, error } = await admin
      .from('tracked_flights')
      .select('*')
      .eq('active', true)
      .or(`flight_date.is.null,flight_date.gte.${today}`)
      .order('last_checked_at', { ascending: true, nullsFirst: true })
      .limit(50);
    if (error) throw error;

    const results: any[] = [];
    for (const f of flights ?? []) {
      try {
        const res = await callFlightStatus(f.flight, f.route, f.flight_date);
        const d = res?.data ?? {};
        const changes: string[] = [];
        if (d.status && d.status !== 'desconocido' && f.last_status && d.status !== f.last_status) {
          changes.push(`Estado: ${f.last_status} → ${d.status}`);
        }
        if (d.gate && f.last_gate && d.gate !== f.last_gate) {
          changes.push(`Puerta: ${f.last_gate} → ${d.gate}`);
        }
        if (d.terminal && f.last_terminal && d.terminal !== f.last_terminal) {
          changes.push(`Terminal: ${f.last_terminal} → ${d.terminal}`);
        }
        if (d.estimated_departure && f.last_estimated && d.estimated_departure !== f.last_estimated) {
          changes.push(`Hora estimada: ${f.last_estimated} → ${d.estimated_departure}`);
        }

        if (changes.length > 0) {
          const title = `Vuelo ${f.flight} actualizado`;
          const body = changes.join(' · ');
          await pushToUser(f.user_id, title, body, f.trip_id ? `/dashboard/viajes/${f.trip_id}` : '/dashboard/concierge');
          await admin.from('notifications').insert({
            user_id: f.user_id,
            type: 'flight_update',
            title, body,
            related_id: f.trip_id ?? null,
          });
        }

        await admin.from('tracked_flights').update({
          last_status: d.status ?? f.last_status,
          last_gate: d.gate ?? f.last_gate,
          last_terminal: d.terminal ?? f.last_terminal,
          last_estimated: d.estimated_departure ?? f.last_estimated,
          last_checked_at: new Date().toISOString(),
        }).eq('id', f.id);

        results.push({ flight: f.flight, changes });
      } catch (e) {
        results.push({ flight: f.flight, error: (e as Error).message });
      }
    }

    return new Response(JSON.stringify({ ok: true, checked: flights?.length ?? 0, results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
