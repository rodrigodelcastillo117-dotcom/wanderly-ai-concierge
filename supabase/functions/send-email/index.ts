// send-email — envía el correo de invitación a un viaje. Antes aceptaba destinatario, asunto y
// HTML libres (cualquier usuario podía mandar cualquier correo desde el dominio de IATOS); ahora
// solo recibe el viaje y el amigo, verifica que quien llama es el dueño y que el amigo ya está
// invitado, toma el correo del destinatario del servidor y usa una plantilla fija.
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { getAuthUser, unauthorizedResponse } from "../_shared/verify-auth.ts";
import { sendEmail } from "../_shared/email.ts";
import { tripInviteEmail } from "../_shared/email-templates.ts";
import { heroPhoto } from "../_shared/hero-photo.ts";
import { enforceRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const user = await getAuthUser(req);
  if (!user) return unauthorizedResponse(corsHeaders);

  const rl = await enforceRateLimit(req, "send-email", user.id, { perMinute: 5, perHour: 30, ipPerMinute: 10 });
  if (!rl.allowed) return rateLimitResponse(rl, corsHeaders);

  try {
    const { trip_id, friend_id } = (await req.json().catch(() => ({}))) ?? {};
    if (typeof trip_id !== 'string' || typeof friend_id !== 'string') {
      return json({ error: 'trip_id y friend_id requeridos' }, 400);
    }

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: trip } = await admin
      .from('trips').select('id, user_id, destino, ciudad_origen, fecha_salida, fecha_regreso, num_viajeros').eq('id', trip_id).maybeSingle();
    if (!trip || trip.user_id !== user.id) return json({ error: 'forbidden' }, 403);

    const { data: collab } = await admin
      .from('trip_collaborators').select('user_id').eq('trip_id', trip_id).eq('user_id', friend_id).maybeSingle();
    if (!collab) return json({ error: 'forbidden' }, 403);

    const { data: friend } = await admin.auth.admin.getUserById(friend_id);
    const to = friend?.user?.email;
    if (!to) return json({ error: 'sin_correo' }, 404);

    const { data: profs } = await admin.from('profiles').select('id, full_name').in('id', [user.id, friend_id]);
    const name = (id: string) => profs?.find((p) => p.id === id)?.full_name ?? null;

    const destino = trip.destino ?? 'tu próximo destino';
    const { subject, html, text } = tripInviteEmail({
      guestName: name(friend_id),
      hostName: name(user.id),
      destination: destino,
      origin: trip.ciudad_origen ?? null,
      dateFrom: trip.fecha_salida,
      dateTo: trip.fecha_regreso,
      travelers: trip.num_viajeros ?? null,
      tripId: trip.id,
      hero: await heroPhoto(trip.destino, { fn: 'send-email', userId: user.id }),
      siteUrl: Deno.env.get('SITE_URL'),
    });
    const res = await sendEmail({ to, subject, html, text });
    if (!res.ok) return json({ error: res.error || 'Resend error' }, 502);
    return json({ ok: true, id: res.id });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'unknown' }, 500);
  }
});
