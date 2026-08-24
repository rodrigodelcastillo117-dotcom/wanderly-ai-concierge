// Helpers de acceso PRO y cuota gratuita.
// Se ejecutan SOLO en el servidor con service_role (nunca se acepta esa key del cliente).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

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

export type QuotaKind = "concierge" | "trip_analysis";

export type QuotaResult = {
  allowed: boolean;
  reason: "pro" | "free_quota" | "quota_exceeded" | "unknown_kind" | "error";
  remaining: number | null;
};

/** Consume una unidad de cuota gratuita. Si el usuario es PRO, siempre permite y no descuenta. */
export async function consumeQuota(userId: string, kind: QuotaKind): Promise<QuotaResult> {
  try {
    const { data, error } = await adminClient().rpc("consume_free_quota", {
      _user_id: userId,
      _kind: kind,
    });
    if (error) {
      console.error("consume_free_quota error:", error.message);
      // Fail-open para no romper la experiencia por un fallo de infraestructura.
      return { allowed: true, reason: "error", remaining: null };
    }
    return data as QuotaResult;
  } catch (e) {
    console.error("consume_free_quota exception:", (e as Error).message);
    return { allowed: true, reason: "error", remaining: null };
  }
}

/** Respuesta 402 estándar cuando se agota la cuota gratuita. */
export function paywallResponse(kind: QuotaKind, corsHeaders: Record<string, string> = {}) {
  const msg =
    kind === "concierge"
      ? "Agotaste tus 3 mensajes gratis de este mes con el Concierge."
      : "Ya usaste tu análisis de viaje gratuito.";
  return new Response(
    JSON.stringify({
      error: "upgrade_required",
      kind,
      message: `${msg} Activa IATOS PRO para acceso ilimitado.`,
      upgrade_url: "/dashboard/pro",
    }),
    { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}

export async function isPro(userId: string): Promise<boolean> {
  const { data, error } = await adminClient().rpc("is_pro", { _user_id: userId });
  if (error) {
    console.error("is_pro error:", error.message);
    return true; // fail-open
  }
  return Boolean(data);
}
