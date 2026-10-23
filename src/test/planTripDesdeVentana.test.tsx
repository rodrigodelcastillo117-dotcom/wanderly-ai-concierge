// /dashboard/planear?desde=ventana: llega de la ventana "Planear viaje" con destino, origen, fechas y
// viajeros en campos separados. Se abre el paso de fechas ya lleno, el perfil no pisa el origen
// elegido y nada se cotiza solo (ninguna llamada de pago hasta que la persona confirma).
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { vi, it, expect } from "vitest";

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
}

const invoke = vi.fn(async () => ({ data: null, error: null }));
const qb: any = { select: () => qb, eq: () => qb, maybeSingle: async () => ({ data: { ciudad_origen: "Monterrey" }, error: null }) };
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => qb, functions: { invoke: (...a: unknown[]) => invoke(...(a as [])) } } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" }, loading: false }) }));
vi.mock("@/components/DashboardLayout", () => ({ DashboardLayout: ({ children }: any) => <>{children}</> }));
vi.mock("@/components/AnalysisProgress", () => ({ AnalysisProgress: () => <p>ANALIZANDO</p> }));
vi.mock("@/components/TripBuildPreview", () => ({ TripBuildPreview: () => null }));
vi.mock("@/components/OriginPicker", () => ({ OriginPicker: ({ value }: { value: string }) => <output data-testid="origen">{value}</output> }));
vi.mock("@/components/VoiceInput", () => ({ VoiceInput: () => null }));
vi.mock("@/lib/analytics", () => ({ track: () => {} }));
vi.mock("framer-motion", () => {
  const strip = (p: any) => { const { initial, animate, exit, transition, ...r } = p; return r; };
  const cache: Record<string, any> = {};
  const motion = new Proxy({}, { get: (_t, tag: string) => (cache[tag] ??= (p: any) => React.createElement(tag, strip(p))) });
  return { motion, AnimatePresence: ({ children }: any) => <>{children}</> };
});

import PlanTrip from "@/pages/PlanTrip";

it("abre el paso de fechas con todo lleno y no cotiza solo", async () => {
  render(
    <MemoryRouter initialEntries={["/dashboard/planear?destino=Canc%C3%BAn&origen=Guadalajara&viajeros=3&desde=ventana&fecha_salida=2027-01-14&fecha_regreso=2027-01-23"]}>
      <Routes><Route path="/dashboard/planear" element={<PlanTrip />} /></Routes>
    </MemoryRouter>,
  );
  expect(await screen.findByText("¿Cuándo y con quién?")).toBeInTheDocument();
  expect(screen.getByText(/Llenamos tu viaje a Cancún desde Guadalajara/)).toBeInTheDocument();
  expect((screen.getByLabelText(/Fecha de salida|Salida/, { selector: "input" }) as HTMLInputElement).value).toBe("2027-01-14");
  await waitFor(() => expect(screen.getByTestId("origen")).toHaveTextContent("Guadalajara"));
  expect(screen.getByText("3")).toBeInTheDocument();
  expect(invoke).not.toHaveBeenCalled();
});
