// SerpApi con pocas búsquedas: TTL según la fecha del viaje, búsquedas idénticas juntadas, freno
// de la cuenta (presupuesto y cuota agotada) con precio guardado etiquetado, y resultados de
// vuelos/hoteles con todo lo que trae Google y su etiqueta. Sin llamadas reales.
import { describe, it, expect, vi } from "vitest";

const env: Record<string, string> = {};
(globalThis as unknown as { Deno: unknown }).Deno = { env: { get: (k: string) => env[k] } };

import flightsFixture from "./fixtures/googlemax/serp_flights_round.json";
import hotelsFixture from "./fixtures/googlemax/serp_hotels.json";
import {
  cacheKey, createSerpFetch, isSerpQuotaError, memoryCacheStore, travelDateTtlSeconds,
} from "../../supabase/functions/_shared/serpCache";
import { makeAccountBrake, QUOTA_PAUSE_SECONDS } from "../../supabase/functions/_shared/serpBrake";
import { finalizeSearchResponse, PAUSED_EMPTY, PAUSED_NOTICE } from "../../supabase/functions/_shared/liveSearch";
import { googleFlightResult, searchFlights, TP_LABEL } from "../../supabase/functions/flights-search/search";
import { searchHotels } from "../../supabase/functions/hotels-search/search";
import { buildQuoteSnapshot, lineStateFor, totalsByState } from "../../supabase/functions/_shared/quotes";
import { enforceSources, liveConsultedAt } from "../../supabase/functions/analizar-viaje/sources";

const NOW = Date.parse("2026-10-22T12:00:00Z");
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const url = (date: string) => `https://serpapi.com/search.json?engine=google_flights&departure_id=MEX&arrival_id=MAD&outbound_date=${date}&api_key=SECRETO`;

describe("TTL según qué tan lejos está el viaje", () => {
  const p = (k: string, v: string) => new URLSearchParams({ [k]: v });
  it("vuelos: 3 h / 6 h / 12 h / 24 h; hoteles: 6 h / 12 h / 24 h / 48 h", () => {
    expect(travelDateTtlSeconds("google_flights", p("outbound_date", "2026-10-25"), NOW)).toBe(3 * 3600);
    expect(travelDateTtlSeconds("google_flights", p("outbound_date", "2026-11-10"), NOW)).toBe(6 * 3600);
    expect(travelDateTtlSeconds("google_flights", p("outbound_date", "2026-12-20"), NOW)).toBe(12 * 3600);
    expect(travelDateTtlSeconds("google_flights", p("outbound_date", "2027-04-01"), NOW)).toBe(24 * 3600);
    expect(travelDateTtlSeconds("google_hotels", p("check_in_date", "2026-10-24"), NOW)).toBe(6 * 3600);
    expect(travelDateTtlSeconds("google_hotels", p("check_in_date", "2027-04-01"), NOW)).toBe(48 * 3600);
    // Sin fecha o en otros motores: el TTL base de siempre.
    expect(travelDateTtlSeconds("google_flights", new URLSearchParams(), NOW)).toBe(6 * 3600);
    expect(travelDateTtlSeconds("google_maps", p("outbound_date", "2027-04-01"), NOW)).toBe(7 * 86400);
  });

  it("se guarda con el TTL de la fecha del viaje", async () => {
    const store = memoryCacheStore(() => NOW);
    const { fetch: f } = createSerpFetch({ store, fetchImpl: (async () => json(flightsFixture)) as unknown as typeof fetch, now: () => NOW });
    await f(url("2027-04-01"));
    expect([...store.rows.values()][0].ttl_seconds).toBe(24 * 3600);
  });
});

describe("búsquedas idénticas al mismo tiempo", () => {
  it("pagan una sola búsqueda y ambas reciben el mismo resultado con la misma fecha", async () => {
    let release!: () => void;
    const wait = new Promise<void>((r) => { release = r; });
    const impl = vi.fn(async () => { await wait; return json(flightsFixture); });
    const onLive = vi.fn();
    const inflight = new Map();
    const a = createSerpFetch({ store: memoryCacheStore(() => NOW), fetchImpl: impl as unknown as typeof fetch, now: () => NOW, inflight, onLive });
    const b = createSerpFetch({ store: memoryCacheStore(() => NOW), fetchImpl: impl as unknown as typeof fetch, now: () => NOW, inflight, onLive });
    const pa = a.fetch(url("2026-11-10"));
    // Espera a que la primera ya esté en SerpApi (antes: 5 ms fijos; con la máquina cargada la segunda
    // llegaba antes de que la primera se registrara y la prueba fallaba sin que el código estuviera mal).
    await vi.waitFor(() => expect(impl).toHaveBeenCalledTimes(1));
    const pb = b.fetch(url("2026-11-10"));
    // La segunda llega mientras la primera sigue esperando a SerpApi (cachés distintas a propósito).
    await new Promise((r) => setTimeout(r, 20));
    release();
    const [ra, rb] = await Promise.all([pa, pb]);
    expect(impl).toHaveBeenCalledTimes(1);
    expect(onLive).toHaveBeenCalledTimes(1);
    expect((await ra.json()).best_flights[0].price).toBe(1530);
    expect((await rb.json()).best_flights[0].price).toBe(1530);
    expect(rb.headers.get("x-iatos-cache")).toBe("hit");
    expect(b.trace).toMatchObject({ live: 0, hits: 1, coalesced: 1 });
    expect(inflight.size).toBe(0);
  });
});

describe("freno de la cuenta de SerpApi", () => {
  it("cuota agotada: se pausa 1 h para todos y se sirve el último precio guardado con su fecha", async () => {
    let now = NOW;
    const store = memoryCacheStore(() => now);
    const brake = makeAccountBrake({ store, now: () => now });
    // Precio guardado hace 2 días (vencido).
    now = NOW - 2 * 86400_000;
    await store.put(await cacheKey("google_flights", new URL(url("2026-11-10")).searchParams), "google_flights", flightsFixture, 6 * 3600);
    now = NOW;
    const impl = vi.fn(async () => json({ error: "Your account has run out of searches." }, 429));
    const s1 = createSerpFetch({ store, brake, fetchImpl: impl as unknown as typeof fetch, now: () => now });
    const r1 = await s1.fetch(url("2026-11-10"));
    expect(r1.status).toBe(200);
    expect(r1.headers.get("x-iatos-cache")).toBe("stale");
    expect(s1.trace).toMatchObject({ paused: "quota", stale: 1 });
    expect(await brake.paused()).toBe("quota");
    // Otra búsqueda (sin precio guardado) en la siguiente hora: ni siquiera se llama a SerpApi.
    const s2 = createSerpFetch({ store, brake, fetchImpl: impl as unknown as typeof fetch, now: () => now });
    const r2 = await s2.fetch(url("2026-12-01"));
    expect(impl).toHaveBeenCalledTimes(1);
    expect(r2.status).toBe(429);
    expect(r2.headers.get("x-iatos-cache")).toBe("paused");
    // Pasada la hora se vuelve a intentar.
    now = NOW + (QUOTA_PAUSE_SECONDS + 1) * 1000;
    expect(await brake.paused()).toBeNull();
    expect(isSerpQuotaError(200, { error: "Google hasn't returned any results" })).toBe(false);
  });

  it("presupuesto del mes alcanzado: no se busca en vivo (tampoco en análisis)", async () => {
    const used = vi.fn(async () => 150);
    const brake = makeAccountBrake({ store: null, monthlyBudget: 150, used, now: () => NOW });
    const impl = vi.fn(async () => json(flightsFixture));
    const s = createSerpFetch({ store: memoryCacheStore(() => NOW), brake, fetchImpl: impl as unknown as typeof fetch, now: () => NOW });
    const r = await s.fetch(url("2026-11-10"));
    expect(impl).not.toHaveBeenCalled();
    expect(r.headers.get("x-iatos-cache")).toBe("paused");
    expect(s.trace.paused).toBe("budget");
    // Sin presupuesto configurado no hay tope de cuenta; si la base falla, se permite.
    expect(await makeAccountBrake({ store: null, used }).paused()).toBeNull();
    expect(await makeAccountBrake({ store: null, monthlyBudget: 10, used: async () => { throw new Error("db"); }, log: () => {} }).paused()).toBeNull();
  });

  it("la respuesta dice que las búsquedas están en pausa (con o sin resultados)", () => {
    const trace = { live: 0, hits: 0, stale: 1, denied: null, oldestFetchedAt: "2026-10-20T12:00:00Z", paused: "quota" as const };
    const withData = finalizeSearchResponse({ status: 200, body: { source: "serpapi", results: [{ airline: "AM" }] } }, trace, NOW);
    expect(withData.body).toMatchObject({ aviso_limite: PAUSED_NOTICE, busquedas_en_pausa: true, precio_guardado: true, estado_dato: "OBSOLETO" });
    expect((withData.body.results as any[])[0]).toMatchObject({ estado_dato: "OBSOLETO", consultado_at: "2026-10-20T12:00:00Z", precio_guardado: true });
    const empty = finalizeSearchResponse({ status: 200, body: { source: "none", results: [] } }, { ...trace, stale: 0, oldestFetchedAt: null }, NOW);
    expect(empty).toMatchObject({ status: 200, body: { motivo: PAUSED_EMPTY, busquedas_en_pausa: true } });
  });
});

describe("vuelos y hoteles: todo lo que trae Google, con su etiqueta", () => {
  it("Google Flights: tramos, números de vuelo, escalas, emisiones y precio total explicado", () => {
    const r = googleFlightResult(flightsFixture.other_flights[0], 2, true, "https://www.aviasales.com/x");
    expect(r).toMatchObject({
      price_usd: 1180, price_per_person_usd: 590, airline: "Avianca", stops: 1, duration: "16h 35m", duration_minutes: 995,
      fuente: "google_flights", departure_token: "WyJDalJJ2...",
    });
    expect(r.segments.map((s) => s.flight_number)).toEqual(["AV 61", "AV 10"]);
    expect(r.layovers).toEqual([{ airport: "BOG", name: "Aeropuerto El Dorado", duration: "2h 30m", overnight: false }]);
    expect(r.price_note).toBe("Precio total para 2 viajeros, ida y vuelta, según Google Flights.");
    expect(googleFlightResult(flightsFixture.best_flights[0], 1, true, "x").carbon_kg).toBe(712);
  });

  it("flights-search: resultados de SerpApi y, de respaldo, Travelpayouts como precio de referencia", async () => {
    const gf = await searchFlights({ origin: "MEX", destination: "MAD", depart: "2026-11-10", return_date: "2026-11-20", travelers: 2 }, {
      serpKey: "k", serpFetch: (async () => json(flightsFixture)) as unknown as typeof fetch,
    });
    expect(gf.body).toMatchObject({ source: "serpapi", etiqueta_fuente: "Google Flights" });
    expect((gf.body.results as any[])[0]).toMatchObject({ price_usd: 1180, fuente: "google_flights" });

    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => json({ data: { MAD: { 0: { price: 610, airline: "IB", transfers: 1, departure_at: "2026-11-10T10:00:00Z", expires_at: "2026-10-23T10:00:00Z" } } } })) as typeof fetch;
    try {
      const tp = await searchFlights({ origin: "MEX", destination: "MAD", depart: "2026-11-10", return_date: "2026-11-20", travelers: 1 }, {
        serpKey: "k", tpToken: "t", serpFetch: (async () => json({ error: "live_search_limit" }, 429)) as unknown as typeof fetch,
      });
      expect(tp.body).toMatchObject({ source: "travelpayouts", estado_dato: "ESTIMADO", etiqueta_fuente: TP_LABEL });
      expect((tp.body.results as any[])[0]).toMatchObject({ fuente: "travelpayouts", estado_dato: "ESTIMADO", etiqueta: TP_LABEL, vigencia_hasta: "2026-10-23T10:00:00Z" });
      expect(TP_LABEL).toMatch(/puede variar/);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("Google Hotels: total con impuestos, monto antes de impuestos, categoría numérica y ubicación", async () => {
    const out = await searchHotels({ city: "Madrid", checkin: "2026-11-10", checkout: "2026-11-15", adults: 2, sort: "price" }, {
      serpKey: "k", serpFetch: (async () => json(hotelsFixture)) as unknown as typeof fetch,
    });
    const [cheap, unico] = out.body.results as any[];
    expect(unico).toMatchObject({
      name: "Hotel Único Madrid", nightly_usd: 412, total_usd: 2060, nightly_before_taxes_usd: 375, total_before_taxes_usd: 1875,
      total_incluye_impuestos: true, hotel_class: 5, lat: 40.4301, check_in_time: "15:00", proveedor_tarifa: "Booking.com", fuente: "google_hotels",
    });
    // Sin total de Google: se calcula noche × noches y se dice.
    expect(cheap).toMatchObject({ name: "Hostal Sin Total", total_usd: 475, total_calculado: true, hotel_class: 3 });
    expect(out.body.etiqueta_fuente).toBe("Google Hotels");
  });
});

describe("cotización: la fecha real de cada fuente y el total con las mismas etiquetas", () => {
  it("cada lista lleva su propia fecha; un precio guardado no se presenta como en vivo", () => {
    expect(liveConsultedAt({ consulted_at: "2026-10-22T06:00:00Z" }, "x")).toBe("2026-10-22T06:00:00Z");
    expect(liveConsultedAt({ consulted_at: "basura" }, "fallback")).toBe("fallback");
    const a: any = {
      vuelos: [{ tier: "equilibrio", precio_por_persona: 18000, fuente_precio: "serpapi" }],
      hospedaje: [{ nombre: "Hotel Único Madrid", precio_por_noche: 8240, fuente_precio: "serpapi" }],
    };
    enforceSources(a, [], [{ name: "Hotel Único Madrid", nightly_usd: 412 }], "tripadvisor", {
      fxUsd: 20, consultedAt: "2026-10-22T12:00:00Z",
      googleFlights: [{ price_per_person_usd: 900 }], googleFlightsAt: "2026-10-22T07:00:00Z",
      hotelsAt: "2026-10-20T09:00:00Z", hotelsSaved: true,
    });
    expect(a.vuelos[0]).toMatchObject({ estado_dato: "CONSULTADO_EN_VIVO", consultado_at: "2026-10-22T07:00:00Z" });
    expect(a.hospedaje[0]).toMatchObject({ estado_dato: "OBSOLETO", consultado_at: "2026-10-20T09:00:00Z" });
    expect(lineStateFor(a.hospedaje[0], new Date(NOW), false)).toBe("PENDIENTE");
  });

  it("tours: la calificación la pone el servidor con la lista de Google, no el modelo", () => {
    const a: any = { tours: [{ nombre: "Museo del Prado", fuente: "google_places", rating: 5, num_reviews: 99999 }] };
    enforceSources(a, [{ name: "Museo del Prado", rating: 4.8, num_reviews: 120000, place_id: "ChIJprado", web_url: "https://maps.google.com/?cid=9" }], [], "google_places");
    expect(a.tours[0]).toMatchObject({ fuente: "google_places", rating: 4.8, num_reviews: 120000, place_id: "ChIJprado", estado_dato: "ESTIMADO" });
  });

  it("el total es la suma de renglones y se desglosa por estado", () => {
    const q = buildQuoteSnapshot({
      tripId: "t", userId: "u", origin: "analizar-viaje",
      breakdown: { vuelos: 36000, hospedaje: 41200, comida: 9000 },
      travelers: 2, nights: 5, rooms: 1,
      fx: { rate: 20, source: "frankfurter", fetched_at: "2026-10-22", is_fallback: false },
      reference: {
        vuelos: { fuente_precio: "serpapi", estado_dato: "CONSULTADO_EN_VIVO", consultado_at: "2026-10-22T07:00:00Z" },
        hospedaje: { fuente_precio: "serpapi", estado_dato: "OBSOLETO", consultado_at: "2026-10-20T09:00:00Z" },
      },
      now: new Date(NOW),
    });
    expect(q.total).toBe(86200);
    expect(q.sources.total_por_estado).toEqual({ COTIZADO: 36000, PENDIENTE: 41200, ESTIMADO: 9000 });
    expect(totalsByState([{ state: "OPCIONAL", amount: 5 }])).toEqual({});
  });
});
