// Planear (grupo godtier): frase natural en el paso 1 interpretada sin IA, atajos de fechas y el
// callejón sin salida de ?autoCheapest sin ciudad de salida.
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { vi, beforeEach, it, expect } from "vitest";
import { parseTripFallback } from "@/lib/parseTripFallback";
import { datePresets } from "@/lib/planDefaults";

const profile = vi.hoisted(() => ({ ciudad_origen: "Ciudad de México" as string | null }));
const invoke = vi.fn(async () => ({ data: null, error: null }));
const qb: any = { select: () => qb, eq: () => qb, maybeSingle: async () => ({ data: profile.ciudad_origen ? { ciudad_origen: profile.ciudad_origen } : null, error: null }) };
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => qb, functions: { invoke: (f: string, o: any) => (invoke as any)(f, o) } } }));
const user = vi.hoisted(() => ({ id: "u1" }));
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

// El slider de viajeros (Radix) usa ResizeObserver, que jsdom no trae.
(globalThis as any).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };

const renderAt = (url: string) => render(
  <MemoryRouter initialEntries={[url]}>
    <Routes><Route path="/dashboard/planear" element={<PlanTrip />} /></Routes>
  </MemoryRouter>,
);

beforeEach(() => { sessionStorage.clear(); invoke.mockClear(); profile.ciudad_origen = "Ciudad de México"; });

it("una frase completa en el paso 1 se interpreta en el dispositivo y prellena fechas y viajeros", async () => {
  renderAt("/dashboard/planear");
  const phrase = "Oaxaca del 12 al 16 de diciembre, 2 personas";
  const expected = parseTripFallback(phrase);
  fireEvent.change(screen.getByLabelText("¿A dónde quieres ir?"), { target: { value: phrase } });
  expect(screen.getByText(/^Entendimos: Oaxaca · 12 dic.* · 2 personas$/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Continuar/ }));
  expect(await screen.findByRole("status")).toHaveTextContent(/Entendimos: Oaxaca/);
  expect(screen.getByLabelText("Salida")).toHaveValue(expected.fechaSalida);
  expect(screen.getByLabelText("Regreso")).toHaveValue(expected.fechaRegreso);
  expect(screen.getByText("2", { selector: "span" })).toBeInTheDocument();
  expect(screen.getByText("Paso 2 de 3")).toBeInTheDocument();
  // Nada se pagó: ni parsear-viaje ni analizar-viaje.
  expect(invoke).not.toHaveBeenCalled();
});

it("si la frase no trae un destino reconocible lo dice, en vez de mandarla entera como destino", () => {
  renderAt("/dashboard/planear");
  fireEvent.change(screen.getByLabelText("¿A dónde quieres ir?"), { target: { value: "algo bonito y barato con amigos en diciembre" } });
  expect(screen.getByText(/No reconocimos el destino en tu frase/)).toBeInTheDocument();
});

it("los ejemplos llenan el campo y los atajos de fechas ponen salida y regreso", async () => {
  renderAt("/dashboard/planear");
  fireEvent.click(screen.getByRole("button", { name: "Oaxaca un fin de semana, 2 personas" }));
  expect(screen.getByLabelText("¿A dónde quieres ir?")).toHaveValue("Oaxaca un fin de semana, 2 personas");
  fireEvent.click(screen.getByRole("button", { name: /Continuar/ }));
  const p = datePresets()[1];
  fireEvent.click(await screen.findByRole("button", { name: /En 2 semanas/ }));
  expect(screen.getByLabelText("Salida")).toHaveValue(p.salida);
  expect(screen.getByLabelText("Regreso")).toHaveValue(p.regreso);
  expect(screen.getByRole("button", { name: /En 2 semanas/ })).toHaveAttribute("aria-pressed", "true");
});

it("una tarjeta de destino sin ciudad de salida en el perfil ya no se queda muda: pide la ciudad", async () => {
  profile.ciudad_origen = null;
  renderAt("/dashboard/planear?destino=Lisboa&autoCheapest=1");
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Para cotizar Lisboa necesitamos tu ciudad de salida"));
  expect(invoke).not.toHaveBeenCalled();
});
