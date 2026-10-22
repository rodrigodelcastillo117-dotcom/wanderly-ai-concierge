// Costo estimado de cada llamada pagada, para public.ai_usage_log. Sin dependencias de Deno (se
// prueba con Vitest). Precios públicos de docs/iatos/IATOS_COSTOS_UNITARIOS.md (sección 1, consulta
// del 2026-10-22). Es una ESTIMACIÓN para decidir límites: la factura real manda.

/** SerpApi, plan Developer usado completo (USD 75 / 5,000). */
export const SERPAPI_USD_PER_SEARCH = 0.015;

export type UsageEntry = {
  user_id?: string | null;
  function: string;
  provider: string;
  model?: string | null;
  input_tokens?: number;
  output_tokens?: number;
  searches?: number;
  cost_estimate_usd?: number;
  /** Tokens de entrada leídos/escritos en la caché de prompt de Claude (precio distinto). */
  cache_read_tokens?: number;
  cache_write_tokens?: number;
};

type Price = { input: number; output: number; cacheRead?: number; cacheWrite?: number };

/** USD por millón de tokens según proveedor y modelo. */
export function tokenPrice(provider: string, model?: string | null): Price | null {
  const p = provider.toLowerCase();
  const m = String(model ?? "").toLowerCase();
  if (p === "anthropic") return { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 };
  if (p === "gemini" || p === "lovable") {
    if (m.includes("flash-lite")) return { input: 0.1, output: 0.4 };
    if (m.includes("pro")) return { input: 1.25, output: 10 };
    if (m.includes("2.5-flash")) return { input: 0.3, output: 2.5 };
    if (m.includes("3-flash")) return { input: 0.5, output: 3 };
    // gemini-flash-latest y desconocidos: el Flash vigente (3.8 Flash, precio 2026).
    return { input: 0.75, output: 3.75 };
  }
  if (p === "perplexity") return { input: 3, output: 15 };
  return null;
}

const nonNeg = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : 0);

export function estimateCostUsd(e: UsageEntry): number {
  let usd = nonNeg(e.searches) * (e.provider.toLowerCase() === "serpapi" ? SERPAPI_USD_PER_SEARCH : 0);
  const price = tokenPrice(e.provider, e.model);
  if (price) {
    usd += (nonNeg(e.input_tokens) * price.input + nonNeg(e.output_tokens) * price.output) / 1e6;
    usd += (nonNeg(e.cache_read_tokens) * (price.cacheRead ?? price.input)) / 1e6;
    usd += (nonNeg(e.cache_write_tokens) * (price.cacheWrite ?? price.input)) / 1e6;
  }
  return Math.round(usd * 1e6) / 1e6;
}

/** Fila lista para insertar (sin columnas que no existen en la tabla). */
export function usageRow(e: UsageEntry) {
  return {
    user_id: e.user_id ?? null,
    function: e.function.slice(0, 60),
    provider: e.provider.slice(0, 40),
    model: e.model ? String(e.model).slice(0, 80) : null,
    // Lo leído/escrito en caché se suma a la entrada (son tokens de entrada), con su propio precio
    // en el costo.
    input_tokens: nonNeg(e.input_tokens) + nonNeg(e.cache_read_tokens) + nonNeg(e.cache_write_tokens),
    output_tokens: nonNeg(e.output_tokens),
    searches: nonNeg(e.searches),
    cost_estimate_usd: typeof e.cost_estimate_usd === "number" && e.cost_estimate_usd >= 0 ? e.cost_estimate_usd : estimateCostUsd(e),
  };
}

/** Tokens de una respuesta estilo OpenAI (Gemini compatible / gateway). null si no trae `usage`. */
export function usageFromChat(json: unknown): { input_tokens: number; output_tokens: number } | null {
  const u = (json as { usage?: Record<string, unknown> } | null)?.usage;
  if (!u || typeof u !== "object") return null;
  const input = nonNeg(u.prompt_tokens);
  const completion = nonNeg(u.completion_tokens);
  const total = nonNeg(u.total_tokens);
  // Gemini cobra el razonamiento como salida y a veces no lo incluye en completion_tokens.
  const output = Math.max(completion, total > input ? total - input : 0);
  if (!input && !output) return null;
  return { input_tokens: input, output_tokens: output };
}

/** Tokens de una respuesta de Claude (Messages API). */
export function usageFromClaude(json: unknown): Pick<UsageEntry, "input_tokens" | "output_tokens" | "cache_read_tokens" | "cache_write_tokens" | "model"> | null {
  const j = json as { usage?: Record<string, unknown>; model?: unknown } | null;
  const u = j?.usage;
  if (!u || typeof u !== "object") return null;
  return {
    model: typeof j?.model === "string" ? j.model : null,
    input_tokens: nonNeg(u.input_tokens),
    output_tokens: nonNeg(u.output_tokens),
    cache_read_tokens: nonNeg(u.cache_read_input_tokens),
    cache_write_tokens: nonNeg(u.cache_creation_input_tokens),
  };
}
