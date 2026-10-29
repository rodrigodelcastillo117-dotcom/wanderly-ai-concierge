// Ronda 4 de cuenta y técnica (29-oct-2026): P2-4 (Favoritos de Madrid sin foto) y P2-7 (respaldo de
// lugares visitados cuando ai_user_preferences.visit_count vale 0). Fallan con el código anterior.
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, renderHook } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const rows = vi.hoisted(() => ({
  recomendaciones: [{ id: "f1", titulo: "Madrid", descripcion: null, tipo: "destination_ai", imagen_url: null, match_score: null }] as any[],
  ai_user_preferences: { perfil_ia: null, dna_signal: null, visit_count: 0, nivel_presupuesto: null, actividades_tarde: null } as any,
  user_visits: [{ category: "museo" }, { category: "restaurante" }, { category: "parque" }] as any[],
  trips: [] as any[],
}));
vi.mock("@/integrations/supabase/client", () => {
  const chain = (table: string) => {
    const many = { data: (rows as any)[table] ?? [], error: null };
    const api: any = {
      select: () => api, eq: () => api, order: () => api, limit: () => api, update: () => api,
      maybeSingle: async () => ({ data: (rows as any)[table] ?? null, error: null }),
      then: (r: any, j: any) => Promise.resolve(many).then(r, j),
    };
    return api;
  };
  return { supabase: { from: (t: string) => chain(t), functions: { invoke: vi.fn() } } };
});
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));
vi.mock("@/components/DashboardLayout", () => ({ DashboardLayout: ({ children }: any) => <div>{children}</div> }));
vi.mock("@/lib/insights", () => ({ logInsight: async () => {} }));
vi.mock("@/hooks/useInView", () => ({ useInView: () => true }));
const asked = vi.hoisted(() => [] as string[]);
vi.mock("@/lib/stockPhoto", () => ({
  isSafeStockUrl: () => false,
  cachedStockPhoto: () => undefined,
  // Como en producción: "madrid travel" devuelve "sin foto" (image null en la caché compartida).
  getStockPhoto: async (q: string) => {
    asked.push(q);
    return q === "Madrid travel" ? null : { image: `https://images.pexels.com/${encodeURIComponent(q)}.jpg`, photographer: "Ana", page_url: null };
  },
}));

import Favoritos from "@/pages/Favoritos";
import { useTravelDNA } from "@/components/lux/TravelDNAStats";

describe("P2-4 · Favoritos: Madrid tiene foto aunque la primera búsqueda no traiga nada", () => {
  it("usa la consulta de respaldo (el lugar emblemático) y la marca como ilustrativa", async () => {
    render(<MemoryRouter><Favoritos /></MemoryRouter>);
    await waitFor(() => expect(screen.getByRole("img", { name: "Madrid" })).toBeInTheDocument());
    expect(screen.getByRole("img", { name: "Madrid" }).getAttribute("src")).toContain("Madrid%20Cibeles");
    expect([...new Set(asked)]).toEqual(["Madrid travel", "Madrid Cibeles"]);
  });
});

describe("P2-7 · useTravelDNA: visit_count = 0 no esconde los lugares visitados reales", () => {
  it("con la columna en 0 y 3 visitas registradas, visitCount = 3", async () => {
    const { result } = renderHook(() => useTravelDNA());
    await waitFor(() => expect(result.current.dna).not.toBeNull());
    expect(result.current.dna!.visitCount).toBe(3);
    expect(result.current.dna!.lugares).toBe(3);
  });
});
