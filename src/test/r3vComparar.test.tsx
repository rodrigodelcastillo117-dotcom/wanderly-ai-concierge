// R3 viajes P1-4 y P2-12: Comparar daba 504 a los 40 s en 2 de 4 intentos (ai-tool con
// "gemini-flash-latest", que razona antes de responder, sin tope de tokens y con un prompt largo), y la
// etiqueta «Highlights» estaba en inglés. Ahora: tarea "compare" con modelo ligero sin razonamiento,
// respuesta corta, tope de 20 s en el servidor, caché por combinación de destinos y «Lo imperdible».
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { vi, it, expect, describe, beforeEach, afterEach } from "vitest";
import { AI_TASKS, AI_TOOL_TIMEOUT_MS, comparePrompt, planAiCall, TtlCache } from "../../supabase/functions/ai-tool/tasks";
import { aiFetchDetailed } from "../../supabase/functions/_shared/ai";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: (...a: any[]) => invoke(...a) } } }));
vi.mock("@/components/DashboardLayout", () => ({ DashboardLayout: ({ children }: any) => <div>{children}</div> }));
vi.mock("@/lib/fx", async (orig) => { const m: any = await orig(); return { ...m, fetchFxTable: async () => m.FX_FALLBACK_TABLE }; });
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("@/components/media/SmartImage", () => ({ SmartImage: ({ children }: any) => <div>{children}</div> }));

import Compare, { COMPARE_TIMEOUT_MS } from "@/pages/Compare";

describe("P1-4 · ai-tool: la tarea «compare» responde rápido", () => {
  it("modelo ligero, sin razonamiento, pocos tokens y tope de 20 s (menos de 25)", () => {
    const p = planAiCall({ task: "compare", json: true, prompt: comparePrompt(["Madrid", "Lisboa"]), model: "google/gemini-2.5-pro" });
    expect(p.model).toBe("google/gemini-flash-lite-latest"); // el cliente no puede subir el modelo
    expect(p.reasoningEffort).toBe("none");
    expect(p.maxTokens).toBeLessThanOrEqual(1500);
    expect(p.timeoutMs).toBeLessThan(25_000);
    expect(COMPARE_TIMEOUT_MS).toBeLessThanOrEqual(30_000);
    expect(COMPARE_TIMEOUT_MS).toBeGreaterThan(AI_TASKS.compare.timeoutMs);
    // Sin tarea, lo genérico de siempre (traductor, bóveda).
    expect(planAiCall({ prompt: "hola" })).toMatchObject({ model: "google/gemini-flash-latest", maxTokens: null, timeoutMs: AI_TOOL_TIMEOUT_MS, cacheKey: null });
  });

  it("el prompt es corto y pide valores breves", () => {
    const pr = comparePrompt(["Madrid", "Lisboa", "Roma", "Praga"]);
    expect(pr.length).toBeLessThan(400);
    expect(pr).toMatch(/breves/);
    expect(pr).toMatch(/Madrid vs Lisboa vs Roma vs Praga/);
  });

  it("caché por combinación de destinos (mayúsculas y espacios no importan) y con vencimiento", () => {
    const a = planAiCall({ task: "compare", json: true, prompt: comparePrompt(["Madrid", "Lisboa"]) });
    const b = planAiCall({ task: "compare", json: true, prompt: comparePrompt(["madrid", " Lisboa"]).replace("Lisboa", "lisboa") });
    expect(a.cacheKey).toBeTruthy();
    expect(a.cacheKey).toBe(b.cacheKey);
    expect(planAiCall({ task: "compare", json: true, prompt: comparePrompt(["Madrid", "Roma"]) }).cacheKey).not.toBe(a.cacheKey);
    const c = new TtlCache<number>(2);
    c.set("k", 1, 1000, 0);
    expect(c.get("k", 500)).toBe(1);
    expect(c.get("k", 1500)).toBeUndefined();
    c.set("a", 1, 1000, 0); c.set("b", 2, 1000, 0); c.set("c", 3, 1000, 0);
    expect(c.get("a", 1)).toBeUndefined(); // tamaño acotado
  });
});

describe("P1-4 · cliente de IA: reasoning_effort sin romper nada", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; delete (globalThis as any).Deno; });

  it("si Gemini no acepta reasoning_effort (400), reintenta el mismo modelo sin él", async () => {
    (globalThis as any).Deno = { env: { get: (k: string) => (k === "GEMINI_API_KEY" ? "k" : undefined) } };
    const bodies: any[] = [];
    globalThis.fetch = vi.fn(async (_u: any, init: any) => {
      bodies.push(JSON.parse(init.body));
      return bodies.length === 1 ? new Response("bad", { status: 400 }) : new Response(JSON.stringify({ choices: [] }), { status: 200 });
    }) as any;
    const r = await aiFetchDetailed({ method: "POST", body: JSON.stringify({ model: "google/gemini-flash-lite-latest", reasoning_effort: "none", messages: [] }) });
    expect(r.provider).toBe("gemini");
    expect(bodies[0]).toMatchObject({ model: "gemini-flash-lite-latest", reasoning_effort: "none" });
    expect(bodies[1].model).toBe("gemini-flash-lite-latest");
    expect(bodies[1]).not.toHaveProperty("reasoning_effort");
  });

  it("el respaldo de Lovable recibe el nombre que publica y sin reasoning_effort", async () => {
    (globalThis as any).Deno = { env: { get: () => undefined } };
    let sent: any = null;
    globalThis.fetch = vi.fn(async (_u: any, init: any) => { sent = JSON.parse(init.body); return new Response("{}", { status: 200 }); }) as any;
    await aiFetchDetailed({ method: "POST", body: JSON.stringify({ model: "google/gemini-flash-lite-latest", reasoning_effort: "none", max_tokens: 1200, messages: [] }) });
    expect(sent).toMatchObject({ model: "google/gemini-2.5-flash-lite", max_tokens: 1200 });
    expect(sent).not.toHaveProperty("reasoning_effort");
  });
});

describe("Comparar en pantalla", () => {
  const ROWS = [
    { destino: "Madrid", costo_diario_usd: "$100-150", mejor_epoca: "Primavera", visa_mx: "No", seguridad: "Alta", idioma: "Español", highlights: "Prado, Retiro, tapas" },
    { destino: "Lisboa", costo_diario_usd: "$80-120", mejor_epoca: "Primavera", visa_mx: "No", seguridad: "Alta", idioma: "Portugués", highlights: "Tranvía 28, Belém" },
  ];
  beforeEach(() => { invoke.mockReset(); invoke.mockResolvedValue({ data: { ok: true, data: ROWS }, error: null }); localStorage.clear(); });
  const compare = () => {
    fireEvent.change(screen.getByLabelText("Destino 1"), { target: { value: "Madrid" } });
    fireEvent.change(screen.getByLabelText("Destino 2"), { target: { value: "Lisboa" } });
    fireEvent.click(screen.getByRole("button", { name: /^Comparar$/ }));
  };

  it("pide la tarea «compare» y la etiqueta dice «Lo imperdible» (no «Highlights»)", async () => {
    render(<MemoryRouter><Compare /></MemoryRouter>);
    compare();
    expect((await screen.findAllByText("Lo imperdible")).length).toBeGreaterThan(0);
    expect(screen.queryByText("Highlights")).toBeNull();
    expect(invoke).toHaveBeenCalledWith("ai-tool", expect.objectContaining({ body: expect.objectContaining({ task: "compare", json: true }) }));
  });

  it("la misma combinación se muestra al instante, sin volver a llamar a la IA", async () => {
    const first = render(<MemoryRouter><Compare /></MemoryRouter>);
    compare();
    await screen.findAllByText("Tranvía 28, Belém");
    first.unmount();
    render(<MemoryRouter><Compare /></MemoryRouter>);
    compare();
    expect((await screen.findAllByText("Tranvía 28, Belém")).length).toBeGreaterThan(0);
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
