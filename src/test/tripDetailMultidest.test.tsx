// Puntos 7, 8, 10 y 11 del caso Roma → Florencia → Venecia en la página del viaje (TripDetail) con
// los datos del caso: pestañas (Resumen · Comprar · Destinos · Documentos), "Comprar" como flujo de
// elegir y comprar (vuelo, un hotel por ciudad, auto) con botón precargado en cada paso, el coche no es
// un vuelo (va al road trip y a la renta de auto) y escalas con sus ciudades o "por confirmar".
import React from "react";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { vi, it, expect, beforeEach, describe } from "vitest";

const TRIP = "11111111-1111-4111-8111-111111111111";
const db = {
  trip: null as any,
  bookings: [] as any[],
  updates: [] as any[],
  updateError: null as any,
};

vi.mock("@/integrations/supabase/client", () => {
  const from = (table: string) => {
    let kind = "select";
    let payload: any = null;
    const api: any = {
      // .not: TripBookingIntents filtra con .not("state", "in", …); sin él el componente reventaba en cada
      // render (7 "Unhandled Rejection") y la corrida terminaba con exit 1 (P3-QA-1).
      select: () => api, eq: () => api, not: () => api, order: () => api, limit: () => api, in: () => api,
      update: (p: any) => { kind = "update"; payload = p; db.updates.push({ table, payload: p }); return api; },
      insert: () => api,
      maybeSingle: async () => ({ data: table === "trips" ? db.trip : null, error: null }),
      single: async () => ({ data: null, error: null }),
      then: (res: any, rej: any) => {
        if (kind === "update") {
          const r = db.updateError ? { data: null, error: db.updateError }
            : { data: [{ selections: payload.selections, quote_basis: db.trip.quote_basis, quote_needs_update: true }], error: null };
          return Promise.resolve(r).then(res, rej);
        }
        return Promise.resolve({ data: table === "bookings" ? db.bookings : [], error: null }).then(res, rej);
      },
    };
    return api;
  };
  return { supabase: { from, functions: { invoke: vi.fn(async () => ({ data: null, error: null })) }, auth: { getSession: async () => ({ data: { session: null } }) } } };
});
const authUser = vi.hoisted(() => ({ id: "u1" }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: authUser, loading: false }) }));
vi.mock("@/components/DashboardLayout", () => ({ DashboardLayout: ({ children }: any) => <>{children}</> }));
vi.mock("@/components/DestinationVideo", () => ({ DestinationVideo: () => null }));
vi.mock("@/components/CityCollapsible", () => ({ CityCollapsible: ({ children }: any) => <div>{children}</div>, useCityImage: () => null }));
vi.mock("@/components/EditWithAIDialog", () => ({ EditWithAIDialog: () => null }));
vi.mock("@/components/LiveTripQuote", () => ({ LiveTripQuote: () => null }));
vi.mock("@/components/InviteFriendDialog", () => ({ InviteFriendDialog: () => null }));
vi.mock("@/components/PriceWatchCard", () => ({ PriceWatchCard: () => null }));
vi.mock("@/components/TripDocuments", () => ({ TripDocuments: ({ tripId }: any) => <section data-testid="docs">{tripId}</section> }));
vi.mock("@/lib/tripPdf", () => ({ generateTripPDF: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

import TripDetail from "@/pages/TripDetail";
import { CASO_TRIP } from "./fixtures/casoRomaFlorenciaVenecia";
import { parseBookingSearch, parseGoogleFlightsSearch } from "../../supabase/functions/_shared/booking/links";

const renderTrip = () => render(
  <MemoryRouter initialEntries={[`/dashboard/viajes/${CASO_TRIP.id}`]}>
    <Routes><Route path="/dashboard/viajes/:id" element={<TripDetail />} /></Routes>
  </MemoryRouter>,
);

beforeEach(() => {
  db.trip = { ...JSON.parse(JSON.stringify(CASO_TRIP)), user_id: "u1", quote_basis: null, quote_needs_update: false, selections: null };
  db.bookings = [];
  db.updates.length = 0;
  db.updateError = null;
  localStorage.clear();
});

const AF = "https://www.aviasales.com/search/MEX2210ROM01112?t=AF1793MEXCDGFCO1793VCECDGMEX_ab_1100&marker=533299";
const realFare = { tier: "equilibrio", mode: "vuelo", aerolinea: "Air France", duracion: "16h 10m", escalas: "1 escala(s)", precio_por_persona: 21000,
  fuente_precio: "travelpayouts", estado_dato: "ESTIMADO", consultado_at: "2026-10-22T15:00:00Z", booking_link: AF,
  ciudad: "Roma", from: "Ciudad de México", to: "Roma" };

describe("Pestañas de la página del viaje (punto 11)", () => {
  it("barra de secciones con Resumen, Comprar, Destinos y Documentos; una sección a la vez", async () => {
    renderTrip();
    const nav = await screen.findByTestId("trip-secciones");
    const tabs = within(nav).getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["Resumen", "Comprar", "Destinos", "Experiencias", "Documentos"]);
    expect(screen.getByTestId("tab-resumen")).toHaveAttribute("aria-selected", "true");
    expect(document.getElementById("panel-comprar")).toHaveAttribute("hidden");
    fireEvent.click(screen.getByTestId("tab-comprar"));
    expect(screen.getByTestId("tab-comprar")).toHaveAttribute("aria-selected", "true");
    expect(document.getElementById("panel-comprar")).not.toHaveAttribute("hidden");
    expect(document.getElementById("panel-resumen")).toHaveAttribute("hidden");
  });

  it("un solo desglose: el de abajo ya no repite el total (va plegado bajo el total)", async () => {
    renderTrip();
    await screen.findByTestId("trip-secciones");
    expect(screen.queryAllByText("Desglose de presupuesto").length + screen.queryAllByText("Ver desglose del total").length).toBe(1);
    expect(screen.getByTestId("trip-desglose").closest("[data-trip-panel]")).toHaveAttribute("data-trip-panel", "resumen");
  });

  it("'Elegir vuelo y hotel' de 'Qué sigue' abre la sección Comprar", async () => {
    // Un viaje que aún no empieza (el del caso sale hoy y "Qué sigue" ofrece el Modo viaje).
    Object.assign(db.trip, { fecha_salida: "2099-10-22", fecha_regreso: "2099-11-01", created_at: new Date(Date.now() - 3600_000).toISOString() });
    renderTrip();
    const btns = await screen.findAllByRole("button", { name: /Elegir vuelo y hotel/ });
    fireEvent.click(btns[0]);
    await waitFor(() => expect(screen.getByTestId("tab-comprar")).toHaveAttribute("aria-selected", "true"));
  });
});

describe("Comprar: elegir y comprar (puntos 10 y 11)", () => {
  it("pasos numerados y 'Te falta': vuelo y un hotel por ciudad, más el auto", async () => {
    renderTrip();
    const pasos = await screen.findByTestId("comprar-pasos");
    expect(within(pasos).getAllByRole("listitem").map((li) => li.textContent?.trim())).toEqual(
      ["1. Vuelo de ida y regreso", "2. Hotel en Roma", "3. Roma → Florencia", "4. Hotel en Florencia", "5. Florencia → Venecia", "6. Hotel en Venecia", "7. Auto (opcional)",
        "8. Restaurantes y experiencias", "9. Listo · Revisa y compra"]);
    expect(screen.getByTestId("trip-comprar-falta")).toHaveTextContent("Te falta: vuelo de ida y regreso · hotel en Roma · Roma → Florencia · hotel en Florencia · Florencia → Venecia · hotel en Venecia");
  });

  it("vuelo sin tarifa real: lo dice y su botón lleva la búsqueda del viaje (MEX→FCO, regreso VCE→MEX, 2 adultos); nada de BUH ni Volaris", async () => {
    renderTrip();
    const step = await screen.findByTestId("comprar-vuelo");
    expect(within(step).getByTestId("vuelo-sin-precio")).toHaveTextContent("Aún no tenemos precio real para esta ruta: búscalo en Google Flights.");
    // Los estimados de IA (Aeroméxico, Iberia "Directo") y la tarifa de otra ruta no son opciones.
    expect(within(step).queryAllByTestId("vuelo-opcion")).toHaveLength(0);
    const a = within(step).getByTestId("comprar-vuelo-abrir");
    expect(a).toHaveTextContent("Comprar en Google Flights");
    expect(parseGoogleFlightsSearch(a.getAttribute("href")!)).toMatchObject({ origin: "MEX", destination: "FCO", return_from: "VCE", adults: 2, airlines: [] });
    expect(document.body.innerHTML).not.toMatch(/BUH|Volaris|Retiro de Coche/);
  });

  it("con una tarifa real: se ve como opción con aerolínea, escalas con sus ciudades, total y por persona; elegirla cambia el total", async () => {
    db.trip.vuelos_json = [...db.trip.vuelos_json, realFare];
    renderTrip();
    const opt = (await screen.findAllByTestId("vuelo-opcion"))[0];
    expect(opt).toHaveTextContent("Air France · Equilibrado");
    expect(opt).toHaveTextContent("Escalas: París");
    expect(opt).toHaveTextContent("$42,000 MXN");
    expect(opt).toHaveTextContent("$21,000 MXN por persona");
    expect(opt).toHaveAttribute("aria-checked", "true");
    // El botón precarga la ruta del viaje y SOLO Air France (tarifa real, aerolínea que opera la ruta).
    expect(parseGoogleFlightsSearch(screen.getByTestId("comprar-vuelo-abrir").getAttribute("href")!)).toMatchObject({ destination: "FCO", airlines: ["AF"] });
  });

  it("un hotel por ciudad con 3 opciones, noches de esa ciudad y Booking con sus fechas; elegir otro en Florencia se guarda y cambia el total", async () => {
    renderTrip();
    const steps = await screen.findAllByTestId("comprar-hospedaje");
    expect(steps.map((s) => s.getAttribute("data-city"))).toEqual(["Roma", "Florencia", "Venecia"]);
    for (const s of steps) expect(within(s).getAllByTestId("hotel-opcion")).toHaveLength(3);
    const flor = steps[1];
    expect(parseBookingSearch(within(flor).getByTestId("comprar-hotel-Florencia-abrir").getAttribute("href")!)).toMatchObject({ checkin: "2026-10-26", checkout: "2026-10-29", adults: 2 });
    // El hotel de la cotización se marca "En la cotización", sin palomita: aún no lo eligió la persona.
    expect(within(flor).queryByRole("radio", { checked: true })).toBeNull();
    expect(within(flor).getAllByTestId("hotel-opcion").find((b) => b.getAttribute("data-default") === "true")).toHaveTextContent("Four Seasons Firenze");
    fireEvent.click(within(flor).getByRole("radio", { name: /Milu/ }));
    await waitFor(() => expect(within(screen.getAllByTestId("comprar-hospedaje")[1]).getByRole("radio", { checked: true })).toHaveTextContent("Milu"));
    // Total: hospedaje por ciudad con Milu (7,017 × 3) en lugar de Four Seasons (37,035 × 3).
    const expected = 561468 - 401960 + (32795 * 4 + 7017 * 3 + 53226 * 3);
    await waitFor(() => expect(screen.getByTestId("trip-total-amount")).toHaveTextContent(`$${expected.toLocaleString("es-MX")} MXN`));
    await waitFor(() => expect(db.updates.find((u) => u.table === "trips")?.payload.selections).toMatchObject({ hoteles: [{ ciudad: "Florencia", i: 4 }] }), { timeout: 2000 });
  });

  it("traslados entre ciudades: tren Roma → Florencia (estimado) con su buscador de trenes", async () => {
    renderTrip();
    const legs = await screen.findAllByTestId("comprar-traslado");
    expect(legs.map((l) => `${l.getAttribute("data-from")}>${l.getAttribute("data-to")}`)).toEqual(["Roma>Florencia", "Florencia>Venecia"]);
    const opts = within(legs[0]).getAllByTestId("traslado-opcion");
    expect(opts.map((o) => o.getAttribute("data-mode"))).toEqual(expect.arrayContaining(["tren", "coche"]));
    expect(within(legs[0]).getByText(/Trainline · busca la ruta en su sitio/)).toBeInTheDocument();
    expect(legs[0]).toHaveTextContent("por persona · estimado");
    expect(within(legs[0]).getByTestId("comprar-traslado-marcar")).toBeInTheDocument();
  });

  it("restaurantes y experiencias en carrusel por ciudad con su botón para reservar", async () => {
    renderTrip();
    const extras = await screen.findByTestId("comprar-extras");
    expect(within(extras).getByText(/Restaurantes y experiencias para reservar \(opcional\)/)).toBeInTheDocument();
    expect(within(extras).getAllByTestId("comprar-extras-ciudad").map((c) => c.getAttribute("data-city"))).toEqual(["Roma", "Florencia", "Venecia"]);
    const roma = within(extras).getAllByTestId("comprar-extras-ciudad")[0];
    const rest = within(roma).getByTestId("picks-restaurante");
    // Roscioli "$$$" (sin verificar) va en Caro; sin opción económica ni media no se inventa una.
    // Niveles sin opción verificada: sin tarjetas vacías, una línea pequeña (pedido del dueño, 27-oct-2026).
    expect(within(rest).queryAllByTestId("pick-card-vacia")).toHaveLength(0);
    expect(within(rest).getByTestId("picks-restaurante-sin-nivel")).toHaveTextContent("No encontramos opciones verificadas de nivel económico ni medio aquí.");
    expect(within(rest).getAllByTestId("pick-card").find((c) => c.getAttribute("data-slot") === "caro")).toHaveTextContent("Roscioli");
    // Cada botón dice lo que es (búsqueda, ficha o sitio oficial), nunca "Reservar" sin la página del lugar.
    expect(within(extras).getAllByTestId("pick-reservar").map((a) => a.textContent)).toEqual(
      expect.arrayContaining([expect.stringMatching(/^(Buscar en OpenTable|Buscar en TheFork|Ver en Google Maps|Buscar en Google Maps|Sitio oficial|Buscar en GetYourGuide)/)]));
    expect(within(extras).queryAllByText(/^Reservar/)).toHaveLength(0);
    // Experiencia: "Agregar al total" la suma (selTours) y se guarda como antes.
    const exp = within(roma).getByTestId("picks-experiencia");
    fireEvent.click(within(exp).getAllByTestId("pick-elegir")[0]);
    await waitFor(() => expect(within(exp).getAllByTestId("pick-elegir")[0]).toHaveAttribute("aria-pressed", "true"));
    await waitFor(() => expect(db.updates.find((u) => u.table === "trips")?.payload.selections).toMatchObject({ tours: [{ i: 0 }] }), { timeout: 2000 });
  });
});

describe("Destinos: cómo llegar por tierra (punto 8)", () => {
  it("el coche no es un vuelo: sin icono de avión, con 'Ver el road trip' y 'Rentar auto'", async () => {
    renderTrip();
    await screen.findByTestId("trip-secciones");
    const cars = Array.from(document.querySelectorAll('[data-testid="arrival-option"][data-mode="coche"]')) as HTMLElement[];
    expect(cars.length).toBeGreaterThan(0);
    for (const c of cars) {
      expect(c.closest("[data-trip-panel]")).toHaveAttribute("data-trip-panel", "destinos");
      expect(c.querySelector(".lucide-plane")).toBeNull();
      expect(c.querySelector('[data-testid="ground-buy-buttons"]')).not.toBeNull();
      expect(c.textContent).toMatch(/Ver el road trip/);
      const rent = Array.from(c.querySelectorAll("a")).find((a) => /Rentar auto/.test(a.textContent ?? ""))!;
      expect(rent.getAttribute("href")).toMatch(/^\/dashboard\/autos\?city=/);
    }
    // Ninguna tarjeta de vuelo se repite en Destinos (se eligen en Comprar).
    expect(document.querySelectorAll('#panel-destinos [data-testid="arrival-option"][data-mode="vuelo"]')).toHaveLength(0);
  });
});

describe("FlightBuyButtons (punto 8): comprar desde una opción de vuelo", () => {
  it("lleva la ruta del viaje, fechas y 2 pasajeros; si no hay destino, lo dice", async () => {
    const { FlightBuyButtons } = await import("@/components/booking/FlightBuyButtons");
    const { unmount } = render(<MemoryRouter><FlightBuyButtons option={db.trip.vuelos_json[5]} trip={db.trip} /></MemoryRouter>);
    const g = screen.getByTestId("flight-buy-google");
    expect(g).toHaveTextContent("Ver y comprar en Google Flights");
    expect(parseGoogleFlightsSearch(g.getAttribute("href")!)).toMatchObject({ origin: "MEX", destination: "FCO", return_from: "VCE", adults: 2, airlines: [] });
    unmount();
    const lost = { ...db.trip, destino: "Xyzópolis → Abcville", itinerario_json: { destinations: ["Xyzópolis", "Abcville"] } };
    render(<MemoryRouter><FlightBuyButtons option={{ aerolinea: "Iberia", fuente_precio: "estimado", from: "Ciudad de México", to: "Xyzópolis" }} trip={lost} /></MemoryRouter>);
    expect(screen.getByTestId("flight-buy-google")).toHaveTextContent("Abre Google Flights y escribe el destino");
  });
});
