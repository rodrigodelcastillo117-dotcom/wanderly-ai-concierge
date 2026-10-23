// flights-search { action: "explore" } y { type: "multi" } con fixtures (sin llamadas reales):
// solo-caché sin gasto, caché compartida de 12 h por origen y mes, cuota del plan, error del
// proveedor, cuota de SerpApi agotada, conversión a MXN con fuente y varias ciudades (type=3).
import { describe, it, expect, vi } from "vitest";

const env: Record<string, string> = {};
(globalThis as unknown as { Deno: unknown }).Deno = { env: { get: (k: string) => env[k] } };

import exploreFixture from "./fixtures/gflights/travel_explore_mex.json";
import multiFixture from "./fixtures/gflights/flights_multi_city.json";
import { CACHE_TTL_SECONDS, createSerpFetch, memoryCacheStore, trimForCache, type GateDecision } from "../../supabase/functions/_shared/serpCache";
import { finalizeSearchResponse } from "../../supabase/functions/_shared/liveSearch";
import { EXPLORE_ENGINE, exploreDestinations } from "../../supabase/functions/flights-search/explore";
import { multiCityJson, searchMultiCity } from "../../supabase/functions/flights-search/multiCity";

const NOW = Date.parse("2026-10-23T15:00:00Z");
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function setup(opts: { gate?: () => Promise<GateDecision>; fetchImpl?: typeof fetch; now?: () => number } = {}) {
  let now = NOW;
  const clock = opts.now ?? (() => now);
  const store = memoryCacheStore(clock);
  const fetchImpl = vi.fn(opts.fetchImpl ?? (async () => json(exploreFixture)));
  const mk = () => createSerpFetch({ store, fetchImpl: fetchImpl as unknown as typeof fetch, gate: opts.gate, now: clock, log: () => {} });
  const run = async (body: Record<string, unknown>) => {
    const serp = mk();
    const r = await exploreDestinations({ action: "explore", ...body }, { serpKey: "SECRETO", serpFetch: serp.fetch, store, now: clock });
    return finalizeSearchResponse(r, serp.trace, clock());
  };
  return { store, fetchImpl, run, advance: (ms: number) => { now += ms; } };
}

describe("explore: gasto controlado", () => {
  it("TTL de 12 h y solo se guarda lo que se usa", () => {
    expect(CACHE_TTL_SECONDS[EXPLORE_ENGINE]).toBe(12 * 3600);
    const t = trimForCache(EXPLORE_ENGINE, { ...exploreFixture, extra: "x".repeat(50) }) as Record<string, unknown>;
    expect(Object.keys(t).sort()).toEqual(["destinations", "search_parameters"]);
  });

  it("sin live (abrir la ventana) solo lee la caché: sin caché no llama a SerpApi ni gasta", async () => {
    const gate = vi.fn(async (): Promise<GateDecision> => ({ allow: true }));
    const s = setup({ gate });
    const r = await s.run({ origin: "Ciudad de México" });
    expect(r.status).toBe(200);
    expect(r.body.sin_cache).toBe(true);
    expect(r.body.results).toEqual([]);
    expect(String(r.body.motivo)).toContain("Explorar destinos");
    expect(s.fetchImpl).not.toHaveBeenCalled();
    expect(gate).not.toHaveBeenCalled();
  });

  it("live: un fallo de caché gasta 1 (con la bolsa del plan); después todos leen la caché sin gastar", async () => {
    const gate = vi.fn(async (): Promise<GateDecision> => ({ allow: true }));
    const s = setup({ gate });
    const a = await s.run({ origin: "Ciudad de México", live: true });
    expect(s.fetchImpl).toHaveBeenCalledTimes(1);
    expect(gate).toHaveBeenCalledTimes(1);
    const url = new URL(String(s.fetchImpl.mock.calls[0][0]));
    expect(url.searchParams.get("engine")).toBe("google_travel_explore");
    expect(url.searchParams.get("departure_id")).toBe("MEX");
    expect(url.searchParams.get("currency")).toBe("MXN");
    const res = a.body.results as Array<Record<string, unknown>>;
    expect(res.map((d) => d.destino)).toEqual(["Cancún", "Tijuana", "Los Ángeles", "Madrid", "Bogotá"]);
    expect(res[0]).toMatchObject({ iata: "CUN", precio_mxn: 2130, escalas: 0, salida: "2027-01-14", regreso: "2027-01-23", estado_dato: "CONSULTADO_EN_VIVO" });
    // Sin precio no se inventa: null y al final.
    expect(res[4].precio_mxn).toBeNull();
    expect(a.body.frescura).toBe("en_vivo");
    expect(a.body.precio_tipo).toBe("referencia");

    // Otra persona abre la ventana 3 h después: lectura de la caché, mismo dato y su hora real.
    s.advance(3 * 3600_000);
    const b = await s.run({ origin: "CDMX" });
    expect(s.fetchImpl).toHaveBeenCalledTimes(1);
    expect(b.body.from_cache).toBe(true);
    expect(b.body.consulted_at).toBe(new Date(NOW).toISOString());
    expect(b.body.etiqueta_frescura).toBe("Consultado hace 3 h");

    // Y un "Explorar destinos" con la caché vigente tampoco gasta.
    await s.run({ origin: "Ciudad de México", live: true });
    expect(s.fetchImpl).toHaveBeenCalledTimes(1);
    expect(gate).toHaveBeenCalledTimes(1);

    // Pasadas 12 h la lectura sin gasto ya no sirve el dato.
    s.advance(10 * 3600_000);
    const c = await s.run({ origin: "Ciudad de México" });
    expect(c.body.sin_cache).toBe(true);
  });

  it("la caché es por origen y mes", async () => {
    const s = setup({ gate: async () => ({ allow: true }) });
    await s.run({ origin: "Ciudad de México", live: true });
    expect((await s.run({ origin: "Guadalajara" })).body.sin_cache).toBe(true);
    expect((await s.run({ origin: "Ciudad de México", month: 3 })).body.sin_cache).toBe(true);
  });

  it("cuota del plan agotada: 402 honesto, sin llamar a SerpApi", async () => {
    const s = setup({ gate: async () => ({ allow: false, soft: false, info: { plan: "free", limit: 5, used: 5 } }) });
    const r = await s.run({ origin: "Ciudad de México", live: true });
    expect(s.fetchImpl).not.toHaveBeenCalled();
    expect(r.status).toBe(402);
    expect(r.body.code).toBe("FREE_LIMIT_REACHED");
  });

  it("uso justo de PRO sin caché: sin precios y lo dice", async () => {
    const s = setup({ gate: async () => ({ allow: false, soft: true }) });
    const r = await s.run({ origin: "Ciudad de México", live: true });
    expect(r.status).toBe(200);
    expect(r.body.results).toEqual([]);
    expect(r.body.limite_uso_justo).toBe(true);
  });

  it("error del proveedor: sin precios, no se guarda y se devuelve la búsqueda", async () => {
    const refund = vi.fn(async () => {});
    const s = setup({ gate: async () => ({ allow: true, refund }), fetchImpl: (async () => json({ error: "Internal error" }, 500)) as unknown as typeof fetch });
    const r = await s.run({ origin: "Ciudad de México", live: true });
    expect(r.body.disponible).toBe(false);
    expect(r.body.fallas).toEqual(["explore_http_500"]);
    expect(refund).toHaveBeenCalledTimes(1);
    expect(s.store.rows.size).toBe(0);
  });

  it("SerpApi sin búsquedas: búsquedas en pausa, sin precios", async () => {
    const s = setup({ gate: async () => ({ allow: true, refund: async () => {} }), fetchImpl: (async () => json({ error: "Your account has run out of searches." }, 429)) as unknown as typeof fetch });
    const r = await s.run({ origin: "Ciudad de México", live: true });
    expect(r.body.results).toEqual([]);
    expect(r.body.busquedas_en_pausa).toBe(true);
  });

  it("origen desconocido: 400 sin buscar", async () => {
    const s = setup();
    const r = await s.run({ origin: "Zzyzx", live: true });
    expect(r.status).toBe(400);
    expect(s.fetchImpl).not.toHaveBeenCalled();
  });

  it("si Google responde en otra moneda, se convierte a MXN con la tasa y su fuente", async () => {
    const usd = { ...exploreFixture, search_parameters: { ...exploreFixture.search_parameters, currency: "USD" } };
    const store = memoryCacheStore(() => NOW);
    const serp = createSerpFetch({ store, fetchImpl: (async () => json(usd)) as unknown as typeof fetch, now: () => NOW });
    const r = await exploreDestinations({ origin: "MEX", live: true }, {
      serpKey: "K", serpFetch: serp.fetch, store, now: () => NOW,
      fx: async () => ({ rate: 18.5, source: "frankfurter", fetched_at: "2026-10-22T00:00:00Z", is_fallback: false }),
    });
    expect((r.body.results as Array<{ precio_mxn: number | null }>)[0].precio_mxn).toBe(Math.round(2130 * 18.5));
    expect(r.body.fx).toEqual({ de: "USD", tasa: 18.5, fuente: "frankfurter", fecha: "2026-10-22T00:00:00Z" });
  });

  it("otra moneda sin tasa verificable: sin precio (nunca se adivina)", async () => {
    const jpy = { ...exploreFixture, search_parameters: { currency: "JPY" } };
    const r = await exploreDestinations({ origin: "MEX", live: true }, {
      serpKey: "K", serpFetch: (async () => json(jpy)) as unknown as typeof fetch, fx: async () => null,
    });
    expect((r.body.results as Array<{ precio_mxn: number | null }>).every((d) => d.precio_mxn === null)).toBe(true);
  });
});

describe("varias ciudades: google_flights type=3 + multi_city_json", () => {
  it("arma la búsqueda y etiqueta el precio como total del itinerario", async () => {
    const fetchImpl = vi.fn(async () => json(multiFixture));
    const r = await searchMultiCity({
      type: "multi", travelers: 2, travel_class: "business",
      legs: [{ from: "Ciudad de México", to: "Madrid", date: "2027-03-02" }, { from: "Madrid", to: "Roma", date: "2027-03-08" }, { from: "Roma", to: "CDMX", date: "2027-03-14" }],
    }, { serpKey: "K", serpFetch: fetchImpl as unknown as typeof fetch });
    const u = new URL(String((fetchImpl.mock.calls[0] as unknown[])[0]));
    expect(u.searchParams.get("type")).toBe("3");
    expect(u.searchParams.get("travel_class")).toBe("3");
    expect(JSON.parse(u.searchParams.get("multi_city_json")!)).toEqual([
      { departure_id: "MEX", arrival_id: "MAD", date: "2027-03-02" },
      { departure_id: "MAD", arrival_id: "FCO", date: "2027-03-08" },
      { departure_id: "FCO", arrival_id: "MEX", date: "2027-03-14" },
    ]);
    const res = r.body.results as Array<Record<string, unknown>>;
    expect(res).toHaveLength(2);
    expect(res[0].price_usd).toBe(1840);
    expect(String(res[0].price_note)).toContain("total del itinerario de 3 tramos");
    expect(res[0].departure_token).toBe("TOKEN_TRAMO_2");
    expect(res[0].buy_url).toBe("https://www.google.com/travel/flights?fixture=multi");
  });

  it("tramos inválidos: 400 sin buscar", async () => {
    const fetchImpl = vi.fn();
    expect((await searchMultiCity({ legs: [{ from: "MEX", to: "MAD", date: "2027-03-02" }] }, { serpKey: "K", serpFetch: fetchImpl as unknown as typeof fetch })).status).toBe(400);
    expect((await searchMultiCity({ legs: [{ from: "MEX", to: "MAD", date: "mañana" }, { from: "MAD", to: "MEX", date: "2027-03-09" }] }, { serpKey: "K", serpFetch: fetchImpl as unknown as typeof fetch })).status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(multiCityJson([{ departure_id: "A", arrival_id: "B", date: "2027-01-01" }])).toBe('[{"departure_id":"A","arrival_id":"B","date":"2027-01-01"}]');
  });
});
