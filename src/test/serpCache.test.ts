import { describe, it, expect, vi, beforeEach } from "vitest";

const env: Record<string, string> = {};
(globalThis as unknown as { Deno: unknown }).Deno = { env: { get: (k: string) => env[k] } };

import {
  CACHE_TTL_SECONDS, cacheKey, cacheProvenance, canonicalParams, createSerpFetch, memoryCacheStore, trimForCache,
  type GateDecision,
} from "../../supabase/functions/_shared/serpCache";
import { makeLiveSearchGate, finalizeSearchResponse, liveLimitOutcome } from "../../supabase/functions/_shared/liveSearch";
import { searchFlights } from "../../supabase/functions/flights-search/search";
import { searchHotels } from "../../supabase/functions/hotels-search/search";

const FLIGHTS_URL = "https://serpapi.com/search.json?engine=google_flights&departure_id=MEX&arrival_id=MAD&outbound_date=2026-11-10&api_key=SECRETO";
const flightsJson = {
  search_metadata: { id: "x", google_flights_url: "https://www.google.com/travel/flights?x", json_endpoint: "https://serpapi.com/x" },
  search_parameters: { engine: "google_flights", api_key: "no" },
  best_flights: [{ price: 812, flights: [{ airline: "Iberia" }] }],
  other_flights: [],
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("caché compartida de SerpApi", () => {
  let now = Date.parse("2026-10-22T12:00:00Z");
  const clock = () => now;
  beforeEach(() => { now = Date.parse("2026-10-22T12:00:00Z"); });

  it("TTL por motor: vuelos 6 h, hoteles 12 h, Maps 7 días, estado de vuelo 10 min, Pexels 7 días", () => {
    expect(CACHE_TTL_SECONDS).toMatchObject({
      google_flights: 6 * 3600, google_hotels: 12 * 3600, google_maps: 7 * 86400, google: 600,
      pexels_photo: 7 * 86400, pexels_video: 7 * 86400, trip_quote: 86400,
    });
  });

  it("la llave ignora la api_key y el orden/mayúsculas de los parámetros", async () => {
    const a = new URLSearchParams("engine=google_flights&departure_id=MEX&arrival_id=MAD&api_key=uno");
    const b = new URLSearchParams("arrival_id=mad&api_key=otra&engine=google_flights&departure_id=mex");
    expect(canonicalParams(a)).toBe(canonicalParams(b));
    expect(canonicalParams(a)).not.toMatch(/api_key|uno/);
    expect(await cacheKey("google_flights", a)).toBe(await cacheKey("google_flights", b));
    expect(await cacheKey("google_flights", a)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("guarda solo lo que se usa (sin parámetros ni metadatos con la llave)", () => {
    const t = trimForCache("google_flights", flightsJson) as Record<string, unknown>;
    expect(Object.keys(t).sort()).toEqual(["best_flights", "other_flights", "search_metadata"]);
    expect(t.search_metadata).toEqual({ google_flights_url: "https://www.google.com/travel/flights?x" });
  });

  it("primera búsqueda en vivo (cuenta 1 y se registra); la misma búsqueda después sale de la caché sin gastar", async () => {
    const store = memoryCacheStore(clock);
    const fetchImpl = vi.fn(async () => json(flightsJson));
    const gate = vi.fn(async (): Promise<GateDecision> => ({ allow: true }));
    const onLive = vi.fn();

    const s1 = createSerpFetch({ store, fetchImpl, gate, onLive, now: clock });
    const r1 = await s1.fetch(FLIGHTS_URL);
    expect(r1.headers.get("x-iatos-cache")).toBe("miss");
    expect((await r1.json()).best_flights[0].price).toBe(812);
    expect(s1.trace).toMatchObject({ live: 1, hits: 0 });

    now += 5 * 3600 * 1000; // 5 h después, otro usuario, misma ruta (otra api_key en la URL)
    const s2 = createSerpFetch({ store, fetchImpl, gate, onLive, now: clock });
    const r2 = await s2.fetch(FLIGHTS_URL.replace("SECRETO", "OTRA"));
    expect(r2.headers.get("x-iatos-cache")).toBe("hit");
    expect(r2.headers.get("x-iatos-fetched-at")).toBe("2026-10-22T12:00:00.000Z");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(gate).toHaveBeenCalledTimes(1); // el acierto de caché no gasta la bolsa del usuario
    expect(onLive).toHaveBeenCalledTimes(1);
    expect(onLive).toHaveBeenCalledWith({ engine: "google_flights", ok: true });
    expect(cacheProvenance(s2.trace, clock())).toMatchObject({
      fetched_at: "2026-10-22T12:00:00.000Z", estado_dato: "CONSULTADO_EN_VIVO", precio_guardado: false, from_cache: true,
    });
  });

  it("pasado el TTL nunca se sirve como vigente: vuelve a consultar en vivo", async () => {
    const store = memoryCacheStore(clock);
    const fetchImpl = vi.fn(async () => json(flightsJson));
    await createSerpFetch({ store, fetchImpl, now: clock }).fetch(FLIGHTS_URL);
    now += 6 * 3600 * 1000 + 1000;
    const s = createSerpFetch({ store, fetchImpl, now: clock });
    const r = await s.fetch(FLIGHTS_URL);
    expect(r.headers.get("x-iatos-cache")).toBe("miss");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(r.headers.get("x-iatos-fetched-at")).toBe(new Date(now).toISOString());
  });

  it("tope duro (FREE/prueba): no llama a SerpApi y NO sirve un precio vencido", async () => {
    const store = memoryCacheStore(clock);
    const fetchImpl = vi.fn(async () => json(flightsJson));
    await createSerpFetch({ store, fetchImpl, now: clock }).fetch(FLIGHTS_URL);
    now += 7 * 3600 * 1000;
    const s = createSerpFetch({ store, fetchImpl, now: clock, gate: async () => ({ allow: false, soft: false, info: { quota: "live_searches_daily" } }) });
    const r = await s.fetch(FLIGHTS_URL);
    expect(r.status).toBe(429);
    expect(r.headers.get("x-iatos-cache")).toBe("limit");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(s.trace.denied).toMatchObject({ soft: false });
  });

  it("uso justo (PRO): sirve el último precio guardado marcado OBSOLETO / precio guardado, sin bloquear", async () => {
    const store = memoryCacheStore(clock);
    const fetchImpl = vi.fn(async () => json(flightsJson));
    await createSerpFetch({ store, fetchImpl, now: clock }).fetch(FLIGHTS_URL);
    now += 30 * 3600 * 1000;
    const s = createSerpFetch({ store, fetchImpl, now: clock, gate: async () => ({ allow: false, soft: true }) });
    const r = await s.fetch(FLIGHTS_URL);
    expect(r.status).toBe(200);
    expect(r.headers.get("x-iatos-cache")).toBe("stale");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(cacheProvenance(s.trace, clock())).toMatchObject({
      fetched_at: "2026-10-22T12:00:00.000Z", estado_dato: "OBSOLETO", precio_guardado: true,
    });
  });

  it("si SerpApi responde con error (no lo cobra): se devuelve la búsqueda, no se guarda y se registra como no cobrada", async () => {
    const store = memoryCacheStore(clock);
    const refund = vi.fn(async () => {});
    const onLive = vi.fn();
    const s = createSerpFetch({
      store, now: clock, onLive,
      fetchImpl: vi.fn(async () => json({ error: "Google hasn't returned any results for this query." })),
      gate: async () => ({ allow: true, refund }),
    });
    await s.fetch(FLIGHTS_URL);
    expect(refund).toHaveBeenCalledTimes(1);
    expect(onLive).toHaveBeenCalledWith({ engine: "google_flights", ok: false });
    expect(store.rows.size).toBe(0);
  });

  it("no_cache=true no lee la caché; otras URLs pasan directo", async () => {
    const store = memoryCacheStore(clock);
    const fetchImpl = vi.fn(async () => json(flightsJson));
    const s = createSerpFetch({ store, fetchImpl, now: clock });
    await s.fetch(FLIGHTS_URL);
    await s.fetch(`${FLIGHTS_URL}&no_cache=true`);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    await s.fetch("https://api.travelpayouts.com/v1/prices/cheap?origin=MEX");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(store.rows.size).toBe(1);
  });

  it("si la base de la caché falla, la búsqueda sigue en vivo", async () => {
    const fetchImpl = vi.fn(async () => json(flightsJson));
    const s = createSerpFetch({
      store: { get: async () => { throw new Error("db down"); }, put: async () => { throw new Error("db down"); } },
      fetchImpl, now: clock, log: () => {},
    });
    const r = await s.fetch(FLIGHTS_URL);
    expect(r.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("bolsa de búsquedas en vivo (live_search_take)", () => {
  it("permitida: aparta 1 y sabe devolverla con el plan correcto", async () => {
    const rpc = vi.fn(async (fn: string) => ({ data: fn === "live_search_take" ? { allowed: true, plan: "trial" } : null, error: null }));
    const d = await makeLiveSearchGate(rpc, "u1")();
    expect(d.allow).toBe(true);
    expect(rpc).toHaveBeenCalledWith("live_search_take", { _user_id: "u1", _units: 1 });
    if (d.allow) await d.refund?.();
    expect(rpc).toHaveBeenCalledWith("live_search_refund", { _user_id: "u1", _plan: "trial", _units: 1 });
  });

  it("negada: tope duro o uso justo según la base", async () => {
    const hard = await makeLiveSearchGate(async () => ({ data: { allowed: false, soft: false, quota: "live_searches_daily" }, error: null }), "u")();
    const soft = await makeLiveSearchGate(async () => ({ data: { allowed: false, soft: true, reason: "fair_use" }, error: null }), "u")();
    expect(hard).toMatchObject({ allow: false, soft: false });
    expect(soft).toMatchObject({ allow: false, soft: true });
  });

  it("si la base no responde, falla abierta (y lo registra)", async () => {
    const log = vi.fn();
    const d = await makeLiveSearchGate(async () => ({ data: null, error: { message: "timeout" } }), "u", log)();
    expect(d.allow).toBe(true);
    expect(log).toHaveBeenCalled();
  });
});

describe("flights-search / hotels-search con límite del plan", () => {
  const tp = { data: { MAD: { 0: { price: 640, airline: "IB", transfers: 0, departure_at: "2026-11-10T10:00:00Z" } } } };
  const freeDenied = async (): Promise<GateDecision> => ({
    allow: false, soft: false,
    info: { quota: "live_searches_daily", limit: 5, used: 5, renews_at: "2026-10-23T00:00:00Z", upgrade_available: true, plan: "free" },
  });
  const flightsBody = { origin: "MEX", destination: "MAD", depart: "2026-11-10", travelers: 1, type: "oneway" };
  beforeEach(() => { vi.spyOn(console, "error").mockImplementation(() => {}); });

  it("FREE sin búsquedas: si Travelpayouts (gratis) tiene tarifa, se muestra con aviso; no se llama a SerpApi", async () => {
    const fetchImpl = vi.fn(async (u: string) => (String(u).includes("travelpayouts") ? json(tp) : json(flightsJson)));
    vi.stubGlobal("fetch", fetchImpl);
    const serp = createSerpFetch({ store: memoryCacheStore(), fetchImpl: fetchImpl as unknown as typeof fetch, gate: freeDenied });
    const out = finalizeSearchResponse(await searchFlights(flightsBody, { serpKey: "s", tpToken: "t", serpFetch: serp.fetch }), serp.trace);
    vi.unstubAllGlobals();
    expect(out.status).toBe(200);
    expect(out.body.source).toBe("travelpayouts");
    expect(String(out.body.aviso_limite)).toMatch(/^Usaste tus 5 búsquedas en vivo de hoy/);
    expect(fetchImpl.mock.calls.some(([u]) => String(u).includes("serpapi.com"))).toBe(false);
  });

  it("FREE sin búsquedas y sin otra fuente: 402 FREE_LIMIT_REACHED (quota live_searches_daily)", async () => {
    const fetchImpl = vi.fn(async () => json({}));
    const serp = createSerpFetch({ store: memoryCacheStore(), fetchImpl: fetchImpl as unknown as typeof fetch, gate: freeDenied });
    const out = finalizeSearchResponse(
      await searchHotels({ city: "Madrid", checkin: "2026-11-10", checkout: "2026-11-12", adults: 2 }, { serpKey: "s", serpFetch: serp.fetch }),
      serp.trace,
    );
    expect(out.status).toBe(402);
    expect(out.body).toMatchObject({ code: "FREE_LIMIT_REACHED", quota: "live_searches_daily", limit: 5, upgrade_available: true });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("PRO en uso justo sin precio guardado: 200 'no disponible' con motivo, nunca 402", () => {
    const out = finalizeSearchResponse(
      { status: 200, body: { ok: true, source: "none", disponible: false, results: [] } },
      { live: 0, hits: 0, stale: 0, denied: { soft: true }, oldestFetchedAt: null },
    );
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ limite_uso_justo: true, disponible: false });
    expect(String(out.body.motivo)).toMatch(/uso justo/);
  });

  it("resultado de la caché: consulted_at es la consulta real, no 'ahora'", async () => {
    const store = memoryCacheStore(() => Date.parse("2026-10-22T08:00:00Z"));
    const fetchImpl = vi.fn(async () => json(flightsJson));
    await createSerpFetch({ store, fetchImpl: fetchImpl as unknown as typeof fetch, now: () => Date.parse("2026-10-22T08:00:00Z") })
      .fetch("https://serpapi.com/search.json?engine=google_flights&departure_id=MEX&arrival_id=MAD&outbound_date=2026-11-10&type=2&adults=1&currency=USD&hl=es&sort_by=2&api_key=a");
    const serp = createSerpFetch({ store, fetchImpl: fetchImpl as unknown as typeof fetch, now: () => Date.parse("2026-10-22T12:00:00Z") });
    const out = finalizeSearchResponse(await searchFlights(flightsBody, { serpKey: "s", serpFetch: serp.fetch }), serp.trace, Date.parse("2026-10-22T12:00:00Z"));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(out.body).toMatchObject({ source: "serpapi", consulted_at: "2026-10-22T08:00:00.000Z", estado_dato: "CONSULTADO_EN_VIVO", from_cache: true, cache_max_age_h: 4 });
  });

  it("sin límite negado no cambia la respuesta", () => {
    expect(liveLimitOutcome({ live: 1, hits: 0, stale: 0, denied: null, oldestFetchedAt: null }, 0)).toEqual({ kind: "ok" });
  });
});
