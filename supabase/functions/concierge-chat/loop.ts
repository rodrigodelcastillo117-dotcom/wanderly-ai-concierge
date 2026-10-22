// Bucle de tool-calling del concierge, separado de Deno para poder probarlo con un modelo y
// herramientas simuladas (suite de evaluación src/test/iatoEvals.test.ts).

import { runToolCalls, TOOL_TIMEOUT_MS, type ToolCall } from "./tools.ts";
import {
  collectEvidence, enforceAvailabilityHonesty, prepareToolResultForModel, validateCards,
  type ConciergeCard, type ToolRun,
} from "./cards.ts";

export interface ModelMessage { role: string; content?: string | null; tool_calls?: ToolCall[]; tool_call_id?: string }

export type CallModel = (messages: ModelMessage[], opts: { toolChoice: "auto" | "none" }) => Promise<ModelMessage | null>;
export type ExecTool = (name: string, args: Record<string, unknown>) => Promise<unknown>;

export interface LoopResult { finalText: string; toolsUsed: string[]; toolRuns: ToolRun[] }

export const MAX_ITERATIONS = 4;

export async function runConciergeLoop(
  messages: ModelMessage[],
  callModel: CallModel,
  execTool: ExecTool,
  { maxIterations = MAX_ITERATIONS, timeoutMs = TOOL_TIMEOUT_MS } = {},
): Promise<LoopResult> {
  const toolsUsed: string[] = [];
  const toolRuns: ToolRun[] = [];
  let finalText = "";
  for (let i = 0; i < maxIterations; i++) {
    // En la última vuelta se obliga a responder con lo ya obtenido (antes se perdía todo y salía
    // "Estoy procesando demasiada información").
    const last = i === maxIterations - 1;
    const msg = await callModel(messages, { toolChoice: last ? "none" : "auto" });
    if (!msg) break;
    if (msg.tool_calls?.length && !last) {
      messages.push(msg);
      const results = await runToolCalls(msg.tool_calls, execTool, timeoutMs);
      for (const r of results) {
        toolsUsed.push(r.name);
        const prepared = prepareToolResultForModel(r.name, r.result);
        toolRuns.push({ name: r.name, args: r.args, result: prepared });
        messages.push({ role: "tool", tool_call_id: r.id, content: JSON.stringify(prepared) });
      }
      continue;
    }
    finalText = msg.content ?? "";
    break;
  }
  return { finalText, toolsUsed, toolRuns };
}

/** Saca el JSON de la respuesta del modelo (puede venir con ```json o con texto alrededor). */
export function parseModelJson(text: string): { text?: unknown; cards?: unknown; [k: string]: unknown } {
  const raw = String(text ?? "").trim();
  const tryParse = (s: string) => {
    try {
      const v = JSON.parse(s);
      return v && typeof v === "object" && !Array.isArray(v) ? v : null;
    } catch {
      return null;
    }
  };
  const fenced = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  const direct = tryParse(raw) ?? tryParse(fenced);
  if (direct) return direct;
  const m = raw.match(/\{[\s\S]*\}/);
  const inner = m ? tryParse(m[0]) : null;
  return inner ?? { text: raw, cards: [] };
}

export interface FinalReply { text: string; cards: ConciergeCard[]; dropped: { type: string; reason: string }[] }

/** Valida cards contra los resultados de herramientas de este turno y asegura honestidad. */
export function finalizeReply(parsed: { text?: unknown; cards?: unknown }, toolRuns: ToolRun[], now: Date = new Date()): FinalReply {
  const ev = collectEvidence(toolRuns);
  const { cards, dropped } = validateCards(parsed?.cards, ev, now.toISOString());
  const baseText = typeof parsed?.text === "string" ? parsed.text.slice(0, 4000) : "";
  let text = enforceAvailabilityHonesty(baseText, ev);
  if (!text.trim()) {
    text = cards.length ? "Esto es lo que encontré:" : "No alcancé a armar una respuesta. ¿Me lo pides de nuevo?";
  }
  return { text, cards, dropped };
}
