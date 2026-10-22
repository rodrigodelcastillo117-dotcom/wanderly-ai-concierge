// Concierge 2.0 — núcleo: ruteo de modelos, circuit breaker, cliente de streaming de Claude (SSE,
// herramientas, pensamiento con firma), protocolo con la app y validación de herramientas.
import { describe, it, expect } from "vitest";
import {
  buildAnthropicRequest, MessageAccumulator, ProviderError, SseParser, streamAnthropic, assistantContentForEcho, parseToolJson,
} from "../../supabase/functions/concierge-chat/anthropic";
import {
  CircuitBreaker, DEFAULT_MODEL_CONFIG, providerChain, resolveModelConfig, routeTurn,
} from "../../supabase/functions/concierge-chat/router";
import { AnswerStreamFilter, ConciergeStreamParser, DATA_SENTINEL, encodeEvent, splitAnswer } from "../../supabase/functions/concierge-chat/stream";
import { TOOL_DEFS, toAnthropicTools, toOpenAiTools, validateToolInput } from "../../supabase/functions/concierge-chat/toolDefs";
import { buildStableSystem, buildDynamicSystem, SYSTEM } from "../../supabase/functions/concierge-chat/prompt";
import { mapSerpOrganic, runWebSearch } from "../../supabase/functions/concierge-chat/webSearch";
import { memoryCacheStore } from "../../supabase/functions/_shared/serpCache";
import { toOpenAiMessages } from "../../supabase/functions/concierge-chat/agent";

// ── SSE simulado de la Messages API ──
export const sse = (events: Array<[string, unknown]>) => events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join("");
export function textStream(model: string, text: string, usage = { input_tokens: 900, cache_read_input_tokens: 4000, cache_creation_input_tokens: 0, output_tokens: 1 }) {
  return sse([
    ["message_start", { type: "message_start", message: { id: "msg_1", type: "message", model, usage } }],
    ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "", signature: "" } }],
    ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "sig-abc" } }],
    ["content_block_stop", { type: "content_block_stop", index: 0 }],
    ["content_block_start", { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } }],
    ...text.match(/.{1,7}/gs)!.map((chunk) => ["content_block_delta", { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: chunk } }] as [string, unknown]),
    ["content_block_stop", { type: "content_block_stop", index: 1 }],
    ["message_delta", { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 120 } }],
    ["message_stop", { type: "message_stop" }],
  ]);
}
export function toolStream(model: string, calls: Array<{ id: string; name: string; input: unknown }>) {
  const ev: Array<[string, unknown]> = [["message_start", { type: "message_start", message: { model, usage: { input_tokens: 800, output_tokens: 1 } } }]];
  calls.forEach((c, i) => {
    const json = JSON.stringify(c.input);
    ev.push(["content_block_start", { type: "content_block_start", index: i, content_block: { type: "tool_use", id: c.id, name: c.name, input: {} } }]);
    for (let k = 0; k < json.length; k += 9) ev.push(["content_block_delta", { type: "content_block_delta", index: i, delta: { type: "input_json_delta", partial_json: json.slice(k, k + 9) } }]);
    ev.push(["content_block_stop", { type: "content_block_stop", index: i }]);
  });
  ev.push(["message_delta", { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 60 } }], ["message_stop", { type: "message_stop" }]);
  return sse(ev);
}
const streamResponse = (body: string, chunk = 50) => new Response(new ReadableStream({
  start(c) {
    const enc = new TextEncoder();
    for (let i = 0; i < body.length; i += chunk) c.enqueue(enc.encode(body.slice(i, i + chunk)));
    c.close();
  },
}), { status: 200, headers: { "content-type": "text/event-stream" } });

const REQ = {
  model: "claude-haiku-5-5", effort: "low" as const, stableSystem: "reglas", dynamicSystem: "hoy", tools: toAnthropicTools(),
  messages: [{ role: "user" as const, content: "hola" }], toolChoice: "auto" as const, maxTokens: 12000,
};
const OPTS = { apiKey: "k", firstByteTimeoutMs: 500, idleTimeoutMs: 500, totalTimeoutMs: 2000 };

describe("petición a la Messages API", () => {
  it("cachea herramientas + reglas, deja lo dinámico fuera del prefijo y no manda parámetros prohibidos", () => {
    const { body, headers } = buildAnthropicRequest({ ...REQ, model: "claude-sonnet-5-5", serverFallback: true });
    const system = body.system as Array<Record<string, unknown>>;
    expect(system[0]).toMatchObject({ text: "reglas", cache_control: { type: "ephemeral" } });
    expect(system[1]).toEqual({ type: "text", text: "hoy" });
    expect(body.cache_control).toEqual({ type: "ephemeral" });
    expect(body).toMatchObject({ stream: true, tool_choice: { type: "auto" }, output_config: { effort: "low" }, fallbacks: "default" });
    for (const k of ["temperature", "top_p", "top_k", "thinking"]) expect(body).not.toHaveProperty(k);
    expect(headers["anthropic-version"]).toBe("2026-10-21");
    expect(headers["anthropic-beta"]).toBe("server-side-fallback-2026-07-01");
    expect((body.tools as any[]).every((t) => t.eager_input_streaming === true)).toBe(true);
  });
  it("el modelo rápido no lleva respaldo del servidor (no lo admite) y nunca fuerza herramienta", () => {
    const { body, headers } = buildAnthropicRequest({ ...REQ, serverFallback: true, toolChoice: "none" });
    expect(body).not.toHaveProperty("fallbacks");
    expect(headers["anthropic-beta"]).toBeUndefined();
    expect(body.tool_choice).toEqual({ type: "none" });
  });
  it("el prefijo estable no cambia entre mensajes (sin fecha ni viaje): la caché sirve", () => {
    expect(buildStableSystem("")).toBe(buildStableSystem(""));
    expect(buildStableSystem("")).not.toMatch(/FECHA DE HOY|VIAJE EN CONTEXTO:/);
    expect(buildDynamicSystem({ todayLine: "FECHA DE HOY: x", tripReason: "pinned", hasTrip: true, godMode: true })).toMatch(/MODO: EXIGENTE/);
    expect(SYSTEM).toContain(DATA_SENTINEL);
  });
});

describe("SSE y acumulador", () => {
  it("parser incremental: eventos partidos en trozos arbitrarios", () => {
    const p = new SseParser();
    const raw = sse([["ping", { type: "ping" }], ["message_stop", { type: "message_stop" }]]);
    const out = [...p.push(raw.slice(0, 13)), ...p.push(raw.slice(13, 40)), ...p.push(raw.slice(40)), ...p.flush()];
    expect(out.map((e) => e.event)).toEqual(["ping", "message_stop"]);
  });
  it("arma texto, entrada de herramienta y conserva la firma del pensamiento", () => {
    const texts: string[] = [];
    const acc = new MessageAccumulator({ onText: (d) => texts.push(d) });
    const p = new SseParser();
    for (const ev of p.push(textStream("claude-haiku-5-5", "Tu vuelo AF179 va a tiempo."))) acc.apply(ev);
    expect(texts.join("")).toBe("Tu vuelo AF179 va a tiempo.");
    const content = acc.finalContent();
    expect(content[0]).toEqual({ type: "thinking", thinking: "", signature: "sig-abc" });
    expect(acc.msg.stopReason).toBe("end_turn");
    expect(acc.msg.usage).toMatchObject({ cache_read_input_tokens: 4000, output_tokens: 120 });

    const acc2 = new MessageAccumulator();
    for (const ev of new SseParser().push(toolStream("m", [{ id: "t1", name: "web_search", input: { query: "Centurion T1" } }]))) acc2.apply(ev);
    expect(acc2.toolUses()).toEqual([{ id: "t1", name: "web_search", input: { query: "Centurion T1" } }]);
  });
  it("JSON de herramienta cortado o inválido no se ejecuta (eager streaming)", () => {
    expect(parseToolJson('{"query": "x"', {})).toEqual({ ok: false, error: "JSON inválido" });
    expect(parseToolJson("", { a: 1 })).toEqual({ ok: true, value: { a: 1 } });
    expect(parseToolJson("[1]", {})).toMatchObject({ ok: false });
  });
  it("eco de un turno con respaldo del servidor: antes del bloque fallback solo texto", () => {
    const out = assistantContentForEcho([
      { type: "thinking", thinking: "", signature: "s" }, { type: "text", text: "Hola" }, { type: "fallback", from: {}, to: {} },
      { type: "tool_use", id: "t", name: "web_search", input: {} },
    ]);
    expect(out.map((b) => b.type)).toEqual(["text", "tool_use"]);
  });
});

describe("streamAnthropic con fetch simulado", () => {
  it("entrega el texto en vivo y mide el primer texto", async () => {
    const seen: string[] = [];
    const r = await streamAnthropic(REQ, { ...OPTS, fetchImpl: async () => streamResponse(textStream("claude-haiku-5-5", "Listo, aquí va.")) }, { onText: (d) => seen.push(d) });
    expect(seen.join("")).toBe("Listo, aquí va.");
    expect(r.text).toBe("Listo, aquí va.");
    expect(r.latency.firstTextMs).not.toBeNull();
  });
  it("429/529/5xx → ProviderError overloaded/server (para el breaker), 400 → bad_request", async () => {
    for (const [status, kind] of [[429, "overloaded"], [529, "overloaded"], [500, "server"], [400, "bad_request"], [401, "auth"]] as const) {
      await expect(streamAnthropic(REQ, { ...OPTS, fetchImpl: async () => new Response("{}", { status }) })).rejects.toMatchObject({ kind });
    }
  });
  it("timeout antes de los encabezados → kind timeout (no espera de más)", async () => {
    const hang = (_u: unknown, init?: RequestInit) => new Promise<Response>((_res, rej) => init?.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError"))));
    const t0 = Date.now();
    await expect(streamAnthropic(REQ, { ...OPTS, firstByteTimeoutMs: 80, fetchImpl: hang as typeof fetch })).rejects.toMatchObject({ kind: "timeout" });
    expect(Date.now() - t0).toBeLessThan(1000);
  });
  it("error dentro del stream (overloaded_error) conserva el texto parcial", async () => {
    const body = sse([
      ["message_start", { type: "message_start", message: { model: "m", usage: {} } }],
      ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
      ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hola" } }],
      ["error", { type: "error", error: { type: "overloaded_error", message: "Overloaded" } }],
    ]);
    const err = await streamAnthropic(REQ, { ...OPTS, fetchImpl: async () => streamResponse(body) }).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err).toMatchObject({ kind: "overloaded", partialText: "Hola" });
  });
});

describe("ruteo de modelos", () => {
  const cfg = DEFAULT_MODEL_CONFIG;
  it("simple → rápido; planeación, Privé o exigente → capaz", () => {
    expect(routeTurn({ message: "¿mi vuelo va a tiempo?", intents: ["flight_status"], exigente: false, config: cfg })).toMatchObject({ tier: "fast", model: "claude-haiku-5-5", effort: "low" });
    expect(routeTurn({ message: "mi vuelo se canceló", intents: ["flight_disruption"], exigente: false, config: cfg })).toMatchObject({ tier: "smart", model: "claude-sonnet-5-5" });
    expect(routeTurn({ message: "hola", intents: [], exigente: true, config: cfg })).toMatchObject({ tier: "smart", effort: "medium", maxIterations: 4 });
    expect(routeTurn({ message: "x".repeat(400), intents: [], exigente: false, config: cfg }).tier).toBe("smart");
  });
  it("modelos configurables por entorno y app_flags (gana app_flags; inválidos se ignoran)", () => {
    const c = resolveModelConfig({ CONCIERGE_FAST_MODEL: "claude-haiku-5-5", CONCIERGE_SMART_MODEL: "claude-opus-5-5" }, { smart_model: "claude-sonnet-5-5", fast_effort: "medium", exigente_effort: "turbo", force_tier: "smart" });
    expect(c).toMatchObject({ smart_model: "claude-sonnet-5-5", fast_effort: "medium", exigente_effort: "medium", force_tier: "smart" });
    expect(resolveModelConfig({}, { fast_model: "bad model!!" }).fast_model).toBe("claude-haiku-5-5");
    expect(routeTurn({ message: "hola", intents: [], exigente: false, config: c }).tier).toBe("smart");
  });
});

describe("circuit breaker", () => {
  it("después de un 5xx/429/timeout el proveedor se salta sin esperar; tras el enfriamiento, una prueba", () => {
    let now = 0;
    const b = new CircuitBreaker(() => now);
    b.recordFailure("lovable:x", "overloaded", 60_000);
    expect(b.isOpen("lovable:x")).toBe(true);
    now = 30_000;
    expect(b.isOpen("lovable:x")).toBe(true);
    now = 61_000;
    expect(b.isOpen("lovable:x")).toBe(false); // prueba
    expect(b.isOpen("lovable:x")).toBe(true); // una a la vez
    b.recordSuccess("lovable:x");
    expect(b.isOpen("lovable:x")).toBe(false);
  });
  it("un error de la petición (400) no abre el breaker; credenciales malas lo abren 10 min", () => {
    let now = 0;
    const b = new CircuitBreaker(() => now);
    b.recordFailure("a", "bad_request", 60_000);
    expect(b.isOpen("a")).toBe(false);
    b.recordFailure("a", "auth", 60_000);
    now = 5 * 60_000;
    expect(b.isOpen("a")).toBe(true);
  });
  it("cadena: Claude del nivel → el otro Claude → Gemini; salta los abiertos", () => {
    const b = new CircuitBreaker(() => 0);
    const route = routeTurn({ message: "hola", intents: [], exigente: false, config: DEFAULT_MODEL_CONFIG });
    const full = providerChain(route, DEFAULT_MODEL_CONFIG, b, { hasAnthropicKey: true, hasLovableKey: true });
    expect(full.map((s) => s.key)).toEqual(["anthropic:claude-haiku-5-5", "anthropic:claude-sonnet-5-5", "lovable:google/gemini-2.5-flash"]);
    b.recordFailure("anthropic:claude-haiku-5-5", "overloaded", 60_000);
    expect(providerChain(route, DEFAULT_MODEL_CONFIG, b, { hasAnthropicKey: true, hasLovableKey: true })[0].key).toBe("anthropic:claude-sonnet-5-5");
    expect(providerChain(route, DEFAULT_MODEL_CONFIG, b, { hasAnthropicKey: false, hasLovableKey: true }).map((s) => s.provider)).toEqual(["lovable"]);
  });
});

describe("protocolo con la app", () => {
  it("el filtro muestra el texto y retiene el bloque de datos aunque el centinela llegue partido", () => {
    const f = new AnswerStreamFilter();
    const parts = ["Hola, ", "te dejo 2 opciones.\n<<", "<IATO_", "DATA>>>\n{\"cards\":[]}"];
    const shown = parts.map((p) => f.push(p)).join("") + f.flush();
    expect(shown).toBe("Hola, te dejo 2 opciones.\n");
  });
  it("respuesta en JSON viejo: no se muestra en vivo, se valida al final", () => {
    const f = new AnswerStreamFilter();
    expect(f.push('{"text":"Hola","cards":[]}') + f.flush()).toBe("");
    expect(splitAnswer('{"text":"Hola","cards":[{"type":"alert"}]}')).toMatchObject({ text: "Hola", format: "json", data: { cards: [{ type: "alert" }] } });
    expect(splitAnswer(`Texto\n${DATA_SENTINEL}\n{"actions":[{"type":"save_place"}]}`)).toMatchObject({ text: "Texto", data: { actions: [{ type: "save_place" }] } });
    expect(splitAnswer("solo texto")).toEqual({ text: "solo texto", data: null, format: "text" });
  });
  it("eventos SSE de ida y vuelta", () => {
    const raw = encodeEvent({ type: "status", data: { id: "1", text: "Consultando tu vuelo AF179…", state: "running" } }) + encodeEvent({ type: "delta", data: { text: "Va " } });
    const p = new ConciergeStreamParser();
    const evs = [...p.push(raw.slice(0, 20)), ...p.push(raw.slice(20))];
    expect(evs).toEqual([{ type: "status", data: { id: "1", text: "Consultando tu vuelo AF179…", state: "running" } }, { type: "delta", data: { text: "Va " } }]);
  });
});

describe("herramientas", () => {
  it("cada herramienta dice cuándo usarla; TripAdvisor prohíbe datos prácticos; web_search existe", () => {
    const names = TOOL_DEFS.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["web_search", "search_places", "check_flight_status", "search_prive", "search_members_venues"]));
    expect(TOOL_DEFS.find((t) => t.name === "search_attractions")!.description).toMatch(/NO la uses para ubicaciones/);
    expect(toOpenAiTools()[0]).toMatchObject({ type: "function", function: { name: "check_flight_status" } });
  });
  it("valida entradas: requeridos, tipos, enums; convierte números en texto", () => {
    expect(validateToolInput("search_nearby", { lat: "19.4", lng: -99.1, kind: "hospital" })).toEqual({ ok: true, input: { lat: 19.4, lng: -99.1, kind: "hospital" } });
    expect(validateToolInput("search_nearby", { lat: 1, lng: 2, kind: "spa" })).toMatchObject({ ok: false });
    expect(validateToolInput("web_search", {})).toMatchObject({ ok: false, error: 'falta "query"' });
    expect(validateToolInput("nope", {})).toMatchObject({ ok: false });
  });
  it("respaldo en formato OpenAI: tool_use → tool_calls y tool_result → role tool; sin pensamiento", () => {
    const m = toOpenAiMessages("S", "D", [
      { role: "user", content: "hola" },
      { role: "assistant", content: [{ type: "thinking", thinking: "", signature: "s" }, { type: "tool_use", id: "t1", name: "web_search", input: { query: "x" } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "{}" }] },
    ]);
    expect(m[0]).toMatchObject({ role: "system" });
    expect(m[2]).toMatchObject({ role: "assistant", tool_calls: [{ id: "t1", function: { name: "web_search", arguments: '{"query":"x"}' } }] });
    expect(m[3]).toEqual({ role: "tool", tool_call_id: "t1", content: "{}" });
    expect(JSON.stringify(m)).not.toMatch(/signature/);
  });
});

describe("web_search", () => {
  const serpJson = { organic_results: [
    { title: "The Centurion Lounge Mexico City (MEX)", link: "https://www.americanexpress.com/es-mx/beneficios/centurion-lounge/mex", snippet: "Terminal 1, zona internacional, después del control de seguridad.", source: "American Express" },
    { title: "Salas AICM", link: "http://inseguro.example/x", snippet: "no https" },
  ] };
  it("mapea título, fragmento y enlace https; guarda en la caché 24 h y la reutiliza sin gastar búsqueda", async () => {
    const store = memoryCacheStore();
    let calls = 0;
    let lives = 0;
    const fetchImpl = (async () => { calls++; return new Response(JSON.stringify(serpJson), { status: 200 }); }) as typeof fetch;
    const deps = { fetchImpl, serpKey: "k", store, gate: async () => ({ allow: true as const }), onLive: () => { lives++; } };
    const a = await runWebSearch({ query: "Centurion T1 AICM" }, deps);
    expect(a).toMatchObject({ ok: true, source: "google_web", results: [{ title: "The Centurion Lounge Mexico City (MEX)" }] });
    expect((a.results as unknown[]).length).toBe(1);
    const b = await runWebSearch({ query: "centurion t1 aicm" }, deps);
    expect(b).toMatchObject({ from_cache: true });
    expect(calls).toBe(1);
    expect(lives).toBe(1);
    expect(mapSerpOrganic({ answer_box: { answer: "Terminal 1", link: "https://aicm.com.mx" } }).answer).toMatchObject({ text: "Terminal 1", source: "aicm.com.mx" });
  });
  it("límite del plan sin caché → respaldo gratuito (Wikipedia) citado; sin nada → límite honesto", async () => {
    const wiki = { pages: [{ key: "Aeropuerto_Internacional_de_la_Ciudad_de_México", title: "Aeropuerto Internacional de la Ciudad de México", excerpt: "Terminal 1 y <b>Terminal 2</b>" }] };
    const fetchImpl = (async (u: string) => (String(u).includes("wikipedia") ? new Response(JSON.stringify(wiki)) : new Response("{}", { status: 500 }))) as typeof fetch;
    const r = await runWebSearch({ query: "AICM terminales" }, { fetchImpl, serpKey: "k", store: memoryCacheStore(), gate: async () => ({ allow: false as const, soft: false }) });
    expect(r).toMatchObject({ ok: true, source: "wikipedia" });
    expect(String((r.results as any[])[0].snippet)).not.toMatch(/<b>/);
    const none = await runWebSearch({ query: "x" }, { fetchImpl: (async () => new Response("{}")) as typeof fetch, serpKey: "k", gate: async () => ({ allow: false as const, soft: true }) });
    expect(none).toMatchObject({ limite_uso_justo: true });
  });
  it("sin resultados de Google → lista vacía (la búsqueda sí corrió), no error", async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ error: "Google hasn't returned any results for this query." }), { status: 200 })) as typeof fetch;
    const r = await runWebSearch({ query: "zzzz" }, { fetchImpl, serpKey: "k" });
    expect(r).toEqual({ ok: true, source: "google_web", results: [] });
  });
});
