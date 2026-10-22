import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { vi, it, expect, beforeEach } from "vitest";

// Respuestas por tabla; `pending` deja la carga colgada para probar el estado "cargando".
let pending = false;
let deleteRows = 0;
const tables: Record<string, any[]> = {
  trips: [{ id: "own1", user_id: "u1", destino: "Roma", created_at: "2026-01-02", total_estimado: 1 }],
  trip_collaborators: [{ trip_id: "sh1" }],
};
const sharedTrip = { id: "sh1", user_id: "u9", destino: "Lima", created_at: "2026-01-01", total_estimado: 1 };
const deletes: any[] = [];
function qb(table: string) {
  const f: any = {}; let kind = "select";
  const api: any = {
    select: () => api,
    eq: (k: string, v: any) => { f[k] = v; return api; },
    in: () => { f.in = true; return api; },
    delete: () => { kind = "delete"; return api; },
    then: (res: any, rej: any) => {
      if (pending) return new Promise(() => {});
      if (kind === "delete") { deletes.push({ table, ...f }); return Promise.resolve({ data: Array.from({ length: deleteRows }, () => ({ id: "x" })), error: null }).then(res, rej); }
      const data = table === "trips" && f.in ? [sharedTrip] : tables[table];
      return Promise.resolve({ data, error: null }).then(res, rej);
    },
  };
  return api;
}
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: (t: string) => qb(t), functions: { invoke: async () => ({ data: null }) } } }));
const user = { id: "u1" };
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user, loading: false }) }));
vi.mock("@/components/DashboardLayout", () => ({ DashboardLayout: ({ children }: any) => <>{children}</> }));
vi.mock("@/components/DestinationVideo", () => ({ DestinationVideo: () => null }));
const toastSpy = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastSpy }));

import Trips from "@/pages/Trips";

beforeEach(() => { pending = false; deleteRows = 0; deletes.length = 0; toastSpy.success.mockClear(); toastSpy.error.mockClear(); });

it("mientras carga no muestra 'Aún no has guardado ningún viaje'", async () => {
  pending = true;
  render(<MemoryRouter><Trips /></MemoryRouter>);
  expect(screen.getByLabelText("Cargando tus viajes")).toBeInTheDocument();
  expect(screen.queryByText(/Aún no has guardado/)).toBeNull();
});

it("un viaje compartido ofrece 'Salir del viaje' (no 'Eliminar') y no borra la fila de trips", async () => {
  deleteRows = 1;
  render(<MemoryRouter><Trips /></MemoryRouter>);
  expect(await screen.findByRole("button", { name: "Salir del viaje a Lima" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Eliminar viaje a Lima" })).toBeNull();
  expect(screen.getByRole("button", { name: "Eliminar viaje a Roma" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Salir del viaje a Lima" }));
  fireEvent.click(await screen.findByRole("button", { name: "Salir del viaje" }));
  await screen.findByText("Roma");
  await new Promise((r) => setTimeout(r, 0));
  expect(deletes).toEqual([{ table: "trip_collaborators", trip_id: "sh1", user_id: "u1" }]);
});

it("si el borrado afecta 0 filas, dice la verdad y no muestra 'Viaje eliminado'", async () => {
  deleteRows = 0;
  render(<MemoryRouter><Trips /></MemoryRouter>);
  fireEvent.click(await screen.findByRole("button", { name: "Eliminar viaje a Roma" }));
  fireEvent.click(await screen.findByRole("button", { name: "Eliminar" }));
  await new Promise((r) => setTimeout(r, 10));
  expect(toastSpy.success).not.toHaveBeenCalled();
  expect(toastSpy.error).toHaveBeenCalledWith(expect.stringMatching(/No se borró nada/));
  expect(screen.getByText("Roma")).toBeInTheDocument();
});
