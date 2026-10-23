// Conexiones reales de Ticketmaster (solo Edge Functions): la llave TICKETMASTER_API_KEY (Deno.env),
// la caché compartida (public.serp_cache), el límite global de la cuenta (≤ 5 por segundo y tope
// diario, con check_rate_limit para que valga entre instancias) y el límite por usuario. La lógica vive
// en ticketmaster.ts (probada con Vitest). La llave nunca se registra ni se devuelve.
import { adminClient } from "./entitlements.ts";
import { dbCacheStore, logUsage } from "./serpRuntime.ts";
import { makeRateLimiter, searchTicketmaster, type TmQuery, type TmResult, TM_PER_DAY, TM_PER_SECOND } from "./ticketmaster.ts";

export const ticketmasterKey = () => Deno.env.get("TICKETMASTER_API_KEY") ?? "";

/** Por usuario: 10 búsquedas en vivo por minuto y 60 por hora (los aciertos de caché no cuentan). */
export const TM_USER_PER_MINUTE = 10;
export const TM_USER_PER_HOUR = 60;

const local = makeRateLimiter({ perSecond: TM_PER_SECOND });

async function hit(subject: string, bucket: string, limit: number, windowSeconds: number): Promise<boolean | null> {
  try {
    const { data, error } = await adminClient().rpc("check_rate_limit", { _subject: subject, _bucket: bucket, _limit: limit, _window_seconds: windowSeconds });
    if (error) return null;
    const allowed = (data as { allowed?: unknown } | null)?.allowed;
    return typeof allowed === "boolean" ? allowed : null;
  } catch {
    return null;
  }
}

/** Ranura de la cuenta: primero en memoria (5/s por instancia), luego global (5/s y tope del día con margen). */
async function accountSlot(): Promise<boolean> {
  if (!(await local())) return false;
  if ((await hit("global:ticketmaster", "ticketmaster:dia", Math.floor(TM_PER_DAY * 0.95), 86400)) === false) return false;
  for (let i = 0; i < 2; i++) {
    const ok = await hit("global:ticketmaster", "ticketmaster:s", TM_PER_SECOND - 1, 1);
    if (ok !== false) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

export function ticketmasterFor(fn: string, userId: string | null, opts: { timeoutMs?: number; background?: (p: Promise<unknown>) => void } = {}) {
  const store = dbCacheStore();
  return (q: TmQuery): Promise<TmResult> => searchTicketmaster(q, {
    fetchImpl: fetch, apiKey: ticketmasterKey(), store, limiter: accountSlot,
    userGate: userId ? async () => {
      const m = await hit(`user:${userId}`, "ticketmaster:m", TM_USER_PER_MINUTE, 60);
      if (m === false) return false;
      return hit(`user:${userId}`, "ticketmaster:h", TM_USER_PER_HOUR, 3600);
    } : undefined,
    timeoutMs: opts.timeoutMs, background: opts.background,
    // Gratis (sin costo por llamada), pero queda en ai_usage_log para vigilar el tope de 5000 al día.
    onLive: (ok) => (ok ? logUsage({ user_id: userId, function: fn, provider: "ticketmaster", model: "discovery_v2", searches: 1, cost_estimate_usd: 0 }) : undefined),
  });
}
