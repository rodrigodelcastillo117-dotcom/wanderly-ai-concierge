// Llamadas al modelo del plan de varias ciudades con tope y un reintento. Sin Deno: se prueba con Vitest.

/** Tope de UNA llamada al modelo: las que contestan tardan 13–25 s; las que se cuelgan, hasta el límite de la función. */
export const AI_CALL_CAP_MS = 45_000;

/**
 * Llamada con reintento (recorrido 11-nov-2026, Praga → Viena → Budapest: 2 de 4 llamadas se colgaron hasta los 123 s y el
 * plan falló o salió con ciudades vacías). Cada intento tiene su tope; si falla y aún queda tiempo, se repite una vez.
 */
export async function callAIRetry<T>(call: (timeoutMs: number) => Promise<T>, budget: () => number, onRetry?: (e: unknown) => void): Promise<T> {
  try {
    return await call(Math.min(AI_CALL_CAP_MS, budget()));
  } catch (e) {
    if (budget() < 15_000) throw e;
    onRetry?.(e);
    return await call(Math.min(AI_CALL_CAP_MS, budget()));
  }
}
