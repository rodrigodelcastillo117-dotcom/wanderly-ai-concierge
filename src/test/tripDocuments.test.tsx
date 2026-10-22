import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { vi, it, expect, beforeEach, describe } from "vitest";

const TRIP = "11111111-1111-4111-8111-111111111111";
const state = {
  rows: [] as any[],
  selectError: null as any,
  uploads: [] as any[],
  removed: [] as string[][],
  inserts: [] as any[],
  deletes: [] as any[],
  signed: [] as any[],
  uploadError: null as any,
  insertError: null as any,
};

vi.mock("@/integrations/supabase/client", () => {
  const table = (name: string) => {
    let kind = "select";
    const filters: Record<string, unknown> = {};
    const api: any = {
      select: () => api,
      eq: (k: string, v: unknown) => { filters[k] = v; return api; },
      order: () => api,
      insert: (row: any) => { state.inserts.push({ table: name, row }); return Promise.resolve({ error: state.insertError }); },
      delete: () => { kind = "delete"; return api; },
      then: (res: any, rej: any) => {
        if (kind === "delete") { state.deletes.push({ table: name, ...filters }); return Promise.resolve({ error: null }).then(res, rej); }
        return Promise.resolve({ data: state.selectError ? null : state.rows, error: state.selectError }).then(res, rej);
      },
    };
    return api;
  };
  const bucket = (b: string) => ({
    upload: async (path: string, file: File, opts: any) => { state.uploads.push({ b, path, name: file.name, opts }); return { error: state.uploadError }; },
    remove: async (paths: string[]) => { state.removed.push(paths); return { error: null }; },
    createSignedUrl: async (path: string, ttl: number) => { state.signed.push({ b, path, ttl }); return { data: { signedUrl: `https://signed.example/${path}?t=${ttl}` }, error: null }; },
  });
  return { supabase: { from: table, storage: { from: bucket } } };
});
let userId = "owner";
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: userId } }) }));
const toastSpy = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastSpy }));

import { TripDocuments } from "@/components/TripDocuments";

const doc = (over: any = {}) => ({
  id: "d1", trip_id: TRIP, uploaded_by: "owner", kind: "boleto", storage_path: `${TRIP}/u-boleto.pdf`,
  filename: "boleto.pdf", mime: "application/pdf", size: 2048, created_at: "2026-10-22T10:00:00Z", ...over,
});

beforeEach(() => {
  Object.assign(state, { rows: [], selectError: null, uploads: [], removed: [], inserts: [], deletes: [], signed: [], uploadError: null, insertError: null });
  userId = "owner";
  toastSpy.success.mockClear(); toastSpy.error.mockClear();
});

describe("Documentos del viaje", () => {
  it("lista los documentos con tipo y tamaño", async () => {
    state.rows = [doc()];
    render(<TripDocuments tripId={TRIP} ownerId="owner" />);
    expect(await screen.findByText("boleto.pdf")).toBeInTheDocument();
    expect(screen.getByText(/Boleto · 2 KB/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Documentos" })).toBeInTheDocument();
  });

  it("sube al bucket privado con la ruta {trip_id}/{uuid}-{nombre} y registra la fila", async () => {
    render(<TripDocuments tripId={TRIP} ownerId="owner" />);
    await screen.findByText(/Aún no hay documentos/);
    fireEvent.change(screen.getByLabelText("Tipo de documento"), { target: { value: "pasaporte" } });
    const file = new File(["%PDF"], "Mi Pasaporte.pdf", { type: "application/pdf" });
    fireEvent.change(screen.getByTestId("trip-doc-input"), { target: { files: [file] } });
    await waitFor(() => expect(state.inserts).toHaveLength(1));
    expect(state.uploads[0].b).toBe("trip-documents");
    expect(state.uploads[0].path).toMatch(new RegExp(`^${TRIP}/[0-9a-f-]+-Mi_Pasaporte\\.pdf$`));
    expect(state.uploads[0].opts).toMatchObject({ upsert: false, contentType: "application/pdf" });
    expect(state.inserts[0].row).toMatchObject({ trip_id: TRIP, uploaded_by: "owner", kind: "pasaporte", storage_path: state.uploads[0].path, mime: "application/pdf", size: 4 });
  });

  it("rechaza tipo o tamaño no permitidos sin subir nada", async () => {
    render(<TripDocuments tripId={TRIP} ownerId="owner" />);
    await screen.findByText(/Aún no hay documentos/);
    fireEvent.change(screen.getByTestId("trip-doc-input"), { target: { files: [new File(["x"], "virus.exe", { type: "application/x-msdownload" })] } });
    await waitFor(() => expect(toastSpy.error).toHaveBeenCalled());
    expect(state.uploads).toHaveLength(0);
  });

  it("si la fila no se puede guardar, borra el archivo subido (no deja huérfanos)", async () => {
    state.insertError = { message: "rls" };
    render(<TripDocuments tripId={TRIP} ownerId="owner" />);
    await screen.findByText(/Aún no hay documentos/);
    fireEvent.change(screen.getByTestId("trip-doc-input"), { target: { files: [new File(["x"], "a.png", { type: "image/png" })] } });
    await waitFor(() => expect(state.removed).toHaveLength(1));
    expect(state.removed[0][0]).toBe(state.uploads[0].path);
    expect(toastSpy.error).toHaveBeenCalled();
  });

  it("descarga con un enlace firmado de 60 s (la pestaña se abre en el mismo gesto)", async () => {
    state.rows = [doc()];
    const win: any = { location: { href: "" }, opener: {}, close: vi.fn() };
    const open = vi.spyOn(window, "open").mockReturnValue(win);
    render(<TripDocuments tripId={TRIP} ownerId="owner" />);
    fireEvent.click(await screen.findByRole("button", { name: "Descargar boleto.pdf" }));
    expect(open).toHaveBeenCalledWith("", "_blank");
    await waitFor(() => expect(win.location.href).toBe(`https://signed.example/${TRIP}/u-boleto.pdf?t=60`));
    expect(state.signed[0]).toMatchObject({ b: "trip-documents", ttl: 60 });
    expect(win.opener).toBeNull();
    open.mockRestore();
  });

  it("borra solo quien lo subió o el dueño, con confirmación (archivo y fila)", async () => {
    state.rows = [doc({ id: "mine", uploaded_by: "collab", filename: "poliza.pdf" }), doc({ id: "owners", uploaded_by: "owner", filename: "boleto.pdf" })];
    userId = "collab";
    render(<TripDocuments tripId={TRIP} ownerId="owner" />);
    await screen.findByText("poliza.pdf");
    expect(screen.queryByRole("button", { name: "Borrar boleto.pdf" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Borrar poliza.pdf" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar borrado" }));
    await waitFor(() => expect(screen.queryByText("poliza.pdf")).toBeNull());
    expect(state.removed[0]).toEqual([`${TRIP}/u-boleto.pdf`]);
    expect(state.deletes[0]).toMatchObject({ table: "trip_documents", id: "mine" });
  });

  it("el dueño del viaje puede borrar lo que subió un colaborador", async () => {
    state.rows = [doc({ id: "c1", uploaded_by: "collab", filename: "poliza.pdf" })];
    render(<TripDocuments tripId={TRIP} ownerId="owner" />);
    expect(await screen.findByRole("button", { name: "Borrar poliza.pdf" })).toBeInTheDocument();
  });

  it("si la tabla aún no existe (migración pendiente) lo dice y no ofrece subir", async () => {
    state.selectError = { code: "42P01", message: "relation does not exist" };
    render(<TripDocuments tripId={TRIP} ownerId="owner" />);
    expect(await screen.findByText(/todavía no están disponibles/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Subir documento/ })).toBeNull();
  });
});
