// Tareas con parámetros fijos del lado del servidor para ai-tool (R3 viajes P1-4: Comparar daba 504 a los
// 40 s en 2 de 4 intentos con "gemini-flash-latest", que razona antes de responder y sin tope de tokens).
// Una tabla de 4 destinos no necesita razonamiento: modelo ligero sin razonamiento, respuesta corta, tope
// de 20 s (el cliente corta a los 30) y la misma combinación de destinos se sirve de la caché.
// Puro (sin Deno): se prueba con Vitest.

export type AiTask = {
  model: string;
  /** Tope de tokens de la respuesta. */
  maxTokens: number;
  /** Tope de espera del lado del servidor (504 code "timeout" al vencer). */
  timeoutMs: number;
  /** "none" = sin razonamiento previo (Gemini, endpoint compatible con OpenAI). */
  reasoningEffort?: "none" | "low";
  /** Cuánto se guarda la respuesta para el mismo pedido (0 = sin caché). */
  cacheTtlMs: number;
};

/** Tope genérico (traductor, bóveda…): el de siempre. */
export const AI_TOOL_TIMEOUT_MS = 40_000;
export const DEFAULT_MODEL = "google/gemini-flash-latest";

export const AI_TASKS: Record<string, AiTask> = {
  compare: { model: "google/gemini-flash-lite-latest", maxTokens: 1200, timeoutMs: 20_000, reasoningEffort: "none", cacheTtlMs: 12 * 3600_000 },
};

export type AiToolRequest = { prompt: string; system?: string; model?: string; json?: boolean; task?: string };

/** Parámetros de la llamada: los de la tarea si la hay (el cliente no puede subirlos), si no los genéricos. */
export function planAiCall(req: AiToolRequest): { model: string; maxTokens: number | null; timeoutMs: number; reasoningEffort: AiTask["reasoningEffort"] | null; cacheKey: string | null; cacheTtlMs: number } {
  const task = req.task ? AI_TASKS[req.task] : undefined;
  if (!task) return { model: req.model || DEFAULT_MODEL, maxTokens: null, timeoutMs: AI_TOOL_TIMEOUT_MS, reasoningEffort: null, cacheKey: null, cacheTtlMs: 0 };
  const norm = (s: unknown) => String(s ?? "").normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();
  return {
    model: task.model, maxTokens: task.maxTokens, timeoutMs: task.timeoutMs, reasoningEffort: task.reasoningEffort ?? null,
    cacheKey: task.cacheTtlMs > 0 ? `${req.task}|${req.json ? "j" : "t"}|${norm(req.system)}|${norm(req.prompt)}` : null,
    cacheTtlMs: task.cacheTtlMs,
  };
}

/** Caché en memoria de la instancia (se pierde al reiniciar; basta para repetir la misma comparación). */
export class TtlCache<T> {
  private m = new Map<string, { v: T; exp: number }>();
  constructor(private max = 200) {}
  get(k: string, now = Date.now()): T | undefined {
    const e = this.m.get(k);
    if (!e) return undefined;
    if (e.exp <= now) { this.m.delete(k); return undefined; }
    return e.v;
  }
  set(k: string, v: T, ttlMs: number, now = Date.now()) {
    if (this.m.size >= this.max) this.m.delete(this.m.keys().next().value as string);
    this.m.set(k, { v, exp: now + ttlMs });
  }
}

/** Prompt corto de Comparar: valores breves (menos tokens, respuesta más rápida). */
export function comparePrompt(list: string[]): string {
  return `Compara para un viajero mexicano: ${list.join(" vs ")}. Responde un array JSON, un objeto por destino en ese orden, con valores breves (máx. 12 palabras): [{"destino":"","costo_diario_usd":"$X-Y","mejor_epoca":"","visa_mx":"Sí/No + nota","seguridad":"Alta/Media/Baja + nota","idioma":"","highlights":"3 imperdibles"}]`;
}
