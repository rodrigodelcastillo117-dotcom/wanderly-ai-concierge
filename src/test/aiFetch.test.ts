import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const env: Record<string, string> = {};
(globalThis as unknown as { Deno: unknown }).Deno = { env: { get: (k: string) => env[k] } };

import { aiFetch } from "../../supabase/functions/_shared/ai";

const LOVABLE = "https://ai.gateway.lovable.dev/v1/chat/completions";
const GEMINI = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
const init = (body: Record<string, unknown>): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json", "Lovable-API-Key": "lov" },
  body: JSON.stringify(body),
});
const ok = () => new Response(JSON.stringify({ choices: [] }), { status: 200 });

describe("aiFetch", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    for (const k of Object.keys(env)) delete env[k];
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => vi.unstubAllGlobals());

  const call = (i: number) => {
    const [url, req] = fetchMock.mock.calls[i] as [string, RequestInit];
    return { url, body: JSON.parse(req.body as string), headers: req.headers as Record<string, string> };
  };

  it("uses the Lovable gateway when there is no Gemini key", async () => {
    fetchMock.mockResolvedValue(ok());
    await aiFetch(init({ model: "google/gemini-2.5-flash", messages: [] }));
    expect(call(0).url).toBe(LOVABLE);
    expect(call(0).body.model).toBe("google/gemini-2.5-flash");
  });

  it("calls Gemini directly with its own key and bare model name", async () => {
    env.GEMINI_API_KEY = "g-key";
    fetchMock.mockResolvedValue(ok());
    await aiFetch(init({ model: "google/gemini-2.5-flash", messages: [], response_format: { type: "json_object" } }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(call(0).url).toBe(GEMINI);
    expect(call(0).body.model).toBe("gemini-2.5-flash");
    expect(call(0).body.response_format).toEqual({ type: "json_object" });
    expect(call(0).headers.Authorization).toBe("Bearer g-key");
  });

  it("falls back from pro to flash, then to Lovable", async () => {
    env.GEMINI_API_KEY = "g-key";
    fetchMock
      .mockResolvedValueOnce(new Response("quota", { status: 429 }))
      .mockResolvedValueOnce(new Response("down", { status: 503 }))
      .mockResolvedValueOnce(ok());
    const res = await aiFetch(init({ model: "google/gemini-2.5-pro", messages: [] }));
    expect(res.ok).toBe(true);
    expect([call(0).body.model, call(1).body.model]).toEqual(["gemini-2.5-pro", "gemini-2.5-flash"]);
    expect(call(2).url).toBe(LOVABLE);
    expect(call(2).body.model).toBe("google/gemini-2.5-pro");
  });

  it("retries a forced function call as 'required' if Gemini rejects it", async () => {
    env.GEMINI_API_KEY = "g-key";
    fetchMock.mockResolvedValueOnce(new Response("bad tool_choice", { status: 400 })).mockResolvedValueOnce(ok());
    await aiFetch(init({
      model: "google/gemini-2.5-flash", messages: [], tools: [],
      tool_choice: { type: "function", function: { name: "x" } },
    }));
    expect(call(1).url).toBe(GEMINI);
    expect(call(1).body.tool_choice).toBe("required");
  });

  it("does not retry on auth errors and keeps image generation on Lovable", async () => {
    env.GEMINI_API_KEY = "bad";
    fetchMock.mockResolvedValueOnce(new Response("no", { status: 401 })).mockResolvedValue(ok());
    await aiFetch(init({ model: "google/gemini-2.5-pro", messages: [] }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(call(1).url).toBe(LOVABLE);

    fetchMock.mockClear();
    await aiFetch(init({ model: "google/gemini-2.5-flash-image", messages: [], modalities: ["image", "text"] }));
    expect(call(0).url).toBe(LOVABLE);
  });
});
