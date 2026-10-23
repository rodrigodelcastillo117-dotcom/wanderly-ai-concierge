// Eliminar (dueño) o salir (colaborador) desde la página del viaje.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const calls = vi.hoisted(() => ({ deleted: [] as string[], left: [] as string[], deleteRows: 1, invoke: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => {
  const chain = (table: string) => {
    const filters: Record<string, string> = {};
    const q: any = {
      delete: () => q,
      eq: (k: string, v: string) => { filters[k] = v; return q; },
      select: async () => {
        if (table === "trips") {
          calls.deleted.push(filters.id);
          return { data: calls.deleteRows ? [{ id: filters.id }] : [], error: null };
        }
        calls.left.push(`${filters.trip_id}:${filters.user_id}`);
        return { data: [{ id: "c1" }], error: null };
      },
    };
    return q;
  };
  return { supabase: { from: chain, functions: { invoke: calls.invoke } } };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { toast } from "sonner";
import { TripDeleteButton } from "@/components/TripDeleteButton";

const TRIP = "11111111-1111-4111-8111-111111111111";

function renderButton(isOwner: boolean) {
  render(
    <MemoryRouter initialEntries={[`/dashboard/viajes/${TRIP}`]}>
      <Routes>
        <Route path="/dashboard/viajes/:id" element={<TripDeleteButton tripId={TRIP} destino="Roma → Florencia → Venecia" isOwner={isOwner} userId="u1" />} />
        <Route path="/dashboard/viajes" element={<p>Lista de viajes</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => { calls.deleted = []; calls.left = []; calls.deleteRows = 1; calls.invoke.mockReset(); vi.mocked(toast.success).mockReset(); vi.mocked(toast.error).mockReset(); });

describe("TripDeleteButton", () => {
  it("dueño: confirma, borra el viaje, purga archivos y regresa a Mis viajes", async () => {
    renderButton(true);
    fireEvent.click(screen.getByRole("button", { name: "Eliminar viaje" }));
    expect(screen.getByText("¿Eliminar este viaje?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Eliminar" }));
    await waitFor(() => expect(screen.getByText("Lista de viajes")).toBeInTheDocument());
    expect(calls.deleted).toEqual([TRIP]);
    expect(calls.invoke).toHaveBeenCalledWith("trip-files-purge", { body: {} });
    expect(toast.success).toHaveBeenCalledWith("Viaje eliminado");
  });

  it("cancelar no borra nada", () => {
    renderButton(true);
    fireEvent.click(screen.getByRole("button", { name: "Eliminar viaje" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(calls.deleted).toEqual([]);
  });

  it("si la base no deja borrar (0 filas), lo dice y no sale de la página", async () => {
    calls.deleteRows = 0;
    renderButton(true);
    fireEvent.click(screen.getByRole("button", { name: "Eliminar viaje" }));
    fireEvent.click(screen.getByRole("button", { name: "Eliminar" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Solo quien creó el viaje puede eliminarlo. No se borró nada."));
    expect(screen.queryByText("Lista de viajes")).toBeNull();
  });

  it("colaborador: sale del viaje sin borrarlo", async () => {
    renderButton(false);
    fireEvent.click(screen.getByRole("button", { name: "Salir del viaje" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Salir del viaje" }).at(-1)!);
    await waitFor(() => expect(screen.getByText("Lista de viajes")).toBeInTheDocument());
    expect(calls.deleted).toEqual([]);
    expect(calls.left).toEqual([`${TRIP}:u1`]);
  });
});
