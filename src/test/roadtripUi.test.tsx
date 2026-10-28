// Road trips (grupo roadtrip): UI del panel, del selector de modo por tramo, de las ideas y de la
// ruta de varios destinos con el coche como opción de primera clase.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const bridgeMock = vi.fn();
vi.mock("@/lib/bookingBridgeApi", () => ({ bridge: (...a: unknown[]) => bridgeMock(...a), newIdempotencyKey: () => "bk-test-key-123" }));

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
vi.mock("@/components/media/SmartImage", () => ({
  SmartImage: ({ alt }: any) => <div role="img" aria-label={alt}><span>Foto ilustrativa</span></div>,
}));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn() }) }));

import { ROADTRIP_ANCHOR, RoadTripJump, RoadTripPanel } from "@/components/roadtrip/RoadTripPanel";
import { TransportModePicker } from "@/components/roadtrip/TransportModePicker";
import { RoadTripIdeas } from "@/components/roadtrip/RoadTripIdeas";
import { buildRoadTripPlan } from "@/lib/roadtrip";
import MultiDestRoute from "@/pages/MultiDestRoute";

const live = (km: number, min: number) => ({ ok: true, distance_meters: km * 1000, duration_seconds: min * 60, consultado_at: "2026-10-22T12:00:00Z" });
const PLAN = buildRoadTripPlan({
  stops: ["Florencia", "Siena", "Roma"], legModes: ["coche", "coche"], legDates: ["2026-11-10", "2026-11-13"], live: [live(76, 72), null],
})!;

beforeEach(() => { bridgeMock.mockReset(); invoke.mockReset(); });

describe("RoadTripPanel", () => {
  it("muestra cada tramo con km, tiempo y su etiqueta CONSULTADO / ESTIMADO", () => {
    render(<MemoryRouter><RoadTripPanel plan={PLAN} tripId="11111111-1111-4111-8111-111111111111" /></MemoryRouter>);
    const leg0 = document.querySelector('[data-leg="0"]') as HTMLElement;
    const leg1 = document.querySelector('[data-leg="1"]') as HTMLElement;
    expect(within(leg0).getByText("76 km")).toBeInTheDocument();
    expect(within(leg0).getByText("1 h 12 min")).toBeInTheDocument();
    expect(leg0.querySelector('[data-estado="CONSULTADO"]')).not.toBeNull();
    expect(within(leg0).getByText("Google Maps, sin tráfico")).toBeInTheDocument();
    expect(leg1.querySelector('[data-estado="ESTIMADO"]')).not.toBeNull();
    expect(within(leg1).getByText("aprox. (línea recta)")).toBeInTheDocument();
  });

  it("costos: combustible estimado con fuente; renta, casetas y estacionamiento sin monto", () => {
    render(<MemoryRouter><RoadTripPanel plan={PLAN} /></MemoryRouter>);
    const fuel = document.querySelector('[data-cost="combustible-total-EUR"]') as HTMLElement;
    expect(fuel.querySelector('[data-estado="ESTIMADO"]')).not.toBeNull();
    expect(within(fuel).getByRole("link", { name: /Weekly Oil Bulletin/ })).toHaveAttribute("href", "https://energy.ec.europa.eu/data-and-analysis/weekly-oil-bulletin_en");
    for (const id of ["renta-0", "peajes", "estacionamiento", "devolucion-0"]) {
      const el = document.querySelector(`[data-cost="${id}"]`) as HTMLElement;
      expect(within(el).getByText("—")).toBeInTheDocument();
    }
    expect(screen.getByText(/No se suma al total del viaje/)).toBeInTheDocument();
  });

  it("renta: recogida y devolución, aviso del cargo one-way y botón por el Booking Bridge", () => {
    render(<MemoryRouter><RoadTripPanel plan={PLAN} tripId="11111111-1111-4111-8111-111111111111" returnCity="Florencia" /></MemoryRouter>);
    const rental = document.querySelector('[data-rental="0"]') as HTMLElement;
    expect(rental.textContent).toMatch(/Recoges en Florencia/);
    expect(rental.textContent).toMatch(/devuelves en Roma/);
    expect(within(rental).getByText(/cargo por devolver el auto en otro lugar/)).toBeInTheDocument();
    expect(within(rental).getByText(/Tu vuelo de regreso sale de Florencia/)).toBeInTheDocument();
    fireEvent.click(within(rental).getByRole("button", { name: /Buscar auto de renta/ }));
    const go = screen.getByRole("link", { name: /Continuar en Kayak/ });
    expect(go).toHaveAttribute("href", "https://www.kayak.com.mx/cars/Florence/Rome/2026-11-10/2026-11-13");
  });

  it("avisos por país con su fuente oficial y fecha de consulta", () => {
    render(<MemoryRouter><RoadTripPanel plan={PLAN} /></MemoryRouter>);
    const ztl = document.querySelector('[data-notice="it-ztl"]') as HTMLElement;
    expect(ztl.textContent).toMatch(/ZTL/);
    expect(within(ztl).getAllByRole("link")[0].getAttribute("href")).toMatch(/^https:\/\/www\.evz\.de\//);
    expect(within(ztl).getByText(/Consultada el/)).toBeInTheDocument();
  });

  it("vista previa: no ofrece reservar", () => {
    render(<MemoryRouter><RoadTripPanel plan={PLAN} preview /></MemoryRouter>);
    expect(screen.getByText(/vista previa/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Buscar auto de renta/ })).toBeNull();
  });

  it("acceso directo: resume los tramos y lleva al panel (sin tener que bajar)", () => {
    render(<MemoryRouter><RoadTripJump plan={PLAN} /><RoadTripPanel plan={PLAN} tripId="11111111-1111-4111-8111-111111111111" /></MemoryRouter>);
    const panel = screen.getByTestId("roadtrip-panel");
    expect(panel.id).toBe(ROADTRIP_ANCHOR);
    const scroll = vi.fn();
    panel.scrollIntoView = scroll;
    const jump = screen.getByTestId("roadtrip-jump");
    expect(jump).toHaveTextContent("2 tramos");
    fireEvent.click(jump);
    expect(scroll).toHaveBeenCalledTimes(1);
  });

  it("acceso directo: sin tramos no aparece; la vista previa no lleva ancla", () => {
    const { container } = render(<MemoryRouter><RoadTripJump plan={null} /><RoadTripPanel plan={PLAN} preview /></MemoryRouter>);
    expect(container.querySelector('[data-testid="roadtrip-jump"]')).toBeNull();
    expect(screen.getByTestId("roadtrip-panel").id).toBe("");
  });
});

describe("TransportModePicker", () => {
  it("elige coche para todos o mezcla por tramo", () => {
    const onChange = vi.fn();
    const { rerender } = render(<TransportModePicker stops={["Roma", "Florencia", "Siena"]} mode={null} legModes={[]} onChange={onChange} />);
    fireEvent.click(screen.getByRole("radio", { name: /En coche \(road trip\)/ }));
    expect(onChange).toHaveBeenLastCalledWith("coche", ["coche", "coche"]);
    rerender(<TransportModePicker stops={["Roma", "Florencia", "Siena"]} mode="mixto" legModes={["tren", "tren"]} onChange={onChange} />);
    const leg2 = screen.getByRole("radiogroup", { name: /Tramo 2: Florencia a Siena/ });
    fireEvent.click(within(leg2).getByRole("radio", { name: "Coche" }));
    expect(onChange).toHaveBeenLastCalledWith("mixto", ["tren", "coche"]);
  });
});

describe("RoadTripIdeas", () => {
  it("muestra rutas con foto ilustrativa, fuente y enlace a planear en coche", () => {
    render(<MemoryRouter><RoadTripIdeas /></MemoryRouter>);
    const tosc = document.querySelector('[data-route="toscana"]') as HTMLElement;
    expect(within(tosc).getByText("Foto ilustrativa")).toBeInTheDocument();
    expect(within(tosc).getByRole("link", { name: /Fuente: Visit Tuscany/ })).toHaveAttribute("href", expect.stringMatching(/^https:\/\/www\.visittuscany\.com\//));
    expect(within(tosc).getByText(/4 días \(según la fuente\)/)).toBeInTheDocument();
    const plan = within(tosc).getByRole("link", { name: /Planear este road trip/ });
    const url = new URL(plan.getAttribute("href")!, "https://x.test");
    expect(url.pathname).toBe("/dashboard/ruta");
    expect(url.searchParams.get("modo")).toBe("coche");
    expect(url.searchParams.get("destinos")).toBe("San Gimignano|Volterra|Siena|Montalcino|Pienza|Radda in Chianti");
    const amalfi = document.querySelector('[data-route="amalfi"]') as HTMLElement;
    expect(within(amalfi).getByText(/sugerencia IATOS/, { selector: "p" })).toBeInTheDocument();
  });
});

describe("Ruta de varios destinos con coche", () => {
  it("?modo=coche preselecciona el coche, muestra la vista previa ESTIMADA y manda transport_mode al servidor", async () => {
    (globalThis as any).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
    invoke.mockResolvedValue({ data: null, error: new Error("sin red en pruebas") });
    render(
      <MemoryRouter initialEntries={["/dashboard/ruta?destinos=Florencia|Siena|Roma&modo=coche&origin=Ciudad%20de%20M%C3%A9xico"]}>
        <MultiDestRoute />
      </MemoryRouter>,
    );
    expect(screen.getByRole("radio", { name: /En coche \(road trip\)/ })).toHaveAttribute("aria-checked", "true");
    const panel = await screen.findByTestId("roadtrip-panel");
    expect(within(panel).getByText(/vista previa/)).toBeInTheDocument();
    expect(panel.querySelectorAll('[data-estado="CONSULTADO"]')).toHaveLength(0);
    // Mezclar: el segundo tramo en tren quita ese tramo de la vista previa.
    fireEvent.click(screen.getByRole("radio", { name: /Mezclar por tramo/ }));
    fireEvent.click(within(screen.getByRole("radiogroup", { name: /Tramo 2: Siena a Roma/ })).getByRole("radio", { name: "Tren" }));
    await waitFor(() => expect(screen.getByTestId("roadtrip-panel").querySelectorAll("[data-leg]")).toHaveLength(1));
    // Generar (veterano o no): el cuerpo lleva el modo por tramo.
    fireEvent.click(screen.getByRole("button", { name: /Configurar y generar|Generar ruta automáticamente/ }));
    const gen = screen.queryByRole("button", { name: /^Generar ruta$/ });
    if (gen) fireEvent.click(gen);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("logistics-plan", expect.anything()));
    const body = invoke.mock.calls.find((c) => c[0] === "logistics-plan")![1].body;
    expect(body.prefs).toMatchObject({ transport_mode: "mixto", leg_modes: ["coche", "tren"] });
  });
});

import TripCars from "@/pages/TripCars";

describe("Renta de auto con devolución en otra ciudad", () => {
  it("precarga recogida, devolución y fechas, avisa del cargo y busca con ambas ciudades", () => {
    render(
      <MemoryRouter initialEntries={["/dashboard/autos?city=Florencia&dropoff=Roma&pickup=2026-11-10&return=2026-11-13"]}>
        <TripCars />
      </MemoryRouter>,
    );
    expect(screen.getByLabelText(/Devolver en otra ciudad/)).toHaveValue("Roma");
    expect(screen.getByTestId("tripcars-one-way").textContent).toMatch(/cargo extra/);
    expect(screen.getByText(/Recoges en Florencia y devuelves en Roma/)).toBeInTheDocument();
    const open = vi.spyOn(window, "open").mockReturnValue({} as Window);
    fireEvent.click(screen.getByRole("button", { name: /Buscar/ }));
    expect(open).toHaveBeenCalledWith("https://www.kayak.com.mx/cars/Florence/Rome/2026-11-10/2026-11-13", "_blank");
  });
});
