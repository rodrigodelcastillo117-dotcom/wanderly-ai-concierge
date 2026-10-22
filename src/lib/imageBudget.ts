/**
 * Presupuesto de llamadas por minuto para las funciones de imágenes (pexels-image, place-photo).
 *
 * Por qué: el detalle de un viaje llegó a lanzar 42 llamadas a pexels-image en una carga (límite del
 * servidor: 30/min) y todas volvían 429. Aquí cada función tiene una fila: como mucho `perMinute`
 * llamadas por minuto y `concurrency` a la vez; tras un 429 se pausa (Retry-After o `cooldownMs`) y
 * lo pendiente se resuelve "sin imagen" (la tarjeta se queda con su respaldo, sin hueco).
 */
export type Budget = {
  /** Corre `fn` cuando haya turno. Si la fila está en pausa por un 429, devuelve `paused` sin llamar. */
  run<T>(fn: () => Promise<T>, paused: T): Promise<T>;
  /** Llamar al recibir un 429. */
  block(retryAfterSec?: number | null): void;
  isBlocked(): boolean;
  /** Llamadas iniciadas (para pruebas y diagnósticos). */
  started(): number;
  reset(): void;
};

export function createBudget({ perMinute, concurrency = 3, cooldownMs = 60_000, windowMs = 60_000 }: {
  perMinute: number; concurrency?: number; cooldownMs?: number; windowMs?: number;
}): Budget {
  let stamps: number[] = [];
  let active = 0;
  let blockedUntil = 0;
  let total = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const queue: Array<() => void> = [];

  const pump = () => {
    timer = null;
    const now = Date.now();
    stamps = stamps.filter((t) => now - t < windowMs);
    while (queue.length && active < concurrency && stamps.length < perMinute) {
      stamps.push(Date.now());
      active += 1;
      queue.shift()!();
    }
    if (queue.length && !timer && stamps.length >= perMinute) {
      timer = setTimeout(pump, Math.max(50, windowMs - (now - stamps[0])));
    }
  };

  return {
    async run<T>(fn: () => Promise<T>, paused: T): Promise<T> {
      if (Date.now() < blockedUntil) return paused;
      await new Promise<void>((resolve) => { queue.push(resolve); pump(); });
      try {
        if (Date.now() < blockedUntil) return paused;
        total += 1;
        return await fn();
      } finally {
        active -= 1;
        pump();
      }
    },
    block(retryAfterSec) {
      const ms = typeof retryAfterSec === "number" && Number.isFinite(retryAfterSec) && retryAfterSec > 0 ? retryAfterSec * 1000 : cooldownMs;
      blockedUntil = Date.now() + ms;
    },
    isBlocked: () => Date.now() < blockedUntil,
    started: () => total,
    reset() {
      stamps = []; active = 0; blockedUntil = 0; total = 0; queue.length = 0;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}

/** Estado HTTP de un error de supabase.functions.invoke (FunctionsHttpError lleva la respuesta en context). */
export function invokeStatus(error: unknown): number | null {
  const ctx = (error as { context?: { status?: unknown } } | null)?.context;
  return typeof ctx?.status === "number" ? ctx.status : null;
}

/** Retry-After (segundos) de un error de invoke, si viene. */
export function invokeRetryAfter(error: unknown): number | null {
  const h = (error as { context?: { headers?: { get?: (k: string) => string | null } } } | null)?.context?.headers;
  const v = Number(typeof h?.get === "function" ? h.get("Retry-After") : NaN);
  return Number.isFinite(v) && v > 0 ? v : null;
}
