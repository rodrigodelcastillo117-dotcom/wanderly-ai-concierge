// Turno de Iato con streaming y herramientas (Concierge 2.0). Sin Deno: el fetch, el reloj y las
// herramientas llegan por parámetro, así que el turno completo se prueba con modelo y herramientas
// simulados (src/test/concierge2*.test.ts) y se mide la latencia con mocks.
//
// Flujo:
//   1. Herramientas previstas por el planeador ya corrieron en paralelo (prefetch) y van como datos.
//   2. Llamada al modelo en streaming: el texto se manda a la app mientras se escribe (sin el bloque
//      de datos). Si el proveedor falla (429/5xx/timeout/red) se registra en el circuit breaker y se
//      pasa al siguiente sin esperar más.
//   3. Si el modelo pide herramientas: se validan las entradas, se aplica la política (TripAdvisor no
//      responde datos prácticos), corren en paralelo con su tope de tiempo y siguen con lo que llegó.
//   4. La última vuelta no permite herramientas: siempre hay respuesta con lo obtenido.

import {
  assistantContentForEcho, type AMessage, type ContentBlock, type Effort, type ParsedToolUse, ProviderError,
  streamAnthropic, type ToolResultBlock, type Usage,
} from "./anthropic.ts";
import { AnswerStreamFilter } from "./stream.ts";
import { type CircuitBreaker, type ProviderStep } from "./router.ts";
import { toAnthropicTools, toOpenAiTools, type ToolDef, validateToolInput } from "./toolDefs.ts";
import { applyToolPolicy, toolOutcome, toolStatusText } from "./planner.ts";
import type { ToolRun } from "./cards.ts";
import { withTimeout } from "./tools.ts";
import { lovableModelName } from "../_shared/ai.ts";

export interface ModelCallInput {
  stableSystem: string;
  dynamicSystem: string;
  messages: AMessage[];
  tools: ToolDef[];
  toolChoice: "auto" | "none";
  maxTokens: number;
  /** Tiempo que le queda al turno (ms): la llamada no puede durar más (AUD-IATO-01). */
  budgetMs?: number;
}

export interface ModelCallResult {
  provider: "anthropic" | "lovable";
  model: string;
  content: ContentBlock[];
  text: string;
  toolUses: ParsedToolUse[];
  stopReason: string;
  usage: Usage;
  firstTextMs?: number | null;
}

export type ModelCaller = (step: ProviderStep, input: ModelCallInput, h: { onText: (d: string) => void }) => Promise<ModelCallResult>;

export interface AgentEmitter {
  status: (id: string, text: string, state: "running" | "done" | "empty" | "error") => void;
  delta: (text: string) => void;
  reset: () => void;
}

export interface AgentInput {
  chain: ProviderStep[];
  callModel: ModelCaller;
  breaker: CircuitBreaker;
  cooldownMs: number;
  stableSystem: string;
  dynamicSystem: string;
  messages: AMessage[];
  tools: ToolDef[];
  maxIterations: number;
  maxTokens: number;
  userMessage: string;
  execTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  prepare: (name: string, raw: unknown) => Record<string, unknown>;
  toolTimeoutMs: (name: string, args: Record<string, unknown>) => number;
  emit: AgentEmitter;
  /** Resultados ya consultados (prefetch): se reutilizan si el modelo pide lo mismo. */
  prefetched?: ToolRun[];
  /** Tope del turno completo; al pasarlo, la siguiente vuelta ya no permite herramientas. */
  deadlineMs?: number;
  /**
   * Tope DURO del turno (ms) contando respaldos y vueltas (AUD-IATO-01). Cada llamada recibe solo lo
   * que queda; sin tiempo para una llamada útil se corta con AllProvidersFailed y la app recibe el
   * evento de error antes de que la plataforma mate la función (el stream quedaba cortado sin final).
   */
  hardBudgetMs?: number;
  now?: () => number;
}

export interface UsageRecord extends Usage { provider: string; model: string }

export interface AgentResult {
  finalText: string;
  toolsUsed: string[];
  toolRuns: ToolRun[];
  usage: UsageRecord[];
  provider: string | null;
  model: string | null;
  /** Texto que la app ya vio en vivo (sin el bloque de datos). */
  streamed: string;
  rerouted: string[];
  failures: { key: string; kind: string; status: number }[];
  firstTextMs: number | null;
}

export class AllProvidersFailed extends Error {
  /** usage: lo que sí cobraron los proveedores en este turno (AUD-IATO-02: se registra igual). */
  constructor(public last: ProviderError | null, public usage: UsageRecord[] = []) { super("all_providers_failed"); }
}

/** Menos de esto no alcanza para una respuesta útil: se corta el turno (AUD-IATO-01). */
export const MIN_MODEL_CALL_MS = 5_000;

/** JSON con llaves ordenadas en todos los niveles (para reconocer la misma consulta). */
export function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v as Record<string, unknown>).sort().map((k) => `${JSON.stringify(k)}:${stableStringify((v as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

const keyOf = (name: string, args: Record<string, unknown>) => `${name}:${stableStringify(args)}`;

export async function runAgentTurn(a: AgentInput): Promise<AgentResult> {
  const now = a.now ?? Date.now;
  const t0 = now();
  const res: AgentResult = {
    finalText: "", toolsUsed: [], toolRuns: [...(a.prefetched ?? [])], usage: [], provider: null, model: null,
    streamed: "", rerouted: [], failures: [], firstTextMs: null,
  };
  const cache = new Map<string, Record<string, unknown>>();
  for (const r of a.prefetched ?? []) cache.set(keyOf(r.name, r.args ?? {}), r.result);
  const messages = [...a.messages];
  let stepIdx = 0;
  let lastErr: ProviderError | null = null;

  for (let i = 0; i < a.maxIterations; i++) {
    const overDeadline = a.deadlineMs !== undefined && now() - t0 > a.deadlineMs;
    const last = i === a.maxIterations - 1 || overDeadline;
    let result: ModelCallResult | null = null;
    let filter = new AnswerStreamFilter();
    let shown = "";

    while (stepIdx < a.chain.length) {
      const step = a.chain[stepIdx];
      filter = new AnswerStreamFilter();
      shown = "";
      const budgetMs = a.hardBudgetMs !== undefined ? a.hardBudgetMs - (now() - t0) : undefined;
      if (budgetMs !== undefined && budgetMs < MIN_MODEL_CALL_MS) {
        throw new AllProvidersFailed(lastErr ?? new ProviderError("timeout", 0, "turn_budget"), res.usage);
      }
      try {
        result = await a.callModel(step, {
          stableSystem: a.stableSystem, dynamicSystem: a.dynamicSystem, messages, tools: a.tools,
          toolChoice: last ? "none" : "auto", maxTokens: a.maxTokens, ...(budgetMs !== undefined ? { budgetMs } : {}),
        }, {
          onText: (d) => {
            const v = filter.push(d);
            if (v) {
              if (res.firstTextMs === null) res.firstTextMs = now() - t0;
              shown += v;
              a.emit.delta(v);
            }
          },
        });
        if (result.stopReason === "refusal" && !result.text.trim()) throw new ProviderError("refusal", 200, "refusal");
        a.breaker.recordSuccess(step.key);
        break;
      } catch (e) {
        const err = e instanceof ProviderError ? e : new ProviderError("network", 0, (e as Error)?.message ?? "error");
        lastErr = err;
        res.failures.push({ key: step.key, kind: err.kind, status: err.status });
        a.breaker.recordFailure(step.key, err.kind, a.cooldownMs);
        if (shown) a.emit.reset();
        result = null;
        stepIdx++;
      }
    }
    if (!result) throw new AllProvidersFailed(lastErr, res.usage);
    res.provider = result.provider;
    res.model = result.model;
    res.usage.push({ provider: result.provider, model: result.model, ...result.usage });

    const wantsTools = result.toolUses.length > 0 && result.stopReason === "tool_use" && !last;
    if (!wantsTools) {
      const tail = filter.flush();
      if (tail) { shown += tail; a.emit.delta(tail); }
      res.finalText = result.text;
      res.streamed = shown;
      break;
    }

    // Texto antes de las herramientas: era un preámbulo, no la respuesta.
    if (shown) a.emit.reset();
    messages.push({ role: "assistant", content: assistantContentForEcho(result.content) });
    const results: ToolResultBlock[] = await Promise.all(result.toolUses.map(async (tu): Promise<ToolResultBlock> => {
      if (tu.inputError) {
        return { type: "tool_result", tool_use_id: tu.id, is_error: true, content: JSON.stringify({ INVALID_JSON: tu.inputError }) };
      }
      const v = validateToolInput(tu.name, tu.input);
      if (!v.ok) {
        return { type: "tool_result", tool_use_id: tu.id, is_error: true, content: JSON.stringify({ error: `entrada inválida: ${(v as { error: string }).error}` }) };
      }
      const policy = applyToolPolicy(tu.name, v.input, a.userMessage);
      if (policy.rerouted) res.rerouted.push(policy.rerouted);
      const k = keyOf(policy.name, policy.args);
      let prepared = cache.get(k);
      if (!prepared) {
        a.emit.status(tu.id, toolStatusText(policy.name, policy.args), "running");
        let raw: unknown;
        try {
          raw = await withTimeout(a.execTool(policy.name, policy.args), a.toolTimeoutMs(policy.name, policy.args));
        } catch (e) {
          raw = { error: (e as Error)?.message ?? "tool error" };
        }
        prepared = a.prepare(policy.name, raw);
        cache.set(k, prepared);
        const o = toolOutcome(prepared);
        a.emit.status(tu.id, `${toolStatusText(policy.name, policy.args).replace(/…$/, "")} · ${o.suffix}`, o.state);
      }
      res.toolsUsed.push(policy.name);
      res.toolRuns.push({ name: policy.name, args: policy.args, result: prepared });
      const note = policy.rerouted ? { nota: "Se usó web_search: TripAdvisor no tiene datos prácticos (ubicaciones, horarios, salas)." } : {};
      return { type: "tool_result", tool_use_id: tu.id, content: JSON.stringify({ ...prepared, ...note }) };
    }));
    messages.push({ role: "user", content: results });
  }
  return res;
}

// ═══ Proveedores ═══

export interface CallerDeps {
  fetchImpl: typeof fetch;
  anthropicKey?: string;
  lovableKey?: string;
  lovableUrl?: string;
  /** Tiempos por nivel (ms). */
  timeouts?: { firstByteMs: number; idleMs: number; totalMs: number };
  serverFallback?: boolean;
}

const LOVABLE_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

/** Mensajes de Claude → formato OpenAI (respaldo). Los bloques de pensamiento no se mandan. */
export function toOpenAiMessages(stableSystem: string, dynamicSystem: string, messages: AMessage[]) {
  const out: Record<string, unknown>[] = [{ role: "system", content: `${dynamicSystem}\n\n---\n\n${stableSystem}` }];
  for (const m of messages) {
    if (m.role === "user") {
      if (typeof m.content === "string") { out.push({ role: "user", content: m.content }); continue; }
      const text = m.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("\n\n");
      for (const b of m.content) if (b.type === "tool_result") out.push({ role: "tool", tool_call_id: b.tool_use_id, content: b.content });
      if (text) out.push({ role: "user", content: text });
      continue;
    }
    if (typeof m.content === "string") { out.push({ role: "assistant", content: m.content }); continue; }
    const text = m.content.filter((b) => b.type === "text").map((b) => String((b as { text?: unknown }).text ?? "")).join("");
    const calls = m.content.filter((b) => b.type === "tool_use").map((b) => {
      const t = b as { id: string; name: string; input: unknown };
      return { id: t.id, type: "function", function: { name: t.name, arguments: JSON.stringify(t.input ?? {}) } };
    });
    out.push({ role: "assistant", content: text || null, ...(calls.length ? { tool_calls: calls } : {}) });
  }
  return out;
}

const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);

export function makeModelCaller(d: CallerDeps): ModelCaller {
  const base = d.timeouts ?? { firstByteMs: 10_000, idleMs: 15_000, totalMs: 45_000 };
  return async (step, input, h) => {
    // Nunca más que lo que le queda al turno (AUD-IATO-01).
    const cap = typeof input.budgetMs === "number" && input.budgetMs > 0 ? input.budgetMs : Infinity;
    const t = { firstByteMs: Math.min(base.firstByteMs, cap), idleMs: Math.min(base.idleMs, cap), totalMs: Math.min(base.totalMs, cap) };
    if (step.provider === "anthropic") {
      if (!d.anthropicKey) throw new ProviderError("auth", 401, "sin llave");
      const r = await streamAnthropic({
        model: step.model, effort: step.effort as Effort, stableSystem: input.stableSystem, dynamicSystem: input.dynamicSystem,
        tools: toAnthropicTools(input.tools), messages: input.messages, toolChoice: input.toolChoice, maxTokens: input.maxTokens,
        serverFallback: d.serverFallback ?? true,
      }, { fetchImpl: d.fetchImpl, apiKey: d.anthropicKey, firstByteTimeoutMs: t.firstByteMs, idleTimeoutMs: t.idleMs, totalTimeoutMs: t.totalMs }, { onText: h.onText });
      return {
        provider: "anthropic", model: r.model ?? step.model, content: r.content, text: r.text, toolUses: r.toolUses,
        stopReason: r.stopReason ?? "end_turn", usage: r.usage, firstTextMs: r.latency.firstTextMs,
      };
    }
    // Gateway de Lovable (formato OpenAI, sin streaming): solo como respaldo.
    if (!d.lovableKey) throw new ProviderError("auth", 401, "sin llave");
    let res: Response;
    try {
      res = await d.fetchImpl(d.lovableUrl ?? LOVABLE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${d.lovableKey}` },
        body: JSON.stringify({
          // Mismo nombre que usa el resto de IATOS con el gateway (alias → nombre publicado).
          model: lovableModelName(step.model), messages: toOpenAiMessages(input.stableSystem, input.dynamicSystem, input.messages),
          tools: toOpenAiTools(input.tools), tool_choice: input.toolChoice,
        }),
        signal: AbortSignal.timeout(t.totalMs),
      });
    } catch (e) {
      throw new ProviderError((e as Error)?.name === "TimeoutError" ? "timeout" : "network", 0, (e as Error)?.message ?? "");
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      const kind = res.status === 402 ? "auth" : res.status === 429 || res.status === 503 ? "overloaded" : res.status >= 500 ? "server" : "bad_request";
      throw new ProviderError(kind, res.status, detail.slice(0, 300));
    }
    const j = await res.json().catch(() => null) as any;
    const msg = j?.choices?.[0]?.message ?? {};
    const text = typeof msg.content === "string" ? msg.content : "";
    const toolUses: ParsedToolUse[] = (Array.isArray(msg.tool_calls) ? msg.tool_calls : []).map((tc: any, i: number) => {
      let input: unknown = {};
      let inputError: string | undefined;
      try { input = typeof tc?.function?.arguments === "string" ? JSON.parse(tc.function.arguments || "{}") : tc?.function?.arguments ?? {}; } catch { inputError = "JSON inválido"; }
      return { id: String(tc?.id ?? `call_${i}`), name: String(tc?.function?.name ?? ""), input, ...(inputError ? { inputError } : {}) };
    });
    if (text) h.onText(text);
    const content: ContentBlock[] = [
      ...(text ? [{ type: "text", text } as ContentBlock] : []),
      ...toolUses.map((tu) => ({ type: "tool_use", id: tu.id, name: tu.name, input: tu.input } as ContentBlock)),
    ];
    const u = j?.usage ?? {};
    const input_tokens = n(u.prompt_tokens);
    const output_tokens = Math.max(n(u.completion_tokens), n(u.total_tokens) - input_tokens);
    return {
      provider: "lovable", model: typeof j?.model === "string" ? j.model : step.model, content, text, toolUses,
      stopReason: toolUses.length ? "tool_use" : "end_turn",
      usage: { input_tokens, output_tokens, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    };
  };
}
