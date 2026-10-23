// Caso real del dueño (23-oct-2026): destino "india", 2 viajeros, 21 nov → 5 dic 2026 (14 noches).
// Antes: un vuelo "Ciudad de México → india", un hotel "india · 14 noches" y nada para moverse entre
// Delhi, Agra, Jaipur y Ranthambore ("no hay next, no nada"). Ahora: ruta propuesta con su porqué,
// Comprar con TODOS los tramos (avión / tren / coche con chofer), "Siguiente →" y el resumen final.
import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ inserts: [] as any[], invokes: [] as any[] }));
vi.mock("@/integrations/supabase/client", () => {
  const from = (table: string) => {
    const api: any = {
      select: () => api, eq: () => api, order: () => api, limit: () => api, in: () => api, not: () => api,
      insert: (row: any) => { db.inserts.push({ table, row }); return api; },
      delete: () => api,
      maybeSingle: async () => ({ data: table === "profiles" ? { ciudad_origen: "Ciudad de México" } : table === "travel_profiles" ? { intereses: ["Historia"], preferencias_comida: [] } : null, error: null }),
      single: async () => ({ data: { id: "trip-india-ruta" }, error: null }),
      then: (res: any, rej: any) => Promise.resolve({ data: [], error: null }).then(res, rej),
    };
    return api;
  };
  const invoke = async (fn: string, opts: any) => {
    db.invokes.push({ fn, body: opts?.body });
    if (fn === "logistics-plan" && !opts?.body?.action) return { data: { logistics: { fx_usd_mxn: 18, flights: [], per_destination: [], days: [] } }, error: null };
    return { data: { ok: true }, error: null };
  };
  return { supabase: { from, functions: { invoke }, rpc: async () => ({ data: null, error: null }), auth: { getSession: async () => ({ data: { session: null } }) } } };
});
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" }, loading: false }) }));
vi.mock("@/components/DashboardLayout", () => ({ DashboardLayout: ({ children }: any) => <>{children}</> }));
vi.mock("@/components/AnalysisProgress", () => ({ AnalysisProgress: () => <p>ANALIZANDO</p> }));
vi.mock("@/components/TripBuildPreview", () => ({ TripBuildPreview: () => null }));
vi.mock("@/components/OriginPicker", () => ({ OriginPicker: ({ value }: any) => <span data-testid="origen">{value}</span> }));
vi.mock("@/components/VoiceInput", () => ({ VoiceInput: () => null }));
vi.mock("@/lib/analytics", () => ({ track: () => {} }));
vi.mock("@/lib/trackBooking", () => ({ logBookingClick: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("framer-motion", () => {
  const strip = (p: any) => { const { initial, animate, exit, transition, layout, ...r } = p; return r; };
  const cache: Record<string, any> = {};
  const motion = new Proxy({}, { get: (_t, tag: string) => (cache[tag] ??= (p: any) => React.createElement(tag, strip(p))) });
  return { motion, AnimatePresence: ({ children }: any) => <>{children}</> };
});
(globalThis as any).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };

import PlanTrip from "@/pages/PlanTrip";
import { buildBuyFlow } from "@/lib/buyFlow";
import { TripPurchasePlan } from "@/components/booking/TripPurchasePlan";
import { routeConversion } from "@/components/route/ConvertToRouteBanner";
import { proposeCountryRoute, weightedNights, cityReasons } from "@/lib/countryRoutes";
import { countryOnly, parseMultiCityText } from "@/lib/multiCityText";
import { mainAirport } from "../../supabase/functions/_shared/airports";
import { parseGoogleFlightsSearch } from "../../supabase/functions/_shared/booking/links";

beforeEach(() => { db.inserts.length = 0; db.invokes.length = 0; sessionStorage.clear(); localStorage.clear(); });

describe("Destino país: 'india'", () => {
  it("'india' es un país, no una ciudad llamada India", () => {
    const p = parseMultiCityText("india");
    expect(p.cities).toEqual([]);
    expect(countryOnly(p)).toBe("India");
    expect(countryOnly(parseMultiCityText("Japón 10 días"))).toBe("Japón");
    expect(countryOnly(parseMultiCityText("Europa"))).toBe("Europa");
  });

  it("14 noches: Triángulo de Oro + Ranthambore y regreso a Delhi (DEL), con su porqué", () => {
    const r = proposeCountryRoute("india", 14)!;
    expect(r.cities).toEqual(["Delhi", "Agra", "Jaipur", "Ranthambore", "Delhi"]);
    expect(r.nights).toEqual([4, 2, 4, 2, 2]);
    expect(mainAirport(r.cities[0])).toBe("DEL");
    expect(r.why[1]).toMatch(/Taj Mahal/);
    // Con el ADN (le gusta la historia) el porqué lo dice; con el análisis, cita lo que encontró.
    const why = cityReasons(r, { tours: [{ nombre: "Taj Mahal", ciudad: "Agra", rating: 4.8, fuente: "tripadvisor" }] }, { declared: ["Historia"] });
    expect(why[1]).toBe("Tu análisis ya tiene aquí: Taj Mahal (4.8 en Tripadvisor). Va con tu gusto por historia.");
  });

  it("traslados realistas: con pocas noches no hay 5 paradas (máximo ~1 ciudad cada 2 noches)", () => {
    expect(proposeCountryRoute("india", 5)!.cities).toEqual(["Delhi", "Agra"]);
    expect(proposeCountryRoute("india", 8)!.cities).toEqual(["Delhi", "Agra", "Jaipur", "Delhi"]);
    expect(proposeCountryRoute("india", 3)).toBeNull(); // una sola ciudad no es ruta
    expect(weightedNights([4, 2, 4, 2, 2], 9)!.reduce((a, b) => a + b, 0)).toBe(9);
  });

  it("planeador: 'Entendimos: India · 14 noches. Te proponemos: Delhi (4) → …', 'Ajustar ruta' y 'Solo una ciudad'", async () => {
    render(<MemoryRouter initialEntries={["/dashboard/planear"]}><Routes>
      <Route path="/dashboard/planear" element={<PlanTrip />} /><Route path="/dashboard/viajes/:id" element={<p>VIAJE</p>} />
    </Routes></MemoryRouter>);
    fireEvent.change(screen.getByLabelText("¿A dónde quieres ir?"), { target: { value: "india 14 noches" } });
    expect(screen.getByTestId("plan-multicity-entendimos")).toHaveTextContent(
      "Entendimos: India · 14 noches. Te proponemos: Delhi (4) → Agra (2) → Jaipur (4) → Ranthambore (2) → Delhi (2). ¿La armamos así?");
    expect(screen.getAllByTestId("city-why")[1]).toHaveTextContent(/Taj Mahal/);
    // Ajustar ruta: quitar Ranthambore y agregar Udaipur.
    fireEvent.click(screen.getByTestId("plan-multicity-ajustar"));
    fireEvent.click(screen.getByRole("button", { name: "Quitar Ranthambore" }));
    fireEvent.change(screen.getByLabelText("Agregar ciudad a la ruta"), { target: { value: "Udaipur" } });
    fireEvent.click(screen.getByRole("button", { name: "Agregar" }));
    expect(screen.getAllByTestId("city-nights-row").map((r) => r.querySelector(".truncate")?.textContent)).toEqual(["Delhi", "Agra", "Jaipur", "Udaipur", "Delhi"]);
    fireEvent.change(screen.getByLabelText("Agregar ciudad a la ruta"), { target: { value: "Xyzópolis" } });
    fireEvent.click(screen.getByRole("button", { name: "Agregar" }));
    expect(screen.getByRole("alert")).toHaveTextContent("No reconocimos «Xyzópolis» como ciudad.");
    // Solo una ciudad: Delhi → un destino.
    fireEvent.click(screen.getByTestId("plan-multicity-una"));
    fireEvent.click(within(screen.getByTestId("plan-multicity-elegir-una")).getByRole("button", { name: "Delhi" }));
    expect(screen.getByLabelText("¿A dónde quieres ir?")).toHaveValue("Delhi");
    expect(screen.queryByTestId("plan-multicity")).toBeNull();
  });

  it("planeador: confirmar la ruta propuesta y generarla con sus noches", async () => {
    render(<MemoryRouter initialEntries={["/dashboard/planear"]}><Routes>
      <Route path="/dashboard/planear" element={<PlanTrip />} /><Route path="/dashboard/viajes/:id" element={<p>VIAJE</p>} />
    </Routes></MemoryRouter>);
    fireEvent.change(screen.getByLabelText("¿A dónde quieres ir?"), { target: { value: "india" } });
    expect(screen.getByTestId("plan-multicity-entendimos")).toHaveTextContent("Entendimos: India. Te proponemos: Delhi → Agra → Jaipur → Ranthambore → Delhi");
    fireEvent.click(screen.getByRole("button", { name: /Continuar/ }));
    await waitFor(() => expect(screen.getByTestId("origen")).toHaveTextContent("Ciudad de México"));
    fireEvent.change(screen.getByLabelText("Salida"), { target: { value: "2026-11-21" } });
    fireEvent.change(screen.getByLabelText("Regreso"), { target: { value: "2026-12-05" } });
    expect(within(screen.getByTestId("plan-multicity-noches")).getAllByTestId("city-nights-value").map((n) => n.textContent))
      .toEqual(["4 noches", "2 noches", "4 noches", "2 noches", "2 noches"]);
    fireEvent.click(screen.getByRole("button", { name: /Continuar/ }));
    fireEvent.click(screen.getByRole("button", { name: /Generar ruta de 4 ciudades/ }));
    await screen.findByText("VIAJE");
    const plan = db.invokes.find((c) => c.fn === "logistics-plan" && !c.body.action)!;
    expect(plan.body).toMatchObject({ destinations: ["Delhi", "Agra", "Jaipur", "Ranthambore", "Delhi"], nights_per_city: [4, 2, 4, 2, 2], num_viajeros: 2 });
    expect(db.inserts.find((i) => i.table === "trips")!.row).toMatchObject({ destino: "Delhi → Agra → Jaipur → Ranthambore → Delhi", pais_destino: "India" });
  });
});

// Viaje guardado del dueño (país como destino) y el mismo viaje ya como ruta.
const SAVED = {
  id: "t-india", user_id: "u1", destino: "india", ciudad_origen: "Ciudad de México", fecha_salida: "2026-11-21", fecha_regreso: "2026-12-05", num_viajeros: 2,
  itinerario_json: [{ dia: 1, titulo: "Delhi" }],
  vuelos_json: [{ aerolinea: "United", precio_por_persona: 38348, fuente_precio: "estimado", escalas: "Escalas por confirmar" }],
  hospedaje_json: [{ nombre: "The Imperial", precio_por_noche: 6000, ciudad: "Delhi" }],
  tours_json: [
    { nombre: "Jal Mahal", ciudad: "Jaipur", rating: 4.3, fuente: "tripadvisor", precio_por_persona: 0 },
    { nombre: "Hawa Mahal", ciudad: "Jaipur", rating: 4.5, fuente: "tripadvisor", precio_por_persona: 150 },
    { nombre: "Qutab Minar", ciudad: "Delhi", rating: 4.5, fuente: "tripadvisor", precio_por_persona: 600 },
    { nombre: "Fuerte Rojo", ciudad: "Delhi", rating: 4.4, fuente: "tripadvisor", precio_por_persona: 500 },
    { nombre: "Taj Mahal", ciudad: "Agra", rating: 4.8, fuente: "tripadvisor", precio_por_persona: 1100 },
    { nombre: "Safari en Ranthambore", ciudad: "Ranthambore", rating: 4.4, fuente: "tripadvisor", precio_por_persona: 2400 },
  ],
  restaurantes_json: [{ nombre: "Trishna", ciudad: "Mumbai", rango_precio: "$$$" }, { nombre: "Gajalee", ciudad: "Mumbai", rango_precio: "$$" }],
};

describe("Viaje ya guardado con 'india' como destino", () => {
  it("'Convertir en ruta' con la ruta propuesta (ciudades del análisis), noches y por qué", () => {
    const c = routeConversion(SAVED)!;
    expect(c.kind).toBe("pais");
    expect(c.cities).toEqual(["Delhi", "Agra", "Jaipur", "Ranthambore", "Delhi"]);
    expect(c.nights).toEqual([4, 2, 4, 2, 2]);
    expect(c.why![0]).toBe("Tu análisis ya tiene aquí: Qutab Minar (4.5 en Tripadvisor) y Fuerte Rojo (4.4 en Tripadvisor).");
    const q = new URL(c.href, "https://x.test").searchParams;
    expect(q.get("destinos")).toBe("Delhi|Agra|Jaipur|Ranthambore|Delhi");
    expect(q.get("noches")).toBe("4|2|4|2|2");
    expect(q.get("viajeros")).toBe("2");
  });
});

const hotel = (ciudad: string, nombre: string, precio: number, tier = "equilibrio") => ({ ciudad, nombre, precio_por_noche: precio, tier, fuente_precio: "serpapi" });
const ROUTE_TRIP = {
  id: "t-india-ruta", user_id: "u1", destino: "Delhi → Agra → Jaipur → Ranthambore → Delhi", ciudad_origen: "Ciudad de México",
  fecha_salida: "2026-11-21", fecha_regreso: "2026-12-05", num_viajeros: 2, created_at: "2026-10-23T10:00:00Z",
  vuelos_json: [{ tier: "equilibrio", mode: "vuelo", aerolinea: "Aerolínea por confirmar", fuente_precio: "estimado", from: "Ciudad de México", to: "Delhi", precio_por_persona: 38000 }],
  hospedaje_json: [hotel("Delhi", "The Imperial", 6000), hotel("Jaipur", "Samode Haveli", 5200), hotel("Ranthambore", "Nahargarh", 7000)],
  tours_json: SAVED.tours_json, restaurantes_json: [],
  itinerario_json: { multi: true, destinations: ["Delhi", "Agra", "Jaipur", "Ranthambore", "Delhi"], logistics: {
    fx_usd_mxn: 18,
    internal_transport: [
      { from: "Delhi", to: "Agra", mode: "tren", provider: "Gatimaan Express", duration: "1h 40m", price_per_person_usd: 20 },
      { from: "Agra", to: "Jaipur", mode: "coche", provider: "Coche con chofer", duration: "4h 30m", price_per_person_usd: 45 },
      { from: "Jaipur", to: "Ranthambore", mode: "tren", provider: "Indian Railways", duration: "2h", price_per_person_usd: 8 },
    ],
    per_destination: [
      { city: "Delhi", checkin: "2026-11-21", checkout: "2026-11-25" }, { city: "Agra", checkin: "2026-11-25", checkout: "2026-11-27" },
      { city: "Jaipur", checkin: "2026-11-27", checkout: "2026-12-01" }, { city: "Ranthambore", checkin: "2026-12-01", checkout: "2026-12-03" },
      { city: "Delhi", checkin: "2026-12-03", checkout: "2026-12-05" },
    ] } },
};

describe("Comprar del viaje por la India: todos los tramos, 'Siguiente →' y resumen", () => {
  it("vuelo MEX→DEL de ida y regreso, cada tramo con avión / tren / coche con chofer y un hotel por ciudad", () => {
    const flow = buildBuyFlow(ROUTE_TRIP, { selVuelo: -1, selHospedaje: -1, selTours: new Set() });
    expect(flow.steps.map((s) => s.title)).toEqual(["Vuelo de ida y regreso", "Hotel en Delhi", "Delhi → Agra", "Hotel en Agra", "Agra → Jaipur", "Hotel en Jaipur",
      "Jaipur → Ranthambore", "Hotel en Ranthambore", "Ranthambore → Delhi", "Hotel en Delhi", "Auto (opcional)"]);
    expect(parseGoogleFlightsSearch(flow.steps[0].item!.url!)).toMatchObject({ origin: "MEX", destination: "DEL", depart: "2026-11-21", ret: "2026-12-05", adults: 2 });
    const legs = flow.steps.filter((s) => s.kind === "traslado") as any[];
    // Delhi → Agra: tren del plan (con precio estimado) elegido; avión con Google Flights solo ida; coche con chofer con la ruta.
    expect(legs[0].choices.map((c: any) => [c.mode, c.label, c.fromPlan])).toEqual([["tren", "Tren", true], ["vuelo", "Avión", false], ["coche", "Coche con chofer", false]]);
    expect(legs[0].chosen).toBe("tren");
    expect(legs[0].choices[0].pricePp).toBe(360);
    expect(legs[0].item.buttonLabel).toBe("Buscar tren");
    expect(legs[0].item.fallbackHref).toBe("/dashboard/trenes?origin=Delhi&dest=Agra&date=2026-11-25");
    expect(parseGoogleFlightsSearch(legs[0].choices[1].url)).toMatchObject({ origin: "DEL", destination: "AGR", depart: "2026-11-25", adults: 2 });
    expect(legs[0].choices[2].url).toMatch(/^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&origin=Delhi&destination=Agra&travelmode=driving/);
    // Agra → Jaipur: el plan dice coche con chofer.
    expect(legs[1].chosen).toBe("coche");
    // Ranthambore → Delhi: sin plan; por cotizar (sin precio inventado).
    expect(legs[3].choices.every((c: any) => c.pricePp == null)).toBe(true);
    // Agra no tiene hotel cotizado: el paso existe y queda por elegir.
    const agra = flow.steps.find((s) => s.title === "Hotel en Agra") as any;
    expect(agra.chosen).toBe(-1);
    // Elegir avión en Delhi → Agra cambia el botón de compra del tramo.
    const flow2 = buildBuyFlow(ROUTE_TRIP, { selVuelo: -1, selHospedaje: -1, selTours: new Set(), selLegs: { "traslado:delhi>agra": "vuelo" } });
    const leg0 = flow2.steps.find((s) => s.kind === "traslado") as any;
    expect(leg0.chosen).toBe("vuelo");
    expect(parseGoogleFlightsSearch(leg0.item.url)).toMatchObject({ origin: "DEL", destination: "AGR" });
  });

  it("'Siguiente →' en cada paso, dice lo que falta sin bloquear, y termina en 'Listo · Revisa y compra'", async () => {
    const scrolled: string[] = [];
    (Element.prototype as any).scrollIntoView = function () { scrolled.push(this.id); };
    const onViewTrip = vi.fn();
    render(<MemoryRouter><TripPurchasePlan trip={ROUTE_TRIP} selVuelo={-1} selHospedaje={-1} selTours={new Set([4])} bookings={[]} userId="u1"
      onSelectVuelo={() => {}} onSelectHotel={() => {}} onToggleTour={() => {}} selectionTotal={152300} onViewTrip={onViewTrip}
      sendSelectionSlot={<button type="button">Enviarme mi selección por correo</button>} /></MemoryRouter>);
    const chips = within(screen.getByTestId("comprar-pasos")).getAllByRole("listitem").map((li) => li.textContent?.trim());
    expect(chips.slice(-2)).toEqual(["12. Restaurantes y experiencias", "13. Listo · Revisa y compra"]);
    const bars = screen.getAllByTestId("comprar-siguiente");
    fireEvent.click(bars[0]);
    expect(scrolled.at(-1)).toBe("paso-2");
    // Hotel en Agra: lo dice, pero se puede seguir.
    const agra = document.getElementById("paso-4")!;
    expect(within(agra).getByTestId("comprar-falta-paso")).toHaveTextContent("Te falta elegir hotel en Agra");
    const next = within(agra).getByTestId("comprar-siguiente");
    expect(next).toHaveTextContent("Siguiente de todos modos");
    expect(next).not.toBeDisabled();
    fireEvent.click(next);
    expect(scrolled.at(-1)).toBe("paso-5");
    // Elegir un modo en un tramo avanza solo al siguiente paso.
    vi.useFakeTimers();
    const leg = document.getElementById("paso-3")!;
    fireEvent.click(within(leg).getByRole("radio", { name: /Avión/ }));
    vi.advanceTimersByTime(600);
    vi.useRealTimers();
    expect(scrolled.at(-1)).toBe("paso-4");
    expect(within(document.getElementById("paso-3")!).getByRole("radio", { name: /Avión/ })).toHaveAttribute("aria-checked", "true");
    // Saltar con los chips.
    fireEvent.click(within(screen.getByTestId("comprar-pasos")).getByText(/Listo · Revisa y compra/));
    expect(scrolled.at(-1)).toBe("paso-listo");
    const listo = screen.getByTestId("comprar-listo");
    expect(within(listo).getByTestId("comprar-listo-falta")).toHaveTextContent("Te falta elegir hotel en Agra");
    const rows = within(listo).getAllByTestId("comprar-listo-item").map((r) => r.textContent ?? "");
    expect(rows.some((r) => r.includes("Delhi → Agra · Avión"))).toBe(true);
    expect(rows.some((r) => r.includes("Taj Mahal"))).toBe(true);
    expect(within(listo).getByTestId("comprar-listo-total")).toHaveTextContent("$152,300 MXN");
    expect(within(listo).getByRole("button", { name: "Enviarme mi selección por correo" })).toBeInTheDocument();
    fireEvent.click(within(listo).getByTestId("comprar-ver-viaje"));
    expect(onViewTrip).toHaveBeenCalled();
  });
});
