// Lógica de cuota y respuestas de error estables, sin dependencias de Deno (se prueba con Vitest
// desde src/test). entitlements.ts la usa con el cliente service_role real.
//
// Contrato de errores (IATOS-P1-FREE-01): el cliente decide qué mostrar por `code`, nunca por el
// texto. Solo viajan campos seguros; los detalles técnicos se quedan en los logs del servidor.
//   402 FREE_LIMIT_REACHED   límite del plan alcanzado (quota, limit, used, renews_at, upgrade_available)
//   503 SERVICE_UNAVAILABLE  fallo técnico (proveedor, verificación de cuota, guardado): sin venta de PRO
//   401 UNAUTHENTICATED      sesión inválida
//   409 ANALYSIS_IN_PROGRESS ya hay una petición igual corriendo (doble clic, otra pestaña)
//   400 INVALID_REQUEST      faltan datos

export type QuotaKind = "concierge" | "trip_analysis";
/** Tipos de plan_limits que no usan reservas: alertas y vuelos activos, búsquedas en vivo. */
export type PlanLimitKind = "price_watches" | "tracked_flights" | "live_searches";
export type QuotaName =
  | "concierge_monthly" | "trip_analysis_once" | "trip_analysis_monthly"
  // Límites recomendados (20261022135300): prueba sin tarjeta y tope diario de PRO.
  | "concierge_trial" | "trip_analysis_trial" | "concierge_daily" | "trip_analysis_daily"
  // Grupo cost (20261022142000): activos a la vez y bolsa de búsquedas en vivo.
  | "price_watches_active" | "tracked_flights_active"
  | "live_searches_daily" | "live_searches_monthly" | "live_searches_trial";

/** Solo los límites mensuales y diarios se renuevan; los de una vez, de la prueba y activos, no. */
export const quotaRenews = (q: QuotaName) => q.endsWith("_monthly") || q.endsWith("_daily");

export type QuotaReason =
  | "pro" | "free_quota" | "reserved" | "quota_exceeded" | "in_progress" | "too_many_in_progress"
  | "replay" | "unknown_kind" | "error";

export type QuotaResult = {
  allowed: boolean;
  reason: QuotaReason;
  remaining: number | null;
  // Datos para el aviso de límite (los manda la base desde la migración 20261022135000).
  limit?: number | null;
  used?: number | null;
  renews_at?: string | null;
  quota?: QuotaName;
  upgrade_available?: boolean;
  // Solo con reserve_quota.
  reservation_id?: string;
  trip_id?: string | null;
  result?: unknown;
};

export type QuotaOptions = {
  /**
   * Si la verificación falla (BD caída, migración sin aplicar, falta la service key):
   * true → se niega (fail-closed); false → se permite (fail-open).
   * Por omisión, trip_analysis falla cerrado: cada análisis gasta Claude + SerpApi + Perplexity.
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

/** Ejecuta una RPC de cuota (consume_free_quota o reserve_quota) y traduce el resultado; nunca lanza. */
export async function runQuota(
  rpc: QuotaRpc,
  userId: string,
  kind: QuotaKind,
  opts: QuotaOptions = {},
): Promise<QuotaResult> {
  try {
    const { data, error } = await rpc(userId, kind);
    if (error) {
      console.error("quota rpc error:", error.message);
      return onError(kind, opts);
    }
    const r = data as Partial<QuotaResult> | null;
    if (!r || typeof r.allowed !== "boolean") {
      console.error("quota rpc: respuesta inesperada", data);
      return onError(kind, opts);
    }
    return { ...r, allowed: r.allowed, reason: (r.reason ?? "error") as QuotaReason, remaining: r.remaining ?? null };
  } catch (e) {
    console.error("quota rpc exception:", (e as Error).message);
    return onError(kind, opts);
  }
}

const json = (status: number, body: unknown, corsHeaders: Record<string, string>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

/** Primer día del mes siguiente (UTC), cuando se renueva la cuota mensual. */
export function nextMonthStartIso(now = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
}

/** "1 de noviembre de 2026". En UTC porque la cuota se renueva a las 00:00 UTC del día 1. */
export function formatRenewal(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

export type FreeLimitBody = {
  code: "FREE_LIMIT_REACHED";
  quota: QuotaName;
  limit: number;
  used: number;
  renews_at: string | null;
  upgrade_available: boolean;
  message: string;
};

const DEFAULT_LIMIT: Record<QuotaKind | PlanLimitKind, number> = {
  concierge: 3, trip_analysis: 1, price_watches: 0, tracked_flights: 1, live_searches: 5,
};
const DEFAULT_QUOTA: Record<QuotaKind | PlanLimitKind, QuotaName> = {
  concierge: "concierge_monthly", trip_analysis: "trip_analysis_once", price_watches: "price_watches_active",
  tracked_flights: "tracked_flights_active", live_searches: "live_searches_daily",
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Texto para el usuario según el límite alcanzado. El frontend usa el mismo texto (functionErrors.ts).
 * `limit` solo se usa en los límites de activos y de búsquedas en vivo.
 */
export function freeLimitMessage(quota: QuotaName, renewsAt: string | null, upgradeAvailable: boolean, limit: number | null = null): string {
  const fecha = formatRenewal(renewsAt) ?? (quota.endsWith("_daily") ? "mañana" : "próximo mes");
  // Mismo texto que el diálogo del frontend, que toma el precio de src/lib/planCopy.ts (PRICE_LINE);
  // una prueba (functionErrors.test) verifica que coincidan.
  const pro = "Puedes seguir usando las funciones gratuitas o activar IATOS PRO por $99 MXN al mes, IVA incluido, sujeto a las condiciones vigentes.";
  const n = typeof limit === "number" && limit >= 0 ? limit : null;
  if (quota === "price_watches_active") {
    if (upgradeAvailable && !n) return `Las alertas de precio están incluidas en IATOS PRO. ${pro}`;
    const tope = n ? `Ya tienes ${plural(n, "alerta de precio activa", "alertas de precio activas")}, el máximo de tu plan.` : "Llegaste al máximo de alertas de precio de tu plan.";
    return `${tope} Desactiva una para activar otra.${upgradeAvailable ? ` ${pro}` : ""}`;
  }
  if (quota === "tracked_flights_active") {
    const tope = n ? `Ya sigues ${plural(n, "vuelo", "vuelos")} a la vez, el máximo de tu plan.` : "Llegaste al máximo de vuelos seguidos de tu plan.";
    return `${tope} Deja de seguir uno para agregar otro.${upgradeAvailable ? ` ${pro}` : ""}`;
  }
  if (quota.startsWith("live_searches_") && upgradeAvailable) {
    const cuantas = n ? `tus ${plural(n, "búsqueda", "búsquedas")} en vivo` : "tus búsquedas en vivo";
    if (quota === "live_searches_trial") return `Usaste ${cuantas} de tu prueba gratuita de IATOS PRO. ${pro}`;
    return quota === "live_searches_daily"
      ? `Usaste ${cuantas} de hoy (vuelos y hoteles); se renuevan el ${fecha}. ${pro}`
      : `Usaste ${cuantas} de este mes (vuelos y hoteles); se renuevan el ${fecha}. ${pro}`;
  }
  // Un plan de pago que llega a su límite no recibe oferta de "mejorar".
  if (!upgradeAvailable) {
    return quota.endsWith("_daily")
      ? `Llegaste al límite diario de tu plan; se renueva el ${fecha}.`
      : `Llegaste al límite mensual de tu plan; se renueva el ${fecha}.`;
  }
  if (quota.endsWith("_trial")) return `Llegaste al límite de tu prueba gratuita de IATOS PRO. ${pro}`;
  if (quota === "concierge_monthly") {
    return `Has utilizado tus mensajes gratuitos de Iato de este mes. Se renuevan el ${fecha}. ${pro}`;
  }
  // Nunca prometer renovación del análisis de una sola vez.
  return `Ya usaste tu análisis gratuito de viaje (es de una sola vez). ${pro}`;
}

/** Cuerpo del 402. Si la base no mandó los datos (migración sin aplicar) usa los límites gratuitos. */
export function freeLimitBody(kind: QuotaKind | PlanLimitKind, q: Partial<QuotaResult> = {}, now = new Date()): FreeLimitBody {
  const quota: QuotaName = q.quota ?? DEFAULT_QUOTA[kind];
  const limit = typeof q.limit === "number" ? q.limit : DEFAULT_LIMIT[kind];
  const used = typeof q.used === "number" ? q.used : limit;
  const renews_at = quotaRenews(quota) ? (q.renews_at ?? (quota.endsWith("_daily") ? null : nextMonthStartIso(now))) : null;
  const upgrade_available = q.upgrade_available ?? true;
  return {
    code: "FREE_LIMIT_REACHED", quota, limit, used, renews_at, upgrade_available,
    message: freeLimitMessage(quota, renews_at, upgrade_available, limit),
  };
}

export function freeLimitResponse(kind: QuotaKind | PlanLimitKind, q: Partial<QuotaResult> = {}, corsHeaders: Record<string, string> = {}) {
  return json(402, freeLimitBody(kind, q), corsHeaders);
}

/** Compatibilidad: 402 con el contrato nuevo y los límites gratuitos por omisión. */
export function paywallResponse(kind: QuotaKind, corsHeaders: Record<string, string> = {}) {
  return freeLimitResponse(kind, {}, corsHeaders);
}

export const SERVICE_UNAVAILABLE_MESSAGE =
  "No pudimos completar esto en este momento y no se descontó de tu plan. Intenta de nuevo en unos minutos.";

export function serviceUnavailableResponse(corsHeaders: Record<string, string> = {}, message = SERVICE_UNAVAILABLE_MESSAGE) {
  return json(503, { code: "SERVICE_UNAVAILABLE", message }, corsHeaders);
}

export function unauthenticatedResponse(corsHeaders: Record<string, string> = {}) {
  return json(401, { code: "UNAUTHENTICATED", error: "unauthorized", message: "Tu sesión expiró. Vuelve a iniciar sesión." }, corsHeaders);
}

export function inProgressResponse(kind: QuotaKind, corsHeaders: Record<string, string> = {}) {
  return json(409, {
    code: "ANALYSIS_IN_PROGRESS",
    message: kind === "concierge"
      ? "Iato todavía está respondiendo tu mensaje anterior. Espera unos segundos."
      : "Tu análisis ya está en proceso. Espera unos segundos; no se cobra dos veces.",
  }, corsHeaders);
}

export function invalidRequestResponse(
  corsHeaders: Record<string, string> = {},
  message = "Faltan datos para continuar. Revisa el formulario e intenta de nuevo.",
) {
  return json(400, { code: "INVALID_REQUEST", message }, corsHeaders);
}

/**
 * Respuesta para una cuota negada: 402 FREE_LIMIT_REACHED si de verdad se alcanzó el límite, 409 si
 * hay otra petición igual en curso y 503 SERVICE_UNAVAILABLE si no pudimos verificar el plan (no es
 * culpa del usuario ni se le pide pagar).
 */
export function quotaDeniedResponse(
  quota: QuotaResult,
  kind: QuotaKind,
  corsHeaders: Record<string, string> = {},
) {
  if (quota.reason === "quota_exceeded") return freeLimitResponse(kind, quota, corsHeaders);
  if (quota.reason === "in_progress" || quota.reason === "too_many_in_progress") return inProgressResponse(kind, corsHeaders);
  return serviceUnavailableResponse(corsHeaders);
}
