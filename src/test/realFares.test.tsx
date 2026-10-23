// Precio real del recorrido multidestino (flights-search type "multi") y ofertas reales por proveedor
// de un hotel (hotels-search action "offers"), con fixtures construidos según la documentación de
// SerpApi (google-flights multi-city y google-hotels-property-details). Sin llamadas reales.
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const env: Record<string, string> = {};
(globalThis as unknown as { Deno: unknown }).Deno = { env: { get: (k: string) => env[k] } };

vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: vi.fn(async () => { throw new Error("sin red en pruebas"); }) } } }));

import multiFixture from "./fixtures/gflights/flights_multi_city.json";
import propertyFixture from "./fixtures/ghotels/property_details.json";
import { CASO_TRIP } from "./fixtures/casoRomaFlorenciaVenecia";
import { createSerpFetch, HOTEL_OFFERS_TTL_SECONDS, memoryCacheStore, travelDateTtlSeconds, trimForCache, type GateDecision } from "../../supabase/functions/_shared/serpCache";
import { finalizeSearchResponse } from "../../supabase/functions/_shared/liveSearch";
import { searchMultiCity } from "../../supabase/functions/flights-search/multiCity";
import { parseHotelOffers, searchHotelOffers } from "../../supabase/functions/hotels-search/offers";
import { checkAllowlisted, checkUntrusted } from "../../supabase/functions/_shared/booking/allowlist";
import { requestHotelOffers, summarizeMultiFare, tripMultiCityLegs, type Invoke } from "@/lib/realFares";
import { HotelOffersButton, MultiCityFareButton } from "@/components/booking/RealPriceButtons";

const NOW = Date.parse("2026-10-21T15:00:00Z");
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const TIERRA = [
  { from: "Roma", to: "Florencia", date: null, mode: "tren" },
  { from: "Florencia", to: "Venecia", date: null, mode: "tren" },
];

describe("tramos del recorrido multidestino (solo avión, open-jaw)", () => {
  it("Roma → Florencia → Venecia en tren: solo llegada internacional y regreso", () => {
    const p = tripMultiCityLegs(CASO_TRIP, TIERRA);
    expect(p.missing).toBeNull();
    expect(p.legs).toEqual([
      { from: "MEX", to: "FCO", date: "2026-10-22" },
      { from: "VCE", to: "MEX", date: "2026-11-01" },
    ]);
    expect(p.omitted.map((o) => `${o.from}>${o.to}`)).toEqual(["Roma>Florencia", "Florencia>Venecia"]);
  });

  it("un traslado en avión entre ciudades sí entra, con la fecha de llegada a esa ciudad", () => {
    const p = tripMultiCityLegs(CASO_TRIP, [{ from: "Roma", to: "Florencia", date: null, mode: "tren" }, { from: "Florencia", to: "Venecia", date: "2026-10-28", mode: "vuelo" }]);
    expect(p.legs.map((l) => `${l.from}>${l.to}@${l.date}`)).toEqual(["MEX>FCO@2026-10-22", "FLR>VCE@2026-10-28", "VCE>MEX@2026-11-01"]);
  });

  it("un solo destino o sin fechas: no se consulta", () => {
    expect(tripMultiCityLegs({ ...CASO_TRIP, destino: "Roma", itinerario_json: {} }, []).legs).toEqual([]);
    expect(tripMultiCityLegs({ ...CASO_TRIP, fecha_regreso: null }, TIERRA).missing).toMatch(/fechas/);
  });

  it("el servidor manda esos tramos en multi_city_json (type=3) y etiqueta el total del itinerario", async () => {
    const fetchImpl = vi.fn(async () => json(multiFixture));
    const legs = tripMultiCityLegs(CASO_TRIP, TIERRA).legs;
    const r = await searchMultiCity({ type: "multi", legs, travelers: 2 }, { serpKey: "K", serpFetch: fetchImpl as unknown as typeof fetch });
    const u = new URL(String((fetchImpl.mock.calls[0] as unknown[])[0]));
    expect(u.searchParams.get("type")).toBe("3");
    expect(JSON.parse(u.searchParams.get("multi_city_json")!)).toEqual([
      { departure_id: "MEX", arrival_id: "FCO", date: "2026-10-22" },
      { departure_id: "VCE", arrival_id: "MEX", date: "2026-11-01" },
    ]);
    const s = summarizeMultiFare({ ...r.body, consulted_at: "2026-10-21T15:00:00Z" }, 2);
    expect(s.ok && s.totalUsd).toBe(1840);
    expect(s.ok && s.perPersonUsd).toBe(920);
    expect(s.ok && s.airlines).toEqual(["Iberia"]);
    expect(s.ok && s.source).toBe("Google Flights");
    expect(s.ok && s.url).toBe("https://www.google.com/travel/flights?fixture=multi");
  });
});

describe("botón \"Consultar precio real del recorrido\"", () => {
  it("no llama hasta que se pulsa; luego muestra total, fuente, hora y Actualizar precio", async () => {
    const invoke = vi.fn(async () => ({ data: { ...(await searchMultiCity({ legs: tripMultiCityLegs(CASO_TRIP, TIERRA).legs, travelers: 2 }, { serpKey: "K", serpFetch: (async () => json(multiFixture)) as unknown as typeof fetch })).body, consulted_at: "2026-10-21T15:00:00Z" }, error: null }));
    render(<MultiCityFareButton trip={CASO_TRIP} interLegs={TIERRA} invoke={invoke as unknown as Invoke} />);
    expect(screen.getByTestId("multi-precio-tramos").textContent).toContain("MEX→FCO · VCE→MEX");
    expect(screen.getByTestId("multi-precio-tramos").textContent).toContain("por tierra");
    expect(invoke).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("multi-precio-consultar"));
    await screen.findByTestId("multi-precio-resultado");
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls[0]).toEqual(["flights-search", { body: { type: "multi", travelers: 2, legs: [{ from: "MEX", to: "FCO", date: "2026-10-22" }, { from: "VCE", to: "MEX", date: "2026-11-01" }] } }]);
    expect(screen.getByTestId("multi-precio-total").textContent).toBe("$1,840 USD");
    expect(screen.getByTestId("multi-precio-fuente").textContent).toMatch(/Fuente: Google Flights · consultado \d{1,2}:\d{2}/);
    expect(screen.getByText(/Aerolíneas: Iberia/)).toBeTruthy();
    fireEvent.click(screen.getByTestId("multi-precio-actualizar"));
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
  });

  it("cuota agotada (402): mensaje honesto, sin precio inventado", async () => {
    const body = { code: "FREE_LIMIT_REACHED", quota: "live_searches_daily", limit: 5, used: 5, renews_at: null, upgrade_available: true, message: "x" };
    const invoke = vi.fn(async () => ({ data: null, error: { name: "FunctionsHttpError", message: "Edge Function returned a non-2xx status code", context: new Response(JSON.stringify(body), { status: 402 }) } }));
    render(<MultiCityFareButton trip={CASO_TRIP} interLegs={TIERRA} invoke={invoke as unknown as Invoke} />);
    fireEvent.click(screen.getByTestId("multi-precio-consultar"));
    const msg = await screen.findByTestId("multi-precio-sin");
    expect(msg.textContent).toMatch(/búsquedas en vivo/i);
    expect(screen.queryByTestId("multi-precio-total")).toBeNull();
  });
});

describe("ofertas reales de un hotel (Property Details)", () => {
  it("una por proveedor, ordenadas por total, etiquetadas y con el enlace de la fuente; sin dominios falsos", () => {
    const o = parseHotelOffers(propertyFixture);
    expect(o).toHaveLength(5);
    expect(o.map((x) => x.source)).toEqual(["Trip.com", "Hotel Artemide", "Booking.com", "Expedia.com", "Hotels.com"]);
    expect(o.map((x) => x.total_usd)).toEqual([597, 615, 630, 642, 644]);
    const by = Object.fromEntries(o.map((x) => [x.source, x]));
    expect(by["Hotel Artemide"].label).toBe("Sitio oficial del hotel");
    expect(by["Booking.com"].label).toBe("Ver en Booking");
    expect(by["Booking.com"].url).toBe("https://www.google.com/travel/lodging/clk?pc=FIXTURE_BOOKING");
    expect(by["Booking.com"].free_cancellation).toBe(true);
    expect(by["Expedia.com"].url).toMatch(/^https:\/\/www\.expedia\.com\//);
    // El dominio que imita a Booking no se muestra como enlace.
    const all = parseHotelOffers(propertyFixture, 99);
    expect(all.find((x) => x.source === "Ofertas Falsas")?.url).toBeNull();
    expect(all.at(-1)?.source).toBe("Ofertas Falsas");
    expect(all.some((x) => x.source === "Sin precio")).toBe(false);
  });

  it("el redirect de Google Hotels por proveedor está en la lista blanca solo si lo da el servidor", () => {
    const clk = "https://www.google.com/travel/lodging/clk?pc=X";
    expect(checkAllowlisted(clk).ok).toBe(true);
    expect(checkUntrusted(clk).ok).toBe(false);
    expect(checkAllowlisted("https://sites.google.com/travel/lodging/clk?pc=X").ok).toBe(false);
  });

  it("caché de 3 h por propiedad + fechas + huéspedes, y gasta de la bolsa solo al consultar", async () => {
    let now = NOW;
    const store = memoryCacheStore(() => now);
    const fetchImpl = vi.fn(async () => json({ ...propertyFixture, nearby_places: [{ name: "x".repeat(5000) }] }));
    const gate = vi.fn(async (): Promise<GateDecision> => ({ allow: true }));
    const run = async (adults = 2) => {
      const serp = createSerpFetch({ store, gate, fetchImpl: fetchImpl as unknown as typeof fetch, now: () => now, log: () => {} });
      const r = await searchHotelOffers({ action: "offers", property_token: "TOKEN_HOTEL_ROMA", checkin: "2026-10-22", checkout: "2026-10-25", adults, name: "Hotel Artemide" }, { serpKey: "K", serpFetch: serp.fetch });
      return finalizeSearchResponse(r, serp.trace, now);
    };
    const a = await run();
    expect(a.body.disponible).toBe(true);
    expect((a.body.results as unknown[]).length).toBe(5);
    const u = new URL(String((fetchImpl.mock.calls[0] as unknown[])[0]));
    expect(u.searchParams.get("property_token")).toBe("TOKEN_HOTEL_ROMA");
    expect(u.searchParams.get("no_cache")).toBeNull();
    expect(travelDateTtlSeconds("google_hotels", u.searchParams, NOW)).toBe(HOTEL_OFFERS_TTL_SECONDS);
    expect(HOTEL_OFFERS_TTL_SECONDS).toBe(3 * 3600);
    // Solo se guarda lo que se usa (no nearby_places ni reseñas).
    expect(Object.keys(trimForCache("google_hotels", propertyFixture) as object).sort()).toEqual(["featured_prices", "name", "prices"]);
    now += 2 * 3600 * 1000;
    const b = await run();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(b.body.from_cache).toBe(true);
    expect(b.body.consulted_at).toBe(new Date(NOW).toISOString());
    // Otros huéspedes: otra búsqueda.
    await run(3);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    now += 1.5 * 3600 * 1000;
    await run();
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(gate).toHaveBeenCalledTimes(3);
  });

  it("cuota agotada: el servidor responde 402 sin llamar a SerpApi y la pantalla lo dice", async () => {
    const fetchImpl = vi.fn(async () => json(propertyFixture));
    const serp = createSerpFetch({ store: memoryCacheStore(() => NOW), gate: async () => ({ allow: false, soft: false, info: { quota: "live_searches_daily", limit: 5, used: 5 } }),
      fetchImpl: fetchImpl as unknown as typeof fetch, now: () => NOW, log: () => {} });
    const r = finalizeSearchResponse(await searchHotelOffers({ property_token: "T", checkin: "2026-10-22", checkout: "2026-10-25", adults: 2 }, { serpKey: "K", serpFetch: serp.fetch }), serp.trace, NOW);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(r.status).toBe(402);
    const invoke = async () => ({ data: null, error: { name: "FunctionsHttpError", message: "Edge Function returned a non-2xx status code", context: new Response(JSON.stringify(r.body), { status: 402 }) } });
    const s = await requestHotelOffers(invoke as unknown as Invoke, { property_token: "T", checkin: "2026-10-22", checkout: "2026-10-25", adults: 2 });
    expect(s.ok).toBe(false);
    expect(!s.ok && s.message).toMatch(/búsquedas en vivo/i);
    // Uso justo sin precio guardado: el motivo del servidor, tal cual.
    const soft = createSerpFetch({ store: memoryCacheStore(() => NOW), gate: async () => ({ allow: false, soft: true, info: {} }), fetchImpl: fetchImpl as unknown as typeof fetch, now: () => NOW, log: () => {} });
    const r2 = finalizeSearchResponse(await searchHotelOffers({ property_token: "T", checkin: "2026-10-22", checkout: "2026-10-25", adults: 2 }, { serpKey: "K", serpFetch: soft.fetch }), soft.trace, NOW);
    const s2 = await requestHotelOffers((async () => ({ data: r2.body, error: null })) as unknown as Invoke, { property_token: "T", checkin: "2026-10-22", checkout: "2026-10-25", adults: 2 });
    expect(!s2.ok && s2.message).toMatch(/uso justo/i);
  });

  it("fechas o token inválidos: 400 sin buscar", async () => {
    const fetchImpl = vi.fn();
    expect((await searchHotelOffers({ property_token: "", checkin: "2026-10-22", checkout: "2026-10-25" }, { serpKey: "K", serpFetch: fetchImpl as unknown as typeof fetch })).status).toBe(400);
    expect((await searchHotelOffers({ property_token: "T", checkin: "2026-10-25", checkout: "2026-10-22" }, { serpKey: "K", serpFetch: fetchImpl as unknown as typeof fetch })).status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("botón \"Ver ofertas reales\": no llama hasta pulsarse; muestra fuentes con total, hora y su enlace", async () => {
    const body = (await searchHotelOffers({ property_token: "TOKEN_HOTEL_ROMA", checkin: "2026-10-22", checkout: "2026-10-25", adults: 2 },
      { serpKey: "K", serpFetch: (async () => json(propertyFixture)) as unknown as typeof fetch })).body;
    const invoke = vi.fn(async () => ({ data: { ...body, consulted_at: "2026-10-21T15:00:00Z" }, error: null }));
    render(<HotelOffersButton query={{ property_token: "TOKEN_HOTEL_ROMA", checkin: "2026-10-22", checkout: "2026-10-25", adults: 2, name: "Hotel Artemide" }} invoke={invoke as unknown as Invoke} />);
    expect(invoke).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("hotel-ofertas-ver"));
    const lista = await screen.findByTestId("hotel-ofertas-lista");
    expect(invoke.mock.calls[0]).toEqual(["hotels-search", { body: { action: "offers", property_token: "TOKEN_HOTEL_ROMA", checkin: "2026-10-22", checkout: "2026-10-25", adults: 2, name: "Hotel Artemide" } }]);
    const rows = within(lista).getAllByTestId("hotel-oferta");
    expect(rows.length).toBeGreaterThanOrEqual(3);
    expect(rows.length).toBeLessThanOrEqual(5);
    expect(screen.getByTestId("hotel-ofertas-fuente").textContent).toMatch(/Google Hotels · consultado \d{1,2}:\d{2}/);
    const links = within(lista).getAllByTestId("hotel-oferta-link") as HTMLAnchorElement[];
    expect(links.map((a) => a.textContent?.trim())).toContain("Ver en Booking");
    expect(links.map((a) => a.textContent?.trim())).toContain("Sitio oficial del hotel");
    expect(links.every((a) => a.target === "_blank" && a.rel.includes("noopener"))).toBe(true);
    expect(lista.textContent).not.toMatch(/reservado|reserva confirmada/i);
  });
});
