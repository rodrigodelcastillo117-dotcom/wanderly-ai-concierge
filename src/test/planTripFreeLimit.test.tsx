// N-09: un usuario gratis sin análisis disponible entra a /dashboard/planear?q=… y no veía nada:
// ni diálogo de límite ni su frase (la intención se consumía y el montaje que la reclamó se
// cancelaba por el doble efecto / remontaje). N-08: parsear-viaje se pagaba dos veces.
import React, { StrictMode } from "react";
import { render, screen, waitFor, act } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { vi, beforeEach } from "vitest";

const PHRASE = "Fin de semana en Puebla desde CDMX, 2 personas, del 12 al 14 de diciembre";

const limit402 = () => {
  const body = JSON.stringify({
    code: "FREE_LIMIT_REACHED", quota: "trip_analysis_once", limit: 1, used: 1, upgrade_available: true,
    error: "upgrade_required", kind: "trip_analysis",
  });
  return { message: "Edge Function returned a non-2xx status code", context: new Response(body, { status: 402 }) };
};

const invoke = vi.fn(async (fn: string, _opts: any): Promise<any> => {
  if (fn === "parsear-viaje") {
    await new Promise((r) => setTimeout(r, 20));
    return { data: { destino: "Puebla", ciudad_origen: "Ciudad de México", fecha_salida: "2026-12-12", fecha_regreso: "2026-12-14", num_viajeros: 2 }, error: null };
  }
  if (fn === "analizar-viaje") return { data: null, error: limit402() };
  return { data: null, error: null };
});
const qb: any = { select: () => qb, eq: () => qb, maybeSingle: async () => ({ data: { ciudad_origen: "Ciudad de México" }, error: null }) };
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => qb, functions: { invoke: (f: string, o: any) => invoke(f, o) } } }));
const user = { id: "u1" };
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user, loading: false }) }));
vi.mock("@/components/DashboardLayout", () => ({ DashboardLayout: ({ children }: any) => <>{children}</> }));
vi.mock("@/components/AnalysisProgress", () => ({ AnalysisProgress: () => <p>ANALIZANDO</p> }));
vi.mock("@/components/TripBuildPreview", () => ({ TripBuildPreview: () => null }));
vi.mock("@/components/OriginPicker", () => ({ OriginPicker: () => null }));
vi.mock("@/components/VoiceInput", () => ({ VoiceInput: () => null }));
vi.mock("@/lib/analytics", () => ({ track: () => {} }));
vi.mock("framer-motion", () => {
  const strip = (p: any) => { const { initial, animate, exit, transition, ...r } = p; return r; };
  const cache: Record<string, any> = {};
  const motion = new Proxy({}, { get: (_t, tag: string) => (cache[tag] ??= (p: any) => React.createElement(tag, strip(p))) });
  return { motion, AnimatePresence: ({ children }: any) => <>{children}</> };
});

import PlanTrip from "@/pages/PlanTrip";
import { FreeLimitDialogHost } from "@/components/FreeLimitDialog";
import { closeFreeLimitDialog } from "@/lib/freeLimitStore";

let loc = "";
const Spy = () => { const l = useLocation(); loc = l.pathname + l.search; return null; };
const calls = (fn: string) => invoke.mock.calls.filter((c) => c[0] === fn).length;

beforeEach(() => {
  sessionStorage.clear();
  invoke.mockClear();
  act(() => closeFreeLimitDialog());
});

const app = (
  <StrictMode>
    <MemoryRouter initialEntries={[`/dashboard/planear?q=${encodeURIComponent(PHRASE)}`]}>
      <Spy />
      <FreeLimitDialogHost />
      <Routes>
        <Route path="/dashboard/planear" element={<PlanTrip />} />
        <Route path="/dashboard/viajes/:id" element={<p>VIAJE</p>} />
      </Routes>
    </MemoryRouter>
  </StrictMode>
);

it("N-09: sin análisis disponible, muestra el diálogo de límite y conserva la frase en el campo", async () => {
  render(app);
  expect(await screen.findByText("Usaste tu análisis gratuito")).toBeInTheDocument();
  expect(screen.getByText("Conocer IATOS PRO")).toBeInTheDocument();
  // La frase sigue en el campo para editarla o planear a mano.
  const input = (await screen.findByLabelText("¿A dónde quieres ir?")) as HTMLInputElement;
  expect(input.value).toBe(PHRASE);
  expect(calls("analizar-viaje")).toBe(1);
  // La URL ya no trae ?q (no se repite el análisis al volver).
  await waitFor(() => expect(loc).toBe("/dashboard/planear"));
});

it("N-08: con doble efecto (StrictMode) parsear-viaje se llama una sola vez por búsqueda", async () => {
  render(app);
  await screen.findByText("Usaste tu análisis gratuito");
  expect(calls("parsear-viaje")).toBe(1);
});
