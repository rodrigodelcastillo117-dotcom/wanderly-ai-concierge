import React from "react";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { vi, it, expect, beforeEach, afterEach, describe } from "vitest";

// E-24: un segundo toque mientras se guarda no debe crear un registro duplicado. Gastos del viaje
// (TripSplit) guarda lo compartido con la RPC trip_split_save_expense y lo personal en expenses.
const calls = vi.hoisted(() => ({
  inserts: [] as { table: string; row: any }[],
  rpcs: [] as { fn: string; args: any }[],
  deletes: [] as string[],
  deleteError: null as any,
}));
let release: () => void = () => {};

vi.mock("@/integrations/supabase/client", () => {
  const rows: Record<string, any[]> = {
    trips: [{ id: "t1", user_id: "u1", destino: "Roma" }],
    trip_split_people: [
      { id: "p0", name: "Yo Mismo", trip_id: "t1", member_id: "u1" },
      { id: "p1", name: "Ana", trip_id: "t1", member_id: null },
      { id: "p2", name: "Luis", trip_id: "t1", member_id: null },
    ],
    trip_split_expenses: [{ id: "e1", payer_id: "p1", amount: 100, currency: "MXN", description: "Cena", trip_id: "t1", created_at: "2026-10-01" }],
    trip_split_shares: [],
    trip_split_payments: [],
    expenses: [],
  };
  const from = (table: string) => {
    let pendingInsert: any = null; let isDelete = false; let delId = "";
    const api: any = {
      select: () => api, order: () => api, eq: (_k: string, v: string) => { if (isDelete) delId = v; return api; },
      maybeSingle: async () => ({ data: rows[table][0] ?? null, error: null }),
      insert: (row: any) => { pendingInsert = row; calls.inserts.push({ table, row }); return api; },
      delete: () => { isDelete = true; return api; },
      single: () => new Promise((res) => {
        release = () => { rows[table].push({ id: `n${calls.inserts.length}`, ...pendingInsert }); res({ data: { id: `n${calls.inserts.length}`, ...pendingInsert }, error: null }); };
      }),
      then: (ok: any, ko: any) => {
        if (isDelete) { calls.deletes.push(delId); return Promise.resolve({ error: calls.deleteError }).then(ok, ko); }
        return Promise.resolve({ data: rows[table], error: null }).then(ok, ko);
      },
    };
    return api;
  };
  const rpc = (fn: string, args: any) => {
    calls.rpcs.push({ fn, args });
    if (fn === "trip_split_members") return Promise.resolve({ data: [{ user_id: "u1", name: "Yo Mismo", avatar_url: null, is_owner: true }], error: null });
    if (fn !== "trip_split_save_expense") return Promise.resolve({ data: 0, error: null });
    return new Promise((res) => {
      release = () => {
        rows.trip_split_expenses.unshift({ id: "e9", trip_id: "t1", created_at: "2026-10-02", ...args.p_expense });
        res({ data: "e9", error: null });
      };
    });
  };
  return { supabase: { from, rpc, storage: { from: () => ({ upload: async () => ({ error: null }), remove: async () => ({}) }) } } };
});
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" }, loading: false }) }));
vi.mock("@/components/DashboardLayout", () => ({ DashboardLayout: ({ children }: any) => <div>{children}</div> }));
vi.mock("@/components/Tooltip", () => ({ FeatureTooltip: () => null }));
vi.mock("@/hooks/useTooltipShown", () => ({ useTooltipShown: () => ({ shouldShow: false, dismiss: () => {} }) }));
vi.mock("framer-motion", () => {
  const strip = (p: any) => { const { initial, animate, exit, transition, whileHover, whileTap, layout, ...r } = p; return r; };
  const motion = new Proxy({}, { get: (_t, tag: string) => (p: any) => React.createElement(tag, strip(p)) });
  return { motion, AnimatePresence: ({ children }: any) => <>{children}</> };
});
const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { error: toastError, success: vi.fn() } }));
// Prueba hermética: TripSplit pide el tipo de cambio en vivo (open.er-api.com); aquí usa la tabla de respaldo.
vi.mock("@/lib/fx", async () => {
  const actual: any = await vi.importActual("@/lib/fx");
  return { ...actual, fetchFxTable: async () => actual.FX_FALLBACK_TABLE };
});

import TripSplit from "@/pages/TripSplit";

const renderSplit = (tab = "?tab=compartidos") =>
  render(
    <MemoryRouter initialEntries={[`/dashboard/viajes/t1/split${tab}`]}>
      <Routes><Route path="/dashboard/viajes/:id/split" element={<TripSplit />} /></Routes>
    </MemoryRouter>,
  );

const confirmSpy = vi.spyOn(window, "confirm");
beforeEach(() => {
  calls.inserts = []; calls.rpcs = []; calls.deletes = []; calls.deleteError = null; toastError.mockClear();
  confirmSpy.mockReturnValue(true);
});
afterEach(() => confirmSpy.mockReset());

const saves = () => calls.rpcs.filter((c) => c.fn === "trip_split_save_expense");

describe("TripSplit", () => {
  it("'Guardar gasto' dos veces seguidas guarda UN gasto compartido (el botón se desactiva mientras guarda)", async () => {
    renderSplit();
    await screen.findByText("Cena");
    fireEvent.click(screen.getByRole("button", { name: /Nuevo gasto/ }));
    fireEvent.change(screen.getByLabelText("Descripción del gasto"), { target: { value: "Taxi" } });
    fireEvent.change(screen.getByLabelText("Monto del gasto"), { target: { value: "250" } });
    // Pagó Luis (sin app) y es para mí: un gasto compartido.
    fireEvent.click(screen.getByRole("radio", { name: "Luis" }));
    const btn = screen.getByRole("button", { name: /Guardar gasto/ });
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(screen.getByRole("button", { name: /Guardando/ })).toBeDisabled();
    await act(async () => { release(); });
    expect(saves()).toHaveLength(1);
    expect(saves()[0].args.p_expense).toMatchObject({ payer_id: "p2", amount: 250, description: "Taxi" });
    expect(saves()[0].args.p_shares).toEqual([{ person_id: "p0", amount: 250, percent: null }]);
    expect(await screen.findByText("Taxi")).toBeInTheDocument();
  });

  it("lo mismo con un gasto solo mío: un solo registro en expenses", async () => {
    renderSplit("");
    fireEvent.click(await screen.findByRole("button", { name: /Nuevo gasto/ }));
    fireEvent.change(screen.getByLabelText("Monto del gasto"), { target: { value: "80" } });
    const btn = screen.getByRole("button", { name: /Guardar gasto/ });
    fireEvent.click(btn);
    fireEvent.click(btn);
    await act(async () => { release(); });
    expect(calls.inserts.filter((c) => c.table === "expenses")).toHaveLength(1);
    expect(saves()).toHaveLength(0);
  });

  it("un monto negativo no se guarda", async () => {
    renderSplit();
    await screen.findByText("Cena");
    fireEvent.click(screen.getByRole("button", { name: /Nuevo gasto/ }));
    fireEvent.change(screen.getByLabelText("Descripción del gasto"), { target: { value: "Raro" } });
    fireEvent.change(screen.getByLabelText("Monto del gasto"), { target: { value: "-40" } });
    fireEvent.click(screen.getByRole("radio", { name: "Ana" }));
    fireEvent.click(screen.getByRole("button", { name: /Guardar gasto/ }));
    expect(calls.inserts).toHaveLength(0);
    expect(saves()).toHaveLength(0);
    expect(toastError).toHaveBeenCalledWith("El monto debe ser mayor a 0");
  });

  it("si borrar un gasto falla, el gasto NO desaparece y se avisa", async () => {
    calls.deleteError = { message: "rls" };
    renderSplit();
    await screen.findByText("Cena");
    fireEvent.click(screen.getByRole("button", { name: "Eliminar gasto Cena" }));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(screen.getByText("Cena")).toBeInTheDocument();
  });

  // D-18: la base no borra en cascada los pagos de la persona; quitar a alguien con gastos se impide
  // y se explica, en vez de confirmar y borrar sus pagos.
  it("quitar a una persona con gastos no la borra ni borra sus pagos; se explica por qué", async () => {
    renderSplit();
    await screen.findByText("Cena");
    fireEvent.click(screen.getByRole("button", { name: "Quitar a Ana" }));
    expect(toastError).toHaveBeenCalledWith("Ana tiene pagos registrados", expect.anything());
    expect(calls.deletes).toHaveLength(0);
  });
});
