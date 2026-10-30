// Tablero de comisiones (solo administradores) en /dashboard/admin: ganado del mes por moneda, por proveedor y
// producto, clics, reservas gestionadas y aprobar/rechazar solicitudes del Operador.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { CommissionsSummary } from "@/components/AdminCommissionsCard";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));

import { AdminCommissionsCard } from "@/components/AdminCommissionsCard";

const resumen: CommissionsSummary = {
  generated_at: "2026-10-30T12:00:00Z",
  mes: "2026-10",
  totales: [{ moneda: "USD", ganado: 1.52, pendiente: 12.5, pagado: 1.52, rechazado: 0, ventas: 2 }, { moneda: "EUR", ganado: 60, pendiente: 0, ventas: 1 }],
  por_proveedor: [{ proveedor: "Aviasales", moneda: "USD", ganado: 1.52, pendiente: 0, ventas: 1 }, { proveedor: "ratehawk", moneda: "EUR", ganado: 60, pendiente: 0, ventas: 1 }],
  por_producto: [{ producto: "hotel", moneda: "EUR", ganado: 60, pendiente: 0, ventas: 1 }],
  clics: { total: 42, por_red: [{ red: "travelpayouts", clics: 30 }, { red: "viator", clics: 12 }], por_producto: [] },
  gestionadas: { total: 3, confirmadas: 2, canceladas: 1, sandbox: 1 },
  solicitudes: [{ id: "q1", kind: "cancelacion", status: "pendiente_aprobacion", created_at: "2026-10-30T10:00:00Z", consent_text: "Sí, cancela R-AB23CD",
    ref_code: "R-AB23CD", title: "Hotel Madrid", provider: "ratehawk", environment: "produccion", start_at: "2026-12-05T00:00:00Z", sell_amount: 460,
    currency: "EUR", policy_check: { gratis: true, gratis_hasta: "2026-12-01T05:00:00Z" } }],
  sincronizacion: [{ source: "travelpayouts", finished_at: "2026-10-30T09:00:00Z", ok: true, error: null }],
  banderas: { comisiones_sync_enabled: true, proveedores_reservas_enabled: false, reservas_gestionadas_cambios_enabled: false, cargo_servicio_enabled: false },
};

describe("AdminCommissionsCard", () => {
  beforeEach(() => rpc.mockReset());

  it("muestra lo ganado por moneda (sin sumar monedas), por proveedor y producto, clics y lo apagado", async () => {
    rpc.mockResolvedValue({ data: resumen, error: null });
    render(<AdminCommissionsCard />);
    expect(await screen.findByText("Comisiones · 2026-10")).toBeInTheDocument();
    expect(rpc).toHaveBeenCalledWith("admin_commissions_summary", { _month: null });
    // Intl es-MX: dólares y euros con su código; cada moneda en su línea.
    expect(screen.getAllByText("USD 1.52").length).toBeGreaterThan(0);
    expect(screen.getAllByText("EUR 60.00").length).toBeGreaterThan(0);
    expect(screen.getByText("Aviasales")).toBeInTheDocument();
    expect(screen.getByText("Hoteles")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText("travelpayouts")).toBeInTheDocument();
    expect(screen.getByText(/Apagado: Reservar\/cancelar en producción, Ejecutar cambios aprobados, Cargo por servicio/)).toBeInTheDocument();
    expect(screen.getByText(/Viajero: «Sí, cancela R-AB23CD»/)).toBeInTheDocument();
  });

  it("aprobar una solicitud llama a admin_managed_request_decide y recarga", async () => {
    rpc.mockImplementation(async (fn: string) => fn === "admin_managed_request_decide" ? { data: { ok: true, status: "aprobada" }, error: null } : { data: resumen, error: null });
    render(<AdminCommissionsCard />);
    fireEvent.click(await screen.findByRole("button", { name: "Aprobar" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("admin_managed_request_decide", { _id: "q1", _approve: true, _note: null }));
    expect(await screen.findByRole("status")).toHaveTextContent(/Aprobada/);
    expect(rpc.mock.calls.filter((c) => c[0] === "admin_commissions_summary")).toHaveLength(2);
  });

  it("si no es administrador o falta la migración, lo dice sin romper la página", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "not_authorized" } });
    render(<AdminCommissionsCard />);
    expect(await screen.findByText(/No pudimos cargar las comisiones/)).toBeInTheDocument();
  });
});
