// Vigilancia proactiva · lo mínimo de pantalla: el consentimiento para contactar proveedores (apagado por omisión,
// texto claro, se guarda el texto aceptado), la sección "Vigilancia" de la Mesa (plegada; solo si la base responde)
// y a dónde lleva un aviso de vigilancia.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { notificationTarget } from "@/lib/notificationTarget";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));

import { ContactoProveedoresPref, TEXTO_CONSENTIMIENTO } from "@/components/vigilancia/ContactoProveedoresPref";
import { VigilanciaPanel } from "@/components/vigilancia/VigilanciaPanel";

beforeEach(() => rpc.mockReset());

describe("consentimiento para contactar proveedores", () => {
  it("apagado por omisión, con texto claro; al encenderlo guarda el texto exacto", async () => {
    rpc.mockImplementation(async (fn: string) => fn === "my_vigilancia_prefs" ? { data: { contactar_proveedores: false }, error: null } : { data: { ok: true }, error: null });
    render(<ContactoProveedoresPref />);
    const sw = await screen.findByRole("switch", { name: "Que IATOS contacte a mis proveedores en mi nombre" });
    expect(sw).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText(TEXTO_CONSENTIMIENTO)).toBeInTheDocument();
    expect(TEXTO_CONSENTIMIENTO).toMatch(/sin pagar, cambiar ni cancelar nada/);
    fireEvent.click(sw);
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("my_vigilancia_prefs_set", { _contactar: true, _texto: TEXTO_CONSENTIMIENTO }));
    await waitFor(() => expect(sw).toHaveAttribute("aria-checked", "true"));
    expect(screen.getByRole("status")).toHaveTextContent(/reconfirmaremos/);
  });
  it("si no se pudo leer la preferencia no se muestra nada (no se adivina)", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "x" } });
    const { container } = render(<ContactoProveedoresPref />);
    await waitFor(() => expect(rpc).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
  it("al apagarlo manda false sin texto", async () => {
    rpc.mockImplementation(async (fn: string) => fn === "my_vigilancia_prefs" ? { data: { contactar_proveedores: true }, error: null } : { data: { ok: true }, error: null });
    render(<ContactoProveedoresPref />);
    fireEvent.click(await screen.findByRole("switch"));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("my_vigilancia_prefs_set", { _contactar: false, _texto: null }));
  });
});

describe("Mesa › Vigilancia", () => {
  it("muestra vuelos vigilados, confirmaciones y hallazgos, con enlace al caso", async () => {
    rpc.mockResolvedValue({ error: null, data: {
      enabled: true, cupo: { tope: 30, usados: 4 },
      vuelos: [{ id: "v1", vuelo: "IB6400", fecha: "2026-11-02", ruta: "MAD→MEX", viajero: "Ana", destino: "Madrid", estado: "cancelado", ultimo_resultado: "ok",
        ultima_revision_at: null, proxima_revision_at: null, activo: false, incidente_id: "i1" },
        { id: "v2", vuelo: "AM401", fecha: "2026-11-03", ruta: null, viajero: "Beto", destino: null, estado: null, ultimo_resultado: "no_data",
          ultima_revision_at: null, proxima_revision_at: "2026-11-02T10:00:00Z", activo: true, incidente_id: null }],
      confirmaciones: [{ id: "c1", tipo: "traslado", proveedor: "Traslados Sol", servicio_at: "2026-11-03T20:00:00Z", estado: "sin_consentimiento", viajero: "Ana", incidente_id: null }],
      eventos: [{ id: 1, ambito: "vuelo", tipo: "vuelo_cancelado", resumen: "IB6400 del 2026-11-02: cancelación.", at: "2026-11-01T09:00:00Z", viajero: "Ana", incidente_id: "i1" }],
    } });
    render(<MemoryRouter><VigilanciaPanel /></MemoryRouter>);
    const panel = await screen.findByTestId("vigilancia-panel");
    expect(rpc).toHaveBeenCalledWith("admin_vigilancia_resumen");
    expect(panel).toHaveTextContent("1 vuelo vigilado · SerpApi hoy 4/30 · 1 hallazgo reciente");
    expect(panel).toHaveTextContent("sin dato de la fuente");
    expect(panel).toHaveTextContent("sin permiso del viajero");
    expect(panel).toHaveTextContent("IB6400 del 2026-11-02: cancelación.");
    expect(screen.getByRole("link", { name: "ver caso" })).toHaveAttribute("href", "/admin/operaciones?id=i1");
    expect(panel.hasAttribute("open")).toBe(false);
  });
  it("si la base no responde (o no es admin) la sección no aparece", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "42501" } });
    const { container } = render(<MemoryRouter><VigilanciaPanel /></MemoryRouter>);
    await waitFor(() => expect(rpc).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});

describe("aviso de vigilancia en la campana", () => {
  it("lleva al viaje; sin viaje, a Mis solicitudes", () => {
    expect(notificationTarget({ type: "vigilancia", related_id: "t1" })).toBe("/dashboard/viajes/t1");
    expect(notificationTarget({ type: "vigilancia", related_id: null })).toBe("/dashboard/concierge?tab=solicitudes");
  });
});
