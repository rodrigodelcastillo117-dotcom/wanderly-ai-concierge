// Conexiones reales (service_role) de la caché compartida, la bolsa de búsquedas en vivo y el
// registro de uso. La lógica vive en serpCache.ts, liveSearch.ts, usage.ts e internalCall.ts
// (probadas con Vitest); aquí solo se conecta con la base.
import { adminClient } from "./entitlements.ts";
import { type AccountBrake, type CacheRow, type CacheStore, createSerpFetch, type LiveGate } from "./serpCache.ts";
import { makeAccountBrake } from "./serpBrake.ts";
import { makeLiveSearchGate } from "./liveSearch.ts";
import { type UsageEntry, usageRow } from "./usage.ts";
import { INTERNAL_HEADER, type InternalPurpose, signInternal, verifyInternal } from "./internalCall.ts";

const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SECRET_KEYS") ?? "";

/** public.serp_cache vía RPC (solo service_role). Si la tabla no existe aún, cada llamada falla y
 * createSerpFetch sigue sin caché. */
export function dbCacheStore(): CacheStore {
  const db = adminClient();
  return {
    get: async (keyHash) => {
      const { data, error } = await db.rpc("serp_cache_get", { _key_hash: keyHash });
      if (error) throw new Error(error.message);
      return (data as CacheRow | null) ?? null;
    },
    put: async (keyHash, engine, response, ttlSeconds) => {
      const { error } = await db.rpc("serp_cache_put", {
        _key_hash: keyHash, _engine: engine, _response: response, _ttl_seconds: ttlSeconds,
      });
      if (error) throw new Error(error.message);
    },
  };
}

/** Registra una llamada pagada en ai_usage_log. Nunca lanza ni detiene la respuesta al usuario. */
export async function logUsage(entry: UsageEntry): Promise<void> {
  try {
    const { error } = await adminClient().from("ai_usage_log").insert(usageRow(entry));
    if (error) console.warn("ai_usage_log insert:", error.message);
  } catch (e) {
    console.warn("ai_usage_log exception:", (e as Error)?.message);
  }
}

/**
 * Freno de toda la cuenta de SerpApi: presupuesto opcional del mes/día (SERPAPI_MONTHLY_BUDGET,
 * SERPAPI_DAILY_BUDGET; sin variable no hay tope) contado en ai_usage_log, y pausa de 1 h cuando
 * SerpApi dice que ya no hay búsquedas.
 */
export function accountBrake(store: CacheStore = dbCacheStore()): AccountBrake {
  return makeAccountBrake({
    store,
    monthlyBudget: Number(Deno.env.get("SERPAPI_MONTHLY_BUDGET") ?? "") || null,
    dailyBudget: Number(Deno.env.get("SERPAPI_DAILY_BUDGET") ?? "") || null,
    used: async (period) => {
      const { data, error } = await adminClient().rpc("serp_global_used", { _period: period });
      if (error) throw new Error(error.message);
      return Number(data) || 0;
    },
  });
}

export function liveSearchGateFor(userId: string): LiveGate {
  return makeLiveSearchGate((fn, args) => adminClient().rpc(fn, args), userId);
}

/**
 * fetch con caché compartida para una función. Cada búsqueda real que SerpApi cobra queda en
 * ai_usage_log (provider "serpapi", model = motor). `gate` = bolsa de búsquedas del usuario.
 */
export function serpFetchFor(fn: string, userId: string | null, gate?: LiveGate) {
  const store = dbCacheStore();
  return createSerpFetch({
    store,
    gate,
    brake: accountBrake(store),
    onLive: ({ engine, ok }) => (ok ? logUsage({ user_id: userId, function: fn, provider: "serpapi", model: engine, searches: 1 }) : undefined),
  });
}

/** Encabezados para que flights-search / hotels-search sepan que la llama un análisis. */
export async function internalHeaders(userId: string, purpose: InternalPurpose): Promise<Record<string, string>> {
  const v = await signInternal(SERVICE_KEY, userId, purpose);
  return v ? { [INTERNAL_HEADER]: v } : {};
}

/** ¿La petición viene firmada por un análisis de viaje de este mismo usuario? */
export async function isAnalysisCall(req: Request, userId: string): Promise<boolean> {
  return (await verifyInternal(req.headers.get(INTERNAL_HEADER), SERVICE_KEY, userId)) === "analysis";
}
