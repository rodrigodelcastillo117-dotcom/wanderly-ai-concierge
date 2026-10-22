import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { vi, beforeEach, describe, it, expect } from "vitest";
import { buildReanalysisPatch, reanalyzeTripInPlace } from "@/lib/tripReanalysis";
import { deleteOwnedTrip, leaveSharedTrip } from "@/lib/tripMembership";

// Cliente falso que registra cada operación (tabla, tipo, filtros, payload).
type Op = { table: string; kind: string; filters: Record<string, unknown>; payload?: any };
function fakeClient(opts: { analysisTrip: any; updateRows?: number; deleteRows?: number; tripOwner?: string }) {
  const ops: Op[] = [];
  const client = {
    ops,
    functions: { invoke: vi.fn(async () => ({ data: { trip: opts.analysisTrip }, error: null })) },
    from: (table: string) => {
      const op: Op = { table, kind: "select", filters: {} };
      const api: any = {
        select: () => api,
        update: (p: any) => { op.kind = "update"; op.payload = p; return api; },
        delete: () => { op.kind = "delete"; return api; },
        eq: (k: string, v: unknown) => { op.filters[k] = v; return api; },
        maybeSingle: async () => ({ data: { id: "orig", user_id: opts.tripOwner ?? "u1", destino: "Roma", num_viajeros: 2 }, error: null }),
        then: (res: any, rej: any) => {
          ops.push(op);
          const n = op.kind === "update" ? (opts.updateRows ?? 1) : op.kind === "delete" ? (opts.deleteRows ?? 1) : 1;
          return Promise.resolve({ data: Array.from({ length: n }, () => ({ id: op.filters.id ?? "x" })), error: null }).then(res, rej);
        },
      };
      return api;
    },
  };
  return client;
}

const fresh = {
  id: "temp", user_id: "u1", created_at: "2026-10-22", destino: "Roma", total_estimado: 50000,
  itinerario_json: [{ dia: 1 }], vuelos_json: [], cover_image_url: null, dates_optimized: false,
};

describe("reanalyzeTripInPlace", () => {
  it("copia el análisis sobre el viaje original y solo borra la fila temporal", async () => {
    const c = fakeClient({ analysisTrip: fresh });
    const res = await reanalyzeTripInPlace(c as any, "orig", { destino: "Roma" });
    expect(res).toEqual({ status: "updated", tripId: "orig", tempCleanup: "deleted" });
    const upd = c.ops.find((o) => o.kind === "update")!;
    expect(upd.filters.id).toBe("orig");
    expect(upd.payload).toMatchObject({ total_estimado: 50000, itinerario_json: [{ dia: 1 }] });
    expect(upd.payload).not.toHaveProperty("id");
    expect(upd.payload).not.toHaveProperty("user_id");
    const dels = c.ops.filter((o) => o.kind === "delete");
    expect(dels).toHaveLength(1);
    expect(dels[0].filters.id).toBe("temp");
    expect(c.functions.invoke).toHaveBeenCalledWith("analizar-viaje", { body: { destino: "Roma", trip_id: "orig" } });
  });

  it("si RLS no deja actualizar (0 filas), no borra NADA y conserva la cotización nueva aparte", async () => {
    const c = fakeClient({ analysisTrip: fresh, updateRows: 0 });
    const res = await reanalyzeTripInPlace(c as any, "orig", {});
    expect(res).toEqual({ status: "kept_copy", tripId: "temp", originalId: "orig" });
    expect(c.ops.filter((o) => o.kind === "delete")).toHaveLength(0);
  });

  it("si el servidor ya actualiza en sitio (mismo id) no copia ni borra", async () => {
    const c = fakeClient({ analysisTrip: { ...fresh, id: "orig" } });
    const res = await reanalyzeTripInPlace(c as any, "orig", {});
    expect(res.status).toBe("updated");
    expect(c.ops).toHaveLength(0);
  });

  it("no pisa la portada existente con null", () => {
    expect(buildReanalysisPatch({ cover_image_url: null, total_estimado: 1 })).toEqual({ total_estimado: 1 });
  });
});

describe("borrar / salir de un viaje", () => {
  it("deleteOwnedTrip reporta not_allowed cuando RLS borra 0 filas (antes: falso 'Viaje eliminado')", async () => {
    const c = fakeClient({ analysisTrip: fresh, deleteRows: 0 });
    expect(await deleteOwnedTrip(c as any, "orig")).toEqual({ ok: false, reason: "not_allowed" });
  });
  it("leaveSharedTrip borra solo la fila del colaborador", async () => {
    const c = fakeClient({ analysisTrip: fresh });
    expect(await leaveSharedTrip(c as any, "t1", "u2")).toEqual({ ok: true });
    expect(c.ops[0]).toMatchObject({ table: "trip_collaborators", kind: "delete", filters: { trip_id: "t1", user_id: "u2" } });
  });
});

// ---- EditTrip (RTL): el botón "Re-analizar" nunca borra el viaje original ----
let client: ReturnType<typeof fakeClient>;
vi.mock("@/integrations/supabase/client", () => ({
  supabase: new Proxy({}, { get: (_t, k: string) => (client as any)[k] }),
}));
let currentUser = { id: "u1" };
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: currentUser, loading: false }) }));
vi.mock("@/components/DashboardLayout", () => ({ DashboardLayout: ({ children }: any) => <>{children}</> }));
vi.mock("framer-motion", () => {
  const strip = (p: any) => { const { initial, animate, exit, transition, ...r } = p; return r; };
  const cache: Record<string, any> = {};
  const motion = new Proxy({}, { get: (_t, tag: string) => (cache[tag] ??= (p: any) => React.createElement(tag, strip(p))) });
  return { motion, AnimatePresence: ({ children }: any) => <>{children}</> };
});
import EditTrip from "@/pages/EditTrip";

// jsdom no trae ResizeObserver (lo usa el Slider de Radix).
(globalThis as any).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };

const renderEdit = () =>
  render(
    <MemoryRouter initialEntries={["/dashboard/viajes/orig/editar"]}>
      <Routes>
        <Route path="/dashboard/viajes/:id/editar" element={<EditTrip />} />
        <Route path="/dashboard/viajes/:id" element={<p>DETALLE</p>} />
        <Route path="/dashboard/viajes" element={<p>LISTA</p>} />
      </Routes>
    </MemoryRouter>,
  );

describe("EditTrip", () => {
  beforeEach(() => { currentUser = { id: "u1" }; });

  it("Re-analizar actualiza el mismo viaje y vuelve a su detalle; jamás borra el id original", async () => {
    client = fakeClient({ analysisTrip: fresh });
    renderEdit();
    fireEvent.click(await screen.findByRole("button", { name: /Re-analizar con IA/ }));
    await screen.findByText("DETALLE");
    expect(client.ops.filter((o) => o.kind === "delete" && o.table === "trips").map((o) => o.filters.id)).toEqual(["temp"]);
  });

  it("las etiquetas del formulario están asociadas a sus campos", async () => {
    client = fakeClient({ analysisTrip: fresh });
    renderEdit();
    expect(await screen.findByLabelText(/Destinos/)).toHaveValue("Roma");
    expect(screen.getByLabelText("Salida")).toHaveAttribute("type", "date");
  });

  it("un colaborador ve 'Salir del viaje' en vez de 'Eliminar viaje'", async () => {
    currentUser = { id: "u2" };
    client = fakeClient({ analysisTrip: fresh, tripOwner: "u1" });
    renderEdit();
    expect(await screen.findByRole("button", { name: /Salir del viaje/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Eliminar viaje/ })).toBeNull();
  });
});
