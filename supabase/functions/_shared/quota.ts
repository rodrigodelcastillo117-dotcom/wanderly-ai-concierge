// Lógica de cuota gratuita sin dependencias de Deno (se prueba con Vitest desde src/test).
// entitlements.ts la usa con el cliente service_role real.

export type QuotaKind = "concierge" | "trip_analysis";

export type QuotaResult = {
  allowed: boolean;
  reason: "pro" | "free_quota" | "quota_exceeded" | "unknown_kind" | "error";
  remaining: number | null;
};

export type QuotaOptions = {
  /**
   * Si la verificación falla (BD caída, migración sin aplicar, falta la service key):
   * true → se niega (fail-closed); false → se permite (fail-open).
   * Por omisión, trip_analysis falla cerrado: cada análisis gasta Claude + SerpApi + Perplexity y,
   * antes, un error de infraestructura regalaba análisis ilimitados a cualquier cuenta gratis.
   * concierge sigue abierto por omisión hasta que concierge-chat use quotaDeniedResponse (si se
   * cerrara antes, su paywallResponse diría "agotaste tus mensajes" a un PRO durante una caída).
   */
  failClosed?: boolean;
};

const FAIL_CLOSED_BY_DEFAULT: Record<QuotaKind, boolean> = {
  trip_analysis: true,
  concierge: false,
};

type RpcResult = { data: unknown; error: { message: string } | null };
export type QuotaRpc = (userId: string, kind: QuotaKind) => PromiseLike<RpcResult>;

function onError(kind: QuotaKind, opts: QuotaOptions): QuotaResult {
  const closed = opts.failClosed ?? FAIL_CLOSED_BY_DEFAULT[kind];
  return { allowed: !closed, reason: "error", remaining: null };
}

/** Ejecuta consume_free_quota y traduce el resultado; nunca lanza. */
export async function runQuota(
  rpc: QuotaRpc,
  userId: string,
  kind: QuotaKind,
  opts: QuotaOptions = {},
): Promise<QuotaResult> {
  try {
    const { data, error } = await rpc(userId, kind);
    if (error) {
      console.error("consume_free_quota error:", error.message);
      return onError(kind, opts);
    }
    const r = data as Partial<QuotaResult> | null;
    if (!r || typeof r.allowed !== "boolean") {
      console.error("consume_free_quota: respuesta inesperada", data);
      return onError(kind, opts);
    }
    return { allowed: r.allowed, reason: (r.reason ?? "error") as QuotaResult["reason"], remaining: r.remaining ?? null };
  } catch (e) {
    console.error("consume_free_quota exception:", (e as Error).message);
    return onError(kind, opts);
  }
}

const json = (status: number, body: unknown, corsHeaders: Record<string, string>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

/** Respuesta 402 estándar cuando se agota la cuota gratuita. */
export function paywallResponse(kind: QuotaKind, corsHeaders: Record<string, string> = {}) {
  const msg =
    kind === "concierge"
      ? "Agotaste tus 3 mensajes gratis de este mes con el Concierge."
      : "Ya usaste tu análisis de viaje gratuito.";
  return json(402, {
    error: "upgrade_required",
    kind,
    message: `${msg} Activa IATOS PRO para acceso ilimitado.`,
    upgrade_url: "/dashboard/pro",
  }, corsHeaders);
}

/**
 * Respuesta para una cuota negada: 402 (paywall) si de verdad se agotó; 503 con un mensaje claro
 * si no pudimos verificar el plan (no es culpa del usuario ni se le pide pagar).
 */
export function quotaDeniedResponse(
  quota: QuotaResult,
  kind: QuotaKind,
  corsHeaders: Record<string, string> = {},
) {
  if (quota.reason === "error" || quota.reason === "unknown_kind") {
    return json(503, {
      error: "quota_check_failed",
      kind,
      message: "No pudimos verificar tu plan en este momento. No se descontó nada; intenta de nuevo en unos minutos.",
    }, corsHeaders);
  }
  return paywallResponse(kind, corsHeaders);
}
