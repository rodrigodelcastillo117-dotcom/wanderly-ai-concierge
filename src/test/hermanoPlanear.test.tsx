// Defectos 20 y 22 (E2E 28-oct-2026):
// 20. Si se cerraba la pestaña mientras se generaba, se perdía el texto original y "¿No entendimos bien tu
//     viaje?" decía "se armó antes de que guardáramos tu texto" en un viaje de hoy. Ahora la consulta viaja
//     con la petición (analizar-viaje la guarda al crear el viaje) y el mensaje no inventa cuándo se armó.
// 22. "Cancelar" en la pantalla de confirmación borraba lo escrito: vuelve con el texto intacto.
import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { vi, beforeEach, afterEach, describe, it, expect } from "vitest";
import { generateFromSpec } from "@/lib/tripSpecFlow";
import { sanitizeSavedConsulta, savedConsulta, validateTripSpec } from "../../supabase/functions/_shared/tripSpec";
import { TEPOZ_AI, TEPOZ_TEXT } from "./fixtures/viajeComplejo";

describe("20 · la consulta viaja con la petición de generación", () => {
  it("analizar-viaje recibe consulta_original e interpretación (no depende de que la pestaña siga abierta)", async () => {
    const calls: any[] = [];
    const client = {
      functions: { invoke: vi.fn(async (fn: string, o: any) => { calls.push({ fn, body: o.body }); return { data: { trip: { id: "t1", itinerario_json: [] } }, error: null }; }) },
      from: () => { const api: any = { update: () => api, eq: () => Promise.resolve({ data: null, error: null }) }; return api; },
    };
    const v = validateTripSpec(JSON.stringify(TEPOZ_AI), TEPOZ_TEXT, {});
    if (!v.ok) throw new Error("fixture");
    await generateFromSpec(client as any, v.spec, { userId: "u1" });
    const body = calls.find((c) => c.fn === "analizar-viaje")!.body;
    expect(body.consulta.consulta_original).toBe(TEPOZ_TEXT);
    expect(body.consulta.interpretacion.paradas.length).toBeGreaterThan(0);
    // Lo que el servidor acepta guardar.
    expect(sanitizeSavedConsulta(body.consulta)?.consulta_original).toBe(TEPOZ_TEXT);
  });

  it("el servidor solo guarda una consulta válida y de tamaño razonable", () => {
    const v = validateTripSpec(JSON.stringify(TEPOZ_AI), TEPOZ_TEXT, {});
    if (!v.ok) throw new Error("fixture");
    expect(sanitizeSavedConsulta(savedConsulta(v.spec))).not.toBeNull();
    expect(sanitizeSavedConsulta(null)).toBeNull();
    expect(sanitizeSavedConsulta({ consulta_original: "x" })).toBeNull();
    expect(sanitizeSavedConsulta({ consulta_original: "x".repeat(9000), interpretacion: {} })).toBeNull();
    expect(sanitizeSavedConsulta([1, 2])).toBeNull();
  });
});

// ── PlanTrip: Cancelar ──
const invoke = vi.fn(async (fn: string, _o?: unknown) => (fn === "interpretar-viaje" ? { data: null, error: new Error("502") } : { data: null, error: null }));
const qb: any = { select: () => qb, eq: () => qb, maybeSingle: async () => ({ data: { ciudad_origen: "Ciudad de México" }, error: null }) };
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => qb, functions: { invoke: (f: string, o: any) => invoke(f, o) } } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" }, loading: false }) }));
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

beforeEach(() => { sessionStorage.clear(); localStorage.clear(); invoke.mockClear(); });
afterEach(() => { vi.useRealTimers(); });

describe("22 · Cancelar en la confirmación", () => {
  it("vuelve al campo con el texto intacto", async () => {
    const text = "Viaje de 4 días a Valle de Bravo en coche desde CDMX";
    render(
      <MemoryRouter initialEntries={[`/dashboard/planear?q=${encodeURIComponent(text)}`]}>
        <Routes><Route path="/dashboard/planear" element={<PlanTrip />} /></Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByTestId("spec-review")).toBeInTheDocument();
    await act(async () => { await Promise.resolve(); });
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByTestId("spec-review")).toBeNull());
    expect(screen.getByLabelText("¿A dónde quieres ir?")).toHaveValue(text);
  });
});
