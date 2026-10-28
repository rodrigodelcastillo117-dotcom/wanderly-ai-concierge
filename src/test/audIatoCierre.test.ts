// Cierre de auditoría — grupo iato-cotiz (docs/iatos/cierre/IATO_COTIZACIONES_OPERACION.md).
// Cada bloque reproduce un defecto NUEVO (falla contra el código previo a la corrección) y queda
// como prueba de regresión.
import { describe, it, expect, vi } from "vitest";
import { AllProvidersFailed, runAgentTurn, type ModelCaller, type ModelCallResult } from "../../supabase/functions/concierge-chat/agent";
import { ProviderError } from "../../supabase/functions/concierge-chat/anthropic";
import { CircuitBreaker, type ProviderStep } from "../../supabase/functions/concierge-chat/router";
import { executeAction } from "../../supabase/functions/concierge-chat/actionExec";
import { collectEvidence, prepareToolResultForModel, validateCards } from "../../supabase/functions/concierge-chat/cards";
import { runWebSearch } from "../../supabase/functions/concierge-chat/webSearch";
import { memoryCacheStore } from "../../supabase/functions/_shared/serpCache";

const steps: ProviderStep[] = [
  { provider: "anthropic", model: "claude-sonnet-5-5", effort: "low", key: "anthropic:claude-sonnet-5-5" },
  { provider: "anthropic", model: "claude-haiku-5-5", effort: "low", key: "anthropic:claude-haiku-5-5" },
  { provider: "lovable", model: "google/gemini-flash-latest", effort: "low", key: "lovable:google/gemini-flash-latest" },
];
const usage = (i: number, o: number) => ({ input_tokens: i, output_tokens: o, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 });
const noEmit = { status: () => {}, delta: () => {}, reset: () => {} };

function agentBase(callModel: ModelCaller, now: () => number) {
  return {
    chain: steps, callModel, breaker: new CircuitBreaker(now), cooldownMs: 120_000,
    stableSystem: "s", dynamicSystem: "d", messages: [{ role: "user" as const, content: "hola" }], tools: [],
    maxIterations: 3, maxTokens: 1000, userMessage: "vuelos a parís",
    execTool: async () => ({ ok: true, source: "serpapi", results: [{ airline: "Air France", price_usd: 900 }] }),
    prepare: (n: string, raw: unknown) => prepareToolResultForModel(n, raw),
    toolTimeoutMs: () => 14_000, emit: noEmit, now, deadlineMs: 30_000,
  };
}

// ═══ AUD-IATO-01 · el turno no tiene tope total: la cadena de respaldos rebasa el límite de la función ═══
describe("AUD-IATO-01 · tope total del turno", () => {
  it("con los 3 proveedores lentos (60 s c/u) el turno se corta antes de 120 s, no a los 180 s", async () => {
    let clock = 0;
    const now = () => clock;
    const budgets: (number | undefined)[] = [];
    const callModel: ModelCaller = async (_step, input) => {
      budgets.push(input.budgetMs);
      // El proveedor respeta el tope que se le pasa (como makeModelCaller con AbortSignal).
      clock += Math.min(60_000, input.budgetMs ?? 60_000);
      throw new ProviderError("timeout", 0, "timeout_total");
    };
    const err = await runAgentTurn({ ...agentBase(callModel, now), hardBudgetMs: 110_000 }).catch((e) => e);
    expect(err).toBeInstanceOf(AllProvidersFailed);
    expect(clock).toBeLessThanOrEqual(110_000);
    expect(budgets[0]).toBeLessThanOrEqual(110_000);
  });

  it("después de herramientas, la última llamada recibe solo el tiempo que queda", async () => {
    let clock = 0;
    const now = () => clock;
    const budgets: (number | undefined)[] = [];
    let n = 0;
    const callModel: ModelCaller = async (step, input) => {
      budgets.push(input.budgetMs);
      n++;
      if (n === 1) {
        clock += 80_000; // primera vuelta lenta que pide herramientas
        return { provider: "anthropic", model: step.model, content: [{ type: "tool_use", id: "t1", name: "search_flights", input: { origin: "MEX", destination: "CDG", depart: "2027-01-10" } }], text: "", toolUses: [{ id: "t1", name: "search_flights", input: { origin: "MEX", destination: "CDG", depart: "2027-01-10" } }], stopReason: "tool_use", usage: usage(1000, 50) } satisfies ModelCallResult;
      }
      clock += Math.min(60_000, input.budgetMs ?? 60_000);
      throw new ProviderError("timeout", 0, "timeout_total");
    };
    await runAgentTurn({ ...agentBase(callModel, now), hardBudgetMs: 110_000 }).catch(() => null);
    expect(clock).toBeLessThanOrEqual(110_000);
    expect(budgets[1]).toBeDefined();
    expect(budgets[1]!).toBeLessThanOrEqual(30_000);
  });
});

// ═══ AUD-IATO-02 · el costo de las llamadas que sí respondieron se pierde si el turno termina en error ═══
describe("AUD-IATO-02 · uso registrado aunque el turno falle", () => {
  it("AllProvidersFailed trae el uso de la vuelta que sí respondió (para ai_usage_log)", async () => {
    let n = 0;
    const callModel: ModelCaller = async (step) => {
      n++;
      if (n === 1) {
        return { provider: "anthropic", model: step.model, content: [{ type: "tool_use", id: "t1", name: "search_flights", input: { origin: "MEX", destination: "CDG", depart: "2027-01-10" } }], text: "", toolUses: [{ id: "t1", name: "search_flights", input: { origin: "MEX", destination: "CDG", depart: "2027-01-10" } }], stopReason: "tool_use", usage: usage(9000, 300) };
      }
      throw new ProviderError("overloaded", 529, "overloaded");
    };
    const err = await runAgentTurn(agentBase(callModel, () => 0)).catch((e) => e);
    expect(err).toBeInstanceOf(AllProvidersFailed);
    expect((err as AllProvidersFailed).usage).toEqual([{ provider: "anthropic", model: "claude-sonnet-5-5", ...usage(9000, 300) }]);
  });
});

// ═══ AUD-IATO-03 · Fixer desde Iato: "enviada" aunque ningún humano recibió el aviso ═══
describe("AUD-IATO-03 · solicitud al Fixer sin aviso al humano", () => {
  const ctx = { todayISO: "2026-10-22", trips: [], activeTripId: null };
  const run = (human_notified: boolean) => executeAction("fixer_request", { tipo: "transport", titulo: "Traslado al aeropuerto" }, ctx, {
    userId: "u1", db: {},
    callFunction: async () => ({ status: 200, json: { ok: true, request: { id: "abcdef12-3456-4000-8000-000000000000", status: "solicitado" }, human_notified } }),
  });

  it("si el correo al equipo falló, no promete respuesta y dice que la solicitud solo quedó registrada", async () => {
    const r = await run(false);
    expect(r.ok).toBe(true);
    expect(r.data?.human_notified).toBe(false);
    expect(r.message).not.toMatch(/te avisamos cuando haya respuesta/i);
    expect(r.message).toMatch(/no pudimos avisar al equipo/i);
    expect(r.message).toMatch(/ABCDEF12/);
  });

  it("con aviso entregado conserva el mensaje de siempre", async () => {
    const r = await run(true);
    expect(r.message).toMatch(/Solicitud enviada a nuestro equipo \(folio ABCDEF12\)/);
    expect(r.data?.human_notified).toBe(true);
  });
});

// ═══ AUD-IATO-04 · un precio real de OTRA opción se marca "consultado en vivo" en la card ═══
const flightsRun = {
  name: "search_flights",
  result: prepareToolResultForModel("search_flights", {
    ok: true, source: "serpapi", consulted_at: "2026-10-22T15:00:00.000Z",
    results: [
      { airline: "Air France", price_usd: 2360, price_per_person_usd: 1180, buy_url: "https://www.aviasales.com/search/MEX2310CDG2" },
      { airline: "Iberia", price_usd: 1720, price_per_person_usd: 860, buy_url: "https://www.aviasales.com/search/MEX2310CDG2" },
    ],
  }),
};
const hotelsRun = {
  name: "search_hotels",
  result: prepareToolResultForModel("search_hotels", {
    ok: true, source: "serpapi", consulted_at: "2026-10-22T15:00:00.000Z",
    results: [
      { name: "Hôtel Le Marais", nightly_usd: 210, total_usd: 1470, nightly_before_taxes_usd: 180, total_before_taxes_usd: 1260, nights: 7 },
      { name: "Hotel Lutetia", nightly_usd: 640, total_usd: 4480, nights: 7 },
    ],
  }),
};

describe("AUD-IATO-04 · precio ligado a la opción de la card", () => {
  const ev = collectEvidence([flightsRun, hotelsRun]);
  it("Air France con el precio de Iberia → NO_VERIFICADO (antes: CONSULTADO_EN_VIVO)", () => {
    const { cards } = validateCards([{ type: "flight", title: "Air France", price_usd: 1720, currency: "USD" }], ev);
    expect(cards[0].estado_dato).toBe("NO_VERIFICADO");
    expect(cards[0].price).toBeUndefined();
  });
  it("hotel inventado con el precio de un hotel real → NO_VERIFICADO", () => {
    const { cards } = validateCards([{ type: "hotel", title: "Grand Hotel Fantasía", price_usd: 640, currency: "USD" }], ev);
    expect(cards[0].estado_dato).toBe("NO_VERIFICADO");
  });
  it("control: el precio de su propia opción sigue verificado", () => {
    const { cards } = validateCards([
      { type: "flight", title: "Air France", price_usd: 2360, currency: "USD" },
      { type: "hotel", title: "Hotel Lutetia", price_usd: 640, currency: "USD" },
    ], ev);
    expect(cards.map((c) => c.estado_dato)).toEqual(["CONSULTADO_EN_VIVO", "CONSULTADO_EN_VIVO"]);
  });
});

// ═══ AUD-IATO-05 · la card no dice si el precio es por persona, por noche, total o sin impuestos ═══
describe("AUD-IATO-05 · base del precio (por persona / total / impuestos)", () => {
  const ev = collectEvidence([flightsRun, hotelsRun]);
  it("vuelo con precio por persona: la card lo dice (antes la pantalla decía 'total')", () => {
    const { cards } = validateCards([{ type: "flight", title: "Air France", price_usd: 1180, currency: "USD" }], ev);
    expect(cards[0].estado_dato).toBe("CONSULTADO_EN_VIVO");
    expect(cards[0].price_basis).toBe("por persona");
  });
  it("vuelo con el total del grupo → 'total'", () => {
    const { cards } = validateCards([{ type: "flight", title: "Iberia", price_usd: 1720, currency: "USD" }], ev);
    expect(cards[0].price_basis).toBe("total");
  });
  it("hotel: por noche con impuestos, total de la estancia y tarifa antes de impuestos", () => {
    const { cards } = validateCards([
      { type: "hotel", title: "Hôtel Le Marais", price_usd: 210, currency: "USD", meta: "total" },
      { type: "hotel", title: "Hôtel Le Marais", price_usd: 1470, currency: "USD", meta: "por noche" },
      { type: "hotel", title: "Hôtel Le Marais", price_usd: 180, currency: "USD", meta: "por noche" },
    ], ev);
    expect(cards.map((c) => c.price_basis)).toEqual([
      "por noche · con impuestos", "total de la estancia · con impuestos", "por noche · sin impuestos",
    ]);
  });
});

// ═══ AUD-IATO-06 · web_search de Iato se salta el freno de la cuenta de SerpApi ═══
describe("AUD-IATO-06 · web_search respeta el presupuesto y la pausa de SerpApi", () => {
  const serpCalls = (fetchImpl: ReturnType<typeof vi.fn>) => fetchImpl.mock.calls.filter((c) => String(c[0]).includes("serpapi.com")).length;
  const wiki = { pages: [{ key: "Aeropuerto", title: "Aeropuerto Internacional", excerpt: "Terminal 1" }] };

  it("con el presupuesto agotado no llama a SerpApi (respaldo gratuito, citado)", async () => {
    const fetchImpl = vi.fn(async (url: string) => new Response(JSON.stringify(String(url).includes("wikipedia") ? wiki : { organic_results: [] }), { status: 200 }));
    const brake = { paused: vi.fn(async () => "budget" as const), tripQuota: vi.fn(async () => {}) };
    const out = await runWebSearch({ query: "centurion lounge aicm" }, { fetchImpl: fetchImpl as unknown as typeof fetch, serpKey: "k", store: memoryCacheStore(), brake });
    expect(serpCalls(fetchImpl)).toBe(0);
    expect(out.source).toBe("wikipedia");
  });

  it("si SerpApi dice que se acabaron las búsquedas, se pausa la cuenta para las demás funciones", async () => {
    const fetchImpl = vi.fn(async (url: string) => String(url).includes("wikipedia")
      ? new Response(JSON.stringify(wiki), { status: 200 })
      : new Response(JSON.stringify({ error: "Your account has run out of searches." }), { status: 429 }));
    const brake = { paused: vi.fn(async () => null), tripQuota: vi.fn(async () => {}) };
    await runWebSearch({ query: "centurion lounge aicm" }, { fetchImpl: fetchImpl as unknown as typeof fetch, serpKey: "k", store: memoryCacheStore(), brake });
    expect(brake.tripQuota).toHaveBeenCalledTimes(1);
  });
});

