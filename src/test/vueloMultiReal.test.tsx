// Vuelo internacional del multidestino con precio REAL (logistics-plan/openJaw.ts): open-jaw
// MEX → Roma y Siena (FLR) → MEX en Google Flights (SerpApi google_flights type=3 + multi_city_json,
// MXN, hl=es), con la caché compartida, el freno y la cuota de siempre. Fixture con la forma de la
// respuesta multi-city de SerpApi (9 resultados). Sin llamadas reales.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const env: Record<string, string> = {};
(globalThis as unknown as { Deno: unknown }).Deno = { env: { get: (k: string) => env[k] } };

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: null } }) },
    from: () => ({ select: () => ({ eq: () => ({ then: (r: any) => r({ data: [], error: null }) }) }) }),
    functions: { invoke: vi.fn(async () => { throw new Error("sin red en pruebas"); }) },
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));

import MULTI_MXN from "./fixtures/gflights/flights_multi_city_mxn.json";
import { flightsTotalMxn, openJawSearchBody, openJawTiers, pickTiers, planOpenJaw } from "../../supabase/functions/logistics-plan/openJaw";
import { forceEstimated, pricingSources, scrubEstimatedFlight } from "../../supabase/functions/logistics-plan/provenance";
import { logisticsReferences } from "../../supabase/functions/logistics-plan/snapshot";
import { searchMultiCity } from "../../supabase/functions/flights-search/multiCity";
import { createSerpFetch, memoryCacheStore, type AccountBrake, type GateDecision } from "../../supabase/functions/_shared/serpCache";
import { finalizeSearchResponse } from "../../supabase/functions/_shared/liveSearch";
import { nearestAirport } from "../../supabase/functions/_shared/airports";
import { parseGoogleFlightsSearch } from "../../supabase/functions/_shared/booking/links";
import { tripFlightRoute } from "../../supabase/functions/_shared/booking/tripRoute";
import { multiDestTripInsert } from "@/lib/multiDestGenerate";
import { computeTripDesglose } from "@/lib/quote";
import { buildBuyFlow } from "@/lib/buyFlow";
import { tripTotalSummary } from "@/lib/tripTotal";
import { tripTotals } from "@/components/RealTripTotal";
import { flightLiveLine, flightStopsLabel } from "@/lib/flightDisplay";
import { flightBuyLinks } from "@/components/booking/FlightBuyButtons";
import { provenanceOf } from "@/lib/provenance";
import { TripPurchasePlan } from "@/components/booking/TripPurchasePlan";
import { MultiCityFareButton } from "@/components/booking/RealPriceButtons";
import type { Invoke } from "@/lib/realFares";

const NOW = Date.parse("2026-10-24T15:00:00Z");
const FX = 18.5;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const BODY = { origin: "Ciudad de México", destinations: ["Roma", "Florencia", "Siena"], fecha_salida: "2027-03-02", fecha_regreso: "2027-03-12", num_viajeros: 2 };
const plan = planOpenJaw(BODY) as Extract<ReturnType<typeof planOpenJaw>, { ok: true }>;

/** Lo que hace logistics-plan: flights-search (caché + gate + freno) → finalizeSearchResponse → tiers. */
async function quote(opts: { store?: ReturnType<typeof memoryCacheStore>; fetchImpl?: any; gate?: () => Promise<GateDecision>; brake?: AccountBrake; now?: number; body?: any; p?: any } = {}) {
  const now = opts.now ?? NOW;
  const fetchImpl = opts.fetchImpl ?? vi.fn(async () => json(MULTI_MXN));
  const p = opts.p ?? plan;
  const serp = createSerpFetch({ store: opts.store ?? memoryCacheStore(() => now), gate: opts.gate, brake: opts.brake, fetchImpl, now: () => now, log: () => {} });
  const r = await searchMultiCity(opts.body ?? openJawSearchBody(p), { serpKey: "K", serpFetch: serp.fetch });
  const out = finalizeSearchResponse(r, serp.trace, now);
  return { out, q: openJawTiers(out.body, p, { fx: FX, now }), fetchImpl, trace: serp.trace };
}

/** Plan mínimo de logistics-plan con esos vuelos (como lo guarda el cliente). */
function logisticsWith(flights: any[], tier = "equilibrio") {
  const f = flights.find((x) => x.tier === tier) ?? flights[0];
  const vuelos = flightsTotalMxn(f, 2, FX);
  const desglose = { vuelos, hospedaje: 0, comida: 30000, tours: 0, transporte_local: 0, extras: 0 };
  return {
    flights, internal_transport: [], days: [], per_destination: [], selected_tier: tier, fx_usd_mxn: FX, nights: 10,
    desglose_presupuesto: desglose, total_estimado_mxn: vuelos + 30000, pricing_sources: pricingSources(flights, []),
    quoted_at: new Date(NOW).toISOString(), travelers: 2, destinations: BODY.destinations,
  };
}

function savedTrip(logistics: any) {
  const row = multiDestTripInsert({ userId: "u1", origin: BODY.origin, stops: BODY.destinations, fechaSalida: BODY.fecha_salida, fechaRegreso: BODY.fecha_regreso,
    viajeros: 2, prefs: {} }, logistics);
  return { ...row, id: "11111111-1111-4111-8111-111111111111", created_at: new Date(NOW).toISOString() } as any;
}

describe("open-jaw real en Google Flights: tramos, aeropuertos y parámetros", () => {
  it("origen → primera ciudad en fecha_salida y última → origen en fecha_regreso; Siena regresa desde FLR", () => {
    expect(plan.ok).toBe(true);
    expect(plan.legs).toEqual([{ from: "MEX", to: "FCO", date: "2027-03-02" }, { from: "FLR", to: "MEX", date: "2027-03-12" }]);
    expect(plan.notes).toEqual(["Regresas desde Florencia (FLR), a 56 km de Siena"]);
  });

  it("SerpApi google_flights type=3 con multi_city_json, adultos y clase del cuerpo, MXN y hl=es", async () => {
    const { fetchImpl } = await quote();
    const u = new URL(String((fetchImpl.mock.calls[0] as unknown[])[0]));
    expect(u.searchParams.get("engine")).toBe("google_flights");
    expect(u.searchParams.get("type")).toBe("3");
    expect(JSON.parse(u.searchParams.get("multi_city_json")!)).toEqual([
      { departure_id: "MEX", arrival_id: "FCO", date: "2027-03-02" },
      { departure_id: "FLR", arrival_id: "MEX", date: "2027-03-12" },
    ]);
    expect(u.searchParams.get("adults")).toBe("2");
    expect(u.searchParams.get("currency")).toBe("MXN");
    expect(u.searchParams.get("hl")).toBe("es");
    expect(u.searchParams.get("travel_class")).toBeNull();
    const biz = planOpenJaw({ ...BODY, travel_class: "business" }) as any;
    const r2 = await quote({ p: biz });
    const u2 = new URL(String((r2.fetchImpl.mock.calls[0] as unknown[])[0]));
    expect(u2.searchParams.get("travel_class")).toBe("3");
  });
});

describe("los 3 tiers salen de resultados REALES", () => {
  it("ahorro = el más barato, equilibrio = precio medio, premium = el más rápido; aerolínea, horarios, escalas, total y enlace", async () => {
    const { q } = await quote();
    expect(q.live).toBe(true);
    const flights = (q as any).flights;
    expect(flights.map((f: any) => f.tier)).toEqual(["ahorro", "equilibrio", "premium"]);
    expect(flights.map((f: any) => f.airline_suggested)).toEqual(["Iberia", "British Airways", "Air France"]);
    expect(flights.map((f: any) => f.price_total_mxn)).toEqual([38940, 45990, 58700]);
    expect(flights.map((f: any) => f.price_per_person_mxn)).toEqual([19470, 22995, 29350]);
    const [a, , p] = flights;
    expect(a.salida).toBe("2027-03-02 18:05");
    expect(a.llegada).toBe("2027-03-03 16:45");
    expect(a.stops).toBe("Escalas: Madrid");
    expect(a.layovers).toEqual(["Madrid"]);
    expect(a.duration).toBe("14h 20m");
    expect(p.duration).toBe("13h 10m");
    for (const f of flights) {
      expect(f.fuente_precio).toBe("en_vivo");
      expect(f.estado_dato).toBe("CONSULTADO_EN_VIVO");
      expect(f.frescura).toBe("en_vivo");
      expect(f.consultado_at).toBe(new Date(NOW).toISOString());
      expect(f.booking_link).toBe(MULTI_MXN.search_metadata.google_flights_url);
      expect(f.departure_token).toMatch(/^TOKEN_/);
      expect(f.airline_suggested).not.toMatch(/por confirmar/);
    }
    // El enlace lleva la misma búsqueda: MEX→FCO a la ida, FLR→MEX al regreso, 2 adultos.
    const gf = parseGoogleFlightsSearch(a.booking_link)!;
    expect([gf.origin, gf.destination, gf.return_from, gf.depart, gf.ret, gf.adults]).toEqual(["MEX", "FCO", "FLR", "2027-03-02", "2027-03-12", 2]);
  });

  it("con un solo resultado los 3 tiers son ese vuelo; sin precio no hay tiers", () => {
    const one = pickTiers([{ price_total: 100, duration_minutes: 600 }])!;
    expect(one.ahorro).toBe(one.premium);
    expect(pickTiers([{ price_total: 0 }])).toBeNull();
  });
});

describe("el total del viaje usa ese precio", () => {
  it("servidor (desglose), filas del viaje, Comprar y el total de la página dan lo mismo, sin 'Incluye estimados: vuelos'", async () => {
    const { q } = await quote();
    const logistics = logisticsWith((q as any).flights);
    expect(logistics.desglose_presupuesto.vuelos).toBe(45990);
    expect(logistics.pricing_sources.vuelos).toBe("google_flights");
    const trip = savedTrip(logistics);
    const v = trip.vuelos_json.find((x: any) => x.tier === "equilibrio");
    expect(v.precio_por_persona * 2).toBe(45990);
    expect(v.aerolinea).toBe("British Airways");
    expect(v.fuente_precio).toBe("en_vivo");
    expect(v.aeropuerto_nota).toBe("Regresas desde Florencia (FLR), a 56 km de Siena");
    const sel = { selVuelo: trip.vuelos_json.indexOf(v), selHospedaje: -1, selTours: new Set<number>(), selHoteles: {} as Record<string, number> };
    const desglose = computeTripDesglose(trip, { ...sel, nochesHospedaje: 10 } as any, 2);
    expect(desglose.vuelos).toBe(45990);
    expect(tripTotals(trip, 2, desglose).total).toBe(logistics.total_estimado_mxn);
    const items = buildBuyFlow(trip, sel, {}, { quoteCreatedAt: null }).items;
    const s = tripTotalSummary({ trip, sel, desglose, items, now: new Date(NOW + 60_000) });
    expect(s.estimadosNote).not.toMatch(/vuelo/);
    // El snapshot (trip_quotes) guarda el vuelo como consultado en vivo con su fecha.
    expect(logisticsReferences(logistics).vuelos).toMatchObject({ fuente_precio: "en_vivo", estado_dato: "CONSULTADO_EN_VIVO", consultado_at: new Date(NOW).toISOString() });
  });

  it("Comprar muestra 'en vivo · consultado HH:MM', la nota del aeropuerto y 'Comprar en Google Flights' con los mismos parámetros", async () => {
    const realNow = Date.now;
    Date.now = () => NOW + 5 * 60_000;
    try {
      const { q } = await quote();
      const trip = savedTrip(logisticsWith((q as any).flights));
      const i = trip.vuelos_json.findIndex((x: any) => x.tier === "ahorro");
      render(<MemoryRouter><TripPurchasePlan trip={trip} selVuelo={i} selHospedaje={-1} selTours={new Set()} bookings={[]} userId={null} /></MemoryRouter>);
      expect(screen.getByTestId("vuelo-en-vivo").textContent).toMatch(/^Google Flights · en vivo · consultado \d{2}:\d{2}/);
      expect(screen.getByTestId("vuelo-aeropuerto-nota").textContent).toBe("Regresas desde Florencia (FLR), a 56 km de Siena.");
      const btn = screen.getByTestId("comprar-vuelo-abrir");
      expect(btn.textContent).toMatch(/Comprar en Google Flights/);
      expect(btn.getAttribute("href")).toBe(MULTI_MXN.search_metadata.google_flights_url);
      expect(screen.getAllByTestId("vuelo-opcion")[0].textContent).toMatch(/Iberia.*Escalas: Madrid · 14h 20m/);
      expect(screen.getAllByTestId("vuelo-horario")[0].textContent).toBe("Sale 18:05 · llega 16:45 +1");
      // Detalle del viaje / "Cómo llegar": el mismo enlace.
      expect(flightBuyLinks(trip.vuelos_json[i], trip, i).google).toBe(MULTI_MXN.search_metadata.google_flights_url);
      expect(flightStopsLabel(trip.vuelos_json[i])).toBe("Escalas: Madrid");
    } finally {
      Date.now = realNow;
    }
  });

  it("una consulta de hace horas no se llama 'en vivo': 'consultado HH:MM (hace 3 h)'", async () => {
    const { q } = await quote();
    const f = (q as any).flights[0];
    expect(flightLiveLine(f, NOW + 3 * 3600_000)).toMatch(/^Google Flights · consultado \d{2}:\d{2} \(hace 3 h\)$/);
    expect(provenanceOf({ source: f.fuente_precio, estado: f.estado_dato, consultadoAt: f.consultado_at }, new Date(NOW + 60_000)).label).toBe("Consultado en vivo · Google Flights");
  });
});

describe("una ciudad sin aeropuerto toma el más cercano de la tabla", () => {
  it("Siena → Florencia (FLR); se dice en la tarjeta", () => {
    expect(nearestAirport("Siena")).toEqual({ airport: "FLR", city: "Florencia", place: "Siena", km: 56, exact: false });
    expect(nearestAirport("Roma")).toMatchObject({ airport: "FCO", exact: true, km: 0 });
    expect(nearestAirport("Lucca")).toMatchObject({ airport: "PSA", city: "Pisa" });
    const p = planOpenJaw({ ...BODY, destinations: ["Siena", "Roma"] }) as any;
    expect(p.legs).toEqual([{ from: "MEX", to: "FLR", date: "2027-03-02" }, { from: "FCO", to: "MEX", date: "2027-03-12" }]);
    expect(p.notes).toEqual(["Vuelas a Florencia (FLR), a 56 km de Siena"]);
    // Comprar / "Actualizar precio" usan la misma ruta (antes: "No reconocemos el aeropuerto").
    const r = tripFlightRoute({ destino: "Siena → Roma", ciudad_origen: "Ciudad de México", fecha_salida: "2027-03-02", fecha_regreso: "2027-03-12", num_viajeros: 2 });
    expect([r.origin, r.destination, r.returnFrom, r.missing]).toEqual(["MEX", "FLR", "FCO", []]);
  });

  it("un lugar que no está en la tabla no se adivina: queda estimado", () => {
    const p = planOpenJaw({ ...BODY, destinations: ["Roma", "Pueblo Inventado"] });
    expect(p).toEqual({ ok: false, reason: "sin_aeropuerto:Pueblo Inventado" });
    expect(openJawTiers({ ok: true, source: "serpapi", results: [] }, p, { fx: FX }).live).toBe(false);
    expect(planOpenJaw({ ...BODY, fecha_regreso: null }).ok).toBe(false);
  });
});

describe("sin resultados o con error: lo de antes, rotulado estimado (nunca mezclado sin etiqueta)", () => {
  const AI = [{ tier: "equilibrio", from: "Ciudad de México", to: "Roma", airline_suggested: "Iberia", stops: "Directo", price_per_person_usd: 1200, fuente_precio: "serpapi" }];

  it.each([
    ["SerpApi responde 500", vi.fn(async () => json({ error: "boom" }, 500))],
    ["sin resultados", vi.fn(async () => json({ search_metadata: {}, best_flights: [], other_flights: [] }))],
    ["la red falla", vi.fn(async () => { throw new Error("ECONNRESET"); })],
  ])("%s → live:false y el vuelo de la IA queda estimado", async (_n, fetchImpl) => {
    const { q } = await quote({ fetchImpl });
    expect(q.live).toBe(false);
    const flights = q.live ? (q as any).flights : forceEstimated(AI).map(scrubEstimatedFlight);
    expect(flights[0]).toMatchObject({ fuente_precio: "estimado", estado_dato: "ESTIMADO", airline_suggested: "Aerolínea por confirmar", stops: "Escalas por confirmar" });
    const logistics = logisticsWith(flights);
    expect(logistics.pricing_sources.vuelos).toBe("estimado");
    const trip = savedTrip(logistics);
    expect(trip.vuelos_json[0]).toMatchObject({ fuente_precio: "estimado", aerolinea: "Aerolínea por confirmar" });
    const sel = { selVuelo: 0, selHospedaje: -1, selTours: new Set<number>(), selHoteles: {} as Record<string, number> };
    const desglose = computeTripDesglose(trip, { ...sel, nochesHospedaje: 10 } as any, 2);
    const s = tripTotalSummary({ trip, sel, desglose, items: buildBuyFlow(trip, sel, {}).items, now: new Date(NOW) });
    expect(s.estimadosNote).toMatch(/Incluye estimados: vuelo/);
  });

  it("sin llave de SerpApi, o con precios en USD, tampoco se presenta como en vivo", async () => {
    const r = await searchMultiCity(openJawSearchBody(plan), { serpKey: null });
    expect(openJawTiers(r.body, plan, { fx: FX }).live).toBe(false);
    const usd = await quote({ body: { ...openJawSearchBody(plan), currency: "USD" } });
    expect(usd.q.live).toBe(false);
    expect(openJawTiers({ error: "timeout" }, plan, { fx: FX })).toEqual({ live: false, reason: "error:timeout" });
  });
});

describe("caché compartida y cuota", () => {
  it("la misma ruta, fechas, viajeros y clase paga UNA búsqueda; la segunda sale de serp_cache con su hora real", async () => {
    const store = memoryCacheStore(() => NOW);
    const fetchImpl = vi.fn(async () => json(MULTI_MXN));
    const gate = vi.fn(async (): Promise<GateDecision> => ({ allow: true }));
    const a = await quote({ store, fetchImpl, gate });
    const b = await quote({ store, fetchImpl, gate, now: NOW + 3 * 3600_000 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(gate).toHaveBeenCalledTimes(1); // un acierto de caché no gasta
    expect(b.out.body.from_cache).toBe(true);
    const fb = (b.q as any).flights[0];
    expect(fb.consultado_at).toBe((a.q as any).flights[0].consultado_at);
    expect(fb.frescura).toBe("cache");
    expect(flightLiveLine(fb, NOW + 3 * 3600_000)).toMatch(/\(hace 3 h\)/);
    // Otra clase es otra búsqueda.
    await quote({ store, fetchImpl, gate, p: planOpenJaw({ ...BODY, travel_class: "premium" }) });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("como análisis (firmado) no pasa por la bolsa; con la bolsa agotada (Actualizar precio) no se llama y queda estimado", async () => {
    const fetchImpl = vi.fn(async () => json(MULTI_MXN));
    const analysis = await quote({ fetchImpl });
    expect(analysis.q.live).toBe(true);
    const denied = vi.fn(async (): Promise<GateDecision> => ({ allow: false, soft: false, info: { quota: "live_searches_daily", limit: 5, used: 5 } }));
    const fetch2 = vi.fn(async () => json(MULTI_MXN));
    const r = await quote({ fetchImpl: fetch2, gate: denied });
    expect(fetch2).not.toHaveBeenCalled();
    expect(r.out.status).toBe(402);
    expect(r.q.live).toBe(false);
  });

  it("cuenta de SerpApi en pausa: sin precio guardado queda estimado; con uno vencido se marca 'precio guardado', no en vivo", async () => {
    const brake: AccountBrake = { paused: async () => "budget", tripQuota: async () => {} };
    const empty = await quote({ brake });
    expect(empty.q.live).toBe(false);
    const store = memoryCacheStore(() => NOW);
    await quote({ store });
    const later = NOW + 30 * 3600_000;
    const stale = await quote({ store, brake, now: later });
    expect(stale.q.live).toBe(true);
    const f = (stale.q as any).flights[0];
    expect(f.estado_dato).toBe("OBSOLETO");
    expect(f.precio_guardado).toBe(true);
    expect(flightLiveLine(f, later)).toMatch(/actualízalo antes de comprar/);
    expect(provenanceOf({ source: f.fuente_precio, estado: f.estado_dato, consultadoAt: f.consultado_at }, new Date(later)).state).toBe("OBSOLETO");
  });
});

describe("\"Actualizar precio\" del vuelo en vivo (mismos parámetros, MXN)", () => {
  it("repite la búsqueda del plan en MXN y compara con el precio del plan", async () => {
    const { q } = await quote();
    const trip = savedTrip(logisticsWith((q as any).flights));
    const cheaper = { ...MULTI_MXN, best_flights: [{ ...MULTI_MXN.best_flights[0], price: 37900 }], other_flights: [] };
    const invoke = vi.fn(async (_fn: string, o: { body: any }) => {
      const r = await searchMultiCity(o.body, { serpKey: "K", serpFetch: (async () => json(cheaper)) as unknown as typeof fetch });
      return { data: { ...r.body, consulted_at: new Date(NOW).toISOString() }, error: null };
    });
    const ahorro = trip.vuelos_json.find((x: any) => x.tier === "ahorro");
    const t2 = { ...trip, vuelos_json: [ahorro] };
    render(<MultiCityFareButton trip={t2} interLegs={[{ from: "Roma", to: "Florencia", date: null, mode: "tren" }, { from: "Florencia", to: "Siena", date: null, mode: "coche" }]} invoke={invoke as unknown as Invoke} />);
    const btn = screen.getByTestId("multi-precio-consultar");
    expect(btn.textContent).toMatch(/Actualizar precio/);
    fireEvent.click(btn);
    await screen.findByTestId("multi-precio-resultado");
    expect(invoke.mock.calls[0][1].body).toEqual({ type: "multi", travelers: 2, currency: "MXN",
      legs: [{ from: "MEX", to: "FCO", date: "2027-03-02" }, { from: "FLR", to: "MEX", date: "2027-03-12" }] });
    expect(screen.getByTestId("multi-precio-total").textContent).toBe("$37,900 MXN");
    expect(screen.getByTestId("multi-precio-antes").textContent).toMatch(/Precio del plan: \$38,940 MXN · bajó \$1,040 MXN/);
  });
});
