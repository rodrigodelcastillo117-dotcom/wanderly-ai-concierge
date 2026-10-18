import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));
vi.mock("@/components/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import AdminMetrics from "@/pages/AdminMetrics";

const weekly = Array.from({ length: 12 }, (_, i) => ({
  week: `2026-08-${String(i + 1).padStart(2, "0")}`, signups: i, trips: i * 2, bookings: i % 3,
}));
const metrics = {
  generated_at: "2026-10-18T12:00:00Z",
  users: { total: 10, last_7d: 1, last_30d: 3, active_30d: 4 },
  activation: { users_with_trip: 6, pct: 60 },
  trips: { total: 20, last_30d: 5, avg_total_mxn: 85000 },
  concierge: { conversations: 1, users: 1, messages: 2 },
  bookings: { total: 7, last_30d: 2, by_category: { flight: 4, hotel: 3 } },
  affiliate_clicks: { total: 1, last_30d: 1 },
  price_watches: { active: 2, total: 3, alerts_sent: 1, checks: 9 },
  subscriptions: { comped: 10 },
  fixer: { total: 6, last_30d: 0 },
  referrals: { total: 0, last_30d: 0, referrers: 0 },
  weekly,
};

const renderPage = () => render(<MemoryRouter><AdminMetrics /></MemoryRouter>);

describe("AdminMetrics", () => {
  beforeEach(() => rpc.mockReset());

  it("renders live metrics, categories and weekly trends", async () => {
    rpc.mockResolvedValue({ data: metrics, error: null });
    renderPage();
    expect(await screen.findByText("Métricas de IATOS")).toBeInTheDocument();
    expect(screen.getByText("60%")).toBeInTheDocument();
    expect(screen.getByText("$85,000")).toBeInTheDocument();
    expect(screen.getByText("Vuelos")).toBeInTheDocument();
    expect(screen.getByText("Cortesía")).toBeInTheDocument();
    expect(screen.getAllByRole("img")).toHaveLength(3);
  });

  it("shows an access message for non-admins", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "not_authorized" } });
    renderPage();
    expect(await screen.findByText("Acceso solo para administradores")).toBeInTheDocument();
  });
});
