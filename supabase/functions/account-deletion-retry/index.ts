// Reintenta solicitudes de borrado de cuenta pendientes (deletion_requests). Para pg_cron o una
// llamada manual del dueño; protegida con la autenticación de cron (falla cerrada). verify_jwt=false.
// Reanuda pasos bloqueantes de cuentas aún no borradas y los no bloqueantes (cliente de Stripe,
// PostHog) de cuentas ya borradas; un paso que falló MAX_ATTEMPTS veces queda para revisión manual.
import { createClient } from "npm:@supabase/supabase-js@2";
import { isAuthorizedCron } from "../_shared/cron-auth.ts";
import { processRequest } from "../_shared/account-deletion-runtime.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const BATCH = 20;
const MAX_ATTEMPTS = 8;

Deno.serve(async (req) => {
  if (!(await isAuthorizedCron(req))) return json({ error: "unauthorized" }, 401);
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return json({ error: "not_configured" }, 503);
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: rows, error } = await admin.from("deletion_requests")
    .select("id").neq("status", "completed").order("updated_at", { ascending: true }).limit(BATCH);
  if (error) return json({ error: "read_failed" }, 500);

  const results: Array<{ id: string; completed: boolean; identity_deleted: boolean; pending: string[] }> = [];
  for (const r of rows ?? []) {
    try {
      const o = await processRequest(admin, (r as { id: string }).id, MAX_ATTEMPTS);
      results.push({ id: (r as { id: string }).id, completed: o.completed, identity_deleted: o.identityDeleted, pending: o.pending });
    } catch {
      results.push({ id: (r as { id: string }).id, completed: false, identity_deleted: false, pending: ["error"] });
    }
  }
  // Sin datos personales: ids de solicitud y nombres de pasos.
  return json({ ok: true, processed: results.length, results });
});
