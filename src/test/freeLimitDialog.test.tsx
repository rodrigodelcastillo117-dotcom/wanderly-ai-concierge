import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FreeLimitDialog } from "@/components/FreeLimitDialog";

describe("FreeLimitDialog", () => {
  it("concierge: copia con fecha y los dos botones", () => {
    const onClose = vi.fn();
    const onUpgrade = vi.fn();
    render(<FreeLimitDialog onClose={onClose} onUpgrade={onUpgrade}
      info={{ quota: "concierge_monthly", limit: 3, used: 3, renewsAt: "2026-11-01T00:00:00Z", upgradeAvailable: true }} />);
    expect(screen.getByText(/Se renuevan el 1 de noviembre de 2026/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Conocer IATOS PRO"));
    expect(onUpgrade).toHaveBeenCalled();
    fireEvent.click(screen.getByText("Continuar con la versión gratuita"));
    expect(onClose).toHaveBeenCalled();
  });

  it("análisis de una sola vez: sin promesa de renovación", () => {
    render(<FreeLimitDialog onClose={() => {}} onUpgrade={() => {}}
      info={{ quota: "trip_analysis_once", limit: 1, used: 1, renewsAt: null, upgradeAvailable: true }} />);
    expect(screen.getByText(/es de una sola vez/)).toBeInTheDocument();
    expect(screen.queryByText(/renuev/i)).toBeNull();
  });

  it("plan de pago en su límite: sin botón de PRO", () => {
    render(<FreeLimitDialog onClose={() => {}} onUpgrade={() => {}}
      info={{ quota: "concierge_monthly", limit: 100, used: 100, renewsAt: "2026-11-01T00:00:00Z", upgradeAvailable: false }} />);
    expect(screen.getByText(/Llegaste al límite mensual de tu plan/)).toBeInTheDocument();
    expect(screen.queryByText("Conocer IATOS PRO")).toBeNull();
    expect(screen.getByText("Entendido")).toBeInTheDocument();
  });
});
