// Ticketmaster Discovery API v2 en IATOS (23-oct-2026). Fixtures armados según la documentación pública
// (developer.ticketmaster.com/products-and-docs/apis/discovery-api/v2/): _embedded.events[] con name, url,
// dates.start{localDate, localTime, dateTime}, dates.status.code, _embedded.venues[{name, address.line1,
// city.name, location}], priceRanges[{type, currency, min, max}] (no siempre viene), images, classifications;
// page.totalElements. Sin red: fetch, caché, límites y llave son simulados (la "llave" es de mentira).
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/integrations/supabase/client", () => {
  const done = Promise.resolve({ data: null, error: null });
  const from = () => ({ insert: () => ({ then: done.then.bind(done), select: () => ({ single: async () => ({ data: null, error: null }) }) }), update: () => ({ eq: () => done }) });
  return { supabase: { from, functions: { invoke: vi.fn() } } };
});
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

import fixture from "./fixtures/priveKeyCatalog.json";
import {
  geohash, makeRateLimiter, mapTicketmasterEvents, officialTicketUrl, probeTicketmaster, searchTicketmaster, tmClassification, tmParams,
  TM_NO_DISPONIBLE, type TmEvent,
} from "../../supabase/functions/_shared/ticketmaster";
import { CACHE_TTL_SECONDS, memoryCacheStore } from "../../supabase/functions/_shared/serpCache";
import { checkAllowlisted } from "../../supabase/functions/_shared/booking/allowlist";
import { fromTicketmaster, mergeEvents, runEventSearch, sameEvent, TM_ENOUGH } from "../../supabase/functions/concierge-chat/events";
import { eventCards, prepareToolResultForModel } from "../../supabase/functions/concierge-chat/cards";
import { finalizeTurn } from "../../supabase/functions/concierge-chat/finalize";
import { addLiveEvent, findKeyClaims, visibleText, type KeyResult } from "../../supabase/functions/_shared/priveKey";
import { memoryCache, runPriveKey } from "../../supabase/functions/concierge-chat/priveKeyMode";
import { planPayload } from "@/lib/priveKey";
import { RichCard } from "@/components/concierge/ConciergeCards";

const FAKE_KEY = "TMKEY_test_9f8e7d6c5b4a";
const NOW = Date.parse("2026-10-23T15:00:00Z");

const venue = (name: string, line1: string, city: string, lat: string, lng: string) =>
  ({ name, address: { line1 }, city: { name: city }, country: { countryCode: "MX" }, location: { latitude: lat, longitude: lng } });
const ev = (o: Record<string, any>) => ({
  id: o.id, name: o.name, type: "event", url: o.url ?? `https://www.ticketmaster.com.mx/${o.id}/event/${o.id}`, locale: "es-mx",
  images: [{ ratio: "3_2", url: `https://s1.ticketm.net/dam/a/${o.id}_RETINA_PORTRAIT_3_2.jpg`, width: 640, height: 427, fallback: false },
    { ratio: "16_9", url: `https://s1.ticketm.net/dam/a/${o.id}_TABLET_LANDSCAPE_16_9.jpg`, width: 1024, height: 576, fallback: false }],
  dates: { start: { localDate: o.date, localTime: o.time, dateTime: o.dateTime }, timezone: "America/Mexico_City", status: { code: o.status ?? "onsale" } },
  classifications: [{ primary: true, segment: { id: "KZFzniwnSyZfZ7v7nJ", name: o.segment ?? "Music" }, genre: { name: o.genre ?? "Rock" } }],
  ...(o.price ? { priceRanges: [{ type: "standard", currency: "MXN", min: o.price[0], max: o.price[1] }] } : {}),
  _embedded: { venues: [o.venue ?? venue("Foro Sol", "Av. Viaducto Río de la Piedad s/n", "Ciudad de México", "19.4053", "-99.0947")] },
});
const TM_JSON = {
  _embedded: {
    events: [
      ev({ id: "G5v1", name: "Coldplay: Music of the Spheres", date: "2026-11-21", time: "21:00:00", dateTime: "2026-11-22T03:00:00Z", price: [950, 6500] }),
      ev({ id: "G5v2", name: "Hamlet", date: "2026-11-21", time: "19:30:00", segment: "Arts & Theatre", genre: "Theatre",
        venue: venue("Teatro de la Ciudad Esperanza Iris", "Donceles 36", "Ciudad de México", "19.4361", "-99.1371") }),
      ev({ id: "G5v3", name: "Concierto cancelado", date: "2026-11-21", time: "20:00:00", status: "cancelled" }),
      ev({ id: "G5v4", name: "Gira pospuesta", date: "2026-11-21", time: "20:00:00", status: "postponed" }),
      ev({ id: "G5v5", name: "Partido reprogramado", date: "2026-11-21", time: "20:00:00", status: "rescheduled", segment: "Sports" }),
      ev({ id: "G5v6", name: "Rosalía · Motomami", date: "2026-11-22", time: "20:30:00", status: "offsale" }),
      ev({ id: "G5v7", name: "Enlace falso", date: "2026-11-21", time: "20:00:00", url: "https://ticketmaster-mx.boletos.io/e/1" }),
    ],
  },
  page: { size: 20, totalElements: 7, totalPages: 1, number: 0 },
};
const RANGE = { from: "2026-11-21", to: "2026-11-22" };
const okFetch = (json: unknown = TM_JSON, status = 200) => vi.fn(async (_u: string) => new Response(JSON.stringify(json), { status, headers: { "content-type": "application/json" } }));

describe("1. parseo según la documentación", () => {
  const out = mapTicketmasterEvents(TM_JSON, RANGE);
  it("nombre, fecha y hora local, recinto, dirección, coordenadas, categoría, url oficial e imagen", () => {
    expect(out[0]).toMatchObject({
      id: "G5v1", title: "Coldplay: Music of the Spheres", fecha: "2026-11-21", hora: "21:00", date_time: "2026-11-22T03:00:00Z", estado: "onsale",
      recinto: "Foro Sol", direccion: "Av. Viaducto Río de la Piedad s/n, Ciudad de México", ciudad: "Ciudad de México", lat: 19.4053, lng: -99.0947,
      categoria: "Music · Rock", url: "https://www.ticketmaster.com.mx/G5v1/event/G5v1",
    });
    expect(out[0].miniatura).toMatch(/16_9/);
  });
  it("un cancelado, pospuesto o reprogramado nunca entra; offsale sí (Agotado / fuera de venta)", () => {
    expect(out.map((e) => e.title)).toEqual(["Coldplay: Music of the Spheres", "Hamlet", "Rosalía · Motomami"]);
    expect(out.find((e) => e.title.startsWith("Rosalía"))!.estado).toBe("offsale");
    // "canceled" (como lo escribe la documentación) tampoco.
    expect(mapTicketmasterEvents({ _embedded: { events: [ev({ id: "x", name: "X", date: "2026-11-21", time: "20:00:00", status: "canceled" })] } })).toEqual([]);
  });
  it("precio SOLO si viene priceRanges", () => {
    expect(out[0].precio).toEqual({ min: 950, max: 6500, currency: "MXN" });
    expect(out[1].precio).toBeUndefined();
  });
  it("el enlace solo sale del campo url y debe ser un dominio oficial de Ticketmaster", () => {
    expect(out.some((e) => /boletos\.io/.test(e.url))).toBe(false);
    expect(officialTicketUrl("https://www.ticketmaster.com/event/1")).toBe("https://www.ticketmaster.com/event/1");
    expect(officialTicketUrl("https://www.ticketmaster.com.mx/x/event/1")).toBeTruthy();
    for (const bad of ["http://www.ticketmaster.com/e", "https://ticketmaster.com.evil.io/e", "https://user:p@ticketmaster.com/e", "javascript:alert(1)"]) expect(officialTicketUrl(bad)).toBeNull();
    expect(checkAllowlisted("https://www.ticketmaster.es/event/1")).toMatchObject({ ok: true, provider: { provider: "ticketmaster", kind: "tickets" } });
  });
  it("fuera del rango pedido no entra", () => {
    expect(mapTicketmasterEvents(TM_JSON, { from: "2026-11-22", to: "2026-11-22" }).map((e) => e.title)).toEqual(["Rosalía · Motomami"]);
  });
});

describe("2. parámetros documentados", () => {
  it("ciudad conocida → geoPoint + radio en km + país; fechas ISO con Z sin milisegundos; categoría y orden", () => {
    const p = tmParams({ city: "CDMX", from: "2026-11-21", to: "2026-11-22", category: "conciertos", keyword: "conciertos" }, NOW)!;
    expect(p).toMatchObject({ geoPoint: geohash(19.436, -99.072, 6), radius: "40", unit: "km", countryCode: "MX", startDateTime: "2026-11-21T00:00:00Z",
      endDateTime: "2026-11-23T23:59:59Z", classificationName: "music", sort: "date,asc" });
    expect(p.keyword).toBeUndefined(); // "conciertos" ya es la categoría
    expect(p).not.toHaveProperty("apikey");
  });
  it("ubicación física (con permiso) → geoPoint alrededor del usuario; ciudad desconocida → city", () => {
    expect(tmParams({ city: "Madrid", coords: { lat: 19.4, lng: -99.27 } }, NOW)).toMatchObject({ geoPoint: geohash(19.4, -99.27, 7), radius: "25" });
    expect(tmParams({ city: "Pueblito Mágico Inventado" }, NOW)).toMatchObject({ city: "Pueblito Mágico Inventado" });
    expect(tmClassification("partido de futbol")).toBe("sports");
    expect(tmClassification("obra de teatro")).toBe("arts & theatre");
    expect(tmClassification("plan para niños")).toBe("family");
    expect(geohash(57.64911, 10.40744, 11)).toBe("u4pruydqqvj"); // ejemplo canónico de geohash
  });
});

describe("3. caché, cuota y llave", () => {
  it("caché de 6 h por consulta: la segunda vez no llama a Ticketmaster", async () => {
    expect(CACHE_TTL_SECONDS.ticketmaster).toBe(6 * 3600);
    const store = memoryCacheStore(() => NOW);
    const fetchImpl = okFetch();
    const q = { city: "Ciudad de México", from: "2026-11-21", to: "2026-11-22" };
    const a = await searchTicketmaster(q, { fetchImpl, apiKey: FAKE_KEY, store, now: () => NOW });
    const b = await searchTicketmaster(q, { fetchImpl, apiKey: FAKE_KEY, store, now: () => NOW + 3600_000 });
    expect(a).toMatchObject({ ok: true, source: "ticketmaster" });
    expect(b).toMatchObject({ ok: true, from_cache: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const c = await searchTicketmaster(q, { fetchImpl, apiKey: FAKE_KEY, store, now: () => NOW + 7 * 3600_000 });
    expect(c.ok && c.from_cache).toBeFalsy();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    // Lo guardado no lleva la llave.
    expect(JSON.stringify([...store.rows.values()])).not.toContain(FAKE_KEY);
  });
  it("la URL lleva apikey y los parámetros; un timeout de 8 s aborta", async () => {
    const fetchImpl = okFetch();
    await searchTicketmaster({ city: "Ciudad de México" }, { fetchImpl, apiKey: FAKE_KEY, now: () => NOW });
    const url = new URL(fetchImpl.mock.calls[0][0] as string);
    expect(url.origin + url.pathname).toBe("https://app.ticketmaster.com/discovery/v2/events.json");
    expect(url.searchParams.get("apikey")).toBe(FAKE_KEY);
    const slow = vi.fn((_u: string, init?: RequestInit) => new Promise<Response>((_r, rej) => init?.signal?.addEventListener("abort", () => rej(Object.assign(new Error("x"), { name: "AbortError" })))));
    const r = await searchTicketmaster({ city: "Ciudad de México" }, { fetchImpl: slow as any, apiKey: FAKE_KEY, timeoutMs: 5, now: () => NOW });
    expect(r).toMatchObject({ ok: false, code: "ticketmaster_error" });
  });
  it("límite por usuario y ranura de la cuenta (≤ 5 por segundo)", async () => {
    const fetchImpl = okFetch();
    expect(await searchTicketmaster({ city: "Ciudad de México" }, { fetchImpl, apiKey: FAKE_KEY, userGate: async () => false, now: () => NOW }))
      .toMatchObject({ ok: false, code: "ticketmaster_limite_usuario" });
    expect(await searchTicketmaster({ city: "Ciudad de México" }, { fetchImpl, apiKey: FAKE_KEY, limiter: async () => false, now: () => NOW }))
      .toMatchObject({ ok: false, code: "ticketmaster_ocupado" });
    expect(fetchImpl).not.toHaveBeenCalled();
    let t = 0;
    const sleep = vi.fn(async (ms: number) => { t += ms; });
    const acquire = makeRateLimiter({ perSecond: 5, now: () => t, sleep });
    for (let i = 0; i < 5; i++) expect(await acquire()).toBe(true);
    expect(sleep).not.toHaveBeenCalled();
    expect(await acquire()).toBe(true); // la sexta espera a que pase el segundo
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(t).toBeGreaterThanOrEqual(1000);
    const strict = makeRateLimiter({ perSecond: 1, now: () => 0, sleep: async () => {}, maxWaitMs: 10 });
    expect(await strict()).toBe(true);
    expect(await strict()).toBe(false);
  });
  it("sin llave o con 401/403 → ticketmaster_no_disponible con mensaje honesto (sin la llave)", async () => {
    const none = await searchTicketmaster({ city: "Ciudad de México" }, { fetchImpl: okFetch(), apiKey: "", now: () => NOW });
    expect(none).toMatchObject({ ok: false, code: TM_NO_DISPONIBLE, motivo: expect.stringMatching(/Ticketmaster no está disponible/) });
    for (const status of [401, 403]) {
      const r = await searchTicketmaster({ city: "Ciudad de México" }, { fetchImpl: okFetch({ fault: { faultstring: `Invalid ApiKey ${FAKE_KEY}` } }, status), apiKey: FAKE_KEY, now: () => NOW });
      expect(r).toMatchObject({ ok: false, code: TM_NO_DISPONIBLE, http: status });
      expect(JSON.stringify(r)).not.toContain(FAKE_KEY);
    }
  });
});

// Google Events (SerpApi) como respaldo/complemento: misma forma documentada que eventosTrenesGratis.
const SERP = {
  search_metadata: { status: "Success" },
  events_results: [
    { title: "Coldplay - Music Of The Spheres", date: { start_date: "Nov 21", when: "Sat, Nov 21, 9 PM" }, address: ["Foro Sol, Viaducto", "Ciudad de México"],
      venue: { name: "Foro Sol" }, ticket_info: [{ source: "Ticketmaster", link: "https://www.ticketmaster.com.mx/coldplay", link_type: "tickets" }] },
    { title: "Festival de Jazz", date: { start_date: "Nov 21", when: "Sat, Nov 21, 6 PM" }, address: ["Parque México", "Ciudad de México"],
      venue: { name: "Parque México" }, ticket_info: [{ source: "Boletia", link: "https://boletia.com/jazz", link_type: "tickets" }] },
  ],
};
const ARGS = { city: "Ciudad de México", date_from: "2026-11-21", date_to: "2026-11-22", query: "conciertos" };

describe("4. search_events: Ticketmaster primero, Google Events de respaldo o complemento", () => {
  const tmOk = (results: TmEvent[]) => vi.fn(async (_q: unknown) => ({ ok: true as const, source: "ticketmaster" as const, results, consulted_at: "2026-10-23T15:00:00Z" }));
  const serpFetch = () => vi.fn(async () => new Response(JSON.stringify(SERP), { status: 200 }));

  it("desduplica por nombre + fecha + recinto (Coldplay aparece una vez, de Ticketmaster)", async () => {
    const tm = tmOk(mapTicketmasterEvents(TM_JSON, RANGE).slice(0, 1));
    const fetchImpl = serpFetch();
    const gate = vi.fn(async () => ({ allow: true as const }));
    const r: any = await runEventSearch(ARGS, { fetchImpl, serpKey: "serp", gate, ticketmaster: tm, now: () => NOW });
    expect(r.source).toBe("ticketmaster+google_events");
    expect(r.results.map((e: any) => [e.title, e.fuente ?? "google_events"])).toEqual([
      ["Coldplay: Music of the Spheres", "ticketmaster"], ["Festival de Jazz", "google_events"]]);
    expect(sameEvent(fromTicketmaster(mapTicketmasterEvents(TM_JSON, RANGE)[0]), { title: "Coldplay", fecha: "2026-11-22", hora: null, cuando: "", boletos: [] })).toBe(false);
    expect(mergeEvents([], [])).toEqual([]);
  });
  it(`con ${TM_ENOUGH}+ eventos de Ticketmaster no se gasta una búsqueda de SerpApi (ni la bolsa ni el freno)`, async () => {
    const many = mapTicketmasterEvents({ _embedded: { events: [1, 2, 3].map((i) => ev({ id: `m${i}`, name: `Show ${i}`, date: "2026-11-21", time: "20:00:00" })) } }, RANGE);
    const fetchImpl = serpFetch();
    const gate = vi.fn(async () => ({ allow: true as const }));
    const brake = { paused: vi.fn(async () => null), tripQuota: vi.fn(async () => {}) };
    const r: any = await runEventSearch(ARGS, { fetchImpl, serpKey: "serp", gate, brake, ticketmaster: tmOk(many), now: () => NOW });
    expect(r).toMatchObject({ ok: true, source: "ticketmaster" });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(gate).not.toHaveBeenCalled();
    expect(brake.paused).not.toHaveBeenCalled();
  });
  it("sin Ticketmaster (sin llave) se usa Google Events con la bolsa y el freno, y se dice por qué", async () => {
    const fetchImpl = serpFetch();
    const gate = vi.fn(async () => ({ allow: true as const }));
    const tm = vi.fn(async () => ({ ok: false as const, code: TM_NO_DISPONIBLE, motivo: "Ticketmaster no está disponible por ahora; no hay eventos de Ticketmaster en esta respuesta." }));
    const r: any = await runEventSearch(ARGS, { fetchImpl, serpKey: "serp", gate, ticketmaster: tm, now: () => NOW });
    expect(r).toMatchObject({ ok: true, source: "google_events", aviso_ticketmaster: expect.stringMatching(/no está disponible/) });
    expect(gate).toHaveBeenCalledTimes(1);
    // Ni Ticketmaster ni SerpApi: no disponible, honesto, sin inventar.
    const none: any = await runEventSearch(ARGS, { fetchImpl, serpKey: "", ticketmaster: tm, now: () => NOW });
    expect(prepareToolResultForModel("search_events", none)).toMatchObject({ disponible: false });
  });
  it("ubicación física solo si el turno es 'aquí' (la pasa index.ts como nearCoords)", async () => {
    const tm = tmOk([]);
    await runEventSearch({ city: "Huixquilucan" }, { fetchImpl: serpFetch(), serpKey: "", ticketmaster: tm, nearCoords: { lat: 19.39, lng: -99.27 }, now: () => NOW });
    expect(tm.mock.calls[0][0]).toMatchObject({ coords: { lat: 19.39, lng: -99.27 } });
    await runEventSearch({ city: "Madrid" }, { fetchImpl: serpFetch(), serpKey: "", ticketmaster: tm, now: () => NOW });
    expect(tm.mock.calls[1][0]).toMatchObject({ city: "Madrid", coords: null });
  });
});

describe("5. card 'event' de Ticketmaster", () => {
  const results = mapTicketmasterEvents(TM_JSON, RANGE).map(fromTicketmaster);
  const prepared = prepareToolResultForModel("search_events", { ok: true, source: "ticketmaster", results, consulted_at: "2026-10-23T15:04:00Z" });
  const runs = [{ name: "search_events", args: { city: "Ciudad de México" }, result: prepared }];

  it("estado, categoría, coordenadas y precio 'desde' solo con priceRanges", () => {
    const cards = eventCards(runs);
    expect(cards[0]).toMatchObject({ type: "event", fuente: "ticketmaster", status: "En venta", body: "Music · Rock", lat: 19.4053, lng: -99.0947,
      price: 950, currency: "MXN", price_note: "precio publicado por Ticketmaster · puede cambiar",
      links: [{ kind: "tickets", label: "Boletos en Ticketmaster", url: "https://www.ticketmaster.com.mx/G5v1/event/G5v1" }] });
    expect(cards[1].price).toBeUndefined();
    expect(cards[2]).toMatchObject({ title: "Rosalía · Motomami", status: "Agotado / fuera de venta" });
  });
  it("RichCard: 'Desde $950 MXN' con aviso, 'Fuente: Ticketmaster', 'Boletos en Ticketmaster' y 'Llévame' con coordenadas; nunca 'comprado'", () => {
    const { container } = render(<RichCard card={eventCards(runs)[0]} />);
    expect(screen.getByTestId("event-price")).toHaveTextContent(/Desde \$950 MXN · precio publicado por Ticketmaster · puede cambiar/);
    expect(screen.getByTestId("event-status")).toHaveTextContent("Music · Rock · En venta");
    expect(screen.getByTestId("event-source")).toHaveTextContent(/^Fuente: Ticketmaster/);
    expect(screen.getByRole("link", { name: /Boletos en Ticketmaster/ })).toHaveAttribute("href", "https://www.ticketmaster.com.mx/G5v1/event/G5v1");
    expect(screen.getByTestId("take-me-there").getAttribute("href")).toBe("https://www.google.com/maps/dir/?api=1&destination=19.4053%2C-99.0947&travelmode=driving");
    expect(container.textContent).not.toMatch(/comprad[oa]s? (tus|los)|ya tienes boletos|reservad/i);
  });
  it("sin priceRanges no hay ningún precio en la card", () => {
    const { container } = render(<RichCard card={eventCards(runs)[1]} />);
    expect(screen.queryByTestId("event-price")).toBeNull();
    expect(container.textContent).not.toMatch(/\$\s?\d|MXN/);
  });
  it("'Guardar en mi viaje' (add_itinerary_item) si el evento cae en un viaje del usuario", () => {
    const trip = { id: "11111111-1111-4111-8111-111111111111", destino: "Ciudad de México", fecha_salida: "2026-11-20", fecha_regreso: "2026-11-24" };
    const base = { raw: "Encontré estos eventos.", toolRuns: runs, plan: { cards: [], suggestedActions: [] }, makeId: () => "a1", userMessage: "conciertos en CDMX" };
    const inCtx = finalizeTurn({ ...base, actionCtx: { todayISO: "2026-10-23", trips: [trip], activeTripId: trip.id }, tripScope: { trip, position: "unknown" as any, user: null } });
    const add = inCtx.actions.find((a) => a.type === "add_itinerary_item")!;
    expect(add).toMatchObject({ confirm_label: "Guardar en mi viaje", params: { trip_id: trip.id, fecha: "2026-11-21", hora: "21:00", titulo: "Coldplay: Music of the Spheres",
      nota: "Evento de Ticketmaster; los boletos se compran en Ticketmaster." } });
    // Sin viaje en contexto: otro de sus viajes con esas fechas y esa ciudad.
    const other = finalizeTurn({ ...base, actionCtx: { todayISO: "2026-10-23", trips: [trip], activeTripId: null }, tripScope: null as any });
    expect(other.actions.find((a) => a.type === "add_itinerary_item")?.params.trip_id).toBe(trip.id);
    // Fuera de las fechas del viaje: no se propone.
    const later = { ...trip, fecha_salida: "2026-12-01", fecha_regreso: "2026-12-05" };
    const out = finalizeTurn({ ...base, actionCtx: { todayISO: "2026-10-23", trips: [later], activeTripId: later.id }, tripScope: { trip: later, position: "unknown" as any, user: null } });
    expect(out.actions.some((a) => a.type === "add_itinerary_item")).toBe(false);
  });
});

describe("6. The Privé Key incorpora UN evento real solo si encaja", () => {
  const rpc = vi.fn(async () => {
    const c = (fixture as any).cities.cdmx;
    return { data: { available: true, adult_confirmed: true, cities: [{ query: "cdmx", resolved: true, city: c.city, coverage: "COBERTURA_PARCIAL", items: c.items }] }, error: null };
  });
  const keyDeps = (liveEvents?: any) => ({ userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", priveSession: "ps-token", rpc: rpc as any, trips: [], pinnedId: null,
    todayISO: "2026-10-22", hitDaily: vi.fn(async () => true), cache: memoryCache(), now: () => 1_000, liveEvents });
  const WISH = { wish: "Plan de aniversario en CDMX el 2026-11-21 para 2, sin tope" };
  const tmEv = (o: Partial<TmEvent>): TmEvent => ({ id: "e1", title: "Coldplay: Music of the Spheres", fecha: "2026-11-21", hora: "17:00", estado: "onsale", recinto: "Foro Sol",
    lat: 19.4053, lng: -99.0947, categoria: "Music · Rock", url: "https://www.ticketmaster.com.mx/G5v1/event/G5v1", precio: { min: 950, max: 6500, currency: "MXN" }, ...o });
  const live = (events: TmEvent[]) => vi.fn(async () => ({ ok: true as const, source: "ticketmaster" as const, results: events, consulted_at: "2026-10-23T15:00:00Z" }));

  it("en venta y sin encimarse con la noche (20:00 en adelante): entra como paso antes, con fuente y enlace de boletos", async () => {
    const tm = live([tmEv({ id: "late", hora: "21:00", title: "Choca con la cena" }), tmEv({})]);
    const out = await runPriveKey(WISH, keyDeps(tm));
    expect(tm).toHaveBeenCalledWith(expect.objectContaining({ city: "Ciudad de México", from: "2026-11-21", to: "2026-11-21" }));
    const proposals = out.body.proposals as KeyResult["proposals"];
    const withEvent = proposals.filter((p) => p.steps.some((s) => s.experience.id.startsWith("tm:")));
    expect(withEvent).toHaveLength(1);
    const p = withEvent[0];
    const i = p.steps.findIndex((s) => s.experience.id === "tm:e1");
    expect(p.steps[i]).toMatchObject({ start: "17:00", end: "19:30", time_status: "segun_horario_publicado", intent: "concierto",
      experience: { name: "Coldplay: Music of the Spheres", neighborhood: "Foro Sol", booking_url: "https://www.ticketmaster.com.mx/G5v1/event/G5v1", state: "TICKETMASTER" },
      cost: { basis: "fuente", amount: 1900, currency: "MXN", source_url: "https://www.ticketmaster.com.mx/G5v1/event/G5v1" } });
    expect(p.steps[i].cost.text).toMatch(/precio publicado por Ticketmaster · puede cambiar/);
    // Va antes del siguiente paso de la noche, sin encimarse (termina 19:30 + traslado).
    expect(p.steps[i + 1].start >= "19:30").toBe(true);
    expect(p.steps.map((s) => s.order)).toEqual(p.steps.map((_, k) => k + 1));
    expect(p.steps[i + 1].transfer?.label).toBe("ESTIMADO");
    expect(p.narrative).toMatch(/concierto a las 17:00 en Foro Sol \(Coldplay: Music of the Spheres, Ticketmaster\)/);
    expect(proposals.flatMap((x) => x.steps).some((s) => s.experience.name === "Choca con la cena")).toBe(false);
    // Sin inventar disponibilidad ni acceso VIP.
    expect(findKeyClaims(visibleText(out.body as unknown as KeyResult))).toEqual([]);
    expect(JSON.stringify(p.steps[i])).not.toMatch(/\bVIP\b|acceso exclusivo|garantizad|disponible hoy|comprados? para ti/i);
    // Guardar el plan en Privé solo guarda experiencias del catálogo (el evento no es una).
    expect(planPayload(p, { text: WISH.wish, mode: "key" }).steps.some((s) => s.experience_id.startsWith("tm:"))).toBe(false);
  });

  it("fuera de venta, otra fecha o sin hora: no entra; tampoco en SURPRISE ME", async () => {
    for (const e of [tmEv({ estado: "offsale" }), tmEv({ fecha: "2026-11-25" }), tmEv({ hora: null })]) {
      const out = await runPriveKey(WISH, keyDeps(live([e])));
      expect((out.body.proposals as KeyResult["proposals"]).flatMap((p) => p.steps).some((s) => s.experience.id.startsWith("tm:"))).toBe(false);
    }
    const base = await runPriveKey(WISH, keyDeps());
    const r = base.body as unknown as KeyResult;
    expect(addLiveEvent(r, [tmEv({})], { ...r.wish, mode: "surprise" })).toBe(r);
  });

  it("si Ticketmaster no responde, The Key sigue igual (sin evento y sin error)", async () => {
    const out = await runPriveKey(WISH, keyDeps(vi.fn(async () => ({ ok: false, code: TM_NO_DISPONIBLE, motivo: "x" }))));
    expect(out.body).toMatchObject({ ok: true, status: "proposals" });
    const boom = await runPriveKey(WISH, keyDeps(vi.fn(async () => { throw new Error("red"); })));
    expect(boom.body).toMatchObject({ ok: true, status: "proposals" });
  });

  it("si con el precio publicado se pasa del presupuesto, no se agrega", async () => {
    const out = await runPriveKey({ wish: "Plan de aniversario en CDMX el 2026-11-21 para 2 con 3000 pesos" }, keyDeps(live([tmEv({ precio: { min: 2000, max: 9000, currency: "MXN" } })])));
    expect(((out.body.proposals as KeyResult["proposals"]) ?? []).flatMap((p) => p.steps).some((s) => s.experience.id.startsWith("tm:"))).toBe(false);
  });
});

describe("7. sonda de health-check (?action=ticketmaster)", () => {
  it("una sola llamada mínima (CDMX, size=1): llave existe, HTTP y cuántos eventos; nunca la llave ni la URL", async () => {
    const fetchImpl = okFetch({ _embedded: { events: [TM_JSON._embedded.events[0]] }, page: { size: 1, totalElements: 42, totalPages: 42, number: 0 } });
    const r = await probeTicketmaster({ fetchImpl, apiKey: FAKE_KEY });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const url = new URL(fetchImpl.mock.calls[0][0] as string);
    expect(url.searchParams.get("size")).toBe("1");
    expect(url.searchParams.get("geoPoint")).toBeTruthy();
    expect(r).toMatchObject({ ok: true, llave_configurada: true, http: 200, eventos: 42 });
    const s = JSON.stringify(r);
    expect(s).not.toContain(FAKE_KEY);
    expect(s).not.toMatch(/apikey|app\.ticketmaster\.com/i);
  });
  it("llave rechazada: el mensaje de Ticketmaster sale sin la llave", async () => {
    const r = await probeTicketmaster({ fetchImpl: okFetch({ fault: { faultstring: `Invalid ApiKey for given resource: ${FAKE_KEY}` } }, 401), apiKey: FAKE_KEY });
    expect(r).toMatchObject({ ok: false, llave_configurada: true, http: 401 });
    expect(JSON.stringify(r)).not.toContain(FAKE_KEY);
    expect(r.detail).toMatch(/\[llave\]/);
  });
  it("sin llave no llama a nada", async () => {
    const fetchImpl = okFetch();
    expect(await probeTicketmaster({ fetchImpl, apiKey: undefined })).toMatchObject({ ok: false, llave_configurada: false, http: null, detail: "Falta TICKETMASTER_API_KEY" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
