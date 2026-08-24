// Rate limiting anti-abuso. Complementa (no reemplaza) las cuotas gratuitas de usage_limits:
// usage_limits controla el modelo de negocio (free vs PRO); esto controla el volumen por minuto/hora
// incluso para usuarios PRO, y por IP para frenar abuso desde una misma red.
import { adminClient } from "./entitlements.ts";

export type RateRule = { limit: number; windowSeconds: number };

export type RateLimitVerdict = {
  allowed: boolean;
  retryAfter: number;
  scope?: "user" | "ip";
};

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for") ?? "";
  const ip = fwd.split(",")[0]?.trim();
  return ip || req.headers.get("cf-connecting-ip") || "unknown";
}

async function hit(subject: string, bucket: string, rule: RateRule): Promise<boolean> {
  try {
    const { data, error } = await adminClient().rpc("check_rate_limit", {
      _subject: subject,
      _bucket: bucket,
      _limit: rule.limit,
      _window_seconds: rule.windowSeconds,
    });
    if (error) {
      console.error("check_rate_limit error:", error.message);
      return true; // fail-open ante fallo de infraestructura
    }
    return Boolean((data as { allowed?: boolean } | null)?.allowed ?? true);
  } catch (e) {
    console.error("check_rate_limit exception:", (e as Error).message);
    return true;
  }
}

/**
 * Verifica límites por usuario y (opcionalmente) por IP.
 * Ejemplo: enforceRateLimit(req, "concierge-chat", userId, { perMinute: 10, perHour: 120, ipPerMinute: 30 })
 */
export async function enforceRateLimit(
  req: Request,
  bucket: string,
  userId: string | null,
  opts: { perMinute?: number; perHour?: number; ipPerMinute?: number } = {},
): Promise<RateLimitVerdict> {
  const { perMinute = 10, perHour = 100, ipPerMinute = 40 } = opts;

  if (userId) {
    if (!(await hit(`user:${userId}`, `${bucket}:m`, { limit: perMinute, windowSeconds: 60 }))) {
      return { allowed: false, retryAfter: 60, scope: "user" };
    }
    if (!(await hit(`user:${userId}`, `${bucket}:h`, { limit: perHour, windowSeconds: 3600 }))) {
      return { allowed: false, retryAfter: 900, scope: "user" };
    }
  }

  const ip = clientIp(req);
  if (ip !== "unknown") {
    if (!(await hit(`ip:${ip}`, `${bucket}:m`, { limit: ipPerMinute, windowSeconds: 60 }))) {
      return { allowed: false, retryAfter: 60, scope: "ip" };
    }
  }

  return { allowed: true, retryAfter: 0 };
}

export function rateLimitResponse(
  verdict: RateLimitVerdict,
  corsHeaders: Record<string, string> = {},
) {
  return new Response(
    JSON.stringify({
      error: "rate_limited",
      scope: verdict.scope ?? "user",
      retry_after: verdict.retryAfter,
      message: "Demasiadas solicitudes en poco tiempo. Espera un momento e inténtalo de nuevo.",
    }),
    {
      status: 429,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        "Retry-After": String(verdict.retryAfter),
      },
    },
  );
}
