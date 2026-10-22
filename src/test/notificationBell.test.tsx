import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { notificationTarget } from "@/lib/notificationTarget";

const rows = Array.from({ length: 20 }, (_, i) => ({
  id: `n${i}`, type: i === 0 ? "flight_update" : "info", title: i === 0 ? "Vuelo AM58 actualizado" : `Aviso ${i}`,
  body: i === 0 ? "Puerta asignada: B12" : null, related_id: i === 0 ? "trip-1" : null, read: i > 2, created_at: new Date().toISOString(),
}));
let unreadTotal = 37;
const updates: unknown[] = [];

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));
vi.mock("@/integrations/supabase/client", () => {
  const from = () => {
    let head = false;
    const q: Record<string, unknown> = {};
    q.select = (_c: string, opts?: { head?: boolean }) => { head = !!opts?.head; return q; };
    q.eq = () => q;
    q.order = () => q;
    q.limit = async () => ({ data: rows, error: null });
    q.update = (v: unknown) => { updates.push(v); return q; };
    q.then = (res: (v: unknown) => unknown) => res(head ? { count: unreadTotal, error: null } : { data: null, error: null });
    return q;
  };
  const channel = { on: () => channel, subscribe: () => channel };
  return { supabase: { from, channel: () => channel, removeChannel: vi.fn(), rpc: vi.fn() } };
});

import { NotificationBell } from "@/components/NotificationBell";

function Where() {
  const l = useLocation();
  return <p data-testid="where">{l.pathname}</p>;
}
const renderBell = () => render(
  <MemoryRouter initialEntries={["/dashboard"]}>
    <NotificationBell />
    <Routes><Route path="*" element={<Where />} /></Routes>
  </MemoryRouter>,
);

describe("NotificationBell (C-15)", () => {
  beforeEach(() => { unreadTotal = 37; updates.length = 0; });

  it("shows the real unread count from a count query, not only among the last 20", async () => {
    unreadTotal = 5; // 3 no leídas en las 20 visibles, 5 en total
    renderBell();
    expect(await screen.findByText("5")).toBeInTheDocument();
  });

  it("caps the badge at 9+", async () => {
    renderBell();
    expect(await screen.findByText("9+")).toBeInTheDocument();
  });

  it("a flight alert with a trip opens that trip", async () => {
    renderBell();
    fireEvent.click(await screen.findByRole("button", { name: "Notificaciones" }));
    fireEvent.click(await screen.findByText("Vuelo AM58 actualizado"));
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/dashboard/viajes/trip-1"));
    expect(updates).toContainEqual({ read: true });
  });

  it("knows where each notification type leads", () => {
    expect(notificationTarget({ type: "flight_update", related_id: "t9" })).toBe("/dashboard/viajes/t9");
    expect(notificationTarget({ type: "flight_update", related_id: null })).toBe("/dashboard/concierge");
    expect(notificationTarget({ type: "price_drop", related_id: "t2" })).toBe("/dashboard/viajes/t2");
    expect(notificationTarget({ type: "info", related_id: "t2" })).toBeNull();
  });
});
