// Freno de la cuenta de SerpApi (sin dependencias de Deno, se prueba con Vitest).
//
// Por qué: el plan actual tiene pocas búsquedas al mes (~216 al 22-oct-2026) y todas las funciones
// gastan de la misma bolsa. Sin freno, al acabarse cada petición seguía llamando a SerpApi (y
// fallando) y las pantallas quedaban sin precio sin decir por qué.
// - Presupuesto opcional (SERPAPI_MONTHLY_BUDGET / SERPAPI_DAILY_BUDGET): al llegar, se dejan de hacer
//   búsquedas en vivo para todos (también análisis) y se sirven precios guardados con su fecha.
//   Ojo: el mes es el calendario UTC; el ciclo de cobro de SerpApi puede empezar otro día.
// - Cuota agotada (SerpApi responde "run out of searches" o 429): pausa de 1 h guardada en la caché
//   compartida, para que ninguna función vuelva a intentar en esa hora.
import { type AccountBrake, type CacheStore, cacheKey, freshnessOf } from "./serpCache.ts";

export const QUOTA_PAUSE_SECONDS = 3600;

/**
 * Prioridad de una búsqueda frente al tope (caso Álvaro, 28-oct-2026: las búsquedas de hoteles y las de
 * la cuenta de auditoría se comieron el tope del día y los análisis siguientes quedaron sin vuelos).
 *  - "vuelos": búsqueda de vuelos (la del análisis de un viaje o la que pide la persona). Puede usar
 *    todo el tope.
 *  - "normal": todo lo demás (hoteles, mapas, cron, Iato web). Se detiene cuando solo queda la reserva.
 */
export type SerpPriority = "vuelos" | "normal";

/** Fracción del tope que se aparta para vuelos si no se configura SERPAPI_FLIGHTS_RESERVE. */
export const FLIGHTS_RESERVE_FRACTION = 0.2;

/**
 * Búsquedas del tope (día o mes) apartadas para vuelos: la configurada (si es válida y menor que el
 * tope) o el 20 % del tope, mínimo 2. Sin tope no hay reserva.
 */
export function flightsReserve(budget: number | null | undefined, configured?: number | null): number {
  const b = Number(budget) || 0;
  if (b <= 0) return 0;
  const c = Number(configured);
  if (Number.isFinite(c) && c >= 0 && c < b) return Math.floor(c);
  return Math.min(b - 1, Math.max(2, Math.round(b * FLIGHTS_RESERVE_FRACTION)));
}
/** Cuánto se reutiliza el conteo de uso del mes (para no consultar la base en cada búsqueda). */
const USED_MEMO_MS = 60_000;

export type BrakeDeps = {
  store: CacheStore | null;
  monthlyBudget?: number | null;
  dailyBudget?: number | null;
  /** Búsquedas de SerpApi registradas en el periodo (ai_usage_log). */
  used?: (period: "month" | "day") => Promise<number>;
  now?: () => number;
  log?: (...a: unknown[]) => void;
  /** Prioridad de quien busca (por defecto "normal"). */
  priority?: SerpPriority;
  /** Reserva para vuelos en el tope del DÍA (SERPAPI_FLIGHTS_RESERVE); sin ella, flightsReserve(). */
  dailyReserve?: number | null;
};

const quotaFlagKey = () => cacheKey("serpapi_quota", { flag: "agotada" });

export function makeAccountBrake(d: BrakeDeps): AccountBrake {
  const now = d.now ?? Date.now;
  const log = d.log ?? ((...a: unknown[]) => console.warn(...a));
  const memo: Record<string, { at: number; value: number }> = {};
  const usedIn = async (period: "month" | "day") => {
    const m = memo[period];
    if (m && now() - m.at < USED_MEMO_MS) return m.value;
    const value = await d.used!(period);
    memo[period] = { at: now(), value };
    return value;
  };
  return {
    paused: async () => {
      if (d.store) {
        try {
          const row = await d.store.get(await quotaFlagKey());
          if (row && freshnessOf(row, now()).fresh) return "quota";
        } catch (e) {
          log("serp brake: no se pudo leer la pausa", (e as Error)?.message);
        }
      }
      if (d.used && ((d.monthlyBudget ?? 0) > 0 || (d.dailyBudget ?? 0) > 0)) {
        try {
          // Falla abierta: si la base no responde se permite (el límite por usuario sigue activo).
          // Lo normal (hoteles, cron, mapas…) se detiene antes y deja la reserva para vuelos.
          const normal = (d.priority ?? "normal") === "normal";
          const monthCap = (d.monthlyBudget ?? 0) - (normal ? flightsReserve(d.monthlyBudget) : 0);
          const dayCap = (d.dailyBudget ?? 0) - (normal ? flightsReserve(d.dailyBudget, d.dailyReserve) : 0);
          if ((d.monthlyBudget ?? 0) > 0 && (await usedIn("month")) >= monthCap) return "budget";
          if ((d.dailyBudget ?? 0) > 0 && (await usedIn("day")) >= dayCap) return "budget";
        } catch (e) {
          log("serp brake: no se pudo contar el uso", (e as Error)?.message);
        }
      }
      return null;
    },
    tripQuota: async () => {
      if (!d.store) return;
      await d.store.put(await quotaFlagKey(), "serpapi_quota", { agotada: true, desde: new Date(now()).toISOString() }, QUOTA_PAUSE_SECONDS);
    },
  };
}
