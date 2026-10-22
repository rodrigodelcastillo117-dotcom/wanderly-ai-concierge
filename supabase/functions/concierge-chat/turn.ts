// Un turno completo de Iato (Concierge 2.0) sin Deno: herramientas previstas en paralelo → mensajes →
// modelo con streaming y herramientas → respuesta validada. index.ts lo llama con las dependencias
// reales; la evaluación local (src/test/concierge2Evals.test.ts) con modelo y herramientas simulados,
// así se prueba EXACTAMENTE el mismo código que corre en producción.

import type { AMessage } from "./anthropic.ts";
import { type AgentResult, type ModelCaller, runAgentTurn } from "./agent.ts";
import { prepareToolResultForModel, type ToolRun } from "./cards.ts";
import type { ChatMessage } from "./guard.ts";
import { type FinalTurn, finalizeTurn } from "./finalize.ts";
import type { ActionContext } from "./actions.ts";
import { toolOutcome, toolStatusText, type TurnPlan } from "./planner.ts";
import { type CircuitBreaker, type ConciergeModelConfig, providerChain, type Route } from "./router.ts";
import { compactHistory, prefetchBlock } from "./prompt.ts";
import type { ConciergeStreamEvent } from "./stream.ts";
import { TOOL_DEFS } from "./toolDefs.ts";
import { withTimeout } from "./tools.ts";

export interface TurnDeps {
  plan: TurnPlan;
  route: Route;
  config: ConciergeModelConfig;
  breaker: CircuitBreaker;
  callModel: ModelCaller;
  execTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  toolTimeout: (name: string, args: Record<string, unknown>) => number;
  send: (ev: ConciergeStreamEvent) => void;
  meta: Record<string, unknown>;
  stableSystem: string;
  dynamicSystem: string;
  contextMessage: ChatMessage | null;
  history: ChatMessage[];
  userMessage: string;
  actionCtx: ActionContext;
  requestIntel?: unknown;
  hasConfirmedBookings?: boolean;
  city?: string;
  party?: number;
  exigente: boolean;
  hasAnthropicKey: boolean;
  hasLovableKey: boolean;
  now?: () => number;
}

/**
 * Tope total del turno en el servidor (AUD-IATO-01). La función Edge muere a los 150 s (plan gratis;
 * también es el límite de inactividad de la petición): con 120 s queda margen para validar, registrar
 * el uso, confirmar la cuota y mandar el evento final o el de error.
 */
export const TURN_BUDGET_MS = 120_000;

export interface TurnOutput { final: FinalTurn; agent: AgentResult; prefetched: ToolRun[]; prefetchMs: number; totalMs: number }

/** Mensajes para el modelo: [CONTEXTO] [historial]; el último mensaje lleva los datos ya consultados. */
export function buildTurnMessages(contextMessage: ChatMessage | null, history: ChatMessage[], prefetched: ToolRun[]): AMessage[] {
  const h = compactHistory(history);
  const messages: AMessage[] = [];
  if (contextMessage) messages.push({ role: "user", content: contextMessage.content });
  h.forEach((m, idx) => {
    const isLast = idx === h.length - 1;
    if (isLast && m.role === "user" && prefetched.length) {
      messages.push({ role: "user", content: [{ type: "text", text: m.content }, { type: "text", text: prefetchBlock(prefetched) }] });
    } else {
      messages.push({ role: m.role, content: m.content } as AMessage);
    }
  });
  if (messages[0]?.role !== "user") messages.unshift({ role: "user", content: "(inicio de la conversación)" });
  return messages;
}

export async function runConciergeTurn(d: TurnDeps): Promise<TurnOutput> {
  const now = d.now ?? Date.now;
  const t0 = now();
  d.send({ type: "meta", data: d.meta });

  // 1) Herramientas previstas, en paralelo, con su paso en vivo y su tope de tiempo.
  const prefetched: ToolRun[] = await Promise.all(d.plan.prefetch.map(async (spec, idx): Promise<ToolRun> => {
    const id = `pre_${idx}`;
    d.send({ type: "status", data: { id, text: toolStatusText(spec.name, spec.args), state: "running" } });
    let raw: unknown;
    try { raw = await withTimeout(d.execTool(spec.name, spec.args), d.toolTimeout(spec.name, spec.args)); } catch (e) { raw = { error: (e as Error)?.message ?? "tool error" }; }
    const result = prepareToolResultForModel(spec.name, raw);
    const o = toolOutcome(result);
    d.send({ type: "status", data: { id, text: `${toolStatusText(spec.name, spec.args).replace(/…$/, "")} · ${o.suffix}`, state: o.state } });
    return { name: spec.name, args: spec.args, result };
  }));
  const prefetchMs = now() - t0;

  // 2) Modelo (streaming) con herramientas.
  const chain = providerChain(d.route, d.config, d.breaker, { hasAnthropicKey: d.hasAnthropicKey, hasLovableKey: d.hasLovableKey });
  const agent = await runAgentTurn({
    chain, breaker: d.breaker, cooldownMs: d.config.breaker_cooldown_s * 1000, callModel: d.callModel,
    stableSystem: d.stableSystem, dynamicSystem: d.dynamicSystem, messages: buildTurnMessages(d.contextMessage, d.history, prefetched),
    tools: TOOL_DEFS, maxIterations: d.route.maxIterations, maxTokens: d.route.maxTokens, userMessage: d.userMessage,
    execTool: d.execTool, prepare: prepareToolResultForModel, toolTimeoutMs: d.toolTimeout, prefetched,
    deadlineMs: d.exigente ? 50_000 : 30_000, hardBudgetMs: Math.max(0, TURN_BUDGET_MS - prefetchMs), now: d.now,
    emit: {
      status: (id, text, state) => d.send({ type: "status", data: { id, text, state } }),
      delta: (text) => d.send({ type: "delta", data: { text } }),
      reset: () => d.send({ type: "reset", data: {} }),
    },
  });

  // 3) Respuesta validada.
  const final = finalizeTurn({
    raw: agent.finalText, toolRuns: agent.toolRuns, plan: d.plan, actionCtx: d.actionCtx,
    requestIntel: d.requestIntel, hasConfirmedBookings: d.hasConfirmedBookings, city: d.city, party: d.party,
  });
  return { final, agent, prefetched, prefetchMs, totalMs: now() - t0 };
}
