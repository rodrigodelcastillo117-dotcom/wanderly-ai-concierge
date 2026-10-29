// Auditoría 10/10 (herramientas, 28-oct-2026) · Gastos y Ahorro:
//  P1-3  el recibo se guardaba pero no había forma de verlo (ahora: enlace firmado, como «Ver ticket»).
//  P2-8  selectores con fecha, nombre corto del viaje, "$934 MXN" con espacio, equivalente en pesos de
//        cada gasto y edición de un gasto.
//  P2-9  "$50,996 al mes durante 3 meses" y "≈ $10,199 por semana" no cuadraban.
import React from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { FxTable } from "@/lib/fx";
import { computeGoal } from "@/lib/savingsGoal";

const LIVE: FxTable = { rates: { USD: 1, MXN: 18.68, EUR: 0.9 }, source: "open.er-api.com", asOf: "2026-10-27T00:00:00Z", isFallback: false, kind: "live" };

const db = vi.hoisted(() => ({ inserts: [] as { table: string; row: any }[], updates: [] as { table: string; row: any; id?: string }[], signed: [] as { bucket: string; path: string; ttl: number }[], tables: {} as Record<string, any[]> }));
vi.mock("@/integrations/supabase/client", () => {
  const from = (table: string) => {
    let write = false;
    let upd: { table: string; row: any; id?: string } | null = null;
    const api: any = {
      select: () => api, in: () => api, is: () => api, gte: () => api, order: () => api, limit: () => api,
      eq: (c: string, v: any) => { if (upd && c === "id") upd.id = v; return api; },
      insert: (row: any) => { db.inserts.push({ table, row }); write = true; return api; },
      update: (row: any) => { upd = { table, row }; db.updates.push(upd); write = true; return api; },
      delete: () => { write = true; return api; },
      maybeSingle: async () => ({ data: (db.tables[table] ?? [])[0] ?? null, error: null }),
      single: async () => ({ data: (db.tables[table] ?? [])[0] ?? null, error: null }),
      then: (res: any, rej: any) => Promise.resolve(write ? { data: null, error: null } : { data: db.tables[table] ?? [], error: null }).then(res, rej),
    };
    return api;
  };
  return {
    supabase: {
      from,
      rpc: async () => ({ data: [], error: null }),
      auth: { getSession: async () => ({ data: { session: { user: { id: "u1" } } } }) },
      functions: { invoke: vi.fn(async () => ({ data: {}, error: null })) },
      storage: { from: (bucket: string) => ({
        upload: async () => ({ error: null }),
        createSignedUrl: async (path: string, ttl: number) => { db.signed.push({ bucket, path, ttl }); return { data: { signedUrl: `https://firmado.example/${path}` }, error: null }; },
      }) },
    },
  };
});
// Mismo objeto en cada render (useEffect([user]) recargaría sin fin con uno nuevo).
const authUser = vi.hoisted(() => ({ id: "u1", email: "u1@example.test", user_metadata: {} }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: authUser, loading: false }) }));
vi.mock("@/components/DashboardLayout", () => ({ DashboardLayout: ({ children }: any) => <>{children}</> }));
vi.mock("@/components/SmartSpendPanel", () => ({ default: () => null }));
vi.mock("@/components/TripSavingsCalculator", () => ({ TripSavingsCalculator: () => null }));
vi.mock("@/hooks/useFxTable", () => ({ useFxTable: () => LIVE }));
vi.mock("@/lib/insights", () => ({ logInsight: vi.fn(async () => {}) }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));

import Gastos from "@/pages/Gastos";

const VB = "55555555-5555-4555-8555-555555555555";
const ES = "66666666-6666-4666-8666-666666666666";
const PROMPT = "Quiero conocer España 15 días, no sé qué ciudades. Del 4 al 19 de mayo";
const root = join(__dirname, "..", "..");

describe("Gastos: recibo, pesos, edición y nombres de viaje", () => {
  beforeEach(() => {
    db.inserts.length = 0; db.updates.length = 0; db.signed.length = 0;
    db.tables = {
      trips: [
        { id: VB, user_id: "u1", destino: "Valle de Bravo", pais_destino: "México", fecha_salida: "2099-11-20", fecha_regreso: "2099-11-23", created_at: "2026-01-01" },
        { id: ES, user_id: "u1", destino: PROMPT, pais_destino: "España", fecha_salida: "2099-05-04", fecha_regreso: "2099-05-19", created_at: "2026-01-02" },
      ],
      profiles: [{ id: "u1", active_trip_id: VB }],
      expenses: [{ id: "e1", amount: 50, currency: "USD", category: "Restaurantes", description: "Cena en dólares", expense_date: "2026-10-28", receipt_url: "u1/1793225170886-recibo_prueba.png", trip_id: VB }],
      trip_collaborators: [],
    };
    window.open = vi.fn() as any;
  });

  it("«Ver recibo» abre el recibo con un enlace firmado del bucket privado", async () => {
    render(<MemoryRouter><Gastos /></MemoryRouter>);
    fireEvent.click(await screen.findByRole("button", { name: "Ver recibo de Cena en dólares" }));
    await waitFor(() => expect(window.open).toHaveBeenCalledWith("https://firmado.example/u1/1793225170886-recibo_prueba.png", "_blank", "noopener,noreferrer"));
    expect(db.signed[0]).toMatchObject({ bucket: "recibos", path: "u1/1793225170886-recibo_prueba.png", ttl: 300 });
  });

  it("muestra el equivalente en pesos de cada gasto en otra moneda", async () => {
    render(<MemoryRouter><Gastos /></MemoryRouter>);
    expect((await screen.findByTestId("gasto-mxn")).textContent).toBe("≈ $934 MXN");
  });

  it("los selectores de viaje llevan nombre corto y fechas (nunca la frase completa)", async () => {
    render(<MemoryRouter><Gastos /></MemoryRouter>);
    fireEvent.click(await screen.findByRole("button", { name: /Nuevo gasto/ }));
    const options = Array.from((screen.getByLabelText("Viaje") as HTMLSelectElement).options).map((o) => o.textContent ?? "");
    expect(options.some((o) => o.startsWith("España ("))).toBe(true);
    expect(options.join(" | ")).not.toMatch(/Quiero conocer/);
    expect(options.some((o) => /^Valle de Bravo \(.+\)$/.test(o))).toBe(true);
  });

  it("un gasto se puede corregir", async () => {
    render(<MemoryRouter><Gastos /></MemoryRouter>);
    fireEvent.click(await screen.findByRole("button", { name: "Editar gasto Cena en dólares" }));
    const monto = screen.getByLabelText("Monto") as HTMLInputElement;
    expect(monto.value).toBe("50");
    fireEvent.change(monto, { target: { value: "55" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() => expect(db.updates.find((u) => u.table === "expenses")).toBeTruthy());
    const u = db.updates.find((x) => x.table === "expenses")!;
    expect(u.id).toBe("e1");
    expect(u.row).toMatchObject({ amount: 55, currency: "USD", receipt_url: "u1/1793225170886-recibo_prueba.png", trip_id: VB });
    expect(db.inserts.filter((i) => i.table === "expenses")).toHaveLength(0);
  });
});

describe("Resumen: cifra y moneda separadas", () => {
  it("«$934 MXN» con espacio real, no «$934MXN»", () => {
    const src = readFileSync(join(root, "src/components/SmartSpendPanel.tsx"), "utf8");
    expect(src).toMatch(/toLocaleString\("es-MX"\)\}\\u00A0`\}<span/);
  });
});

describe("P2-9 ahorro semanal coherente con el mensual", () => {
  it("el semanal reparte lo mismo que el mensual, en las mismas semanas", () => {
    const now = new Date(2026, 9, 28, 12);
    const g = computeGoal({ costMxn: 152_988, savedMxn: 0, dateISO: "2027-02-10", now });
    expect(g.mesesAhorro).toBe(3);
    expect(g.mensual).toBeCloseTo(50_996, 0);
    // 3 meses = 13 semanas: 50,996 × 12 / 52 = 11,768 (antes dividía entre 15 semanas: 10,199).
    expect(g.semanal).toBeCloseTo((152_988 / 3) * 12 / 52, 6);
    expect(g.semanal * (g.mesesAhorro * 52 / 12)).toBeCloseTo(g.faltante, 6);
  });
});
