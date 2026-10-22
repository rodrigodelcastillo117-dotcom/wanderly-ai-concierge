import React from "react";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { vi, it, expect, beforeEach, describe } from "vitest";

// E-24: un segundo toque mientras se guarda no debe crear un registro duplicado.
const calls = vi.hoisted(() => ({ inserts: [] as { table: string; row: any }[], deletes: [] as string[], deleteError: null as any }));
let release: () => void = () => {};

vi.mock("@/integrations/supabase/client", () => {
  const rows: Record<string, any[]> = {
    trips: [{ id: "t1", destino: "Roma" }],
    trip_split_people: [{ id: "p1", name: "Ana", trip_id: "t1" }, { id: "p2", name: "Luis", trip_id: "t1" }],
    trip_split_expenses: [{ id: "e1", payer_id: "p1", amount: 100, description: "Cena", trip_id: "t1", created_at: "2026-10-01" }],
  };
  const from = (table: string) => {
    let pendingInsert: any = null; let isDelete = false; let delId = "";
    const api: any = {
      select: () => api, order: () => api, eq: (_k: string, v: string) => { if (isDelete) delId = v; return api; },
      maybeSingle: async () => ({ data: rows[table][0] ?? null, error: null }),
      insert: (row: any) => { pendingInsert = row; calls.inserts.push({ table, row }); return api; },
      delete: () => { isDelete = true; return api; },
      single: () => new Promise((res) => { release = () => res({ data: { id: `n${calls.inserts.length}`, ...pendingInsert }, error: null }); }),
      then: (ok: any, ko: any) => {
        if (isDelete) { calls.deletes.push(delId); return Promise.resolve({ error: calls.deleteError }).then(ok, ko); }
        return Promise.resolve({ data: rows[table], error: null }).then(ok, ko);
      },
    };
    return api;
  };
  return { supabase: { from } };
});
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

const renderSplit = () =>
  render(
    <MemoryRouter initialEntries={["/dashboard/viajes/t1/split"]}>
      <Routes><Route path="/dashboard/viajes/:id/split" element={<TripSplit />} /></Routes>
    </MemoryRouter>,
  );

beforeEach(() => { calls.inserts = []; calls.deletes = []; calls.deleteError = null; toastError.mockClear(); });

describe("TripSplit", () => {
  it("'Agregar gasto' dos veces seguidas guarda UN gasto (el botón se desactiva mientras guarda)", async () => {
    renderSplit();
    await screen.findByText("Cena");
    fireEvent.change(screen.getByLabelText("Descripción del gasto"), { target: { value: "Taxi" } });
    fireEvent.change(screen.getByLabelText("Monto del gasto"), { target: { value: "250" } });
    fireEvent.change(screen.getByLabelText("¿Quién pagó?"), { target: { value: "p2" } });
    const btn = screen.getByRole("button", { name: /Agregar gasto/ });
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(screen.getByRole("button", { name: /Guardando/ })).toBeDisabled();
    await act(async () => { release(); });
    expect(calls.inserts.filter((c) => c.table === "trip_split_expenses")).toHaveLength(1);
    await screen.findByText("Taxi");
  });

  it("un monto negativo no se guarda", async () => {
    renderSplit();
    await screen.findByText("Cena");
    fireEvent.change(screen.getByLabelText("Descripción del gasto"), { target: { value: "Raro" } });
    fireEvent.change(screen.getByLabelText("Monto del gasto"), { target: { value: "-40" } });
    fireEvent.change(screen.getByLabelText("¿Quién pagó?"), { target: { value: "p1" } });
    fireEvent.click(screen.getByRole("button", { name: /Agregar gasto/ }));
    expect(calls.inserts).toHaveLength(0);
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

  // D-18: la base ya no borra en cascada los pagos de la persona (20261022143200); quitar a alguien
  // con gastos se impide y se explica, en vez de confirmar y borrar sus pagos.
  it("quitar a una persona con gastos no la borra ni borra sus pagos; se explica por qué", async () => {
    renderSplit();
    await screen.findByText("Cena");
    fireEvent.click(screen.getByRole("button", { name: "Quitar a Ana" }));
    expect(toastError).toHaveBeenCalledWith("Ana tiene pagos registrados", expect.anything());
    expect(calls.deletes).toHaveLength(0);
  });
});
