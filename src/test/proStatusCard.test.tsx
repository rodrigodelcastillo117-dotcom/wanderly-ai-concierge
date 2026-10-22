// N-02: si no se puede leer la membresía, /dashboard/pro muestra un aviso con "Reintentar"
// en lugar de un spinner eterno o de "Versión gratuita" adivinada.
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";

const rpc = vi.fn();
const qb: any = { select: () => qb, eq: () => qb, maybeSingle: async () => ({ data: { status: "comped" }, error: null }) };
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a), from: () => qb, functions: { invoke: async () => ({}) } } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" }, loading: false }) }));
vi.mock("@/components/DashboardLayout", () => ({ DashboardLayout: ({ children }: any) => <>{children}</> }));
vi.mock("@/lib/analytics", () => ({ track: () => {} }));

import Pro from "@/pages/Pro";

it("con error al cargar muestra Reintentar, y al reintentar aparece el estado", async () => {
  rpc.mockRejectedValueOnce(new Error("Failed to fetch"));
  rpc.mockResolvedValue({ data: { is_pro: true }, error: null });
  render(<MemoryRouter><Pro /></MemoryRouter>);
  const retry = await screen.findByRole("button", { name: "Reintentar" });
  expect(screen.queryByText("Versión gratuita")).toBeNull();
  fireEvent.click(retry);
  expect(await screen.findByText("PRO de cortesía · acceso permanente")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Reintentar" })).toBeNull();
});
