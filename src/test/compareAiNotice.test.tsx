import React from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { vi, it, expect } from "vitest";

// E-27: visa, seguridad y costos del comparador vienen de la IA y no deben verse como verificados.
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: {
      invoke: async () => ({
        data: {
          ok: true,
          data: [
            { destino: "Tokio", costo_diario_usd: "$120-200", mejor_epoca: "Primavera", visa_mx: "No, 180 días", seguridad: "Alta", idioma: "Japonés", highlights: "Templos" },
            { destino: "Lima", costo_diario_usd: "$50-90", mejor_epoca: "Dic-abr", visa_mx: "No", seguridad: "Media", idioma: "Español", highlights: "Comida" },
          ],
        },
        error: null,
      }),
    },
  },
}));
vi.mock("@/components/DashboardLayout", () => ({ DashboardLayout: ({ children }: any) => <div>{children}</div> }));
// El costo diario se pasa a MXN con el tipo de cambio de la app (auditoría 28-oct-2026): sin red, la tabla de respaldo.
vi.mock("@/lib/fx", async (orig) => { const m: any = await orig(); return { ...m, fetchFxTable: async () => m.FX_FALLBACK_TABLE }; });
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("framer-motion", () => {
  const cache: Record<string, any> = {};
  const strip = (p: any) => { const { initial, animate, exit, transition, whileHover, whileTap, layout, ...r } = p; return r; };
  const motion = new Proxy({}, { get: (_t, tag: string) => (cache[tag] ??= (p: any) => React.createElement(tag, strip(p))) });
  return { motion };
});

import Compare from "@/pages/Compare";
import { SRE_GUIA_VIAJERO_URL } from "@/components/AiDataNotice";

it("el resultado dice 'generada por IA, no verificada', marca costo/visa/seguridad y enlaza a la SRE", async () => {
  render(<MemoryRouter><Compare /></MemoryRouter>);
  fireEvent.change(screen.getByLabelText("Destino 1"), { target: { value: "Tokio" } });
  fireEvent.change(screen.getByLabelText("Destino 2"), { target: { value: "Lima" } });
  fireEvent.click(screen.getByRole("button", { name: /Comparar/ }));

  const note = await screen.findByRole("note");
  expect(note).toHaveTextContent("Información generada por IA, no verificada");
  // 3 campos IA × 2 destinos × 2 vistas (móvil y escritorio).
  expect(screen.getAllByText("Estimado por IA")).toHaveLength(12);
  const links = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
  expect(links.every((h) => h === SRE_GUIA_VIAJERO_URL)).toBe(true);
  expect(within(note).getByRole("link")).toHaveAttribute("rel", "noopener noreferrer");
  expect(document.body.textContent).not.toMatch(/verificado en vivo|dato verificado/i);
  // Costos en MXN (la app habla en pesos), con la cifra de la IA en USD como referencia.
  expect(screen.getAllByText("Costo diario (MXN)").length).toBeGreaterThan(0);
  expect(screen.getAllByText(/MXN por día/).length).toBeGreaterThan(0);
  expect(screen.getAllByTestId("comparar-costo-nota")[0]).toHaveTextContent(/De USD 120–200/);
});
