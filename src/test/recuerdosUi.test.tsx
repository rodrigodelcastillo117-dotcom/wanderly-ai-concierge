// Recuerdos (pantalla): calendario, visor (favorita, ampliar, mover, borrar), álbumes y subida.
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "me" } }) }));
vi.mock("@/components/DashboardLayout", () => ({ DashboardLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }));

import Recuerdos from "@/pages/Recuerdos";
import { RecuerdosUploader } from "@/components/recuerdos/RecuerdosUploader";
import type { RecuerdosClient } from "@/lib/recuerdos/api";

type Op = { table: string; op: string; args: unknown[] };

function makeClient(data: Record<string, unknown[]>) {
  const ops: Op[] = [];
  const removed: string[][] = [];
  const uploads: string[] = [];
  const from = (table: string) => {
    let mode = "select";
    let payload: unknown = null;
    const q: Record<string, unknown> = {};
    for (const op of ["select", "eq", "in", "not", "order", "limit"]) q[op] = (...a: unknown[]) => { ops.push({ table, op, args: a }); return q; };
    q.update = (v: unknown) => { mode = "update"; payload = v; ops.push({ table, op: "update", args: [v] }); return q; };
    q.delete = () => { mode = "delete"; ops.push({ table, op: "delete", args: [] }); return q; };
    q.insert = (v: unknown) => { mode = "insert"; payload = v; ops.push({ table, op: "insert", args: [v] }); return q; };
    q.single = async () => ({ data: { ...(payload as object), created_at: "2026-10-23T10:00:00Z", favorite: false }, error: null });
    q.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve(mode === "select" ? { data: data[table] ?? [], error: null } : { data: null, error: null }).then(res, rej);
    return q;
  };
  const client = {
    from,
    storage: { from: (bucket: string) => ({
      createSignedUrls: async (paths: string[]) => ({ data: paths.map((p) => ({ path: p, signedUrl: `https://signed/${bucket}/${p}` })), error: null }),
      remove: async (p: string[]) => { removed.push(p); return { error: null }; },
      upload: async (p: string) => { uploads.push(p); return { error: null }; },
    }) },
  } as unknown as RecuerdosClient;
  return { client, ops, removed, uploads };
}

const DATA = () => ({
  recuerdos: [
    { id: "r1", user_id: "me", trip_id: "lis", media_type: "foto", storage_path: "me/r1.jpg", thumb_path: "me/r1_t.jpg", taken_on: "2026-03-12", taken_at: null, created_at: "2026-10-01T00:00:00Z", favorite: false, date_source: "exif", trip_source: "fecha" },
    { id: "r2", user_id: "me", trip_id: "lis", media_type: "foto", storage_path: "me/r2.jpg", thumb_path: null, taken_on: "2026-03-12", taken_at: null, created_at: "2026-10-01T00:00:01Z", favorite: false, date_source: "archivo", trip_source: "fecha" },
  ],
  travel_moments: [{ id: "m1", trip_id: "lis", caption: "Alfama", created_at: "2026-03-14T12:00:00", image_path: "me/m1.jpg", image_url: null }],
  trip_journal_entries: [],
  trips: [{ id: "lis", destino: "Lisboa", fecha_salida: "2026-03-10", fecha_regreso: "2026-03-20" }],
  trip_collaborators: [],
  recuerdos_album_shares: [],
});

const renderPage = (c: ReturnType<typeof makeClient>) => render(<MemoryRouter><Recuerdos client={c.client} /></MemoryRouter>);

describe("Recuerdos: calendario y visor", () => {
  let c: ReturnType<typeof makeClient>;
  beforeEach(() => { c = makeClient(DATA()); });

  it("abre en el mes con fotos, con miniatura y cuántas hay en el día", async () => {
    renderPage(c);
    expect(await screen.findByTestId("recuerdos-month")).toHaveTextContent("Marzo 2026");
    const day = screen.getByRole("gridcell", { name: "12 de marzo de 2026: 2 recuerdos" });
    await waitFor(() => expect(day.querySelector("img")?.getAttribute("src")).toBe("https://signed/recuerdos/me/r1_t.jpg"));
    expect(within(day).getByText("2")).toBeInTheDocument();
    expect(screen.getByRole("gridcell", { name: "14 de marzo de 2026: 1 recuerdo" })).toBeInTheDocument();
    // Solo trae lo del usuario de momentos y diario (RLS además).
    expect(c.ops).toContainEqual({ table: "travel_moments", op: "eq", args: ["user_id", "me"] });
    expect(c.ops).toContainEqual({ table: "trip_journal_entries", op: "eq", args: ["author_id", "me"] });
  });

  it("visor: pasar, ampliar, marcar favorita, mover de viaje y borrar", async () => {
    renderPage(c);
    fireEvent.click(await screen.findByRole("gridcell", { name: /12 de marzo de 2026/ }));
    const viewer = await screen.findByTestId("recuerdos-viewer");
    expect(within(viewer).getByText(/1 de 2 · Fecha tomada de la foto/)).toBeInTheDocument();
    await waitFor(() => expect(within(viewer).getByRole("img")).toHaveAttribute("src", "https://signed/recuerdos/me/r1.jpg"));

    fireEvent.click(within(viewer).getByRole("button", { name: "Acercar" }));
    expect(within(viewer).getByRole("img").getAttribute("style")).toContain("scale(1.75)");

    fireEvent.click(within(viewer).getByRole("button", { name: /Marcar favorita/ }));
    await waitFor(() => expect(c.ops).toContainEqual({ table: "recuerdos", op: "update", args: [{ favorite: true }] }));
    expect(within(viewer).getByRole("button", { name: /Favorita/ })).toHaveAttribute("aria-pressed", "true");

    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(within(viewer).getByText(/2 de 2 · Fecha del archivo/)).toBeInTheDocument();
    expect(within(viewer).getByRole("img").getAttribute("style")).toContain("scale(1)");

    fireEvent.change(within(viewer).getByLabelText("Mover a otro viaje"), { target: { value: "" } });
    await waitFor(() => expect(c.ops).toContainEqual({ table: "recuerdos", op: "update", args: [{ trip_id: null, trip_source: "ninguno" }] }));

    fireEvent.click(within(viewer).getByRole("button", { name: /Borrar/ }));
    const confirm = await screen.findByRole("alertdialog");
    await act(async () => { fireEvent.click(within(confirm).getByRole("button", { name: "Borrar" })); });
    await waitFor(() => expect(c.removed).toContainEqual(["me/r2.jpg"]));
    expect(c.ops.some((o) => o.table === "recuerdos" && o.op === "delete")).toBe(true);
    expect(screen.getByTestId("recuerdos-viewer")).toHaveTextContent("1 de 1");
  });

  it("lo de Mejores momentos se ve pero no se borra ni se mueve aquí", async () => {
    renderPage(c);
    fireEvent.click(await screen.findByRole("gridcell", { name: /14 de marzo de 2026/ }));
    const viewer = await screen.findByTestId("recuerdos-viewer");
    expect(within(viewer).getByText(/Alfama · De tus Mejores momentos/)).toBeInTheDocument();
    expect(within(viewer).queryByRole("button", { name: /Borrar/ })).toBeNull();
    expect(within(viewer).queryByLabelText("Mover a otro viaje")).toBeNull();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("recuerdos-viewer")).toBeNull();
  });

  it("Por viaje: álbum con portada, fechas y conteo; compartir con los del viaje empieza apagado", async () => {
    renderPage(c);
    fireEvent.click(await screen.findByRole("tab", { name: /Por viaje/ }));
    const card = screen.getByTestId("album-lis");
    expect(card).toHaveTextContent("Lisboa");
    expect(card).toHaveTextContent("10 – 20 de marzo de 2026");
    expect(card).toHaveTextContent("3 fotos");
    fireEvent.click(card);
    const sw = screen.getByRole("switch", { name: /Compartir con los del viaje/ });
    expect(sw).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText(/Solo tú ves estas fotos/)).toBeInTheDocument();
    fireEvent.click(sw);
    await waitFor(() => expect(c.ops).toContainEqual({ table: "recuerdos_album_shares", op: "insert", args: [{ user_id: "me", trip_id: "lis" }] }));
    await waitFor(() => expect(screen.getByRole("switch", { name: /Compartir/ })).toHaveAttribute("aria-checked", "true"));
  });
});

describe("Recuerdos: subir varias a la vez", () => {
  it("prepara cada archivo, le asigna el viaje por su fecha y avisa al terminar", async () => {
    const c = makeClient({});
    const onUploaded = vi.fn();
    const onDone = vi.fn();
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xda, 0, 2, 1, 0xff, 0xd9]);
    const encode = vi.fn(async (_f: Blob, edge: number) => ({ blob: new Blob([jpeg], { type: "image/jpeg" }), width: edge, height: edge }));
    render(<RecuerdosUploader client={c.client} userId="me" isMobile={false}
      trips={[{ id: "lis", destino: "Lisboa", fecha_salida: "2026-03-10", fecha_regreso: "2026-03-20" }]}
      onUploaded={onUploaded} onDone={onDone} prepareDeps={{ encode, today: "2026-10-23" }} />);
    const inTrip = new File([jpeg], "lisboa.jpg", { type: "image/jpeg", lastModified: new Date(2026, 2, 12, 12).getTime() });
    const outside = new File([jpeg], "casa.jpg", { type: "image/jpeg", lastModified: new Date(2026, 5, 1, 12).getTime() });
    const bad = new File(["%PDF-"], "doc.pdf", { type: "application/pdf" });
    fireEvent.change(screen.getByLabelText("Elegir fotos y videos"), { target: { files: [inTrip, outside, bad] } });
    await waitFor(() => expect(onDone).toHaveBeenCalledWith({ ok: 2, failed: 1, byTrip: 1 }));
    const inserts = c.ops.filter((o) => o.table === "recuerdos" && o.op === "insert").map((o) => o.args[0] as { trip_id: string | null; trip_source: string; taken_on: string });
    expect(inserts.map((i) => [i.taken_on, i.trip_id, i.trip_source]).sort()).toEqual([["2026-03-12", "lis", "fecha"], ["2026-06-01", null, "ninguno"]]);
    expect(screen.getByText("En Lisboa")).toBeInTheDocument();
    expect(screen.getByText(/Sube fotos \(JPG/)).toBeInTheDocument();
    expect(onUploaded).toHaveBeenCalledTimes(2);
    expect(screen.getByText(/hasta 60 segundos y 50 MB/)).toBeInTheDocument();
  });

  it("arrastrar y soltar en escritorio también sube", async () => {
    const c = makeClient({});
    const onDone = vi.fn();
    const encode = vi.fn(async () => null);
    render(<RecuerdosUploader client={c.client} userId="me" trips={[]} isMobile={false} onUploaded={() => {}} onDone={onDone} prepareDeps={{ encode, today: "2026-10-23" }} />);
    const heic = new File(["x"], "IMG.HEIC", { type: "image/heic" });
    fireEvent.drop(screen.getByTestId("recuerdos-dropzone"), { dataTransfer: { files: [heic] } });
    await waitFor(() => expect(onDone).toHaveBeenCalledWith({ ok: 0, failed: 1, byTrip: 0 }));
    // Chrome en computadora no abre HEIC: se dice cómo resolverlo.
    expect(screen.getByText(/no puede abrir fotos HEIC/)).toBeInTheDocument();
  });
});
