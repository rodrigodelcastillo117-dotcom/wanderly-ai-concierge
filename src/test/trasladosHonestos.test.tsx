// E2E real en producción (23-oct-2026), viaje multidestino España: MEX → Madrid → Córdoba → Sevilla →
// Granada → Barcelona → MEX, 2 viajeros. Fixture: la respuesta cruda de logistics-plan.
//  1. Destinos pintaba el taxi del aeropuerto, el AVE, el coche y el autobús ALSA como vuelos
//     ("Aerolínea por confirmar · Escalas por confirmar", botón de Google Flights, ícono de avión):
//     el modo llega en texto libre ("Tren de alta velocidad") y solo se reconocía "tren".
//  2. Comprar marcaba por defecto otra opción ("Vuelo directo" a $1,782) que la que suma el total
//     (el AVE de logistics.internal_transport a 115 USD) y con otro precio.
import React from "react";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { vi, it, expect, beforeEach, describe } from "vitest";
import resp from "./fixtures/espanaMultidestinoLogistics.json";

const db = { trip: null as any };
vi.mock("@/integrations/supabase/client", () => {
  const from = (table: string) => {
    const api: any = {
      select: () => api, eq: () => api, not: () => api, order: () => api, limit: () => api, in: () => api,
      update: () => api, insert: () => api, upsert: () => api,
      maybeSingle: async () => ({ data: table === "trips" ? db.trip : null, error: null }),
      single: async () => ({ data: null, error: null }),
      then: (res: any, rej: any) => Promise.resolve({ data: [], error: null }).then(res, rej),
    };
    return api;
  };
  return { supabase: { from, functions: { invoke: vi.fn(async () => ({ data: null, error: null })) }, auth: { getSession: async () => ({ data: { session: null } }) } } };
});
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" }, loading: false }) }));
vi.mock("@/components/DashboardLayout", () => ({ DashboardLayout: ({ children }: any) => <>{children}</> }));
vi.mock("@/components/DestinationVideo", () => ({ DestinationVideo: () => null }));
vi.mock("@/components/CityCollapsible", () => ({ CityCollapsible: ({ children, city }: any) => <div data-testid={`ciudad-${city}`}>{children}</div>, useCityImage: () => null }));
vi.mock("@/components/EditWithAIDialog", () => ({ EditWithAIDialog: () => null }));
vi.mock("@/components/LiveTripQuote", () => ({ LiveTripQuote: () => null }));
vi.mock("@/components/InviteFriendDialog", () => ({ InviteFriendDialog: () => null }));
vi.mock("@/components/PriceWatchCard", () => ({ PriceWatchCard: () => null }));
vi.mock("@/components/TripDocuments", () => ({ TripDocuments: () => null }));
vi.mock("@/lib/tripPdf", () => ({ generateTripPDF: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

import TripDetail from "@/pages/TripDetail";
import { FlightBuyButtons } from "@/components/booking/FlightBuyButtons";
import { isGroundTripOption, transportModeOf } from "@/lib/booking";
import { flightAirlineLabel, flightStopsLabel } from "@/lib/flightDisplay";
import { groundOptionsForCity, legOptionsFor, multiDestTripRows, transportRubroLabel } from "@/lib/multiDestTrip";
import { buildBuyFlow, type LegStep } from "@/lib/buyFlow";
import { computeTripDesglose } from "@/lib/quote";

const logistics: any = (resp as any).logistics;
const CITIES = ["Madrid", "Córdoba", "Sevilla", "Granada", "Barcelona"];
const ID = "e5a1a000-0000-4000-8000-000000000023";

function makeTrip() {
  const rows = multiDestTripRows(logistics, CITIES, "Ciudad de México");
  return {
    id: ID, user_id: "u1", destino: CITIES.join(" → "), ciudad_origen: "Ciudad de México", pais_destino: "España",
    fecha_salida: "2027-05-04", fecha_regreso: "2027-05-19", num_viajeros: 2, status: "listo", moneda: "MXN",
    created_at: "2026-10-23T10:18:56Z", total_estimado: logistics.total_estimado_mxn, desglose_presupuesto: logistics.desglose_presupuesto,
    // Como lo guardó producción: vuelos_json solo con el vuelo internacional.
    vuelos_json: rows.vuelos_json.filter((v: any) => v.from === "MEX"),
    hospedaje_json: rows.hospedaje_json, tours_json: rows.tours_json, restaurantes_json: rows.restaurantes_json,
    itinerario_json: { multi: true, destinations: CITIES, logistics, days: logistics.days },
    quote_basis: null, quote_needs_update: false, selections: null,
  };
}

const allGround = (trip: any) => CITIES.flatMap((c) => groundOptionsForCity(trip, c));

describe("1. Traslados por tierra no son vuelos", () => {
  it("el modo en texto libre del fixture se reconoce: taxi, tren, coche, autobús; 'Vuelo directo' sí es vuelo", () => {
    const modes = logistics.per_destination.flatMap((pd: any) => pd.arrival_options.map((o: any) => [o.mode, transportModeOf(o.mode)]));
    expect(Object.fromEntries(modes)).toEqual({
      "Taxi oficial / Traslado privado": "taxi",
      "Tren de Cercanías Renfe (Línea C-1 / C-10)": "tren",
      "Tren de Alta Velocidad (AVE / Iryo)": "tren",
      "Auto de Alquiler": "coche",
      "Tren de Alta Velocidad (AVE / Avant)": "tren",
      "Auto de alquiler / Conducción": "coche",
      "Tren Renfe Avant": "tren",
      "Autobús ALSA": "bus",
      "Vuelo directo": "vuelo",
      "Tren de alta velocidad": "tren",
    });
    expect(logistics.internal_transport.map((t: any) => transportModeOf(t.mode))).toEqual(["tren", "tren", "tren", "tren"]);
    // Filas viejas: sin modo es vuelo; "avion" (analizar-viaje) es vuelo; "autobus" no.
    expect(isGroundTripOption({ mode: "vuelo" })).toBe(false);
    expect(isGroundTripOption({ modo: "avion" })).toBe(false);
    expect(isGroundTripOption({})).toBe(false);
    expect(isGroundTripOption({ modo: "autobus" })).toBe(true);
  });

  it("cada tramo por tierra se muestra con su operador, sin 'Aerolínea/Escalas por confirmar'", () => {
    const trip = makeTrip();
    const ground = allGround(trip);
    expect(ground.length).toBeGreaterThanOrEqual(8);
    for (const g of ground) {
      expect(isGroundTripOption(g)).toBe(true);
      expect(flightAirlineLabel(g)).not.toMatch(/Aerolínea por confirmar/);
      expect(flightStopsLabel(g)).toBeNull();
    }
    // El "Vuelo directo" Granada → Barcelona no es "por tierra".
    expect(groundOptionsForCity(trip, "Barcelona").map((g) => g.mode)).toEqual(["Tren de alta velocidad"]);
  });

  it("ningún tramo por tierra lleva enlace de vuelos; sin enlace fiable lo dice", () => {
    const trip = makeTrip();
    for (const g of allGround(trip)) {
      const { container, unmount } = render(<MemoryRouter><FlightBuyButtons option={g} trip={trip} /></MemoryRouter>);
      expect(container.innerHTML).not.toMatch(/google\.com\/travel\/flights|kayak|Google Flights/i);
      expect(container.querySelector("[data-testid='flight-buy-buttons']")).toBeNull();
      const m = transportModeOf(g.mode);
      if (m === "taxi" || m === "bus" || /aeropuerto/i.test(String(g.from))) {
        // Sin precio: el enlace precargado del operador ("IATOS no lo cotiza") o lo que hay que escribir.
        expect(container.textContent).toMatch(/IATOS no lo cotiza|Precio en el sitio del operador/);
        expect(container.textContent).not.toMatch(/\$\s?\d/);
      }
      unmount();
    }
  });
});

describe("2. Comprar coincide con el total en el transporte entre ciudades", () => {
  const travelers = 2;
  it("cada tramo marca por defecto el que suma el total, con el mismo precio, y la suma es el rubro", () => {
    const trip = makeTrip();
    const flow = buildBuyFlow(trip, { selVuelo: -1, selHospedaje: -1, selTours: new Set() });
    const legs = flow.steps.filter((s): s is LegStep => s.kind === "traslado");
    expect(legs.map((l) => l.title)).toEqual(["Madrid → Córdoba", "Córdoba → Sevilla", "Sevilla → Granada", "Granada → Barcelona"]);
    // Todos son AVE/Avant (internal_transport), no el "Vuelo directo" ni el AVE de arrival_options a otro precio.
    expect(legs.map((l) => l.chosen)).toEqual(["tren", "tren", "tren", "tren"]);
    const fx = logistics.fx_usd_mxn;
    logistics.internal_transport.forEach((t: any, i: number) => {
      expect(legs[i].item.price).toBe(Math.round(t.price_per_person_usd * travelers * fx));
      const c = legs[i].choices.find((x) => x.mode === legs[i].chosen)!;
      expect(c.provider).toBe(t.provider);
      expect(c.pricePp).toBe(Math.round(t.price_per_person_usd * fx));
    });
    const sum = legs.reduce((s, l) => s + (l.item.price ?? 0), 0);
    const desglose = computeTripDesglose(trip, { selVuelo: -1, selHospedaje: -1, nochesHospedaje: 15, selTours: new Set() }, travelers);
    expect(sum).toBe(desglose.transporte_local);
    expect(sum).toBe(9118);
  });

  it("Granada → Barcelona: el vuelo sigue como opción, pero no es el elegido por defecto", () => {
    const trip = makeTrip();
    const plan = legOptionsFor(trip, "Granada", "Barcelona");
    expect(plan[0]).toMatchObject({ mode: "tren", provider: "Renfe AVE", quoted: true, priceUsdPp: 115 });
    expect(plan.some((o) => o.mode === "vuelo")).toBe(true);
  });

  it("el rubro se llama 'Transporte entre ciudades' cuando son tramos entre ciudades", () => {
    expect(transportRubroLabel(makeTrip())).toBe("Transporte entre ciudades");
    expect(transportRubroLabel({ itinerario_json: { logistics: { internal_transport: [] } } })).toBe("Transporte local");
  });
});

describe("Página del viaje con el fixture", () => {
  beforeEach(() => { db.trip = makeTrip(); localStorage.clear(); });
  const renderTrip = () => render(
    <MemoryRouter initialEntries={[`/dashboard/viajes/${ID}`]}>
      <Routes><Route path="/dashboard/viajes/:id" element={<TripDetail />} /></Routes>
    </MemoryRouter>,
  );

  it("Destinos: tarjetas con su modo (taxi, tren, coche, autobús), sin enlaces de vuelos; conectores con el ícono del tramo", async () => {
    renderTrip();
    const panel = await screen.findByTestId("ciudad-Granada");
    const destinos = document.getElementById("panel-destinos")!;
    const cards = within(destinos).getAllByTestId("arrival-option");
    // Cada ciudad lleva primero el tramo que suma el total (internal_transport) y luego las alternativas
    // del plan; el AVE Granada → Barcelona del plan es el mismo tramo cotizado (Renfe AVE) y no se repite.
    // R2 (dedupe por operador): «Renfe» Córdoba → Sevilla y Sevilla → Granada son el mismo operador que el
    // tramo cotizado («Renfe Avant») y tampoco se repiten; «Renfe AVE / Iryo» sí (iryo es otro operador).
    expect(cards.map((c) => c.getAttribute("data-mode")).sort()).toEqual(
      ["bus", "coche", "coche", "taxi", "tren", "tren", "tren", "tren", "tren", "tren"]);
    expect(destinos.innerHTML).not.toMatch(/Aerolínea por confirmar|Escalas por confirmar|google\.com\/travel\/flights|kayak/i);
    expect(within(destinos).queryAllByTestId("flight-buy-buttons")).toHaveLength(0);
    // Autobús Sevilla → Granada (ALSA): FlixBus con ruta, fecha del tramo y pasajeros, y la portada de ALSA.
    const busLinks = within(panel).getAllByTestId("ground-operator").map((a) => a.getAttribute("href") ?? "");
    const flix = busLinks.find((h) => h.startsWith("https://shop.flixbus.com/search?"));
    expect(flix).toBeDefined();
    expect(new URL(flix!).searchParams.get("rideDate")).toBe("13.05.2027");
    expect(busLinks).toContain("https://www.alsa.es/");
    expect(within(destinos).getAllByTestId("leg-connector").map((c) => c.getAttribute("data-mode"))).toEqual(["tren", "tren", "tren", "tren"]);
  });

  it("Comprar: el traslado elegido por defecto es el del total", async () => {
    renderTrip();
    const legs = await screen.findAllByTestId("comprar-traslado");
    expect(legs.map((l) => l.getAttribute("data-chosen"))).toEqual(["tren", "tren", "tren", "tren"]);
    const gb = legs[3];
    const chosen = within(gb).getAllByTestId("traslado-opcion").find((b) => b.getAttribute("aria-checked") === "true")!;
    expect(chosen).toHaveAttribute("data-mode", "tren");
    expect(chosen).toHaveTextContent("Renfe AVE");
    expect(chosen).toHaveTextContent("$2,158");
  });
});
