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
import type { TripPosition, UserLocation } from "./location.ts";
import { joinLead, leadSentence, leadSeparator, toolOutcome, toolStatusText, type TurnPlan } from "./planner.ts";
import { type CircuitBreaker, type ConciergeModelConfig, providerChain, type Route } from "./router.ts";
import { compactHistory, prefetchBlock } from "./prompt.ts";
import { type ConciergeStreamEvent, THINK_STEP_ID } from "./stream.ts";
import { TOOL_DEFS } from "./toolDefs.ts";
import { withTimeout } from "./tools.ts";
import { LiveAdviceFilter } from "./brevity.ts";
import { type HonestyCtx, LiveHonestyFilter } from "./honesty.ts";

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
  openRequests?: { title: string; label: string }[];
  knownRequests?: { title: string }[];
  city?: string;
  party?: number;
  exigente: boolean;
  /** Viaje en contexto y ubicación del usuario: regla de "Agregar a tu viaje" (location.ts). */
  tripScope?: { trip: any | null; position: TripPosition; user?: UserLocation | null } | null;
  hasAnthropicKey: boolean;
  hasLovableKey: boolean;
  now?: () => number;
  /**
   * Si las herramientas previstas siguen corriendo después de este tiempo, se muestra la frase de
   * inicio honesta (planner.leadSentence) como primer texto. Sin valor: no hay frase (como antes).
   */
  leadAfterMs?: number;
  /**
   * El texto del modelo llega en vivo a la pantalla (SSE). Por omisión sí; false = respuesta JSON
   * (nadie vio nada antes del final, así que el recorte de brevity.ts todavía puede aplicarse).
   */
  streaming?: boolean;
  /**
   * Guardarraíles de honestidad EN VIVO (honesty.ts): viajes que sí existen, tarjetas prometidas que no
   * existen, "enviada" sin envío y adaptador en viaje nacional. Se aplican oración por oración antes de
   * mostrarse, así lo visto es lo que queda. Sin valor: el texto pasa tal cual.
   */
  honesty?: Omit<HonestyCtx, "toolsWithData"> | null;
}

/**
 * Tope total del turno en el servidor (AUD-IATO-01). La función Edge muere a los 150 s (plan gratis;
 * también es el límite de inactividad de la petición): con 120 s queda margen para validar, registrar
 * el uso, confirmar la cuota y mandar el evento final o el de error.
 */
export const TURN_BUDGET_MS = 120_000;


export interface TurnOutput { final: FinalTurn; agent: AgentResult; prefetched: ToolRun[]; prefetchMs: number; totalMs: number; lead: string | null; leadMs: number | null }

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
  // Ola 9.5: sin consultas previas, un paso en vivo dice qué hace Iato mientras el modelo lee el contexto
  // (antes: 4–7 s de "Iato está escribiendo…"). Se cierra con el primer texto o la primera herramienta;
  // la app lo quita del globo en cuanto hay texto (id "think").
  let thinking = !d.plan.prefetch.length && d.plan.thinking ? d.plan.thinking : null;
  if (thinking) d.send({ type: "status", data: { id: THINK_STEP_ID, text: thinking, state: "running" } });
  const endThinking = () => {
    if (!thinking) return;
    d.send({ type: "status", data: { id: THINK_STEP_ID, text: thinking.replace(/…$/, ""), state: "done" } });
    thinking = null;
  };

  // 0) Frase de inicio: solo si las herramientas tardan (nunca afirma un dato; ver leadSentence).
  const leadText = d.leadAfterMs !== undefined ? leadSentence(d.plan, { exigente: d.exigente, message: d.userMessage }) : null;
  let lead: string | null = null;
  let leadMs: number | null = null;
  const leadTimer = leadText ? setTimeout(() => {
    lead = leadText;
    leadMs = now() - t0;
    d.send({ type: "delta", data: { text: leadText } });
  }, d.leadAfterMs) : undefined;

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
  if (leadTimer !== undefined) clearTimeout(leadTimer);
  const shownLead = lead as string | null;

  // Con frase mostrada: el modelo sabe que ya está en pantalla y sigue en el mismo párrafo; el texto
  // del modelo se pega después con un espacio (o párrafo nuevo si empieza con lista). Si algo hace
  // que la app borre el texto (reset: preámbulo antes de herramientas o cambio de proveedor), la
  // frase se vuelve a mostrar.
  let sepPending = shownLead !== null;
  // Lo que se ve en vivo es lo que queda (brevity.ts): los consejos del vuelo que no pidió se filtran
  // oración por oración ANTES de mostrarse; nada se borra después del streaming.
  const newLive = () => new LiveAdviceFilter({ avoidFlight: !!d.plan.avoidTopics?.includes("vuelo"), userMessage: d.userMessage });
  let live = newLive();
  // Herramientas que trajeron datos en este turno (las previstas y las que pida el modelo): una tarjeta
  // de Booking o Viator solo puede existir si su búsqueda corrió (honesty.ts, N3).
  const withData = new Set<string>(prefetched.filter((r) => r.result?.disponible !== false).map((r) => r.name));
  const honestyCtx: HonestyCtx | null = d.honesty ? { ...d.honesty, toolsWithData: () => withData } : null;
  const newHonest = () => new LiveHonestyFilter(honestyCtx);
  let honest = newHonest();
  const dynamicSystem = shownLead
    ? `${d.dynamicSystem}\n\nYA EN PANTALLA (lo escribió la app mientras llegaban los datos; no lo repitas): «${shownLead}». Tu respuesta aparece justo después, en el mismo párrafo: empieza directo con el resultado, sin saludo.`
    : d.dynamicSystem;
  const show = (text: string) => {
    if (!text) return;
    endThinking();
    if (sepPending) {
      const trimmed = text.replace(/^\s+/, "");
      if (!trimmed) return;
      sepPending = false;
      d.send({ type: "delta", data: { text: leadSeparator(trimmed) + trimmed } });
      return;
    }
    d.send({ type: "delta", data: { text } });
  };
  const sendText = (raw: string) => show(honest.push(live.push(raw)));
  const execTool = async (name: string, args: Record<string, unknown>) => {
    const r = await d.execTool(name, args);
    const p = r && typeof r === "object" && !Array.isArray(r) ? r as Record<string, unknown> : null;
    if (p && !p.error && p.ok !== false && !(Array.isArray(p.results) && p.results.length === 0)) withData.add(name);
    return r;
  };

  // 2) Modelo (streaming) con herramientas.
  const chain = providerChain(d.route, d.config, d.breaker, { hasAnthropicKey: d.hasAnthropicKey, hasLovableKey: d.hasLovableKey });
  const agent = await runAgentTurn({
    chain, breaker: d.breaker, cooldownMs: d.config.breaker_cooldown_s * 1000, callModel: d.callModel,
    stableSystem: d.stableSystem, dynamicSystem, messages: buildTurnMessages(d.contextMessage, d.history, prefetched),
    tools: TOOL_DEFS, maxIterations: d.route.maxIterations, maxTokens: d.route.maxTokens, userMessage: d.userMessage,
    execTool, prepare: prepareToolResultForModel, toolTimeoutMs: d.toolTimeout, prefetched,
    deadlineMs: d.exigente ? 50_000 : 30_000, hardBudgetMs: Math.max(0, TURN_BUDGET_MS - prefetchMs), now: d.now,
    emit: {
      status: (id, text, state) => { endThinking(); d.send({ type: "status", data: { id, text, state } }); },
      delta: sendText,
      reset: () => {
        live = newLive();
        honest = newHonest();
        d.send({ type: "reset", data: {} });
        if (shownLead) {
          d.send({ type: "delta", data: { text: shownLead } });
          sepPending = true;
        }
      },
    },
  });

  // Lo que quedó retenido al final de la última oración.
  show(honest.push(live.flush()) + honest.flush());
  endThinking();

  // 3) Respuesta validada.
  const final = finalizeTurn({
    raw: agent.finalText, toolRuns: agent.toolRuns, plan: d.plan, actionCtx: d.actionCtx,
    requestIntel: d.requestIntel, hasConfirmedBookings: d.hasConfirmedBookings, openRequests: d.openRequests, knownRequests: d.knownRequests, city: d.city, party: d.party,
    exigente: d.exigente, userMessage: d.userMessage, tripScope: d.tripScope ?? null,
    liveText: d.streaming === false ? undefined : honest.shown, liveDropped: live.dropped, liveRevised: honest.revised,
    honesty: honestyCtx,
  });
  if (shownLead) final.text = joinLead(shownLead, final.text);
  return { final, agent, prefetched, prefetchMs, totalMs: now() - t0, lead: shownLead, leadMs };
}
