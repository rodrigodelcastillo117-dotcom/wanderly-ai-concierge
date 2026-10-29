// R2 viajes P1-3: Comparar se quedaba en «Comparando...» para siempre (ai-tool no respondió en más de 90 s
// en 2 de 3 intentos, sin error ni forma de cancelar). Ahora: tope de 45 s con aviso y «Reintentar», botón
// «Cancelar» mientras espera, y tope del lado del servidor en ai-tool (504 code "timeout").
import React from "react";
import { readFileSync } from "node:fs";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { vi, it, expect, describe, beforeEach, afterEach } from "vitest";

const calls: { signal?: AbortSignal }[] = [];
let mode: "hang" | "ok" | "server-timeout" = "hang";
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: {
      invoke: (_fn: string, opts: { signal?: AbortSignal }) => {
        calls.push(opts);
        if (mode === "ok") return Promise.resolve({ data: { ok: true, data: [
          { destino: "Madrid", costo_diario_usd: "$100-150", mejor_epoca: "Primavera", visa_mx: "No", seguridad: "Alta", idioma: "Español", highlights: "Museos" },
          { destino: "Lisboa", costo_diario_usd: "$80-120", mejor_epoca: "Primavera", visa_mx: "No", seguridad: "Alta", idioma: "Portugués", highlights: "Tranvías" },
        ] }, error: null });
        if (mode === "server-timeout") return Promise.resolve({ data: null, error: { context: { json: async () => ({ ok: false, code: "timeout" }) } } });
        return new Promise(() => {}); // ai-tool colgado (no respeta la señal)
      },
    },
  },
}));
vi.mock("@/components/DashboardLayout", () => ({ DashboardLayout: ({ children }: any) => <div>{children}</div> }));
vi.mock("@/lib/fx", async (orig) => { const m: any = await orig(); return { ...m, fetchFxTable: async () => m.FX_FALLBACK_TABLE }; });
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("@/components/media/SmartImage", () => ({ SmartImage: ({ children }: any) => <div>{children}</div> }));

import Compare, { COMPARE_TIMEOUT_MS } from "@/pages/Compare";

const start = () => {
  render(<MemoryRouter><Compare /></MemoryRouter>);
  fireEvent.change(screen.getByLabelText("Destino 1"), { target: { value: "Madrid" } });
  fireEvent.change(screen.getByLabelText("Destino 2"), { target: { value: "Lisboa" } });
  fireEvent.click(screen.getByRole("button", { name: /Comparar/ }));
};

describe("P1-3 · Comparar no se queda colgado", () => {
  beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); calls.length = 0; mode = "hang"; });
  afterEach(() => { vi.useRealTimers(); });

  it("a los 45 s se detiene con aviso y «Reintentar» (y la petición se aborta)", async () => {
    expect(COMPARE_TIMEOUT_MS).toBe(45_000);
    start();
    expect(screen.getByRole("button", { name: /Comparando/ })).toBeDisabled();
    await act(async () => { vi.advanceTimersByTime(COMPARE_TIMEOUT_MS + 10); });
    expect(await screen.findByTestId("comparar-detenida")).toHaveTextContent("tardó más de 45 segundos");
    expect(calls[0].signal?.aborted).toBe(true);
    expect(screen.getByRole("button", { name: /^Comparar$/ })).toBeEnabled();
    mode = "ok";
    fireEvent.click(screen.getByRole("button", { name: /Reintentar/ }));
    expect((await screen.findAllByText("Lisboa")).length).toBeGreaterThan(0);
    expect(screen.queryByTestId("comparar-detenida")).toBeNull();
  });

  it("«Cancelar» mientras espera", async () => {
    start();
    fireEvent.click(screen.getByTestId("comparar-cancelar"));
    expect(await screen.findByTestId("comparar-detenida")).toHaveTextContent("Cancelaste la comparación.");
    expect(screen.getByRole("button", { name: /^Comparar$/ })).toBeEnabled();
  });

  it("si el servidor corta (504 timeout), el mismo aviso", async () => {
    mode = "server-timeout";
    start();
    expect(await screen.findByTestId("comparar-detenida")).toHaveTextContent("tardó más de 45 segundos");
  });
});

it("ai-tool tiene tope propio: AbortSignal.timeout y 504 con code timeout", () => {
  const src = readFileSync("supabase/functions/ai-tool/index.ts", "utf8");
  expect(src).toMatch(/AI_TOOL_TIMEOUT_MS = 40_000/);
  expect(src).toMatch(/signal: AbortSignal\.timeout\(AI_TOOL_TIMEOUT_MS\)/);
  expect(src).toMatch(/code: "timeout"[\s\S]*status: 504/);
});
