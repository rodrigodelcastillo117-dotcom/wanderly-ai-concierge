// Helpers de acceso PRO y cuota gratuita.
// Se ejecutan SOLO en el servidor con service_role (nunca se acepta esa key del cliente).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { type QuotaKind, type QuotaOptions, type QuotaResult, runQuota } from "./quota.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  Deno.env.get("SUPABASE_SECRET_KEYS") ??
  "";

export function adminClient() {
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export type { QuotaKind, QuotaOptions, QuotaResult } from "./quota.ts";
export { paywallResponse, quotaDeniedResponse } from "./quota.ts";

/**
 * Consume una unidad de cuota gratuita. Si el usuario es PRO, siempre permite y no descuenta.
 * Llamar DESPUÉS de validar la entrada: una petición inválida no debe gastar la cuota.
 * Ante un error de verificación, trip_analysis niega (ver QuotaOptions.failClosed).
 */
export function consumeQuota(userId: string, kind: QuotaKind, opts: QuotaOptions = {}): Promise<QuotaResult> {
  return runQuota(
    (id, k) => adminClient().rpc("consume_free_quota", { _user_id: id, _kind: k }),
    userId,
    kind,
    opts,
  );
}

/** ¿Es PRO? Ante un error responde false (fail-closed): no se regala acceso de pago por una caída. */
export async function isPro(userId: string): Promise<boolean> {
  try {
    const { data, error } = await adminClient().rpc("is_pro", { _user_id: userId });
    if (error) {
      console.error("is_pro error:", error.message);
      return false;
    }
    return Boolean(data);
  } catch (e) {
    console.error("is_pro exception:", (e as Error).message);
    return false;
  }
}
