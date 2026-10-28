// Lógica pura del límite de frecuencia (sin Deno ni red) para probarla con Vitest.
// rate-limit.ts la conecta con la función SQL check_rate_limit (atómica, solo service_role).

export type RateRule = { limit: number; windowSeconds: number };

export type RateLimitVerdict = {
  allowed: boolean;
  retryAfter: number;
  scope?: "user" | "ip" | "unavailable";
};

/** Respuesta de un golpe: true = cabe, false = se pasó, null = no se pudo verificar (infraestructura). */
export type HitFn = (subject: string, bucket: string, rule: RateRule) => Promise<boolean | null>;

/**
 * Cubetas que llaman APIs de pago (SerpApi, IA, Google Maps/Places/Routes, generación de imagen)
 * o mandan correos. Si no se puede verificar el límite, se NIEGAN (fail-closed): una caída de la
 * base no debe convertirse en llamadas ilimitadas a proveedores que cobran por uso.
 * Las demás (Pexels, Travelpayouts, borrar cuenta, DB) siguen fallando abierto: negar ahí solo
 * molestaría al usuario sin proteger dinero (y borrar la cuenta es un derecho).
 */
export const PAID_BUCKETS: ReadonlySet<string> = new Set([
  // IA
  "ai-tool", "analizar-preferencias-ruta", "analizar-viaje", "auditar-perfil", "buscar-promociones",
  "card-benefits-lookup", "concierge-chat", "editar-viaje-ai", "evolucionar-dna", "generar-packing-list",
  "avatar-evolve", "generate-avatar", "logistics-plan", "nightlife-discover", "parse-trip-file", "parsear-viaje",
  "recomendar-destinos", "resolver-fechas", "scan-receipt", "suggest-packing", "suggest-restaurants", "tag-moment",
  "aprender-diario", "transcribir-nota", "interpretar-viaje",
  // SerpApi / TripAdvisor / vuelos en vivo
  "flight-status", "flights-search", "hotels-search", "price-watch", "serpapi-quote", "track-flight",
  "tripadvisor-search",
  // Google Maps Platform
  "geocode", "geocode-address", "get-routes", "mark-visited", "nearby-places", "place-details", "place-photo", "place-resolve",
  "places-nearby", "places-search", "experiencias-top",
  // Correos (Resend) y avisos a otras personas
  "concierge-action", "email-bienvenida", "enviar-email-fixer", "enviar-seleccion", "send-email", "share-trip-notify",
]);

export const isPaidBucket = (bucket: string) => PAID_BUCKETS.has(bucket);

const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const IPV6 = /^[0-9a-f:]{2,39}$/i;
const cleanIp = (v: string | null | undefined): string | null => {
  const ip = (v ?? "").trim().replace(/^\[|\]$/g, "");
  return ip && (IPV4.test(ip) || (ip.includes(":") && IPV6.test(ip))) ? ip : null;
};

/**
 * IP del cliente para el límite por IP, tomada SOLO de encabezados que pone la plataforma.
 *
 * Antes se usaba el PRIMER valor de X-Forwarded-For, que lo escribe el cliente: cada petición
 * podía traer una IP inventada distinta y el límite por IP no servía de nada.
 *
 * Las edge functions de Supabase se publican detrás de Cloudflare y del gateway de Supabase:
 *   1. cf-connecting-ip: Cloudflare lo SOBRESCRIBE con la IP que abrió la conexión; un valor que
 *      mande el cliente no sobrevive. Es la fuente preferida.
 *   2. x-real-ip: lo pone el proxy de la plataforma (no lo reenvía tal cual desde el cliente).
 *   3. El ÚLTIMO valor de X-Forwarded-For: cada proxy AGREGA al final la IP de quien le habló, así
 *      que el último lo escribió el salto más cercano (de la plataforma), no el cliente.
 * Si ninguno trae una IP válida → "unknown" y solo aplica el límite por usuario.
 * VERIFICAR EN VIVO (docs/ops/LEEME.md): mandar una petición con "X-Forwarded-For: 1.2.3.4" y
 * revisar en los logs que la IP registrada NO sea 1.2.3.4.
 */
export function clientIp(headers: { get(name: string): string | null }): string {
  const cf = cleanIp(headers.get("cf-connecting-ip"));
  if (cf) return cf;
  const real = cleanIp(headers.get("x-real-ip"));
  if (real) return real;
  const hops = (headers.get("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const last = cleanIp(hops[hops.length - 1]);
  return last ?? "unknown";
}

export type LimitOptions = {
  perMinute?: number; perHour?: number; ipPerMinute?: number;
  /**
   * true = las tres cubetas se consultan a la vez (1 viaje a la base en lugar de 3 en serie; lo usa
   * concierge-chat, donde cada ms cuenta antes del primer texto). El veredicto y su prioridad son los
   * mismos (usuario/minuto → usuario/hora → IP); la diferencia es que una petición negada por una
   * cubeta también suma en las otras (más estricto, nunca más permisivo).
   */
  parallel?: boolean;
};

/** Aplica los límites por usuario (minuto y hora) y por IP (minuto) en ese orden. */
export async function evaluateRateLimit(
  hit: HitFn,
  bucket: string,
  userId: string | null,
  ip: string,
  opts: LimitOptions = {},
): Promise<RateLimitVerdict> {
  const { perMinute = 10, perHour = 100, ipPerMinute = 40 } = opts;
  const failClosed = isPaidBucket(bucket);

  const check = async (subject: string, b: string, rule: RateRule, deny: RateLimitVerdict): Promise<RateLimitVerdict | null> => {
    const r = await hit(subject, b, rule);
    if (r === true) return null;
    if (r === false) return deny;
    // No se pudo verificar: las cubetas de pago se niegan; las baratas siguen.
    return failClosed ? { allowed: false, retryAfter: 30, scope: "unavailable" } : null;
  };

  if (opts.parallel) {
    const [m, h, i] = await Promise.all([
      userId ? check(`user:${userId}`, `${bucket}:m`, { limit: perMinute, windowSeconds: 60 }, { allowed: false, retryAfter: 60, scope: "user" }) : null,
      userId ? check(`user:${userId}`, `${bucket}:h`, { limit: perHour, windowSeconds: 3600 }, { allowed: false, retryAfter: 900, scope: "user" }) : null,
      ip !== "unknown" ? check(`ip:${ip}`, `${bucket}:m`, { limit: ipPerMinute, windowSeconds: 60 }, { allowed: false, retryAfter: 60, scope: "ip" }) : null,
    ]);
    return m ?? h ?? i ?? { allowed: true, retryAfter: 0 };
  }

  if (userId) {
    const m = await check(`user:${userId}`, `${bucket}:m`, { limit: perMinute, windowSeconds: 60 },
      { allowed: false, retryAfter: 60, scope: "user" });
    if (m) return m;
    const h = await check(`user:${userId}`, `${bucket}:h`, { limit: perHour, windowSeconds: 3600 },
      { allowed: false, retryAfter: 900, scope: "user" });
    if (h) return h;
  }

  if (ip !== "unknown") {
    const i = await check(`ip:${ip}`, `${bucket}:m`, { limit: ipPerMinute, windowSeconds: 60 },
      { allowed: false, retryAfter: 60, scope: "ip" });
    if (i) return i;
  }

  return { allowed: true, retryAfter: 0 };
}

/** Cuerpo y estado HTTP de la respuesta cuando se niega (429 límite, 503 sin verificación). */
export function rateLimitBody(verdict: RateLimitVerdict): { status: number; body: Record<string, unknown> } {
  if (verdict.scope === "unavailable") {
    return {
      status: 503,
      body: {
        code: "SERVICE_UNAVAILABLE",
        error: "rate_limit_unavailable",
        retry_after: verdict.retryAfter,
        message: "El servicio no está disponible en este momento. Intenta de nuevo en unos minutos.",
      },
    };
  }
  return {
    status: 429,
    body: {
      code: "RATE_LIMITED",
      error: "rate_limited",
      scope: verdict.scope ?? "user",
      retry_after: verdict.retryAfter,
      message: "Demasiadas solicitudes en poco tiempo. Espera un momento e inténtalo de nuevo.",
    },
  };
}
