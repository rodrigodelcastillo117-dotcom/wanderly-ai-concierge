// Rate limiting anti-abuso. Complementa (no reemplaza) las cuotas gratuitas de usage_limits:
// usage_limits controla el modelo de negocio (free vs PRO); esto controla el volumen por minuto/hora
// incluso para usuarios PRO, y por IP para frenar abuso desde una misma red.
//
// - El conteo lo hace check_rate_limit en una sola sentencia con candado por sujeto+cubeta
//   (migración 20261022141000): dos peticiones simultáneas ya no pasan las dos.
// - La IP sale de encabezados de la plataforma, no del primer X-Forwarded-For (ver clientIp).
// - Si la verificación falla, las cubetas de APIs de pago se niegan (503) y las baratas siguen.
// La lógica pura vive en rate-limit-core.ts (probada en src/test/rateLimit.test.ts).
import { adminClient } from "./entitlements.ts";
import {
  clientIp as clientIpFromHeaders,
  evaluateRateLimit,
  type HitFn,
  type LimitOptions,
  rateLimitBody,
  type RateLimitVerdict,
} from "./rate-limit-core.ts";

export type { RateLimitVerdict, RateRule } from "./rate-limit-core.ts";
export { isPaidBucket, PAID_BUCKETS } from "./rate-limit-core.ts";

export function clientIp(req: Request): string {
  return clientIpFromHeaders(req.headers);
}

const hit: HitFn = async (subject, bucket, rule) => {
  try {
    const { data, error } = await adminClient().rpc("check_rate_limit", {
      _subject: subject,
      _bucket: bucket,
      _limit: rule.limit,
      _window_seconds: rule.windowSeconds,
    });
    if (error) {
      console.error("check_rate_limit error:", error.message);
      return null;
    }
    const allowed = (data as { allowed?: unknown } | null)?.allowed;
    return typeof allowed === "boolean" ? allowed : null;
  } catch (e) {
    console.error("check_rate_limit exception:", (e as Error).message);
    return null;
  }
};

/**
 * Verifica límites por usuario y (opcionalmente) por IP.
 * Ejemplo: enforceRateLimit(req, "concierge-chat", userId, { perMinute: 10, perHour: 120, ipPerMinute: 30 })
 */
export function enforceRateLimit(
  req: Request,
  bucket: string,
  userId: string | null,
  opts: LimitOptions = {},
): Promise<RateLimitVerdict> {
  return evaluateRateLimit(hit, bucket, userId, clientIp(req), opts);
}

export function rateLimitResponse(
  verdict: RateLimitVerdict,
  corsHeaders: Record<string, string> = {},
) {
  const { status, body } = rateLimitBody(verdict);
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      "Retry-After": String(verdict.retryAfter),
    },
  });
}
