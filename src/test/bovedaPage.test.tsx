import React from "react";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { vi, it, expect, beforeEach, describe } from "vitest";

const USER = "b0000000-0000-4000-8000-0000000000a1";
const PASS_ID = "b1000000-0000-4000-8000-000000000001";
const state = {
  items: [] as any[],
  files: [] as any[],
  uploads: [] as any[],
  signed: [] as any[],
  inserts: [] as any[],
  invokes: [] as any[],
};

vi.mock("@/integrations/supabase/client", () => {
  const table = (name: string) => {
    let op = "select";
    let payload: any = null;
    const api: any = {
      select: () => api, order: () => api, not: () => api, limit: () => api, eq: () => api,
      insert: (row: any) => { op = "insert"; payload = row; state.inserts.push({ table: name, row }); return api; },
      update: (row: any) => { op = "update"; payload = row; return api; },
      delete: () => { op = "delete"; return api; },
      single: () => {
        if (name === "vault_files") {
          const row = { id: `f${state.files.length + 1}`, user_id: USER, created_at: "2026-10-22T00:00:00Z", ...payload };
          state.files.push(row);
          return Promise.resolve({ data: row, error: null });
        }
        return Promise.resolve({ data: { id: "new", user_id: USER, created_at: "2026-10-22T00:00:00Z", updated_at: "", ...payload }, error: null });
      },
      then: (res: any, rej: any) => {
        const data = name === "vault_items" ? state.items : name === "vault_files" ? state.files : [];
        return Promise.resolve({ data: op === "select" ? data : null, error: null }).then(res, rej);
      },
    };
    return api;
  };
  const bucket = (b: string) => ({
    upload: async (path: string, blob: Blob, opts: any) => { state.uploads.push({ b, path, blob, opts }); return { error: null }; },
    remove: async () => ({ error: null }),
    createSignedUrl: async (path: string, ttl: number) => { state.signed.push({ b, path, ttl }); return { data: { signedUrl: `https://signed.example/${path}` }, error: null }; },
  });
  return {
    supabase: {
      from: table,
      storage: { from: bucket },
      functions: { invoke: async (fn: string, opts: any) => { state.invokes.push({ fn, body: opts.body }); return { data: { ok: true, text: "• Usa tu sala VIP" }, error: null }; } },
    },
  };
});
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: USER } }) }));
vi.mock("@/components/DashboardLayout", () => ({ DashboardLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
const toastSpy = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastSpy }));

import Benefits from "@/pages/Benefits";

// Renderiza la página completa (hojas de Radix incluidas): con la máquina cargada pasa de 5 s.
vi.setConfig({ testTimeout: 20000 });

const base = { program_id: null, tier_id: null, issuer: null, tier: null, holder_name: null, visa_type: null, entries: null, valid_from: null,
  contact_phone: null, benefits: [], benefits_unverified: false, notes: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", user_id: USER };

const enc = (s: string) => Array.from(new TextEncoder().encode(s));
const seg = (m: number, p: number[]) => [0xff, m, ((p.length + 2) >> 8) & 0xff, (p.length + 2) & 0xff, ...p];
const exifJpeg = (): Uint8Array<ArrayBuffer> => new Uint8Array([0xff, 0xd8, ...seg(0xe1, [...enc("Exif\0\0"), ...enc("GPS 19.43N")]), ...seg(0xdb, [0, 1]), ...seg(0xda, [1, 1, 0, 0, 0x3f, 0]), 0x11, 0xff, 0xd9]);
const readBlob = (b: Blob) => new Promise<string>((resolve) => { const r = new FileReader(); r.onload = () => resolve(new TextDecoder("latin1").decode(new Uint8Array(r.result as ArrayBuffer))); r.readAsArrayBuffer(b); });

const writeText = vi.fn(async () => undefined);

beforeEach(() => {
  Object.assign(state, {
    items: [
      { ...base, id: PASS_ID, section: "documento", kind: "pasaporte", title: "Pasaporte mexicano", number: "G12345678", country_code: "MX", expires_on: "2031-04-12", holder_name: "ANA PRUEBA" },
      { ...base, id: "b1000000-0000-4000-8000-000000000002", section: "tarjeta", kind: "tarjeta", title: "The Platinum Card", issuer: "American Express", tier: "Platino", number: "1005", country_code: null, expires_on: null },
    ],
    files: [{ id: "f0", user_id: USER, item_id: PASS_ID, side: "frente", storage_path: `${USER}/${PASS_ID}/b2000000-0000-4000-8000-000000000001.jpg`, mime: "image/jpeg", size: 120000, created_at: "2026-01-01T00:00:00Z" }],
    uploads: [], signed: [], inserts: [], invokes: [],
  });
  try { localStorage.clear(); } catch { /* */ }
  Object.assign(navigator, { clipboard: { writeText } });
  writeText.mockClear();
  toastSpy.success.mockClear(); toastSpy.error.mockClear();
});

const renderPage = () => render(<MemoryRouter><Benefits /></MemoryRouter>);

describe("Bóveda · página", () => {
  it("muestra el pasaporte con el número oculto (••••5678) y lo revela solo al tocar «mostrar»", async () => {
    renderPage();
    const card = await screen.findByRole("button", { name: "Abrir Pasaporte mexicano" });
    expect(within(card).getByText("••••5678")).toBeInTheDocument();
    expect(card).not.toHaveTextContent("G12345678");
    expect(card).not.toHaveTextContent("G123 4567");
    fireEvent.click(within(card).getByRole("button", { name: "Mostrar número" }));
    expect(within(card).getByText("G123 4567 8")).toBeInTheDocument();
    fireEvent.click(within(card).getByRole("button", { name: "Ocultar número" }));
    expect(within(card).getByText("••••5678")).toBeInTheDocument();
  });

  it("«copiar número» copia sin mostrarlo", async () => {
    renderPage();
    const card = await screen.findByRole("button", { name: "Abrir Pasaporte mexicano" });
    fireEvent.click(within(card).getByRole("button", { name: "Copiar número de Pasaporte mexicano" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("G12345678"));
    expect(card).not.toHaveTextContent("G12345678");
  });

  it("pestañas Documentos · Membresías · Tarjetas · Seguros con conteos", async () => {
    renderPage();
    await screen.findByRole("button", { name: "Abrir Pasaporte mexicano" });
    const tabs = screen.getByRole("tablist", { name: "Secciones de tu bóveda" });
    expect(within(tabs).getAllByRole("tab").map((t) => t.textContent)).toEqual(["Documentos1", "Membresías", "Tarjetas1", "Seguros"]);
    fireEvent.click(within(tabs).getByRole("tab", { name: /Tarjetas/ }));
    const card = await screen.findByRole("button", { name: "Abrir The Platinum Card" });
    expect(within(card).getByText("•••• 1005")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Abrir Pasaporte mexicano" })).toBeNull();
  });

  it("la foto está protegida: el enlace firmado (60 s) se pide solo al tocarla", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Abrir Pasaporte mexicano" }));
    const tile = await screen.findByRole("button", { name: "Ver foto (Frente)" });
    expect(state.signed).toHaveLength(0);
    fireEvent.click(tile);
    await waitFor(() => expect(state.signed).toHaveLength(1));
    expect(state.signed[0]).toMatchObject({ b: "travel-vault", ttl: 60 });
    expect(await screen.findByRole("img", { name: /Foto del documento/ })).toHaveAttribute("referrerpolicy", "no-referrer");
  });

  it("tomar foto: sube al bucket privado un JPEG sin EXIF con ruta {user}/{item}/{uuid}.jpg", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Abrir Pasaporte mexicano" }));
    const input = await screen.findByTestId("vault-camera-input");
    expect(input).toHaveAttribute("accept", "image/*");
    expect(input).toHaveAttribute("capture", "environment");
    fireEvent.change(input, { target: { files: [new File([exifJpeg()], "IMG_4031.JPG", { type: "image/jpeg" })] } });
    await waitFor(() => expect(state.uploads).toHaveLength(1));
    const up = state.uploads[0];
    expect(up.b).toBe("travel-vault");
    expect(up.path).toMatch(new RegExp(`^${USER}/${PASS_ID}/[0-9a-f-]{36}\\.jpg$`));
    expect(up.path).not.toContain("IMG_4031");
    expect(up.opts).toMatchObject({ contentType: "image/jpeg", upsert: false });
    const bytes = await readBlob(up.blob);
    expect(bytes).not.toContain("Exif");
    expect(bytes).not.toContain("GPS");
    expect(state.inserts.find((i) => i.table === "vault_files")?.row).toMatchObject({ item_id: PASS_ID, side: "reverso", mime: "image/jpeg" });
  });

  it("«Iato, resúmeme» manda solo la tarjeta (nombre, nivel, beneficios), nunca el pasaporte ni números", async () => {
    renderPage();
    await screen.findByRole("button", { name: "Abrir Pasaporte mexicano" });
    fireEvent.click(screen.getByRole("button", { name: /Iato, resúmeme/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Resumir/ }));
    await waitFor(() => expect(state.invokes).toHaveLength(1));
    const { fn, body } = state.invokes[0];
    expect(fn).toBe("ai-tool");
    const sent = JSON.stringify(body);
    expect(sent).toContain("The Platinum Card");
    for (const secret of ["G12345678", "Pasaporte", "ANA PRUEBA", "1005", PASS_ID, "travel-vault"]) expect(sent, secret).not.toContain(secret);
    expect(await screen.findByTestId("vault-summary")).toHaveTextContent("Usa tu sala VIP");
  });
});
