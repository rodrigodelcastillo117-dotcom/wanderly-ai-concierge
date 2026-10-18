// Shared gate for scheduled functions (verify_jwt = false). Fails closed.
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";

export async function isAuthorizedCron(req: Request): Promise<boolean> {
  const cronHeader = req.headers.get("x-cron-secret") ?? req.headers.get("x-cron-key") ?? "";
  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();

  const cronSecret = Deno.env.get("CRON_SECRET") ?? "";
  if (cronSecret && cronHeader === cronSecret) return true;

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (serviceKey && bearer === serviceKey) return true;

  // A project can hold both a legacy JWT service key and a new sb_secret_ key, so
  // a valid credential may not match the env string. Ask Auth instead: only a
  // service-role credential can list users.
  if (bearer && SUPABASE_URL) {
    try {
      const probe = createClient(SUPABASE_URL, bearer, { auth: { persistSession: false, autoRefreshToken: false } });
      const { error } = await probe.auth.admin.listUsers({ page: 1, perPage: 1 });
      if (!error) return true;
    } catch {
      // fall through
    }
  }

  // Database schedulers send a secret kept in Supabase Vault (see
  // docs/ops/programar-tareas.sql); it is checked in the database.
  if (cronHeader && serviceKey && SUPABASE_URL) {
    try {
      const admin = createClient(SUPABASE_URL, serviceKey, { auth: { persistSession: false } });
      const { data } = await admin.rpc("verify_cron_secret", { p_secret: cronHeader });
      if (data === true) return true;
    } catch {
      // fall through
    }
  }
  return false;
}
