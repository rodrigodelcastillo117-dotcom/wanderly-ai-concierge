// Vista previa de lugares del mundo en la ruta multidestino y en "Planear viaje": place-resolve solo se
// llama cuando la persona ESCRIBE un destino que la tabla curada y el catálogo no conocen (nunca al abrir).
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, act } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

const invoke = vi.fn();
const chain: any = new Proxy({}, {
  get: (_t, k) => (k === "then" ? (r: any) => r({ data: null, error: null, count: 0 }) : () => chain),
});
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: null } }), getUser: async () => ({ data: { user: null } }) },
    from: () => chain,
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1", email: "a@b.mx" } }) }));
vi.mock("@/components/DashboardLayout", () => ({ DashboardLayout: ({ children }: any) => <div>{children}</div> }));
vi.mock("@/components/RouteGlobe3D", () => ({ RouteGlobe3D: () => null }));
vi.mock("@/components/plan/ExploreMap", () => ({ ExploreMap: () => null }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn() }) }));

import MultiDestRoute from "@/pages/MultiDestRoute";
import { PlanTripDialog } from "@/components/plan/PlanTripDialog";
import { __resetPlaceResolveCache, shouldPreview } from "@/lib/placeResolveClient";

const BAVIERA = { input: "Baviera", status: "ok", kind: "region", name: "Baviera", country: "DE", bases: ["Múnich", "Núremberg", "Augsburgo"] };
const placeCalls = () => invoke.mock.calls.filter((c) => c[0] === "place-resolve");

beforeEach(() => {
  __resetPlaceResolveCache();
  invoke.mockReset();
  invoke.mockImplementation(async (name: string, opts: { body: { destinations?: string[] } }) => {
    if (name === "place-resolve") {
      return { data: { results: (opts.body.destinations ?? []).map((d) => (d === "Baviera" ? BAVIERA : { input: d, status: "ok", kind: "town", name: d })) }, error: null };
    }
    return { data: null, error: new Error("sin red en pruebas") };
  });
  (globalThis as any).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
});

describe("qué se consulta", () => {
  it("ni la tabla curada, ni ciudades del catálogo, ni el principio de un lugar conocido", () => {
    expect(shouldPreview("Toscana")).toBe(false);
    expect(shouldPreview("Roma")).toBe(false);
    expect(shouldPreview("Pari")).toBe(false);
    expect(shouldPreview("Baviera")).toBe(true);
    expect(shouldPreview("Francia")).toBe(true);
  });
});

describe("Ruta multidestino", () => {
  it("abrir con destinos en la URL no consulta; escribir Baviera muestra Baviera → Múnich · Núremberg", async () => {
    render(
      <MemoryRouter initialEntries={["/dashboard/ruta?destinos=Viena|Francia&origin=Ciudad%20de%20M%C3%A9xico"]}>
        <MultiDestRoute />
      </MemoryRouter>,
    );
    await act(async () => { await new Promise((r) => setTimeout(r, 1200)); });
    expect(placeCalls()).toHaveLength(0);
    fireEvent.change(screen.getByLabelText("Agregar ciudad o pedir un cambio a la IA"), { target: { value: "Baviera" } });
    fireEvent.submit(screen.getByLabelText("Agregar ciudad o pedir un cambio a la IA").closest("form")!);
    await waitFor(() => expect(placeCalls()).toHaveLength(1), { timeout: 3000 });
    expect(placeCalls()[0][1]).toEqual({ body: { destinations: ["Baviera"] } });
    const box = await screen.findByTestId("region-bases");
    expect(box.textContent).toContain("Baviera →");
    expect(box.textContent).toContain("Múnich");
    expect(box.textContent).toContain("Núremberg");
  });
});

function Probe({ onPath }: { onPath: (p: string) => void }) {
  const l = useLocation();
  onPath(`${l.pathname}${l.search}`);
  return null;
}

describe("Planear viaje", () => {
  it("escribir una región fuera del catálogo la muestra y Explorar lleva a la ruta por sus ciudades", async () => {
    let path = "";
    render(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <Probe onPath={(p) => { path = p; }} />
        <Routes><Route path="*" element={<PlanTripDialog open onOpenChange={() => {}} />} /></Routes>
      </MemoryRouter>,
    );
    expect(placeCalls()).toHaveLength(0);
    fireEvent.change(screen.getByRole("combobox", { name: "¿A dónde?" }), { target: { value: "Baviera" } });
    await waitFor(() => expect(placeCalls()).toHaveLength(1), { timeout: 3000 });
    const box = await screen.findByTestId("region-bases");
    expect(box.textContent).toContain("Baviera →");
    fireEvent.click(screen.getByRole("button", { name: /^Explorar$/ }));
    await waitFor(() => expect(path.startsWith("/dashboard/ruta?")).toBe(true));
    const qs = new URLSearchParams(path.split("?")[1]);
    expect(qs.get("destinos")).toBe("Múnich|Núremberg");
  });
});
