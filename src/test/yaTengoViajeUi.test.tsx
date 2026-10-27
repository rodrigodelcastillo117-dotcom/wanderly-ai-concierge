// "Ya tengo mi viaje" (pantallas): la opción se ve en la ventana "Planear viaje", el formulario crea el
// viaje con 0 llamadas a SerpApi, logistics-plan o IA (solo geocode-address por hotel, al confirmar) y
// lleva al detalle; un viaje traído se ve bien en el detalle y en Comprar: sin "$0" ni "estimado".
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { vi, it, expect, describe, beforeEach } from "vitest";

const FORBIDDEN = ["logistics-plan", "serpapi-quote", "flights-search", "hotels-search", "travelpayouts-flights", "price-watch",
  "analizar-viaje", "parsear-viaje", "editar-viaje-ai", "concierge-chat", "ai-tool", "resolver-fechas", "recomendar-destinos"];

const db = vi.hoisted(() => ({ trip: null as any, inserts: [] as any[], updates: [] as any[] }));
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => {
  const from = (table: string) => {
    let kind = "select";
    const api: any = {
      select: () => api, eq: () => api, not: () => api, order: () => api, limit: () => api, in: () => api,
      update: (p: any) => { kind = "update"; db.updates.push({ table, p }); return api; },
      insert: (row: any) => { kind = "insert"; db.inserts.push({ table, row }); return api; },
      maybeSingle: async () => ({ data: table === "trips" ? db.trip : table === "profiles" ? { ciudad_origen: "Ciudad de México" } : null, error: null }),
      single: async () => ({ data: kind === "insert" && table === "trips" ? { id: "trip-traido-1" } : null, error: null }),
      then: (res: any, rej: any) => Promise.resolve({ data: kind === "update" ? [] : [], error: null }).then(res, rej),
    };
    return api;
  };
  return { supabase: { from, functions: { invoke: (...a: unknown[]) => invoke(...a) }, auth: { getSession: async () => ({ data: { session: null } }) } } };
});
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" }, loading: false }) }));
vi.mock("@/components/DashboardLayout", () => ({ DashboardLayout: ({ children }: any) => <>{children}</> }));
vi.mock("@/components/DestinationVideo", () => ({ DestinationVideo: () => null }));
vi.mock("@/components/CityCollapsible", () => ({ CityCollapsible: ({ children, city }: any) => <div data-testid="city">{city}{children}</div>, useCityImage: () => null }));
vi.mock("@/components/EditWithAIDialog", () => ({ EditWithAIDialog: () => null }));
vi.mock("@/components/InviteFriendDialog", () => ({ InviteFriendDialog: () => null }));
vi.mock("@/components/TripDocuments", () => ({ TripDocuments: () => null }));
vi.mock("@/components/media/SmartImage", () => ({ SmartImage: ({ alt }: { alt: string }) => <span>{alt}</span>, IllustrativeCaption: () => null }));
vi.mock("@/lib/tripPdf", () => ({ generateTripPDF: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

import TripDetail from "@/pages/TripDetail";
import { PlanTripDialog } from "@/components/plan/PlanTripDialog";
import { broughtTripInsert } from "@/lib/broughtTrip";

const GEO: Record<string, any> = {
  "Hotel Artemide, Roma": { lat: 41.9009, lng: 12.4943, name: "Hotel Artemide", label: "Via Nazionale, 22, 00184 Roma RM, Italia", place_id: "ChIJ-artemide" },
  "Hotel Brunelleschi, Florencia": { lat: 43.7713, lng: 11.2556, name: "Hotel Brunelleschi", label: "Piazza Santa Elisabetta, 3, 50122 Firenze FI, Italia", place_id: "ChIJ-brunelleschi" },
};

beforeEach(() => {
  db.inserts.length = 0;
  db.updates.length = 0;
  invoke.mockReset();
  invoke.mockImplementation(async (fn: string, opts: any) => {
    if (fn === "geocode-address") return GEO[opts?.body?.address] ? { data: GEO[opts.body.address], error: null } : { data: null, error: new Error("404") };
    return { data: null, error: null };
  });
  localStorage.clear();
});

let lastPath = "";
function Probe() { const l = useLocation(); lastPath = l.pathname; return null; }

describe("Entrada: 'Ya tengo vuelos y hotel' en Planear viaje", () => {
  it("la opción se ve y abre el formulario; en ese modo no se lee ni la caché de vuelos baratos", async () => {
    render(<MemoryRouter><PlanTripDialog open onOpenChange={() => {}} /></MemoryRouter>);
    const opt = await screen.findByTestId("plan-modo-traido");
    expect(opt).toHaveTextContent("Ya tengo vuelos y hotel");
    invoke.mockClear();
    fireEvent.click(opt);
    expect(await screen.findByTestId("brought-form")).toBeInTheDocument();
    expect(screen.queryByText(/Vuelos baratos desde/)).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("4 ciudades (Toscana con sus bases), fechas, hotel y vuelo: guarda con 0 SerpApi/logistics/IA y lleva al detalle", async () => {
    render(
      <MemoryRouter initialEntries={["/dashboard/viajes"]}>
        <Probe />
        <Routes><Route path="*" element={<PlanTripDialog open onOpenChange={() => {}} startMode="traido" />} /></Routes>
      </MemoryRouter>,
    );
    const form = await screen.findByTestId("brought-form");
    const stops = ["Roma", "Florencia", "Venecia", "Toscana"];
    stops.forEach((s, i) => {
      if (i > 0) fireEvent.click(within(form).getByRole("button", { name: /Agregar ciudad/ }));
      fireEvent.change(within(form).getAllByRole("combobox")[i], { target: { value: s } });
    });
    // Toscana → Siena y Lucca (tabla curada, sin red).
    await waitFor(() => expect(within(form).getAllByTestId("brought-city").map((li) => li.getAttribute("data-city"))).toEqual(["Roma", "Florencia", "Venecia", "Siena", "Lucca"]));
    const days = ["2027-05-01", "2027-05-04", "2027-05-06", "2027-05-08", "2027-05-10", "2027-05-12"];
    ["Roma", "Florencia", "Venecia", "Siena", "Lucca"].forEach((c, i) => {
      fireEvent.change(screen.getByLabelText(`Llegas a ${c}`), { target: { value: days[i] } });
      fireEvent.change(screen.getByLabelText(`Sales de ${c}`), { target: { value: days[i + 1] } });
    });
    fireEvent.change(screen.getByLabelText("Tu hotel en Roma (opcional)"), { target: { value: "Hotel Artemide" } });
    fireEvent.change(screen.getByLabelText("Tu hotel en Florencia (opcional)"), { target: { value: "Hotel Brunelleschi" } });
    fireEvent.change(screen.getByLabelText("Número de vuelo"), { target: { value: "AM 17" } });
    fireEvent.change(screen.getByLabelText("Fecha del vuelo"), { target: { value: "2027-04-30" } });

    fireEvent.click(screen.getByTestId("brought-save"));
    // Primero se ubican los hoteles (una llamada por hotel) y se muestran para confirmar.
    const confirm = await screen.findByTestId("brought-confirm");
    expect(confirm).toHaveTextContent("Hotel Artemide");
    expect(confirm).toHaveTextContent("Piazza Santa Elisabetta");
    expect(db.inserts).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Confirmar y guardar" }));
    await waitFor(() => expect(lastPath).toBe("/dashboard/viajes/trip-traido-1"));

    const names = invoke.mock.calls.map((c) => c[0]);
    expect(names).toEqual(["geocode-address", "geocode-address"]);
    expect(names.some((n) => FORBIDDEN.includes(n))).toBe(false);
    expect(db.inserts).toHaveLength(1);
    const row = db.inserts[0].row;
    expect(row.destino).toBe("Roma → Florencia → Venecia → Siena → Lucca");
    expect(row.ciudad_origen).toBe("Ciudad de México");
    expect(row.itinerario_json.bases[0].hotel).toMatchObject({ lat: 41.9009, lng: 12.4943, place_id: "ChIJ-artemide" });
    expect(row.vuelos_json).toEqual([expect.objectContaining({ numero_vuelo: "AM17", fecha: "2027-04-30", ya_lo_tengo: true })]);
  });

  it("fechas incoherentes: lo dice junto a la ciudad y no llama a nada", async () => {
    render(<MemoryRouter><PlanTripDialog open onOpenChange={() => {}} startMode="traido" /></MemoryRouter>);
    const form = await screen.findByTestId("brought-form");
    fireEvent.change(within(form).getAllByRole("combobox")[0], { target: { value: "Roma" } });
    fireEvent.change(await screen.findByLabelText("Llegas a Roma"), { target: { value: "2027-05-04" } });
    fireEvent.change(screen.getByLabelText("Sales de Roma"), { target: { value: "2027-05-01" } });
    fireEvent.click(screen.getByTestId("brought-save"));
    expect(await screen.findByText("En Roma la salida debe ser después de la llegada (al menos una noche).")).toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalled();
    expect(db.inserts).toHaveLength(0);
  });
});

describe("Un viaje traído en el detalle y en Comprar", () => {
  const HOTELS = [
    { nombre: "Hotel Artemide", direccion: "Via Nazionale, 22, 00184 Roma RM, Italia", place_id: "ChIJ-artemide", lat: 41.9009, lng: 12.4943, maps_url: "https://www.google.com/maps/search/?api=1&query=Hotel+Artemide&query_place_id=ChIJ-artemide", consulta: "Hotel Artemide, Roma", consultado_at: "2026-10-27T10:00:00Z" },
    { nombre: "Hotel Brunelleschi", direccion: "Piazza Santa Elisabetta, 3, 50122 Firenze FI, Italia", place_id: "ChIJ-brunelleschi", lat: 43.7713, lng: 11.2556, maps_url: "https://www.google.com/maps/search/?api=1&query=Hotel+Brunelleschi&query_place_id=ChIJ-brunelleschi", consulta: "Hotel Brunelleschi, Florencia", consultado_at: "2026-10-27T10:00:00Z" },
    null,
  ];
  beforeEach(() => {
    db.trip = {
      ...broughtTripInsert({
        userId: "u1", personas: 2, origin: null, today: "2026-10-27", flights: [{ numero: "AM17", fecha: "2027-04-30" }],
        cities: [
          { ciudad: "Roma", llegada: "2027-05-01", salida: "2027-05-04" },
          { ciudad: "Florencia", llegada: "2027-05-04", salida: "2027-05-06" },
          { ciudad: "Venecia", llegada: "2027-05-06", salida: "2027-05-08" },
        ],
      }, HOTELS),
      id: "trip-traido-1", created_at: "2026-10-27T10:00:00Z", updated_at: "2026-10-27T10:00:00Z", quote_basis: null, quote_needs_update: false, current_quote_id: null,
    };
  });
  const renderTrip = () => render(
    <MemoryRouter initialEntries={["/dashboard/viajes/trip-traido-1"]}>
      <Routes><Route path="/dashboard/viajes/:id" element={<TripDetail />} /></Routes>
    </MemoryRouter>,
  );

  it("Resumen: 'Vuelos y hotel: ya los tienes', cada ciudad con su hotel; sin $0, sin 'estimado' ni 'Cotiza'", async () => {
    renderTrip();
    const card = await screen.findByTestId("brought-summary");
    expect(card).toHaveTextContent("Vuelos y hotel: ya los tienes");
    expect(card).toHaveTextContent("Vuelo AM17");
    const bases = within(card).getAllByTestId("brought-base");
    expect(bases.map((b) => b.getAttribute("data-city"))).toEqual(["Roma", "Florencia", "Venecia"]);
    expect(bases[0]).toHaveTextContent("Hotel Artemide · Via Nazionale, 22, 00184 Roma RM, Italia");
    expect(bases[0]).toHaveTextContent("1 may 2027 – 4 may 2027 · 3 noches");
    expect(bases[2]).toHaveTextContent("no nos dijiste cuál");
    expect(screen.getAllByRole("heading", { name: "Arma tus días" }).length).toBeGreaterThan(0);
    const resumen = document.getElementById("panel-resumen")!;
    expect(resumen.textContent).not.toMatch(/\$0(?![\d,])/);
    expect(resumen.textContent).not.toMatch(/estimad/i);
    expect(resumen.textContent).not.toMatch(/Cotiza|cotizaci/i);
    expect(document.body.textContent).not.toMatch(/Desde null|Desde\s*$/);
    // Sin buscar precios al abrir el viaje.
    expect(invoke.mock.calls.map((c) => c[0]).some((n) => FORBIDDEN.includes(n))).toBe(false);
  });

  it("Comprar: vuelo y hoteles 'Ya lo tienes' (sin volver a elegir), sin $0 ni 'estimado'", async () => {
    renderTrip();
    fireEvent.click(await screen.findByTestId("tab-comprar"));
    const comprar = await screen.findByTestId("trip-comprar");
    expect(within(comprar).getByTestId("comprar-vuelo")).toHaveTextContent("Ya lo tienes (vuelo AM17): no suma al total.");
    const hoteles = within(comprar).getAllByTestId("comprar-hospedaje");
    expect(hoteles.map((h) => h.getAttribute("data-city"))).toEqual(["Roma", "Florencia", "Venecia"]);
    expect(hoteles[0]).toHaveTextContent("Ya lo tienes: Hotel Artemide. No suma al total.");
    expect(hoteles[2]).toHaveTextContent("Ya tienes dónde quedarte: no suma al total.");
    expect(within(comprar).queryByText("Volver a elegir")).toBeNull();
    expect(comprar.textContent).not.toMatch(/\$0(?![\d,])/);
    expect(comprar.textContent).not.toMatch(/estimad/i);
    expect(within(comprar).queryByTestId("comprar-listo-total")).toBeNull();
    expect(comprar.textContent).not.toMatch(/Falta elegir|Elige tu vuelo/);
    expect(invoke.mock.calls.map((c) => c[0]).some((n) => FORBIDDEN.includes(n))).toBe(false);
  });
});
