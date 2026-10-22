// Punto 5 del caso Roma → Florencia → Venecia: el dueño puso 23 → 30 oct en la pantalla y se guardó
// 22 oct → 1 nov. Se recorre el flujo real de /dashboard/ruta (MultiDestRoute + TripBuildPreview) y se
// comprueba qué fechas llegan a logistics-plan y a la fila de trips.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

const invoke = vi.fn();
const inserts: Array<{ table: string; row: any }> = [];
const chain = (table: string): any => {
  const c: any = new Proxy({}, {
    get: (_t, k) => {
      if (k === "then") return (r: any) => r({ data: [], error: null, count: 3 });
      if (k === "insert") return (row: any) => { inserts.push({ table, row }); return c; };
      if (k === "single" || k === "maybeSingle") return async () => ({ data: { id: "trip-1", ciudad_origen: null }, error: null });
      return () => c;
    },
  });
  return c;
};
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: null } }), getUser: async () => ({ data: { user: null } }) },
    from: (t: string) => chain(t),
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1", email: "a@b.mx" } }) }));
vi.mock("@/components/DashboardLayout", () => ({ DashboardLayout: ({ children }: any) => <div>{children}</div> }));
vi.mock("@/components/RouteGlobe3D", () => ({ RouteGlobe3D: () => null }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }) }));

import MultiDestRoute from "@/pages/MultiDestRoute";

const LOGISTICS = { fx_usd_mxn: 18.5, flights: [], per_destination: [], days: [], total_estimado_mxn: 300000, desglose_presupuesto: { vuelos: 1 }, resumen: "" };

let lastSearch = "";
const Spy = () => { lastSearch = useLocation().search; return null; };
const URL0 = "/dashboard/ruta?origin=Ciudad%20de%20M%C3%A9xico%20&destinos=Roma|Florencia|Venecia&fecha_salida=2026-10-22&fecha_regreso=2026-11-01&viajeros=2";
const page = (url = URL0) => (
  <MemoryRouter initialEntries={[url]}>
    <Routes>
      <Route path="/dashboard/ruta" element={<><MultiDestRoute /><Spy /></>} />
      <Route path="/dashboard/viajes/:id" element={<p>viaje guardado</p>} />
    </Routes>
  </MemoryRouter>
);

async function setDates(salida: string, regreso: string) {
  fireEvent.click(screen.getByRole("button", { name: /Fechas/ }));
  fireEvent.change(await screen.findByLabelText("Fecha de ida"), { target: { value: salida } });
  fireEvent.change(screen.getByLabelText("Fecha de regreso"), { target: { value: regreso } });
}

async function generate() {
  fireEvent.click(screen.getByRole("button", { name: /Configurar y generar|Generar ruta automáticamente/ }));
  const gen = screen.queryByRole("button", { name: /^Generar ruta$/ });
  if (gen) fireEvent.click(gen);
  await waitFor(() => expect(inserts.some((i) => i.table === "trips")).toBe(true));
  return { body: invoke.mock.calls.find((c) => c[0] === "logistics-plan")![1].body, row: inserts.find((i) => i.table === "trips")!.row };
}

beforeEach(() => {
  inserts.length = 0;
  invoke.mockReset();
  invoke.mockImplementation(async (fn: string, { body }: any) => (fn === "logistics-plan" && body?.action !== "snapshot" ? { data: { logistics: LOGISTICS }, error: null } : { data: { ok: true }, error: null }));
  sessionStorage.clear();
});

describe("fechas del viaje multi-destino", () => {
  it("las fechas elegidas en pantalla (23 → 30 oct) son las que se cotizan y se guardan", async () => {
    render(page());
    await setDates("2026-10-23", "2026-10-30");
    expect(screen.getByRole("button", { name: /Fechas/ }).textContent).toMatch(/23 oct.*30 oct.*7n/);
    const { body, row } = await generate();
    expect([body.fecha_salida, body.fecha_regreso]).toEqual(["2026-10-23", "2026-10-30"]);
    expect([row.fecha_salida, row.fecha_regreso]).toEqual(["2026-10-23", "2026-10-30"]);
    expect(row.pais_destino).toBe("Italia");
    expect(row.ciudad_origen).toBe("Ciudad de México");
  });

  it("si la página se vuelve a montar (recarga, sesión que se refresca), conserva las fechas elegidas y no vuelve a las de la URL", async () => {
    const { unmount } = render(page());
    await setDates("2026-10-23", "2026-10-30");
    // Las fechas elegidas quedan en la URL: es lo que lee un nuevo montaje.
    await waitFor(() => expect(lastSearch).toMatch(/fecha_salida=2026-10-23/));
    const kept = lastSearch;
    unmount();
    render(page(`/dashboard/ruta${kept}`));
    expect(screen.getByRole("button", { name: /Fechas/ }).textContent).toMatch(/23 oct.*30 oct/);
    const { body, row } = await generate();
    expect([body.fecha_salida, body.fecha_regreso, row.fecha_salida, row.fecha_regreso]).toEqual(["2026-10-23", "2026-10-30", "2026-10-23", "2026-10-30"]);
  });

  it("antes de generar dice con qué fechas se va a cotizar (sin sorpresas al llegar al viaje)", async () => {
    render(page());
    await setDates("2026-10-23", "2026-10-30");
    expect(screen.getByTestId("ruta-fechas-confirmacion").textContent).toMatch(/23 oct.*30 oct.*7 noches/);
  });
});
