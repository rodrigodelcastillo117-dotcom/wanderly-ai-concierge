// T-P2-3 y T-P2-4: documentos del viaje con visibilidad "solo yo" (por omisión en pasaporte y visa) y
// archivos del viaje que se borran al borrar el viaje (trip-files-purge vacía la cola).
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const TRIP = "11111111-1111-4111-8111-111111111111";
const st = vi.hoisted(() => ({ rows: [] as any[], inserts: [] as any[], rpc: [] as any[], uploads: [] as any[] }));

vi.mock("@/integrations/supabase/client", () => {
  const table = (name: string) => {
    const api: any = {
      select: () => api, eq: () => api, order: () => api,
      insert: (row: any) => { st.inserts.push({ table: name, row }); return Promise.resolve({ error: null }); },
      then: (res: any, rej: any) => Promise.resolve({ data: st.rows, error: null }).then(res, rej),
    };
    return api;
  };
  return {
    supabase: {
      from: table,
      rpc: async (fn: string, args: any) => { st.rpc.push({ fn, args }); return { data: { ok: true, visibility: args?.p_visibility }, error: null }; },
      storage: { from: (b: string) => ({ upload: async (path: string) => { st.uploads.push({ b, path }); return { error: null }; }, remove: async () => ({ error: null }) }) },
    },
  };
});
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "owner" } }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { TripDocuments } from "@/components/TripDocuments";
import { TRIP_DOC_KINDS, defaultDocVisibility } from "@/lib/tripDocuments";
import { deleteOwnedTrip } from "@/lib/tripMembership";
import { drainQueue, type QueueRow } from "../../supabase/functions/trip-files-purge/purge";

beforeEach(() => { st.rows = []; st.inserts = []; st.rpc = []; st.uploads = []; });

describe("T-P2-4: quién ve cada documento", () => {
  it("pasaporte y visa son 'solo yo' por omisión; lo demás, 'viaje'", () => {
    expect(TRIP_DOC_KINDS).toContain("visa");
    expect(defaultDocVisibility("pasaporte")).toBe("solo_yo");
    expect(defaultDocVisibility("visa")).toBe("solo_yo");
    expect(defaultDocVisibility("boleto")).toBe("viaje");
  });

  it("al elegir Pasaporte el selector pasa a 'Solo yo' y la fila se guarda así", async () => {
    render(<TripDocuments tripId={TRIP} ownerId="owner" />);
    await screen.findByText(/Aún no hay documentos/);
    fireEvent.change(screen.getByLabelText("Tipo de documento"), { target: { value: "pasaporte" } });
    expect((screen.getByLabelText("Quién ve el documento") as HTMLSelectElement).value).toBe("solo_yo");
    fireEvent.change(screen.getByTestId("trip-doc-input"), { target: { files: [new File(["%PDF"], "pasaporte.pdf", { type: "application/pdf" })] } });
    await waitFor(() => expect(st.inserts).toHaveLength(1));
    expect(st.inserts[0].row).toMatchObject({ kind: "pasaporte", visibility: "solo_yo" });
  });

  it("se puede compartir un boleto con el viaje o dejarlo solo para mí", async () => {
    render(<TripDocuments tripId={TRIP} ownerId="owner" />);
    await screen.findByText(/Aún no hay documentos/);
    fireEvent.change(screen.getByLabelText("Quién ve el documento"), { target: { value: "solo_yo" } });
    fireEvent.change(screen.getByTestId("trip-doc-input"), { target: { files: [new File(["%PDF"], "b.pdf", { type: "application/pdf" })] } });
    await waitFor(() => expect(st.inserts[0]?.row).toMatchObject({ kind: "boleto", visibility: "solo_yo" }));
  });

  it("quien lo subió cambia la visibilidad con la RPC del servidor y se marca 'Solo tú'", async () => {
    st.rows = [{ id: "d1", trip_id: TRIP, uploaded_by: "owner", kind: "pasaporte", storage_path: `${TRIP}/u-p.pdf`, filename: "p.pdf", mime: "application/pdf", size: 10, created_at: "2026-10-22T10:00:00Z", visibility: "solo_yo" }];
    render(<TripDocuments tripId={TRIP} ownerId="owner" />);
    expect(await screen.findByText("Solo tú")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Compartir p.pdf con el viaje" }));
    await waitFor(() => expect(st.rpc).toEqual([{ fn: "set_trip_document_visibility", args: { p_id: "d1", p_visibility: "viaje" } }]));
    await waitFor(() => expect(screen.queryByText("Solo tú")).toBeNull());
  });

  it("no ofrece cambiar la visibilidad de un documento ajeno", async () => {
    st.rows = [{ id: "d2", trip_id: TRIP, uploaded_by: "collab", kind: "boleto", storage_path: `${TRIP}/u-b.pdf`, filename: "b.pdf", mime: "application/pdf", size: 10, created_at: "2026-10-22T10:00:00Z", visibility: "viaje" }];
    render(<TripDocuments tripId={TRIP} ownerId="owner" />);
    await screen.findByText("b.pdf");
    expect(screen.queryByRole("button", { name: /Dejar b\.pdf solo para ti/ })).toBeNull();
  });
});

describe("T-P2-3: archivos del viaje borrado", () => {
  it("deleteOwnedTrip llama trip-files-purge cuando el viaje sí se borró", async () => {
    const invoke = vi.fn(async () => ({ data: { ok: true }, error: null }));
    const del = { delete: () => del, eq: () => del, select: async () => ({ data: [{ id: "t1" }], error: null }) };
    expect(await deleteOwnedTrip({ from: () => del, functions: { invoke } } as any, "t1")).toEqual({ ok: true });
    expect(invoke).toHaveBeenCalledWith("trip-files-purge", { body: {} });
  });

  it("si RLS no borró nada no llama la purga, y si la purga falla el viaje igual se reporta borrado", async () => {
    const invoke = vi.fn(async () => { throw new Error("red"); });
    const none = { delete: () => none, eq: () => none, select: async () => ({ data: [], error: null }) };
    expect(await deleteOwnedTrip({ from: () => none, functions: { invoke } } as any, "t1")).toEqual({ ok: false, reason: "not_allowed" });
    expect(invoke).not.toHaveBeenCalled();
    const one = { delete: () => one, eq: () => one, select: async () => ({ data: [{ id: "t1" }], error: null }) };
    expect(await deleteOwnedTrip({ from: () => one, functions: { invoke } } as any, "t1")).toEqual({ ok: true });
  });

  it("drainQueue borra por bucket, quita de la cola solo lo borrado y nunca toca otros buckets", async () => {
    let queue: QueueRow[] = [
      { id: 1, bucket_id: "trip-documents", name: "t/a-pasaporte.pdf" },
      { id: 2, bucket_id: "journal-photos", name: "u/t/f.jpg" },
      { id: 3, bucket_id: "travel-vault", name: "u/x/y.jpg" },
      { id: 4, bucket_id: "trip-documents", name: "../etc" },
    ];
    const removed: Array<[string, string[]]> = [];
    const r = await drainQueue({
      load: async (n) => queue.slice(0, n),
      remove: async (b, names) => { removed.push([b, names]); return { error: null }; },
      done: async (ids) => { queue = queue.filter((q) => !ids.includes(q.id)); },
    });
    expect(removed).toEqual([["trip-documents", ["t/a-pasaporte.pdf"]], ["journal-photos", ["u/t/f.jpg"]]]);
    expect(r).toMatchObject({ removed: 2, skipped: 2, failed: 0 });
    expect(queue).toEqual([]);
  });

  it("si storage falla, la fila se queda para el siguiente intento", async () => {
    let queue: QueueRow[] = [{ id: 1, bucket_id: "trip-documents", name: "t/a.pdf" }];
    const r = await drainQueue({
      load: async () => queue,
      remove: async () => ({ error: "503" }),
      done: async (ids) => { queue = queue.filter((q) => !ids.includes(q.id)); },
    });
    expect(r).toMatchObject({ removed: 0, failed: 1 });
    expect(queue).toHaveLength(1);
  });
});
