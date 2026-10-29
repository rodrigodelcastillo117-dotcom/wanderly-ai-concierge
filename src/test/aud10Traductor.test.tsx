// Auditoría 10/10 (P1-7, 28-oct-2026) · Traductor: el aviso decía «Traductor offline para tu destino» pero
// cada frase se pedía a la IA y solo vivía en memoria. Ahora lo traducido se guarda en el dispositivo y se
// ve sin conexión, y el texto dice exactamente eso.
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { loadPhrases, normalizePhrases, savePhrases } from "@/lib/translatorStore";

const TRIP = "88888888-8888-4888-8888-888888888888";
const h = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => {
  const api: any = { select: () => api, eq: () => api, maybeSingle: async () => ({ data: { id: "88888888-8888-4888-8888-888888888888", destino: "Tokio", pais_destino: "Japón", itinerario_json: [] }, error: null }) };
  return { supabase: { from: () => api, functions: { invoke: h.invoke } } };
});
vi.mock("@/components/DashboardLayout", () => ({ DashboardLayout: ({ children }: any) => <>{children}</> }));
vi.mock("@/components/Tooltip", () => ({ FeatureTooltip: ({ text }: { text: string }) => <p data-testid="tip">{text}</p> }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/hooks/useTooltipShown", () => ({ useTooltipShown: () => ({ shouldShow: true, dismiss: () => {} }) }));

import TripTranslator from "@/pages/TripTranslator";

const PHRASE = { es: "Gracias", destino: "Tokio", idioma: "Japonés", bcp47: "ja-JP", local: "ありがとう", phon: "arigató" };
const page = () => render(
  <MemoryRouter initialEntries={[`/dashboard/viajes/${TRIP}/traductor`]}>
    <Routes><Route path="/dashboard/viajes/:id/traductor" element={<TripTranslator />} /></Routes>
  </MemoryRouter>,
);

describe("frases guardadas en el dispositivo", () => {
  beforeEach(() => { localStorage.clear(); h.invoke.mockReset(); });

  it("guarda, lee y limpia lo guardado (sin duplicados ni basura)", () => {
    expect(savePhrases(TRIP, [PHRASE, PHRASE, { es: "", local: "x" } as any])).toBe(true);
    expect(loadPhrases(TRIP)).toEqual([PHRASE]);
    expect(normalizePhrases("nada")).toEqual([]);
    expect(loadPhrases(undefined)).toEqual([]);
  });

  it("lo traducido queda guardado y vuelve a verse sin pedirlo otra vez (sin conexión)", async () => {
    h.invoke.mockResolvedValue({ data: { ok: true, data: [PHRASE] }, error: null });
    const first = page();
    expect((await screen.findByTestId("tip")).textContent).not.toMatch(/offline/i);
    fireEvent.click(await screen.findByRole("button", { name: /Frases esenciales/ }));
    expect(await screen.findByText("ありがとう")).toBeInTheDocument();
    await waitFor(() => expect(loadPhrases(TRIP)).toEqual([PHRASE]));
    expect(screen.getByTestId("traductor-guardado").textContent).toMatch(/1 frase guardada en este dispositivo: las puedes ver sin conexión/);
    first.unmount();

    h.invoke.mockReset();
    page();
    expect(await screen.findByText("ありがとう")).toBeInTheDocument();
    expect(h.invoke).not.toHaveBeenCalled();
  });

  it("si la IA falla, el mensaje es claro y en español", async () => {
    const { toast } = await import("sonner");
    h.invoke.mockResolvedValue({ data: null, error: { message: "Edge Function returned a non-2xx status code" } });
    page();
    fireEvent.click(await screen.findByRole("button", { name: /Frases esenciales/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("No pudimos traducir ahora. Revisa tu conexión e intenta de nuevo."));
  });
});
