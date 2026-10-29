// R2 viajes (parcial de ronda 1, P1-11): «Hazme mi video» en Recuerdos llevaba a Wrapped, que decía «Tus
// 9 viajes de 2026 todavía no empiezan» y no podía hacer ningún video. Ahora el botón solo aparece cuando
// el video sí se puede armar (hay un viaje que ya empezó); si no, el texto lo dice sin prometer nada.
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "me" } }) }));
vi.mock("@/components/DashboardLayout", () => ({ DashboardLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }));

import Recuerdos from "@/pages/Recuerdos";
import type { RecuerdosClient } from "@/lib/recuerdos/api";
import { videoAvailable } from "@/lib/recuerdos/model";
import { localISODatePlus } from "@/lib/localDate";

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


const data = (salida: string) => ({ recuerdos: [], travel_moments: [], trip_journal_entries: [], trip_collaborators: [], recuerdos_album_shares: [],
  trips: [{ id: "t1", destino: "Madrid", fecha_salida: salida, fecha_regreso: salida }] });

describe("«Hazme mi video» solo cuando se puede", () => {
  it("videoAvailable: algún viaje ya empezó", () => {
    expect(videoAvailable([{ fecha_salida: "2027-03-10" }], "2026-10-29")).toBe(false);
    expect(videoAvailable([{ fecha_salida: "2026-03-10" }, { fecha_salida: null }], "2026-10-29")).toBe(true);
  });

  it("todos los viajes en el futuro: sin botón y con texto honesto", async () => {
    render(<MemoryRouter><Recuerdos client={makeClient(data(localISODatePlus(30))).client} /></MemoryRouter>);
    expect(await screen.findByText(/Cuando empiece tu primer viaje, tu IATOS Wrapped podrá armar un video/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Hazme mi video/ })).toBeNull();
  });

  it("con un viaje que ya empezó: el botón lleva a crear el video", async () => {
    render(<MemoryRouter><Recuerdos client={makeClient(data(localISODatePlus(-5))).client} /></MemoryRouter>);
    await waitFor(() => expect(screen.getByRole("link", { name: /Hazme mi video/ })).toHaveAttribute("href", "/wrapped?video=1"));
  });
});
