// Llamadas al modelo del plan de varias ciudades con tope y un reintento. Sin Deno: se prueba con Vitest.

/** Tope de UNA llamada al modelo: las que contestan tardan 13–25 s; las que se cuelgan, hasta el límite de la función. */
export const AI_CALL_CAP_MS = 45_000;

/** Si la llamada no ha contestado en este tiempo, se lanza otra igual en paralelo y gana la primera que conteste. */
export const AI_HEDGE_MS = 28_000;

type Res<T> = { ok: boolean; v?: T; e?: unknown };
const settle = <T>(p: Promise<T>): Promise<Res<T>> => p.then((v): Res<T> => ({ ok: true, v }), (e): Res<T> => ({ ok: false, e }));

/** La primera que conteste bien; si las dos fallan, el error de la última. */
async function firstSuccess<T>(ps: Promise<T>[]): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    let left = ps.length;
    for (const p of ps) {
      settle(p).then((r) => {
        if (r.ok) resolve(r.v as T);
        else if (--left === 0) reject(r.e);
      });
    }
  });
}

/**
 * Llamada con reintento (recorrido 11-nov-2026, Praga → Viena → Budapest: 2 de 4 llamadas se colgaron hasta los 123 s y el
 * plan falló o salió con ciudades vacías). Cada intento tiene su tope; si falla y aún queda tiempo, se repite una vez.
 * Y si tarda más de lo normal (12-nov-2026: con el reintento a los 45 s el plan tardó 84 s), a los 28 s se lanza una segunda
 * llamada en paralelo SIN cancelar la primera: gana la que conteste antes (las normales tardan 13–25 s).
 */
export async function callAIRetry<T>(call: (timeoutMs: number) => Promise<T>, budget: () => number, onRetry?: (e: unknown) => void, hedgeMs = AI_HEDGE_MS): Promise<T> {
  const first = call(Math.min(AI_CALL_CAP_MS, budget()));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const slow = new Promise<"lenta">((r) => { timer = setTimeout(() => r("lenta"), hedgeMs); });
  const r1 = await Promise.race([settle(first), slow]);
  clearTimeout(timer);
  if (r1 !== "lenta") {
    if (r1.ok) return r1.v as T;
    if (budget() < 15_000) throw r1.e;
    onRetry?.(r1.e);
    return await call(Math.min(AI_CALL_CAP_MS, budget()));
  }
  if (budget() < 15_000) return await first;
  onRetry?.(new Error("lenta"));
  return await firstSuccess([first, call(Math.min(AI_CALL_CAP_MS, budget()))]);
}
