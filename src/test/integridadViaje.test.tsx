// Integridad del viaje (E2E real del 23-oct-2026, España multidestino: MEX → Madrid → Córdoba → Sevilla →
// Granada → Barcelona → MEX, 2 viajeros). Fixture: la respuesta cruda de logistics-plan. Cada bloque es
// un defecto que la prueba E2E encontró (evidencia en e2e_smoke3) y falla sin su arreglo.
import React from "react";
import { render, screen, within, fireEvent, waitFor } from "@testing-library/react";
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
import { ReadonlyBudget } from "@/components/ReadonlyBudget";
import { TripPicksCarousel } from "@/components/booking/TripPicksCarousel";
import { groundOptionsForCity, legCarRentalDates, multiDestTripRows, transportRubroLabel } from "@/lib/multiDestTrip";
import { buildBuyFlow, type HotelStep, type LegStep } from "@/lib/buyFlow";
import { computeTripDesglose, quoteStaleness } from "@/lib/quote";
import { quotedHotelForCity } from "@/lib/cityHotels";
import { restaurantPriceLabel, tripUsdMxnRate } from "@/lib/tripPicks";
import { serializeSelections, withCityHotel } from "@/lib/tripSelections";
import { buildSelectionRequest } from "@/lib/selectionEmail";
import { tripTotalSummary } from "@/lib/tripTotal";

const logistics: any = (resp as any).logistics;
const CITIES = ["Madrid", "Córdoba", "Sevilla", "Granada", "Barcelona"];
const ID = "e5a1a000-0000-4000-8000-000000000024";
const FX = logistics.fx_usd_mxn as number;

function makeTrip(extra: Record<string, unknown> = {}) {
  const rows = multiDestTripRows(logistics, CITIES, "Ciudad de México");
  return {
    id: ID, user_id: "u1", destino: CITIES.join(" → "), ciudad_origen: "Ciudad de México", pais_destino: "España",
    fecha_salida: "2027-05-04", fecha_regreso: "2027-05-19", num_viajeros: 2, status: "listo", moneda: "MXN",
    created_at: "2026-10-23T10:18:56Z", total_estimado: logistics.total_estimado_mxn, desglose_presupuesto: logistics.desglose_presupuesto,
    vuelos_json: rows.vuelos_json.filter((v: any) => v.from === "MEX"),
    hospedaje_json: rows.hospedaje_json, tours_json: rows.tours_json, restaurantes_json: rows.restaurantes_json,
    itinerario_json: { multi: true, destinations: CITIES, logistics, days: logistics.days },
    quote_basis: null, quote_needs_update: false, selections: null,
    ...extra,
  } as any;
}
const NO_SEL = { selVuelo: -1, selHospedaje: -1, selTours: new Set<number>() };
const legsOf = (trip: any, sel: any = NO_SEL) => buildBuyFlow(trip, sel).steps.filter((s): s is LegStep => s.kind === "traslado");
const hotelsOf = (trip: any, sel: any = NO_SEL) => buildBuyFlow(trip, sel).steps.filter((s): s is HotelStep => s.kind === "hospedaje");

const renderTrip = () => render(
  <MemoryRouter initialEntries={[`/dashboard/viajes/${ID}`]}>
    <Routes><Route path="/dashboard/viajes/:id" element={<TripDetail />} /></Routes>
  </MemoryRouter>,
);

describe("1. Una sola fuente de verdad para el precio de cada traslado", () => {
  it("Destinos muestra como principal el MISMO tramo que Comprar y el total: precio, operador y duración", () => {
    const trip = makeTrip();
    const legs = legsOf(trip);
    expect(legs.map((l) => l.to)).toEqual(["Córdoba", "Sevilla", "Granada", "Barcelona"]);
    legs.forEach((leg, i) => {
      const principal = groundOptionsForCity(trip, leg.to)[0];
      const chosen = leg.choices.find((c) => c.mode === leg.chosen)!;
      const t = logistics.internal_transport[i];
      expect(principal).toMatchObject({ quoted: true, aerolinea: t.provider, duracion: t.duration, precio_por_persona: Math.round(t.price_per_person_usd * FX) });
      expect(principal.precio_por_persona).toBe(chosen.pricePp);
      expect(principal.aerolinea).toBe(chosen.provider);
      expect(principal.duracion).toBe(chosen.duration);
    });
    // 1,032 / 469 / 901 / 2,158 por persona (antes Destinos decía 1,219 / 525 / 976 / 1,595).
    expect(legs.map((l) => groundOptionsForCity(trip, l.to)[0].precio_por_persona)).toEqual([1032, 469, 901, 2158]);
    const sum = legs.reduce((s, l) => s + groundOptionsForCity(trip, l.to)[0].precio_por_persona * 2, 0);
    expect(Math.abs(sum - logistics.desglose_presupuesto.transporte_local)).toBeLessThanOrEqual(4); // redondeo por persona
    // Las demás opciones del plan son alternativas (no suman) con su propia fuente.
    const alts = groundOptionsForCity(trip, "Córdoba").slice(1);
    expect(alts.length).toBeGreaterThan(0);
    for (const a of alts) expect(a).toMatchObject({ alternativa: true, fuente_precio: "estimado" });
    expect(alts.find((a) => a.aerolinea === "Renfe AVE / Iryo")?.precio_por_persona).toBe(Math.round(65 * FX));
  });

  it("en la página, la tarjeta principal de cada ciudad dice que suma al total y las demás son alternativas", async () => {
    db.trip = makeTrip();
    renderTrip();
    const cordoba = await screen.findByTestId("ciudad-Córdoba");
    const cards = within(cordoba).getAllByTestId("arrival-option");
    expect(cards[0]).toHaveTextContent("Renfe AVE");
    expect(cards[0]).toHaveTextContent("$1,032");
    expect(cards[0]).toHaveTextContent("1h 50m");
    expect(within(cards[0]).getByTestId("arrival-quoted")).toBeInTheDocument();
    for (const c of cards.slice(1)) expect(within(c).getByTestId("arrival-alternativa")).toBeInTheDocument();
    const granada = screen.getByTestId("ciudad-Granada");
    expect(within(granada).getAllByTestId("arrival-option")[0]).toHaveTextContent("Renfe Avant");
    expect(within(granada).getAllByTestId("arrival-option")[0]).toHaveTextContent("$901");
  });
});

describe("2. Rentar auto en un tramo de ida devuelve el auto el día del tramo", () => {
  it("Madrid → Córdoba: recoger y devolver el 7 may en Córdoba, no el 19 may (fin del viaje)", () => {
    const trip = makeTrip();
    expect(legCarRentalDates(trip, "Madrid", "Córdoba")).toEqual({ pickup: "2027-05-07", dropoff: "2027-05-07" });
    const coche = groundOptionsForCity(trip, "Córdoba").find((g) => /auto|coche/i.test(String(g.mode)))!;
    render(<MemoryRouter><FlightBuyButtons option={coche} trip={trip} /></MemoryRouter>);
    const href = screen.getByRole("link", { name: /Rentar auto/ }).getAttribute("href")!;
    const q = new URLSearchParams(href.split("?")[1]);
    expect(q.get("city")).toBe("Madrid");
    expect(q.get("dropoff")).toBe("Córdoba");
    expect(q.get("pickup")).toBe("2027-05-07");
    expect(q.get("return")).toBe("2027-05-07");
    expect(href).not.toContain("2027-05-19");
  });

  it("Comprar: el coche del tramo lleva las mismas fechas del tramo", () => {
    const leg = legsOf(makeTrip())[0];
    const href = leg.choices.find((c) => c.mode === "coche")!.fallbackHref!;
    const q = new URLSearchParams(href.split("?")[1]);
    expect([q.get("pickup"), q.get("return"), q.get("dropoff")]).toEqual(["2027-05-07", "2027-05-07", "Córdoba"]);
  });
});

describe("3. Monedas y etiquetas", () => {
  it("restaurantes: nunca € ni USD mezclados con pesos; USD se convierte solo con la tasa con fuente", () => {
    const trip = makeTrip();
    const fx = tripUsdMxnRate(trip);
    expect(fx).toEqual({ rate: FX, source: "frankfurter" });
    expect(restaurantPriceLabel("€€€ (40-60 USD)", fx)).toEqual({ text: "MXN 750–1,126 por persona", note: `De USD 40–60 · 1 USD = ${FX.toFixed(2)} MXN (Banco Central Europeo (Frankfurter))` });
    expect(restaurantPriceLabel("$15 - $30 USD por persona", fx)?.text).toBe("MXN 281–563 por persona");
    // Sin tasa con fuente (de respaldo): en su moneda, tal cual.
    expect(tripUsdMxnRate({ itinerario_json: { logistics: { fx_usd_mxn: 20.5, fx_source: "fallback", fx_is_fallback: true } } })).toBeNull();
    expect(restaurantPriceLabel("€€€ (40-60 USD)", null)?.text).toBe("USD 40–60 por persona");
    expect(restaurantPriceLabel("EUR 20–30", fx)?.text).toBe("EUR 20–30 por persona");
    expect(restaurantPriceLabel("€€", fx)?.text).toBe("Medio");
  });

  it("carrusel de Córdoba (la página en pesos) sin '€' ni rangos en USD sueltos", () => {
    const trip = makeTrip();
    const idx = trip.restaurantes_json.map((r: any, i: number) => [r, i]).filter(([r]: any) => r.ciudad === "Córdoba").map(([, i]: any) => i);
    const { container } = render(<MemoryRouter><TripPicksCarousel kind="restaurante" city="Córdoba" list={trip.restaurantes_json} indices={idx} taste={null as any} trip={trip}
      actionFor={() => ({ kind: "none" } as any)} isChosen={() => false} /></MemoryRouter>);
    expect(container.textContent).not.toMatch(/€/);
    expect(container.textContent).toMatch(/MXN [\d,]+–[\d,]+ por persona/);
    expect(container.textContent).not.toMatch(/\(\d+-\d+ USD\)/);
  });

  it("el desglose usa las mismas palabras que las tarjetas: 'Experiencias' y 'Transporte entre ciudades'", () => {
    const trip = makeTrip();
    render(<ReadonlyBudget desglose={logistics.desglose_presupuesto} total={logistics.total_estimado_mxn} labels={{ transporte_local: transportRubroLabel(trip) }} />);
    expect(screen.getByText("Experiencias")).toBeInTheDocument();
    expect(screen.getByText("Transporte entre ciudades")).toBeInTheDocument();
    expect(screen.queryByText("Tours")).toBeNull();
    expect(screen.queryByText("Transporte")).toBeNull();
  });

  it("con vuelo estimado no dice 'Cotizado' a secas: 'incluye estimados'", async () => {
    db.trip = makeTrip();
    renderTrip();
    expect(await screen.findByText("Cotizado · incluye estimados · sin reservar")).toBeInTheDocument();
    expect(screen.queryByText("Cotizado · sin reservar")).toBeNull();
    // Todos los hoteles elegidos y el vuelo estimado: "Tu selección · incluye estimados", nunca solo "Tu selección".
    const trip = makeTrip();
    const selHoteles = Object.fromEntries(CITIES.map((c) => [c, quotedHotelForCity(trip, c)]));
    const sel = { ...NO_SEL, selVuelo: 0, selHoteles };
    const flow = buildBuyFlow(trip, sel);
    const desglose = computeTripDesglose(trip, { ...sel, nochesHospedaje: 15 }, 2);
    const s = tripTotalSummary({ trip, sel, desglose, items: flow.items });
    expect(s.barNote).toBe("Tu selección · incluye estimados");
    expect(s.estimadosNote).toMatch(/Incluye estimados: vuelos/);
  });
});

describe("4. Quitar la selección de un hotel", () => {
  it("withCityHotel(-1) quita la ciudad; el total vuelve al de la cotización", () => {
    const trip = makeTrip();
    const ibis = trip.hospedaje_json.findIndex((h: any) => /Ibis/.test(h.nombre));
    const picked = withCityHotel({}, "Madrid", ibis);
    expect(picked).toEqual({ Madrid: ibis });
    const d1 = computeTripDesglose(trip, { ...NO_SEL, nochesHospedaje: 15, selHoteles: picked }, 2);
    expect(d1.hospedaje).toBe(73113 - 13959 + 9849);
    const cleared = withCityHotel(picked, "Madrid", -1);
    expect(cleared).toEqual({});
    expect(computeTripDesglose(trip, { ...NO_SEL, nochesHospedaje: 15, selHoteles: cleared }, 2).hospedaje).toBe(logistics.desglose_presupuesto.hospedaje);
    expect(serializeSelections(trip, { ...NO_SEL, nochesHospedaje: null, selHoteles: cleared })).toBeNull();
  });

  it("en Comprar: tocar el hotel elegido (o 'Quitar mi elección') lo deselecciona; total y 'Falta elegir' se actualizan", async () => {
    db.trip = makeTrip();
    renderTrip();
    const madrid = () => screen.getAllByTestId("comprar-hospedaje")[0];
    await screen.findAllByTestId("comprar-hospedaje");
    fireEvent.click(screen.getByTestId("tab-comprar"));
    expect(screen.getByTestId("trip-total-amount")).toHaveTextContent("$203,897 MXN");
    fireEvent.click(within(madrid()).getByRole("radio", { name: /Ibis/ }));
    await waitFor(() => expect(within(madrid()).getByRole("radio", { checked: true })).toHaveTextContent("Ibis"));
    await waitFor(() => expect(screen.getByTestId("trip-total-amount")).toHaveTextContent("$199,787 MXN"));
    expect(screen.getByTestId("enviar-seleccion-falta")).not.toHaveTextContent("hotel en Madrid");
    // Quitar: tocar el mismo hotel otra vez.
    fireEvent.click(within(madrid()).getByRole("radio", { checked: true }));
    await waitFor(() => expect(within(madrid()).queryByRole("radio", { checked: true })).toBeNull());
    await waitFor(() => expect(screen.getByTestId("trip-total-amount")).toHaveTextContent("$203,897 MXN"));
    expect(screen.getByTestId("enviar-seleccion-falta")).toHaveTextContent("hotel en Madrid");
    // Y con el botón explícito.
    fireEvent.click(within(madrid()).getByRole("radio", { name: /Ibis/ }));
    fireEvent.click(await within(madrid()).findByTestId("hotel-quitar"));
    await waitFor(() => expect(within(madrid()).queryByRole("radio", { checked: true })).toBeNull());
  });
});

// Pedido del dueño (E2E 28-oct-2026): elegir otra opción de la misma cotización NO pide re-cotizar (antes
// "otro hotel sí" la marcaba vieja); solo viajeros, fechas, origen o destino.
describe("5. Elegir hotel (el cotizado u otro) no pide actualizar la cotización", () => {
  const basis = { num_viajeros: 2, fecha_salida: "2027-05-04", fecha_regreso: "2027-05-19", selections: null };
  it("elegir a mano el mismo hotel de la cotización no la cambia; otro hotel tampoco", () => {
    const trip = makeTrip({ quote_basis: basis, quote_needs_update: true });
    const same = serializeSelections(trip, { ...NO_SEL, nochesHospedaje: null, selHoteles: { Madrid: quotedHotelForCity(trip, "Madrid") } });
    expect(same).not.toBeNull();
    expect(quoteStaleness({ ...trip, selections: same }, null)).toMatchObject({ stale: false, reasons: [] });
    const ibis = trip.hospedaje_json.findIndex((h: any) => /Ibis/.test(h.nombre));
    const other = serializeSelections(trip, { ...NO_SEL, nochesHospedaje: null, selHoteles: { Madrid: ibis } });
    expect(quoteStaleness({ ...trip, selections: other }, null)).toMatchObject({ stale: false, reasons: [] });
    // Con la base conocida manda el cálculo: una marca vieja del servidor (por la selección) no cuenta.
    expect(quoteStaleness({ ...trip, selections: null }, null).stale).toBe(false);
    // Cambiar fechas sí.
    expect(quoteStaleness({ ...trip, selections: other, fecha_regreso: "2027-05-20" }, null)).toMatchObject({ stale: true, reasons: ["fechas"] });
  });

  it("en la página: sin aviso ni 'Actualizar cotización' (tampoco en la barra fija del celular)", async () => {
    const t0 = makeTrip();
    const sel = serializeSelections(t0, { ...NO_SEL, nochesHospedaje: null, selHoteles: { Madrid: quotedHotelForCity(t0, "Madrid") } });
    db.trip = makeTrip({ quote_basis: basis, quote_needs_update: true, selections: sel });
    renderTrip();
    await screen.findAllByTestId("comprar-hospedaje");
    expect(screen.getByTestId("trip-total-amount")).toHaveTextContent("$203,897 MXN");
    expect(screen.queryByText(/Cambiaste tu selección/)).toBeNull();
    expect(screen.queryByText(/Cambiaste el viaje/)).toBeNull();
    expect(screen.queryAllByText(/Actualizar cotización/)).toHaveLength(0);
  });

  it("con otro hotel tampoco hay aviso; con otras fechas sí, y dice exactamente qué cambió", async () => {
    const t0 = makeTrip();
    const ibis = t0.hospedaje_json.findIndex((h: any) => /Ibis/.test(h.nombre));
    db.trip = makeTrip({ quote_basis: basis, quote_needs_update: true, selections: serializeSelections(t0, { ...NO_SEL, nochesHospedaje: null, selHoteles: { Madrid: ibis } }) });
    const { unmount } = renderTrip();
    await screen.findAllByTestId("comprar-hospedaje");
    expect(screen.queryByText(/Cambiaste/)).toBeNull();
    expect(screen.queryAllByText(/Actualizar cotización/)).toHaveLength(0);
    unmount();
    db.trip = makeTrip({ quote_basis: { ...basis, fecha_regreso: "2027-05-17" }, quote_needs_update: true });
    renderTrip();
    const stale = await screen.findByTestId("trip-total-stale");
    expect(stale).toHaveTextContent(/^Cambiaste las fechas\. Cotización para 2 viajeros/);
    expect(stale).not.toHaveTextContent(/viajeros o|selección/);
  });
});

describe("6. El hotel de la cotización no parece elegido mientras 'Falta elegir' lo pide", () => {
  beforeEach(() => localStorage.clear());
  it("buyFlow: el Equilibrado es el de la cotización (chosen) pero no lo eligió la persona (userChosen=false)", () => {
    const trip = makeTrip();
    for (const h of hotelsOf(trip)) {
      expect(h.chosen).toBe(quotedHotelForCity(trip, h.city!));
      expect(h.userChosen).toBe(false);
    }
    const r = buildSelectionRequest(trip, NO_SEL, { travelers: 2, nights: 15, desglose: logistics.desglose_presupuesto, total: logistics.total_estimado_mxn });
    expect(r.missing).toEqual(expect.arrayContaining(["hotel en Madrid"]));
  });

  it("en Comprar: sin palomita en el Equilibrado, marcado 'En la cotización', y el paso dice que falta elegir", async () => {
    db.trip = makeTrip();
    renderTrip();
    const steps = await screen.findAllByTestId("comprar-hospedaje");
    fireEvent.click(screen.getByTestId("tab-comprar"));
    const madrid = steps[0];
    expect(within(madrid).queryByRole("radio", { checked: true })).toBeNull();
    const def = within(madrid).getAllByTestId("hotel-opcion").find((b) => b.getAttribute("data-default") === "true")!;
    expect(def).toHaveTextContent("Hotel Catalonia Plaza Mayor");
    expect(within(def).getByTestId("hotel-en-cotizacion")).toBeInTheDocument();
    expect(def.querySelector("svg.lucide-check")).toBeNull();
    expect(within(madrid).getByTestId("comprar-falta-paso")).toHaveTextContent("Te falta elegir hotel en Madrid");
    expect(screen.getByTestId("enviar-seleccion-falta")).toHaveTextContent("hotel en Madrid");
    // Elegirlo: palomita y deja de faltar en ambos lados.
    fireEvent.click(def);
    await waitFor(() => expect(within(screen.getAllByTestId("comprar-hospedaje")[0]).getByRole("radio", { checked: true })).toHaveTextContent("Catalonia"));
    expect(within(screen.getAllByTestId("comprar-hospedaje")[0]).queryByTestId("comprar-falta-paso")).toBeNull();
    expect(screen.getByTestId("enviar-seleccion-falta")).not.toHaveTextContent("hotel en Madrid");
  });
});

beforeEach(() => { localStorage.clear(); db.trip = makeTrip(); });
