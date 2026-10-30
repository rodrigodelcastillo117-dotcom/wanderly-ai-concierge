// Perfil → Ajustes (mínimo indispensable): vincular WhatsApp junto a Telegram y las preferencias de avisos (canal
// preferido y no molestar).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } },
}));

import { WhatsAppLink } from "@/components/canales/WhatsAppLink";
import { PreferenciasCanal } from "@/components/canales/PreferenciasCanal";

beforeEach(() => { invoke.mockReset(); });

const estado = (wa: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  data: { ok: true, telegram: { activo: true, bot: "IatosBot", vinculado: false }, whatsapp: { activo: true, numero: "+5215500000000", vinculado: false, telefono: null, ...wa }, preferencias: { preferido: "app", noMolestarInicio: null, noMolestarFin: null, tz: null }, ...extra },
  error: null,
});

describe("Perfil → Ajustes → WhatsApp", () => {
  it("apagado (sin secretos): lo dice y no ofrece vincular", async () => {
    invoke.mockResolvedValue(estado({ activo: false, numero: null }));
    render(<WhatsAppLink />);
    expect(await screen.findByText(/Todavía no está activo/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Vincular WhatsApp" })).toBeNull();
  });

  it("vincular: código de un solo uso y enlace que abre WhatsApp con «IATOS <código>»", async () => {
    invoke.mockImplementation(async (_fn: string, o: { body: { accion: string } }) => o.body.accion === "estado"
      ? estado({})
      : { data: { ok: true, canal: "whatsapp", codigo: "K7P2QX9M", enlace: "https://wa.me/5215500000000?text=IATOS%20K7P2QX9M", expira: "2026-10-30T15:15:00Z", numero: "+5215500000000" }, error: null });
    render(<WhatsAppLink />);
    const btn = await screen.findByRole("button", { name: "Vincular WhatsApp" });
    await act(async () => { fireEvent.click(btn); });
    const code = await screen.findByTestId("whatsapp-code");
    expect(code).toHaveTextContent("K7P2QX9M");
    expect(within(code).getByRole("link", { name: "Abrir WhatsApp" })).toHaveAttribute("href", "https://wa.me/5215500000000?text=IATOS%20K7P2QX9M");
    expect(invoke).toHaveBeenCalledWith("canales", { body: { accion: "codigo", canal: "whatsapp" } });
  });

  it("vinculado: muestra el número (oculto) y desvincula SOLO WhatsApp; los datos de Meta solo para administradores", async () => {
    invoke.mockImplementation(async (_fn: string, o: { body: { accion: string } }) => o.body.accion === "configurar_whatsapp"
      ? { data: { ok: true, proveedor: "meta", faltan: [], webhook_url: "https://p.supabase.co/functions/v1/whatsapp-webhook", verify_token: "abc123", numero: "+5215500000000" }, error: null }
      : estado({ vinculado: true, telefono: "+521•••222" }));
    const { rerender } = render(<WhatsAppLink />);
    expect(await screen.findByText(/Vinculado \(\+521•••222\)/)).toBeInTheDocument();
    expect(screen.queryByText(/Datos para conectar WhatsApp/)).toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Desvincular" })); });
    expect(invoke).toHaveBeenCalledWith("canales", { body: { accion: "desvincular", canal: "whatsapp" } });
    rerender(<WhatsAppLink isAdmin />);
    await act(async () => { fireEvent.click(screen.getByText(/Datos para conectar WhatsApp en Meta/)); });
    expect(await screen.findByTestId("whatsapp-config")).toHaveTextContent("https://p.supabase.co/functions/v1/whatsapp-webhook");
  });
});

describe("Perfil → Ajustes → Avisos de IATOS", () => {
  it("solo ofrece los canales vinculados y guarda canal preferido y no molestar con la zona del dispositivo", async () => {
    invoke.mockImplementation(async (_fn: string, o: { body: { accion: string } }) => o.body.accion === "estado"
      ? estado({ vinculado: true })
      : { data: { ok: true }, error: null });
    render(<PreferenciasCanal />);
    const sel = await screen.findByLabelText("Prefiero que me avisen por");
    const opciones = within(sel).getAllByRole("option").map((x) => x.textContent);
    expect(opciones).toEqual(["Notificaciones de la app", "WhatsApp", "Correo"]); // Telegram no está vinculado
    fireEvent.change(sel, { target: { value: "whatsapp" } });
    fireEvent.click(screen.getByLabelText("No molestar"));
    fireEvent.change(screen.getByLabelText("Desde"), { target: { value: "23:00" } });
    fireEvent.change(screen.getByLabelText("Hasta"), { target: { value: "07:30" } });
    expect(screen.getByText(/Lo urgente .* te llega por todos tus canales aunque sea de noche/)).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Guardar" })); });
    expect(invoke).toHaveBeenLastCalledWith("canales", { body: expect.objectContaining({ accion: "preferencias", preferido: "whatsapp", noMolestarInicio: "23:00", noMolestarFin: "07:30", tz: expect.any(String) }) });
    expect(await screen.findByRole("status")).toHaveTextContent("Guardado.");
  });

  it("si la base rechaza (p. ej. canal no vinculado) muestra su mensaje", async () => {
    invoke.mockImplementation(async (_fn: string, o: { body: { accion: string } }) => o.body.accion === "estado"
      ? estado({}, { preferencias: { preferido: "app", noMolestarInicio: "22:00", noMolestarFin: "08:00", tz: "America/Mexico_City" } })
      : { data: { ok: false, code: "BAD_HOURS", message: "Revisa el horario de no molestar." }, error: null });
    render(<PreferenciasCanal />);
    expect(await screen.findByLabelText("No molestar")).toBeChecked();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Guardar" })); });
    expect(await screen.findByRole("status")).toHaveTextContent("Revisa el horario de no molestar.");
  });
});
