// Cierre de auditoría — grupo iato-cotiz: "Mejoras adicionales" (instrucción del dueño: GOD TIER).
import { describe, it, expect } from "vitest";
import { runAgentTurn, type ModelCaller } from "../../supabase/functions/concierge-chat/agent";
import { ProviderError } from "../../supabase/functions/concierge-chat/anthropic";
import { CircuitBreaker, type ProviderStep } from "../../supabase/functions/concierge-chat/router";
import { prepareToolResultForModel } from "../../supabase/functions/concierge-chat/cards";
import { incompleteReplyText } from "../../src/lib/conciergeStream";

const steps: ProviderStep[] = [
  { provider: "anthropic", model: "claude-sonnet-5-5", effort: "low", key: "anthropic:claude-sonnet-5-5" },
  { provider: "lovable", model: "google/gemini-flash-latest", effort: "low", key: "lovable:google/gemini-flash-latest" },
];
const ok = (step: ProviderStep) => ({ provider: step.provider, model: step.model, content: [{ type: "text", text: "Listo" }], text: "Listo", toolUses: [], stopReason: "end_turn", usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } });

function run(fail: ProviderError, breaker: CircuitBreaker) {
  let n = 0;
  const callModel: ModelCaller = async (step) => {
    n++;
    if (n === 1) throw fail;
    return ok(step);
  };
  return runAgentTurn({
    chain: steps, callModel, breaker, cooldownMs: 120_000, stableSystem: "s", dynamicSystem: "d",
    messages: [{ role: "user", content: "hola" }], tools: [], maxIterations: 2, maxTokens: 1000, userMessage: "hola",
    execTool: async () => ({}), prepare: prepareToolResultForModel, toolTimeoutMs: () => 1000,
    emit: { status: () => {}, delta: () => {}, reset: () => {} }, now: () => 0,
  });
}

describe("MEJ-01 · una respuesta larga que se pasa del tope total no 'apaga' a Claude para todos", () => {
  it("timeout total con texto fluyendo: se usa el respaldo, pero el breaker NO se abre", async () => {
    const b = new CircuitBreaker(() => 0);
    await run(new ProviderError("timeout", 200, "timeout_total", "Para tu viaje a Tokio…"), b);
    expect(b.isOpen("anthropic:claude-sonnet-5-5")).toBe(false);
  });
  it("sin respuesta (primer byte o inactividad) sí abre el breaker, como antes", async () => {
    const b = new CircuitBreaker(() => 0);
    await run(new ProviderError("timeout", 0, "timeout_first"), b);
    expect(b.isOpen("anthropic:claude-sonnet-5-5")).toBe(true);
  });
});

describe("MEJ-02 · texto parcial cuando se corta la conexión", () => {
  it("se conserva lo que llegó pero se marca como incompleto y sin verificar", () => {
    const t = incompleteReplyText("Tu vuelo sale de la puerta 34", "La conexión se cortó.");
    expect(t).toMatch(/^Tu vuelo sale de la puerta 34/);
    expect(t).toMatch(/Respuesta incompleta/);
    expect(t).toMatch(/sin verificar/);
  });
  it("sin texto, el mensaje de error de siempre", () => {
    expect(incompleteReplyText("  ", "Iato no pudo responder.")).toBe("Iato no pudo responder. Puedes intentarlo de nuevo o tocar **Contactar Fixer**.");
  });
});
