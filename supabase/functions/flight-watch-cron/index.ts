// Recorre vuelos rastreados, consulta su estado en SerpApi, detecta cambios y avisa (dentro de la
// app, por push y por los canales del viajero —Telegram/WhatsApp— respetando su canal preferido y su horario de no
// molestar: _shared/channels/entrega.ts). Las reglas viven en rules.ts y el ciclo en runner.ts (ambos probados).
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { fetchFlightStatus } from '../_shared/flight-serpapi.ts';
import { serpFetchFor } from '../_shared/serpRuntime.ts';
import { isAuthorizedCron } from '../_shared/cron-auth.ts';
import { FLIGHT_PUSH_OPTIONS, pushToUser } from '../_shared/push.ts';
import { safeErrorMessage } from '../_shared/redact.ts';
import { DEFAULT_OPTIONS, parseMaxChecks, runFlightWatch } from './runner.ts';
import { sendEmail } from '../_shared/email.ts';
import { flightUpdateEmail } from '../_shared/email-templates.ts';
import { alertEmailsEnabled, alertRecipient } from '../_shared/alert-email.ts';
import type { TrackedFlight } from './rules.ts';
import { avisarUsuario } from '../_shared/channels/entrega.ts';
import { entregaDeps } from '../_shared/channels/entregaRuntime.ts';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  if (!(await isAuthorizedCron(req))) return json({ error: 'unauthorized' }, 401);

  // Sin llave no se reclama ningún vuelo: nada queda marcado como revisado.
  const key = Deno.env.get('SERPAPI_PRIVATE_KEY');
  if (!key) {
    console.error('flight-watch-cron: falta SERPAPI_PRIVATE_KEY; no se revisó ningún vuelo');
    return json({ ok: false, error: 'serpapi_not_configured' }, 503);
  }

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });
  const opts = { ...DEFAULT_OPTIONS, maxChecks: parseMaxChecks(Deno.env.get('FLIGHT_WATCH_MAX_CHECKS')) };
  // Caché compartida de 10 min con flight-status: varias personas en el mismo vuelo pagan una sola
  // búsqueda; cada búsqueda real queda en ai_usage_log.
  const serp = serpFetchFor('flight-watch-cron', null);
  const entrega = entregaDeps(admin);

  try {
    const summary = await runFlightWatch({
      claim: async (limit) => {
        const { data, error } = await admin.rpc('claim_tracked_flights', { p_limit: limit });
        if (error) throw new Error(`claim_failed: ${error.message}`);
        return (data ?? []) as TrackedFlight[];
      },
      check: (flight, date, route) =>
        fetchFlightStatus(key, flight, date, route ?? undefined, { timeoutMs: opts.perCallTimeoutMs, fetch: serp.fetch }),
      save: async (id, update) => {
        const { error } = await admin.from('tracked_flights').update(update).eq('id', id);
        if (error) throw new Error(`save_failed: ${error.message}`);
      },
      notify: async (n) => {
        const { data, error } = await admin.rpc('notify_once', {
          p_user_id: n.user_id, p_type: 'flight_update', p_title: n.title, p_body: n.body,
          p_related_id: n.related_id, p_dedup_key: n.dedup_key,
        });
        if (error) throw new Error(`notify_failed: ${error.message}`);
        return data != null;
      },
      push: (userId, payload) => pushToUser(admin, userId, payload, FLIGHT_PUSH_OPTIONS),
      // Canales del viajero con SUS preferencias (preferido, no molestar). Cancelado, desviado o un vuelo de hoy/mañana =
      // urgente: por todos los canales aunque sea de noche. WhatsApp fuera de la ventana de 24 h: plantilla iatos_aviso_vuelo.
      deliver: (f, payload, change) => {
        // Un cambio de un vuelo de hoy o mañana (puerta, retraso) tampoco espera al fin del horario de no molestar.
        const dias = f.flight_date ? Math.abs(Date.parse(`${f.flight_date}T12:00:00Z`) - Date.now()) / 86_400_000 : 99;
        const urgente = /cancel|divert|desvi/i.test(`${change.status ?? ""} ${change.changes.join(" ")}`) || dias <= 1.5;
        return avisarUsuario(entrega, f.user_id, {
          titulo: payload.title, texto: payload.body, url: payload.url, urgente, tipo: 'vuelo',
          plantilla: { nombre: 'iatos_aviso_vuelo', params: [f.flight, f.flight_date ?? '', change.changes.join(', ').slice(0, 250)] },
          dedupe: `vuelo:${f.id}:${change.fingerprint}`.slice(0, 200),
        }).then((r) => r.entregados).catch(() => 0);
      },
      // Correo del aviso: apagado por defecto (ALERT_EMAILS_ENABLED, ver _shared/alert-email.ts).
      email: alertEmailsEnabled()
        ? async (f, change) => {
          const to = await alertRecipient(admin, f.user_id);
          if (!to) return;
          const mail = flightUpdateEmail({
            firstName: to.firstName, flight: f.flight, flightDate: f.flight_date, route: f.route,
            changes: change.changes, status: change.status, checkedAt: new Date().toISOString(), url: change.url,
            siteUrl: Deno.env.get('SITE_URL'),
          });
          const sent = await sendEmail({ to: to.email, subject: mail.subject, html: mail.html, text: mail.text });
          if (!sent.ok) console.error('flight-watch-cron: correo de aviso no enviado', f.id);
        }
        : undefined,
      now: () => Date.now(),
      log: (...args) => console.error(...args),
    }, opts);

    if (summary.provider_errors > 0 || summary.failed_rows > 0) {
      console.error('flight-watch-cron: corrida con errores', JSON.stringify(summary));
    }
    // Cuota agotada → 503 para que el chequeo de tareas programadas lo vea como falla.
    if (summary.quota_exhausted) return json({ ok: false, error: 'serpapi_quota_exhausted', ...summary }, 503);
    return json({ ok: summary.provider_errors === 0 && summary.failed_rows === 0, ...summary });
  } catch (e) {
    const message = safeErrorMessage(e);
    console.error('flight-watch-cron: falló la corrida', message);
    return json({ ok: false, error: message }, 500);
  }
});
