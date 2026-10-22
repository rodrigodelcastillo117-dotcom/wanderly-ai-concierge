import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const env: Record<string, string> = {};
(globalThis as unknown as { Deno: unknown }).Deno = { env: { get: (k: string) => env[k] } };

import { callClaudeWithFallback, claudeModels, CURRENT_CLAUDE_MODEL, parseJsonLoose, responseText, toolInput } from "../../supabase/functions/_shared/claude";

describe("llamada a Claude compartida (buscar-promociones, nightlife-discover, analizar-viaje)", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    for (const k of Object.keys(env)) delete env[k];
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => vi.unstubAllGlobals());

  it("usa el modelo vigente, sin temperature ni tool_choice forzado, con los mismos headers que analizar-viaje", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ content: [] }), { status: 200 }));
    await callClaudeWithFallback({
      max_tokens: 4000, temperature: 0, tools: [{ name: "x" }], tool_choice: { type: "tool", name: "x" }, messages: [],
    }, { apiKey: "k" });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    const headers = init.headers as Record<string, string>;
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(body.model).toBe(CURRENT_CLAUDE_MODEL);
    expect(CURRENT_CLAUDE_MODEL).toBe("claude-sonnet-5-5");
    expect(body).not.toHaveProperty("temperature");
    expect(body.tool_choice).toEqual({ type: "auto" });
    expect(body).toMatchObject({ thinking: { type: "between_tools" }, output_config: { effort: "medium" }, fallbacks: "default" });
    expect(headers).toMatchObject({ "x-api-key": "k", "anthropic-version": "2023-06-01", "anthropic-beta": "server-side-fallback-2026-07-01" });
  });

  it("si el modelo de ANTHROPIC_MODEL no existe, prueba el vigente", async () => {
    env.ANTHROPIC_MODEL = "claude-sonnet-4-20250514";
    expect(claudeModels()).toEqual(["claude-sonnet-4-20250514", CURRENT_CLAUDE_MODEL]);
    fetchMock
      .mockResolvedValueOnce(new Response('{"error":{"type":"not_found_error","message":"model: claude-sonnet-4-20250514"}}', { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ content: [] }), { status: 200 }));
    const res = await callClaudeWithFallback({ messages: [] }, { apiKey: "k" });
    expect(res.ok).toBe(true);
    const first = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    const second = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string);
    expect(first.model).toBe("claude-sonnet-4-20250514");
    expect(first).not.toHaveProperty("thinking");
    expect(second.model).toBe(CURRENT_CLAUDE_MODEL);
  });

  it("no reintenta otros errores (devuelve el error para caer al respaldo Gemini)", async () => {
    fetchMock.mockResolvedValue(new Response("overloaded", { status: 529 }));
    const res = await callClaudeWithFallback({ messages: [] }, { apiKey: "k", models: [CURRENT_CLAUDE_MODEL] });
    expect(res.status).toBe(529);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("lee la herramienta / el texto y trata un rechazo como 'sin resultado'", () => {
    expect(toolInput({ content: [{ type: "tool_use", name: "t", input: { a: 1 } }] }, "t")).toEqual({ a: 1 });
    expect(toolInput({ stop_reason: "refusal", content: [{ type: "tool_use", name: "t", input: { a: 1 } }] }, "t")).toBeNull();
    expect(toolInput({ content: [{ type: "text", text: "hola" }] }, "t")).toBeNull();
    expect(responseText({ content: [{ type: "text", text: '```json\n{"venues":[]}\n```' }] })).toContain("venues");
    expect(parseJsonLoose('```json\n{"venues":[1]}\n```')).toEqual({ venues: [1] });
    expect(parseJsonLoose('Aquí está: {"a":2} listo')).toEqual({ a: 2 });
    expect(parseJsonLoose("nada")).toBeNull();
  });
});
