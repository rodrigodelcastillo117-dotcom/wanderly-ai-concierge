// R2 viajes P1-1: Inicio «Tus gastos» decía «Este mes $112.50 USD · Restaurantes 80% · Transporte local 20%»
// y Gastos › Resumen «Este mes $2,668 MXN · Restaurantes 84% · Transporte 16%». Inicio convertía a USD y
// no contaba «tu parte» de lo compartido. Ahora las dos pantallas usan la misma carga y el mismo cálculo.
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { vi, it, expect, beforeEach, describe } from "vitest";
import { __resetActiveTripColumn } from "@/lib/profileActiveTrip";
import { localISODate } from "@/lib/localDate";

const today = localISODate();
const db = {
  expenses: [
    { id: "e1", user_id: "u1", amount: 90, currency: "USD", category: "Restaurantes", description: "Cena", expense_date: today, receipt_url: null, trip_id: null },
    { id: "e2", user_id: "u1", amount: 22.5, currency: "USD", category: "Transporte local", description: "Taxi", expense_date: today, receipt_url: null, trip_id: null },
  ] as any[],
  shares: [
    { share_id: "s1", expense_id: "x1", trip_id: "t1", amount: 420, currency: "MXN", category: "Restaurantes", description: "Tacos",
      expense_date: today, city: null, total: 840, payer_name: "Sofía", paid_by_me: false },
  ] as any[],
};

vi.mock("@/integrations/supabase/client", () => {
  const from = (table: string) => {
    const api: any = {
      select: () => api, eq: () => api, gte: () => api, order: () => api, limit: () => api, in: () => api, update: () => api,
      maybeSingle: async () => ({ data: table === "profiles" ? { full_name: "Ana Pérez" } : null, error: null }),
      then: (res: any, rej: any) => Promise.resolve({ data: table === "expenses" ? db.expenses : [], error: null }).then(res, rej),
    };
    return api;
  };
  const rpc = async (fn: string) => ({ data: fn === "my_split_shares" ? db.shares : [], error: null });
  return { supabase: { from, rpc, functions: { invoke: vi.fn(async () => ({ data: null })) } } };
});
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" }, loading: false }) }));
vi.mock("@/components/DashboardLayout", () => ({ DashboardLayout: ({ children }: any) => <>{children}</> }));
vi.mock("@/components/DestinationVideo", () => ({ DestinationVideo: () => null }));
vi.mock("@/components/VoiceInput", () => ({ VoiceInput: () => null }));
vi.mock("@/components/TripFileUpload", () => ({ TripFileUpload: () => null }));
vi.mock("@/hooks/useAIRecommendations", () => ({ useAIRecommendations: () => ({ recos: [], loading: false }) }));
vi.mock("@/lib/fx", async () => {
  const actual: any = await vi.importActual("@/lib/fx");
  return { ...actual, fetchFxTable: async () => actual.FX_FALLBACK_TABLE };
});
vi.mock("@/lib/weatherNow", async () => {
  const actual: any = await vi.importActual("@/lib/weatherNow");
  return { ...actual, fetchWeatherNow: async () => null };
});

import DashboardHome from "@/pages/DashboardHome";
import SmartSpendPanel from "@/components/SmartSpendPanel";
import { convert, FX_FALLBACK_TABLE } from "@/lib/fx";
import { homeSpendCard, mergeMySpend, sharedPartToItem } from "@/lib/mySpend";

beforeEach(() => { __resetActiveTripColumn(); localStorage.clear(); });
(globalThis as any).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };

const expectedMxn = () => Math.round(
  convert(90, "USD", "MXN", FX_FALLBACK_TABLE)! + convert(22.5, "USD", "MXN", FX_FALLBACK_TABLE)! + 420,
);
const fmt = (n: number) => `$${n.toLocaleString("es-MX")} MXN`;

describe("P1-1 · Tus gastos (Inicio) = Gastos › Resumen", () => {
  it("homeSpendCard: en pesos y con mi parte de lo compartido", () => {
    const items = mergeMySpend(db.expenses, db.shares.map(sharedPartToItem));
    const card = homeSpendCard(items, FX_FALLBACK_TABLE);
    expect(Math.round(card.thisMonth)).toBe(expectedMxn());
    const rest = card.cats.find((c) => c.label === "Restaurantes")!;
    const restMxn = convert(90, "USD", "MXN", FX_FALLBACK_TABLE)! + 420;
    expect(rest.pct).toBe(Math.round((restMxn / (expectedMxn())) * 100));
  });

  it("Inicio muestra la misma cifra en MXN y los mismos % que el Resumen de Gastos", async () => {
    render(<MemoryRouter initialEntries={["/dashboard"]}><Routes><Route path="/dashboard" element={<DashboardHome />} /></Routes></MemoryRouter>);
    const home = await screen.findByText((_, el) => el?.tagName === "P" && el.textContent === fmt(expectedMxn()), {}, { timeout: 5000 });
    expect(home).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/USD/);
    const homeText = document.body.textContent!;
    const homeRest = homeText.match(/Restaurantes(\d+)%/)?.[1];

    const items = mergeMySpend(db.expenses, db.shares.map(sharedPartToItem));
    const { container } = render(<SmartSpendPanel items={items} trips={[]} />);
    await waitFor(() => expect(container.textContent).toContain("Este mes"));
    expect(container.textContent).toContain(`$${expectedMxn().toLocaleString("es-MX")} MXN`);
    const panelRest = container.textContent!.match(/Restaurantes\$[\d,]+ MXN · (\d+)%/)?.[1];
    expect(homeRest).toBeDefined();
    expect(homeRest).toBe(panelRest);
  });
});
