// Recorrido 11-nov-2026 (viaje a Puerto Escondido, sale mañana): «Si mi vuelo se retrasa más de 3 horas, ¿qué derechos tengo?»
// → solo quedaba «Reviso en tiempo real tu vuelo… y tus derechos como pasajero.» y nada más: el modelo quiso seguir buscando al
// llegar al tope de vueltas y su texto final venía vacío. Ahora hay una última llamada sin herramientas con lo que ya se consultó.
import { describe, expect, it } from "vitest";
import { runAgentTurn, withFinalNudge, type ModelCaller } from "../../supabase/functions/concierge-chat/agent";
import { CircuitBreaker, type ProviderStep } from "../../supabase/functions/concierge-chat/router";
import { prepareToolResultForModel } from "../../supabase/functions/concierge-chat/cards";

const steps: ProviderStep[] = [{ provider: "anthropic", model: "claude-sonnet-5-5", effort: "low", key: "anthropic:claude-sonnet-5-5" }];
const usage = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
const toolCall = (step: ProviderStep, id: string) => ({ provider: step.provider, model: step.model,
  content: [{ type: "tool_use", id, name: "web_search", input: { query: "derechos del pasajero retraso" } }],
  text: "", toolUses: [{ id, name: "web_search", input: { query: "derechos del pasajero retraso" } }], stopReason: "tool_use", usage });

describe("Iato nunca termina con solo la frase de inicio", () => {
  it("si al tope de vueltas el texto viene vacío, contesta en una última llamada sin herramientas", async () => {
    const calls: Array<{ toolChoice: unknown; last: unknown }> = [];
    let n = 0;
    const callModel: ModelCaller = async (step, input, h) => {
      n++;
      calls.push({ toolChoice: input.toolChoice, last: input.messages[input.messages.length - 1] });
      if (n === 1) return toolCall(step, "t1") as any;
      if (n === 2) return toolCall(step, "t2") as any; // último paso: quería más herramientas, sin texto
      h.onText("Con PROFECO: si tu vuelo se retrasa ");
      h.onText("más de 4 horas…");
      return { provider: step.provider, model: step.model, content: [{ type: "text", text: "Con PROFECO: si tu vuelo se retrasa más de 4 horas…" }],
        text: "Con PROFECO: si tu vuelo se retrasa más de 4 horas…", toolUses: [], stopReason: "end_turn", usage } as any;
    };
    let shown = "";
    const r = await runAgentTurn({
      chain: steps, callModel, breaker: new CircuitBreaker(() => 0), cooldownMs: 1, stableSystem: "s", dynamicSystem: "d",
      messages: [{ role: "user", content: "Si mi vuelo se retrasa más de 3 horas, ¿qué derechos tengo?" }], tools: [], maxIterations: 2, maxTokens: 500,
      userMessage: "Si mi vuelo se retrasa más de 3 horas, ¿qué derechos tengo?",
      execTool: async () => ({ ok: true, results: [{ title: "PROFECO derechos", url: "https://www.gob.mx/profeco" }] }),
      prepare: prepareToolResultForModel, toolTimeoutMs: () => 1000,
      emit: { status: () => {}, delta: (t) => { shown += t; }, reset: () => {} }, now: () => 0,
    });
    expect(n).toBe(3);
    expect(calls[2].toolChoice).toBe("none");
    expect(r.finalText).toMatch(/PROFECO/);
    expect(shown).toMatch(/PROFECO/);
  });

  it("el aviso va dentro del último mensaje del usuario (turnos alternados)", () => {
    const out = withFinalNudge([{ role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "{}" }] } as any]);
    expect(out).toHaveLength(1);
    expect(JSON.stringify(out[0].content)).toMatch(/Ya no hay más búsquedas/);
    expect(withFinalNudge([{ role: "assistant", content: "x" } as any])).toHaveLength(2);
  });
});
