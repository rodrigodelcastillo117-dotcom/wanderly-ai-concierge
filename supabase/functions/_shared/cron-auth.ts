// Shared gate for scheduled functions (verify_jwt = false). Fails closed.
// La decisión vive en cron-auth-core.ts (probada en src/test/cronAuth.test.ts).
import { createClient } from "npm:@supabase/supabase-js@2";
import { checkCronAuth } from "./cron-auth-core.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";

export function isAuthorizedCron(req: Request): Promise<boolean> {
  return checkCronAuth(req.headers, {
    env: (k) => Deno.env.get(k),
    probeServiceKey: async (bearer) => {
      if (!SUPABASE_URL) return false;
      const probe = createClient(SUPABASE_URL, bearer, { auth: { persistSession: false, autoRefreshToken: false } });
      const { error } = await probe.auth.admin.listUsers({ page: 1, perPage: 1 });
      return !error;
    },
    verifyVaultSecret: async (secret) => {
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
      if (!SUPABASE_URL || !serviceKey) return false;
      const admin = createClient(SUPABASE_URL, serviceKey, { auth: { persistSession: false } });
      const { data, error } = await admin.rpc("verify_cron_secret", { p_secret: secret });
      return !error && data === true;
    },
  });
}
