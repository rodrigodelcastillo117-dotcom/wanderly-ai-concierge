// trip-files-purge (T-P2-3): borra de storage los archivos de los viajes borrados (documentos y fotos
// del diario, de cualquiera que los subió), que el trigger trips_queue_storage_purge anotó en
// storage_purge_queue. Storage solo se borra con su API, por eso existe esta función.
//
//   · Con la sesión de la persona (la app la llama justo después de borrar un viaje): vacía SOLO las
//     filas de esa persona (user_id = dueño del viaje borrado).
//   · Como tarea programada (x-cron-secret): vacía toda la cola (incluidos huérfanos y los de cuentas
//     borradas). verify_jwt = false: la función valida las dos formas.
// Respuesta sin datos personales: solo conteos.
import { createClient } from "npm:@supabase/supabase-js@2";
import { isAuthorizedCron } from "../_shared/cron-auth.ts";
import { getAuthUser, unauthorizedResponse } from "../_shared/verify-auth.ts";
import { enforceRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { drainQueue, type QueueRow } from "./purge.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return json({ error: "not_configured" }, 503);

  let userId: string | null = null;
  if (req.headers.get("x-cron-secret")) {
    if (!(await isAuthorizedCron(req))) return json({ error: "unauthorized" }, 401);
  } else {
    const user = await getAuthUser(req);
    if (!user) return unauthorizedResponse(corsHeaders);
    const rl = await enforceRateLimit(req, "trip-files-purge", user.id, { perMinute: 10, perHour: 60, ipPerMinute: 20 });
    if (!rl.allowed) return rateLimitResponse(rl, corsHeaders);
    userId = user.id;
  }

  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    const result = await drainQueue({
      load: async (limit) => {
        let q = admin.from("storage_purge_queue").select("id, bucket_id, name").order("id", { ascending: true }).limit(limit);
        q = userId ? q.eq("user_id", userId) : q;
        const { data, error } = await q;
        if (error) throw new Error(error.message);
        return (data ?? []) as QueueRow[];
      },
      remove: async (bucket, names) => {
        const { error } = await admin.storage.from(bucket).remove(names);
        return { error: error ? error.message : null };
      },
      done: async (ids) => {
        const { error } = await admin.from("storage_purge_queue").delete().in("id", ids);
        if (error) throw new Error(error.message);
      },
    }, { batch: 100, maxRounds: userId ? 5 : 20 });
    return json({ ok: true, ...result });
  } catch {
    return json({ ok: false, error: "purge_failed" }, 500);
  }
});
