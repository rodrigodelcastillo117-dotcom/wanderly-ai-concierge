// Ventana "Planear viaje" y pantalla "Explorar destinos": se abre desde los 2 botones, prellena
// los campos, "Explorar" lleva al flujo real correcto (ciudad, país, varias ciudades), no hay red
// hasta abrir y abrir NO hace búsquedas de pago (solo lee la caché), la caché del navegador evita
// una segunda lectura, etiquetas de frescura, y la lista y los marcadores de Explorar (Maps simulado).
import { render, screen, fireEvent, within, waitFor, act } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { vi, it, expect, describe, beforeEach } from "vitest";
import exploreFixture from "./fixtures/gflights/travel_explore_mex.json";

const profile: { ciudad_origen: string | null } = { ciudad_origen: null };
const qb: any = { select: () => qb, eq: () => qb, order: () => qb, limit: () => qb, maybeSingle: async () => ({ data: { ...profile, full_name: "Ana" }, error: null }) };
const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => qb, functions: { invoke: (...a: unknown[]) => invoke(...a) } } }));
const auth = { user: { id: "u1" }, signOut: async () => {} };
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth }));
vi.mock("@/hooks/useSubscription", () => ({ useSubscription: () => ({ loading: false, isPro: false }) }));
vi.mock("@/components/NotificationBell", () => ({ NotificationBell: () => null }));
vi.mock("@/components/media/SmartImage", () => ({ SmartImage: ({ alt }: { alt: string }) => <span data-testid="foto">{alt}</span> }));

const markers: Array<{ title: string }> = [];
const fakeMaps = {
  Map: vi.fn(function (this: any) { this.fitBounds = vi.fn(); }),
  Marker: vi.fn(function (this: any, o: { title: string }) { markers.push(o); this.setMap = vi.fn(); this.addListener = vi.fn(); }),
  LatLngBounds: vi.fn(function (this: any) { this.extend = vi.fn(); }),
  Size: vi.fn(), Point: vi.fn(), SymbolPath: { CIRCLE: 0 },
};
vi.mock("@/lib/googleMapsLoader", () => ({
  loadGoogleMaps: vi.fn(async () => { (window as any).google = { maps: fakeMaps }; return fakeMaps; }),
}));

import { DashboardLayout } from "@/components/DashboardLayout";
import ExploreDestinations from "@/pages/ExploreDestinations";
import { loadGoogleMaps } from "@/lib/googleMapsLoader";
import {
  __resetExploreCache, exploreTarget, freshnessLabel, priceLabel, consultedHHMM, type PlanForm,
} from "@/lib/exploreFlights";

const CONSULTED = new Date(Date.now() - 2 * 3600_000).toISOString();
const results = exploreFixture.destinations.map((d) => ({
  destino: d.name, pais: d.country, iata: d.destination_airport.code, lat: d.gps_coordinates.latitude, lng: d.gps_coordinates.longitude,
  salida: d.start_date, regreso: d.end_date, escalas: d.number_of_stops, duracion_min: d.flight_duration ?? null, aerolinea: d.airline,
  foto: (d as { thumbnail?: string }).thumbnail ?? null, precio_mxn: (d as { flight_price?: number }).flight_price ?? null, moneda_original: "MXN",
})).sort((a, b) => (a.precio_mxn ?? Infinity) - (b.precio_mxn ?? Infinity));
const okBody = { ok: true, source: "serpapi", disponible: true, results, consulted_at: CONSULTED, from_cache: true, nota_precio: "Precio de referencia" };

let lastPath = "";
function Probe() {
  const l = useLocation();
  lastPath = `${l.pathname}${l.search}`;
  return null;
}

const renderLayout = (path = "/dashboard/viajes") =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Probe />
      <Routes>
        <Route path="*" element={<DashboardLayout><div>PAGINA</div></DashboardLayout>} />
      </Routes>
    </MemoryRouter>,
  );

const exploreCalls = () => invoke.mock.calls.filter((c) => c[0] === "flights-search");

beforeEach(() => {
  invoke.mockReset();
  invoke.mockResolvedValue({ data: { ok: true, source: "none", disponible: false, sin_cache: true, results: [], motivo: "Aún no hay precios guardados." }, error: null });
  __resetExploreCache();
  profile.ciudad_origen = null;
  markers.length = 0;
  lastPath = "";
  vi.mocked(loadGoogleMaps).mockClear();
});

async function openFrom(name: "Planear viaje" | "Planear un viaje nuevo") {
  fireEvent.click(screen.getByRole("link", { name }));
  return await screen.findByTestId("plan-dialog");
}

describe("ventana Planear viaje", () => {
  it("se abre desde el botón dorado del menú lateral y desde el botón Planear del centro (móvil)", async () => {
    const a = renderLayout();
    // Los enlaces siguen apuntando a la ruta de siempre (abrir en otra pestaña funciona).
    expect(screen.getByRole("link", { name: "Planear viaje" })).toHaveAttribute("href", "/dashboard/planear");
    expect(screen.getByRole("link", { name: "Planear un viaje nuevo" })).toHaveAttribute("href", "/dashboard/planear");
    const d1 = await openFrom("Planear viaje");
    expect(within(d1).getByRole("heading", { name: "Planear viaje" })).toBeInTheDocument();
    expect(lastPath).toBe("/dashboard/viajes"); // no navegó: es una ventana
    a.unmount();
    renderLayout();
    const d2 = await openFrom("Planear un viaje nuevo");
    expect(within(d2).getByRole("radiogroup", { name: "Tipo de viaje" })).toBeInTheDocument();
  });

  it("ninguna llamada de red hasta abrir; al abrir solo se LEE la caché (0 búsquedas de pago)", async () => {
    renderLayout();
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    // (Otras piezas del menú, como el sello de Privé, tienen sus propias llamadas: no son de esta función.)
    expect(exploreCalls()).toHaveLength(0);
    expect(loadGoogleMaps).not.toHaveBeenCalled();
    await openFrom("Planear viaje");
    await waitFor(() => expect(exploreCalls()).toHaveLength(1));
    expect(exploreCalls()[0][1]).toEqual({ body: { action: "explore", origin: "Ciudad de México", month: 0, live: false } });
    // Escribir en los campos no consulta nada.
    fireEvent.change(screen.getByRole("combobox", { name: "¿A dónde?" }), { target: { value: "Can" } });
    expect(exploreCalls()).toHaveLength(1);
    expect(invoke.mock.calls.some((c) => (c[1] as { body?: { live?: boolean } })?.body?.live === true)).toBe(false);
    // Sin caché: estado vacío útil, sin precios inventados.
    expect(await screen.findByTestId("cheap-empty")).toHaveTextContent("Pulsa Explorar destinos para consultarlos");
    expect(screen.queryByText(/\$\d/)).toBeNull();
  });

  it("prellena el origen con ciudad_origen del perfil (o Ciudad de México) y ⇄ invierte", async () => {
    profile.ciudad_origen = "Guadalajara";
    renderLayout();
    const d = await openFrom("Planear viaje");
    const origen = within(d).getByRole("combobox", { name: "Origen" }) as HTMLInputElement;
    await waitFor(() => expect(origen.value).toBe("Guadalajara"));
    await waitFor(() => expect(within(d).getByRole("heading", { name: "Vuelos baratos desde Guadalajara" })).toBeInTheDocument());
    const destino = within(d).getByRole("combobox", { name: "¿A dónde?" }) as HTMLInputElement;
    fireEvent.change(destino, { target: { value: "Cancún" } });
    fireEvent.click(within(d).getByRole("button", { name: "Invertir origen y destino" }));
    expect(origen.value).toBe("Cancún");
    expect(destino.value).toBe("Guadalajara");
  });

  it("el destino autocompleta ciudades y países del catálogo (teclado)", async () => {
    renderLayout();
    const d = await openFrom("Planear viaje");
    const destino = within(d).getByRole("combobox", { name: "¿A dónde?" }) as HTMLInputElement;
    fireEvent.focus(destino);
    fireEvent.change(destino, { target: { value: "jap" } });
    const list = within(d).getByRole("listbox", { name: "¿A dónde?" });
    expect(within(list).getAllByRole("option")[0]).toHaveTextContent(/^Japón\s*País/);
    expect(within(list).getAllByRole("option").length).toBeGreaterThan(1);
    fireEvent.keyDown(destino, { key: "Enter" });
    expect(destino.value).toBe("Japón");
  });

  it("Explorar con una ciudad → asistente de planear con todo lleno (no la frase completa)", async () => {
    renderLayout();
    const d = await openFrom("Planear viaje");
    fireEvent.change(within(d).getByRole("combobox", { name: "¿A dónde?" }), { target: { value: "Cancún" } });
    fireEvent.change(within(d).getByLabelText("Salida"), { target: { value: "2027-01-14" } });
    fireEvent.change(within(d).getByLabelText("Regreso"), { target: { value: "2027-01-23" } });
    fireEvent.change(within(d).getByLabelText("Clase"), { target: { value: "business" } });
    fireEvent.click(within(d).getByRole("button", { name: "Explorar" }));
    const u = new URL(lastPath, "http://x");
    expect(u.pathname).toBe("/dashboard/planear");
    expect(Object.fromEntries(u.searchParams)).toEqual({
      destino: "Cancún", origen: "Ciudad de México", viajeros: "2", desde: "ventana", fecha_salida: "2027-01-14", fecha_regreso: "2027-01-23", clase: "business",
    });
  });

  it("Explorar con un país → ruta multidestino con las ciudades propuestas", async () => {
    renderLayout();
    const d = await openFrom("Planear viaje");
    fireEvent.change(within(d).getByRole("combobox", { name: "¿A dónde?" }), { target: { value: "Japón" } });
    fireEvent.click(within(d).getByRole("button", { name: "Explorar" }));
    const u = new URL(lastPath, "http://x");
    expect(u.pathname).toBe("/dashboard/ruta");
    expect(u.searchParams.get("destinos")!.split("|").length).toBeGreaterThanOrEqual(2);
    expect(u.searchParams.get("origin")).toBe("Ciudad de México");
    expect(u.searchParams.get("auto")).toBeNull(); // no arranca un análisis de pago solo
  });

  it("Varias ciudades → ruta multidestino con tramos, fechas y noches", async () => {
    renderLayout();
    const d = await openFrom("Planear viaje");
    fireEvent.click(within(d).getByRole("radio", { name: "Varias ciudades" }));
    fireEvent.click(within(d).getByRole("button", { name: "Agregar tramo" }));
    const set = (name: string, value: string) => fireEvent.change(within(d).getByRole("combobox", { name }), { target: { value } });
    set("Tramo 1: destino", "Madrid");
    set("Tramo 2: origen", "Madrid"); set("Tramo 2: destino", "Roma");
    set("Tramo 3: origen", "Roma"); set("Tramo 3: destino", "Ciudad de México");
    fireEvent.change(within(d).getByLabelText("Fecha del tramo 1"), { target: { value: "2027-03-02" } });
    fireEvent.change(within(d).getByLabelText("Fecha del tramo 2"), { target: { value: "2027-03-08" } });
    fireEvent.change(within(d).getByLabelText("Fecha del tramo 3"), { target: { value: "2027-03-14" } });
    fireEvent.click(within(d).getByRole("button", { name: "Explorar" }));
    const u = new URL(lastPath, "http://x");
    expect(u.pathname).toBe("/dashboard/ruta");
    expect(Object.fromEntries(u.searchParams)).toMatchObject({
      origin: "Ciudad de México", destinos: "Madrid|Roma", fecha_salida: "2027-03-02", fecha_regreso: "2027-03-14", noches: "6|6",
    });
  });

  it("¿Flexible?: la frase va al intérprete (?q=) con el origen y los viajeros elegidos como contexto", async () => {
    renderLayout();
    const d = await openFrom("Planear viaje");
    fireEvent.change(within(d).getByLabelText("Describe tu viaje"), { target: { value: "10 días por Italia en mayo" } });
    fireEvent.click(within(d).getByRole("button", { name: "Explorar con Iato" }));
    const u = new URL(lastPath, "http://x");
    expect(u.pathname).toBe("/dashboard/planear");
    expect(u.searchParams.get("q")).toBe("10 días por Italia en mayo");
    expect(u.searchParams.get("viajeros")).toBe("2");
  });

  it("caso Diego: con descripción escrita, el botón Explorar ya no la ignora (antes armaba solo el destino del campo)", async () => {
    renderLayout();
    const d = await openFrom("Planear viaje");
    fireEvent.change(within(d).getByLabelText("Describe tu viaje"), { target: { value: "un crucero hasta Cape Town y regreso por Londres" } });
    fireEvent.click(within(d).getByRole("button", { name: /^Explorar$/ }));
    const u = new URL(lastPath, "http://x");
    expect(u.pathname).toBe("/dashboard/planear");
    expect(u.searchParams.get("q")).toContain("un crucero hasta Cape Town y regreso por Londres");
  });

  it("con caché: 3 tarjetas con 'desde $X MXN · consultado HH:MM' y la tarjeta abre la búsqueda real; reabrir no vuelve a llamar", async () => {
    invoke.mockResolvedValue({ data: okBody, error: null });
    renderLayout();
    let d = await openFrom("Planear viaje");
    const cards = await within(d).findAllByTestId("fare-card");
    expect(cards).toHaveLength(3);
    expect(cards[0]).toHaveTextContent("CDMX");
    expect(cards[0]).toHaveTextContent("Cancún");
    expect(cards[0]).toHaveTextContent("14–23 ene");
    expect(cards[0]).toHaveTextContent("Directo");
    expect(cards[0]).toHaveTextContent(`desde $2,130 MXN · ${consultedHHMM(CONSULTED)}`);
    expect(cards[0]).toHaveTextContent("Precio de referencia · Consultado hace 2 h");
    expect(exploreCalls()).toHaveLength(1);
    // Cerrar y volver a abrir: la caché del navegador evita otra llamada.
    fireEvent.keyDown(d, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("plan-dialog")).toBeNull());
    d = await openFrom("Planear viaje");
    await within(d).findAllByTestId("fare-card");
    expect(exploreCalls()).toHaveLength(1);
    fireEvent.click(within(d).getAllByTestId("fare-card")[0]);
    const u = new URL(lastPath, "http://x");
    expect(u.pathname).toBe("/dashboard/vuelos");
    expect(Object.fromEntries(u.searchParams)).toEqual({ origin: "Ciudad de México", destination: "CUN", travelers: "2", depart: "2027-01-14", return: "2027-01-23" });
  });

  it("'Explorar destinos' lleva a la pantalla completa (con la búsqueda pedida explícitamente)", async () => {
    renderLayout();
    const d = await openFrom("Planear viaje");
    fireEvent.click(within(d).getByRole("button", { name: "Explorar destinos" }));
    expect(lastPath).toBe(`/dashboard/explorar?origen=${encodeURIComponent("Ciudad de México")}&buscar=1`);
  });
});

describe("etiquetas", () => {
  it("precio con hora de consulta, frescura y 'Sin precio ahora'", () => {
    const now = Date.parse("2026-10-23T15:00:00Z");
    expect(priceLabel({ precio_mxn: null }, CONSULTED)).toBe("Sin precio ahora");
    expect(priceLabel({ precio_mxn: 2130 }, null)).toBe("desde $2,130 MXN");
    expect(consultedHHMM("2026-10-23T15:00:00Z")).toMatch(/^consultado \d{2}:\d{2}$/);
    expect(freshnessLabel(new Date(now - 5 * 60_000).toISOString(), now)).toBe("Consultado en vivo");
    expect(freshnessLabel(new Date(now - 3 * 3600_000).toISOString(), now)).toBe("Consultado hace 3 h");
    expect(freshnessLabel(new Date(now - 13 * 3600_000).toISOString(), now)).toBe("Precio de hace 13 h · actualízalo antes de comprar");
  });

  it("exploreTarget: solo ida sin regreso; destino vacío no navega", () => {
    const base: PlanForm = { kind: "sencillo", adults: 1, minors: 1, cabin: "turista", origin: "", destination: "Oaxaca", depart: "2027-01-10", ret: "2027-01-20", legs: [] };
    const t = exploreTarget(base)!;
    expect(t.flow).toBe("planear");
    const q = new URL(t.path, "http://x").searchParams;
    expect(q.get("fecha_regreso")).toBeNull();
    expect(q.get("viajeros")).toBe("2");
    expect(q.get("origen")).toBe("Ciudad de México");
    expect(exploreTarget({ ...base, destination: "  " })).toBeNull();
  });
});

describe("pantalla Explorar destinos", () => {
  const renderExplore = (path: string) =>
    render(
      <MemoryRouter initialEntries={[path]}>
        <Probe />
        <Routes><Route path="/dashboard/explorar" element={<ExploreDestinations />} /></Routes>
      </MemoryRouter>,
    );

  it("muestra la lista (foto, fechas, escalas, duración, precio) y un marcador con precio por destino", async () => {
    invoke.mockResolvedValue({ data: okBody, error: null });
    renderExplore(`/dashboard/explorar?origen=${encodeURIComponent("Ciudad de México")}`);
    const rows = await screen.findAllByTestId("explore-row");
    expect(rows).toHaveLength(5);
    expect(rows[0]).toHaveTextContent("Cancún");
    expect(rows[0]).toHaveTextContent("Directo");
    expect(rows[0]).toHaveTextContent("2 h 15 min");
    expect(rows[0]).toHaveTextContent("desde $2,130 MXN");
    expect(rows[4]).toHaveTextContent("Sin precio ahora");
    await waitFor(() => expect(markers.some((m) => m.title === "Cancún: desde $2,130 MXN")).toBe(true));
    expect(markers.some((m) => m.title === "Bogotá: Sin precio ahora")).toBe(true);
    // Abrir la página solo leyó la caché.
    expect(exploreCalls().every((c) => (c[1] as { body: { live: boolean } }).body.live === false)).toBe(true);
    // Filtro "Solo directos" no consulta nada nuevo.
    const n = exploreCalls().length;
    fireEvent.click(screen.getByLabelText("Solo directos"));
    expect(screen.getAllByTestId("explore-row")).toHaveLength(4);
    expect(exploreCalls()).toHaveLength(n);
  });

  it("?buscar=1 (botón Explorar destinos) consulta una vez y se quita de la URL; sin precios lo dice", async () => {
    invoke.mockResolvedValue({ data: { ok: true, source: "serpapi", disponible: false, results: [], motivo: "Las búsquedas de precios en vivo están en pausa por ahora.", busquedas_en_pausa: true }, error: null });
    renderExplore(`/dashboard/explorar?origen=${encodeURIComponent("Monterrey")}&buscar=1`);
    await waitFor(() => expect(exploreCalls()).toHaveLength(1));
    expect(exploreCalls()[0][1]).toEqual({ body: { action: "explore", origin: "Monterrey", month: 0, live: true } });
    expect(await screen.findByTestId("explore-empty")).toHaveTextContent("Sin precio ahora.");
    await waitFor(() => expect(lastPath).not.toContain("buscar=1"));
  });
});
