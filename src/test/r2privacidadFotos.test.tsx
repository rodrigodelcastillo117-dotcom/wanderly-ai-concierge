// T-P2-2: fotos del diario y de "Mejores momentos" sin EXIF/GPS, en buckets PRIVADOS (enlace
// firmado) y borradas al borrar la entrada. Regresión de a2trans_adversarial.test.ts (auditor), que
// afirmaba el defecto: aquí se afirma la corrección.
import React from "react";
import { readFileSync } from "node:fs";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  user: { id: "11111111-1111-4111-8111-111111111111" },
  uploads: [] as Array<{ bucket: string; path: string; blob: Blob; opts: any }>,
  removes: [] as Array<{ bucket: string; paths: string[] }>,
  order: [] as string[],
  inserts: [] as Array<{ table: string; row: any }>,
  entries: [] as any[],
  moments: [] as any[],
}));

vi.mock("@/integrations/supabase/client", () => {
  const from = (table: string) => {
    const rows = table === "trip_journal_entries" ? h.entries : table === "travel_moments" ? h.moments
      : table === "trips" ? [{ id: "22222222-2222-4222-8222-222222222222", destino: "Lisboa", user_id: h.user.id }] : [];
    const api: any = {
      select: () => api, eq: () => api, lte: () => api, order: () => api, limit: () => api,
      maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
      insert: (row: any) => {
        h.inserts.push({ table, row });
        return { select: () => ({ single: async () => ({ data: { id: `n${h.inserts.length}`, created_at: new Date().toISOString(), ...row }, error: null }) }) };
      },
      delete: () => ({ eq: async () => { h.order.push(`delete:${table}`); return { error: null }; } }),
      then: (res: any, rej: any) => Promise.resolve({ data: rows, error: null }).then(res, rej),
    };
    return api;
  };
  const storage = {
    from: (bucket: string) => ({
      upload: async (path: string, blob: Blob, opts: any) => { h.uploads.push({ bucket, path, blob, opts }); return { error: null }; },
      remove: async (paths: string[]) => { h.removes.push({ bucket, paths }); h.order.push(`remove:${bucket}`); return { error: null }; },
      createSignedUrls: async (paths: string[]) => ({ data: paths.map((p) => ({ path: p, signedUrl: `https://signed.test/${bucket}/${p}?token=t`, error: null })), error: null }),
      getPublicUrl: (path: string) => ({ data: { publicUrl: `https://x.supabase.co/storage/v1/object/public/${bucket}/${path}` } }),
    }),
  };
  return {
    supabase: {
      from, storage, functions: { invoke: async () => ({ data: { ok: true }, error: null }) },
      auth: { getUser: async () => ({ data: { user: h.user } }) },
    },
  };
});
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: h.user, loading: false }) }));
vi.mock("@/components/DashboardLayout", () => ({ DashboardLayout: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("@/components/Tooltip", () => ({ FeatureTooltip: () => null }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import TripJournal from "@/pages/TripJournal";
import { BestMomentsPanel } from "@/components/lux/BestMomentsPanel";
import { preparePhotoFile } from "@/lib/photoUpload";
import { momentSource, PRIVATE_BUCKET } from "../../supabase/functions/tag-moment/tagging";

const TRIP = "22222222-2222-4222-8222-222222222222";
const UUID_JPG = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.jpg";
const seg = (marker: number, payload: number[]) => [0xff, marker, ((payload.length + 2) >> 8) & 0xff, (payload.length + 2) & 0xff, ...payload];
const ascii = (s: string) => Array.from(s).map((c) => c.charCodeAt(0));
/** JPEG de iPhone simulado: APP1 con EXIF/GPS antes de los datos. */
const gpsJpeg = () => new Uint8Array([0xff, 0xd8, ...seg(0xe1, ascii("Exif\0\0GPSLatitude=25.6866N;Model=iPhone 15")),
  0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x12, 0x34, 0x56, 0xff, 0xd9]);
const readBlob = (b: Blob) => new Promise<Uint8Array>((res, rej) => { const r = new FileReader(); r.onload = () => res(new Uint8Array(r.result as ArrayBuffer)); r.onerror = () => rej(r.error); r.readAsArrayBuffer(b); });
const has = (b: Uint8Array, s: string) => Buffer.from(b).includes(Buffer.from(s, "latin1"));

beforeEach(() => {
  h.uploads = []; h.removes = []; h.order = []; h.inserts = []; h.entries = []; h.moments = [];
});

const renderJournal = () => render(
  <MemoryRouter initialEntries={[`/dashboard/viajes/${TRIP}/diario`]}>
    <Routes><Route path="/dashboard/viajes/:id/diario" element={<TripJournal />} /></Routes>
  </MemoryRouter>,
);

describe("Diario del viaje (T-P2-2)", () => {
  it("la foto se sube sin EXIF/GPS, como JPEG, en {autor}/{viaje}/{uuid}.jpg y la entrada guarda la ruta (no una URL pública)", async () => {
    const { container } = renderJournal();
    await screen.findByText("Lisboa");
    fireEvent.change(screen.getByLabelText("Entrada del diario"), { target: { value: "Pastel de nata en Belém" } });
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File([gpsJpeg()], "IMG_0001.jpg", { type: "image/jpeg" })] } });
    fireEvent.click(screen.getByRole("button", { name: /Agregar/ }));
    await waitFor(() => expect(h.inserts).toHaveLength(1));
    expect(h.uploads).toHaveLength(1);
    const up = h.uploads[0];
    expect(up.bucket).toBe("journal-photos");
    expect(up.path).toMatch(new RegExp(`^${h.user.id}/${TRIP}/${UUID_JPG}$`));
    expect(up.opts).toMatchObject({ contentType: "image/jpeg", upsert: false });
    const bytes = await readBlob(up.blob);
    expect(has(bytes, "GPSLatitude")).toBe(false);
    expect(has(bytes, "iPhone")).toBe(false);
    expect(h.inserts[0].row.photo_path).toBe(up.path);
    expect(h.inserts[0].row.photo_url).toBeUndefined();
  });

  it("la foto se muestra con un enlace firmado y borrar la entrada borra primero la foto", async () => {
    const path = `${h.user.id}/${TRIP}/0f0f0f0f-0000-4000-8000-000000000001.jpg`;
    h.entries = [{ id: "e1", created_at: "2026-10-01T10:00:00Z", text: "Tranvía 28", photo_path: path, author_id: h.user.id }];
    const { container } = renderJournal();
    await screen.findByText("Tranvía 28");
    await waitFor(() => expect(container.querySelector("img")?.getAttribute("src")).toBe(`https://signed.test/journal-photos/${path}?token=t`));
    fireEvent.click(screen.getByRole("button", { name: "Eliminar esta entrada del diario" }));
    await waitFor(() => expect(h.order).toEqual(["remove:journal-photos", "delete:trip_journal_entries"]));
    expect(h.removes[0].paths).toEqual([path]);
  });

  it("el código ya no usa getPublicUrl ni sube el File original (aserciones del auditor, invertidas)", () => {
    const journal = readFileSync("src/pages/TripJournal.tsx", "utf8");
    expect(journal).not.toMatch(/getPublicUrl/);
    expect(journal).not.toMatch(/\.upload\(path, file/);
    expect(journal).toMatch(/preparePhotoFile/);
    const remove = journal.slice(journal.indexOf("const remove = async"), journal.indexOf("const remove = async") + 700);
    expect(remove).toMatch(/storage\.from\(JOURNAL_BUCKET\)\.remove/);
  });
});

describe("Mejores momentos (T-P2-2)", () => {
  it("se suben limpias al bucket privado con nombre UUID y la fila guarda image_path", async () => {
    render(<BestMomentsPanel />);
    const input = await screen.findByLabelText("Elegir fotos de tus mejores momentos");
    await screen.findByText("Sube fotos de tus mejores viajes");
    fireEvent.change(input, { target: { files: [new File([gpsJpeg()], "IMG_0002.jpg", { type: "image/jpeg" })] } });
    fireEvent.click(await screen.findByRole("button", { name: "Guardar momento" }));
    await waitFor(() => expect(h.inserts).toHaveLength(1));
    const up = h.uploads[0];
    expect(up.bucket).toBe("travel-moments-private");
    expect(up.path).toMatch(new RegExp(`^${h.user.id}/${UUID_JPG}$`));
    expect(has(await readBlob(up.blob), "GPSLatitude")).toBe(false);
    expect(h.inserts[0].row).toMatchObject({ user_id: h.user.id, image_path: up.path });
    expect(h.inserts[0].row.image_url).toBeUndefined();
    const src = readFileSync("src/components/lux/BestMomentsPanel.tsx", "utf8");
    expect(src).not.toMatch(/getPublicUrl/);
    expect(src).not.toMatch(/Math\.random\(\)\.toString\(36\)/);
  });

  it("un momento privado se muestra con enlace firmado y se borra del bucket privado", async () => {
    const path = `${h.user.id}/0e0e0e0e-0000-4000-8000-000000000001.jpg`;
    h.moments = [{ id: "m1", image_url: null, image_path: path, caption: null, trip_name: "Kioto", created_at: "2026-01-01" }];
    const { container } = render(<BestMomentsPanel />);
    await waitFor(() => expect(container.querySelector("img")?.getAttribute("src")).toBe(`https://signed.test/travel-moments-private/${path}?token=t`));
    fireEvent.click(screen.getByRole("button", { name: "Eliminar momento" }));
    await waitFor(() => expect(h.removes).toEqual([{ bucket: "travel-moments-private", paths: [path] }]));
  });
});

describe("limpieza reutilizada de la Bóveda", () => {
  it("preparePhotoFile quita EXIF/GPS (ruta de respaldo sin canvas) y rechaza lo que no es foto", async () => {
    const out = await preparePhotoFile(new File([gpsJpeg()], "a.jpg", { type: "image/jpeg" }), { reencode: async () => null });
    expect(out.type).toBe("image/jpeg");
    expect(has(await readBlob(out), "GPSLatitude")).toBe(false);
    await expect(preparePhotoFile(new File(["%PDF-1.4"], "a.pdf", { type: "application/pdf" }))).rejects.toThrow(/foto/);
    await expect(preparePhotoFile(new File(["<svg/>"], "a.svg", { type: "image/svg+xml" }))).rejects.toThrow(/foto/);
  });

  it("tag-moment lee image_path del bucket privado y los momentos viejos de su URL", () => {
    expect(momentSource({ image_path: "u/x.jpg", image_url: null })).toEqual({ bucket: PRIVATE_BUCKET, path: "u/x.jpg" });
    expect(momentSource({ image_url: "https://p.supabase.co/storage/v1/object/public/travel-moments/u/a.jpg" })).toEqual({ bucket: "travel-moments", path: "u/a.jpg" });
  });
});
