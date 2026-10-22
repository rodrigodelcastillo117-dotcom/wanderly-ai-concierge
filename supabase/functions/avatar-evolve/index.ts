// supabase/functions/avatar-evolve/index.ts
// El avatar gana un detalle del destino por cada viaje terminado o importado (CDMX → pin del Ángel,
// Nueva York → llavero de taxi amarillo…). Idempotente por viaje (avatar_claim_trip).
//
//   · Con sesión: {trip_id} → ese viaje (la app lo llama al importar un viaje pasado o al abrir un
//     viaje que ya terminó). Solo el dueño y solo si el viaje ya terminó.
//   · Tarea programada (x-cron-secret, ver docs/iatos/avatar/programar-avatar-evolucion.sql): hasta
//     10 viajes que terminaron en los últimos 45 días (avatar_trips_due).
// Avisa con notify_once ("Tu avatar ganó un detalle de Roma"). Costo: 1 imagen (+1 si la persona
// cambió y hay que reintentar); cupo de 4 imágenes de evolución por persona cada 24 h.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { isAuthorizedCron } from "../_shared/cron-auth.ts";
import { enforceRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { processTripEvolution } from "../_shared/avatar-flow.ts";
import { admin, evolutionDeps, ownedSouvenirs, TRIP_COLUMNS, tripEnd } from "../_shared/avatar-runtime.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

type Db = ReturnType<typeof admin>;

async function evolveTrip(db: Db, userId: string, tripId: string) {
  const { data: trip } = await db.from("trips").select(TRIP_COLUMNS).eq("id", tripId).maybeSingle();
  if (!trip || trip.user_id !== userId) return { status: "no_encontrado" as const };
  const end = tripEnd(trip);
  if (!end || end >= new Date().toISOString().slice(0, 10)) return { status: "aun_no_termina" as const };
  const owned = await ownedSouvenirs(db, userId);
  const fuente = trip.fuente === "documento" ? "documento" : "fin_de_viaje";
  const out = await processTripEvolution(evolutionDeps(db, userId, tripId, fuente), { trip, owned });
  return { status: out.status, souvenir: { nombre: out.souvenir.nombre, lugar: out.souvenir.lugar, emoji: out.souvenir.emoji }, url: out.url ?? null };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const db = admin();
  try {
    if (req.headers.get("x-cron-secret")) {
      if (!(await isAuthorizedCron(req))) return json({ error: "No autorizado" }, 401);
      if (!Deno.env.get("LOVABLE_API_KEY")) return json({ ok: false, error: "LOVABLE_API_KEY" }, 503);
      const { data, error } = await db.rpc("avatar_trips_due", { p_limit: 10 });
      if (error) return json({ ok: false, error: error.message }, 500);
      const results: Array<{ trip_id: string; status: string }> = [];
      for (const r of (data ?? []) as Array<{ user_id: string; trip_id: string }>) {
        try {
          const res = await evolveTrip(db, r.user_id, r.trip_id);
          results.push({ trip_id: r.trip_id, status: res.status });
        } catch (e) {
          console.error("avatar-evolve trip", r.trip_id, (e as Error).message);
          results.push({ trip_id: r.trip_id, status: "error" });
        }
      }
      return json({ ok: true, procesados: results.length, results });
    }

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: req.headers.get("Authorization")! } } });
    const { data: u } = await userClient.auth.getUser();
    if (!u?.user) return json({ error: "Sesión inválida" }, 401);
    const rl = await enforceRateLimit(req, "avatar-evolve", u.user.id, { perMinute: 6, perHour: 30, ipPerMinute: 12 });
    if (!rl.allowed) return rateLimitResponse(rl, corsHeaders);
    const body = await req.json().catch(() => ({}));
    const tripId = String(body?.trip_id ?? "");
    if (!UUID.test(tripId)) return json({ ok: false, error: "Viaje inválido" }, 400);
    if (!Deno.env.get("LOVABLE_API_KEY")) return json({ ok: false, error: "Servicio no disponible" }, 503);
    const res = await evolveTrip(db, u.user.id, tripId);
    if (res.status === "no_encontrado") return json({ ok: false, error: "Viaje no encontrado" }, 404);
    return json({ ok: true, ...res });
  } catch (e) {
    console.error("avatar-evolve error:", e);
    return json({ ok: false, error: "No se pudo actualizar tu avatar" }, 500);
  }
});
