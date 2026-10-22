import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "fs";
import path from "path";

const env: Record<string, string> = {};
(globalThis as unknown as { Deno: unknown }).Deno = { env: { get: (k: string) => env[k] } };

import { searchFlights } from "../../supabase/functions/flights-search/search";
import { searchHotels } from "../../supabase/functions/hotels-search/search";

const AI_HOSTS = /ai\.gateway\.lovable\.dev|generativelanguage\.googleapis\.com/;

describe("búsqueda en vivo sin proveedores: nunca se inventan vuelos ni hoteles", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.unstubAllGlobals());

  it("flights-search: SerpApi y Travelpayouts fallan → results [], disponible false, link de búsqueda, sin IA", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes("serpapi.com")) return new Response("down", { status: 500 });
      if (String(url).includes("travelpayouts.com")) return new Response(JSON.stringify({ data: {} }), { status: 200 });
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"options":[{"airline":"Inventada","price_per_person_usd":500}]}' } }] }), { status: 200 });
    });
    const r = await searchFlights(
      { origin: "Madrid", destination: "Paris", depart: "2026-11-10", return_date: "2026-11-20", travelers: 2, type: "round" },
      { serpKey: "s", tpToken: "t", lovableKey: "l", marker: "" },
    );
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, source: "none", disponible: false, results: [], motivo: "Búsqueda en vivo no disponible ahora; intenta más tarde." });
    expect(r.body.search_url).toBe("https://www.aviasales.com/search/MAD1011CDG20112?marker=533299");
    expect(fetchMock.mock.calls.some(([u]) => AI_HOSTS.test(String(u)))).toBe(false);
  });

  it("flights-search: datos de Travelpayouts se marcan como caché (48 h) y sin hora de llegada inventada", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes("serpapi.com")) return new Response("down", { status: 500 });
      return new Response(JSON.stringify({ data: { CDG: { 0: { price: 300, airline: "IB", transfers: 1, departure_at: "2026-11-10T08:00:00Z", return_at: "2026-11-20T18:00:00Z" } } } }), { status: 200 });
    });
    const r = await searchFlights({ origin: "MAD", destination: "CDG", depart: "2026-11-10", return_date: "2026-11-20", travelers: 2 }, { serpKey: "s", tpToken: "t" });
    const res = r.body.results as any[];
    expect(r.body).toMatchObject({ source: "travelpayouts", disponible: true, cache_max_age_h: 48 });
    expect(res[0]).toMatchObject({ price_per_person_usd: 300, price_usd: 600, arrival: { id: "CDG", time: null }, return_at: "2026-11-20T18:00:00Z" });
  });

  it("hotels-search: SerpApi falla o sin llave → results [], disponible false, source none, link directo a Booking (tp.media/click responde 400)", async () => {
    fetchMock.mockResolvedValue(new Response("down", { status: 503 }));
    const body = { city: "Roma", checkin: "2026-11-10", checkout: "2026-11-15", adults: 3 };
    for (const envKeys of [{ serpKey: "s" }, { serpKey: null }]) {
      const r = await searchHotels(body, envKeys);
      expect(r.body).toMatchObject({ ok: true, source: "none", disponible: false, results: [] });
      // Directo: el redirect tp.media/click responde 400 "source_type is empty" (H0, cierre 2 · enlaces).
      expect(String(r.body.booking_url)).toMatch(/^https:\/\/www\.booking\.com\/searchresults\.html\?ss=Roma&checkin=2026-11-10&checkout=2026-11-15&group_adults=3/);
      // 3 adultos → 2 habitaciones en la búsqueda.
      expect(decodeURIComponent(String(r.body.booking_url))).toContain("no_rooms=2");
    }
    expect(fetchMock.mock.calls.some(([u]) => AI_HOSTS.test(String(u)))).toBe(false);
  });

  it("el código ya no tiene un respaldo 'ai-fallback' que sustituya proveedores", () => {
    const root = path.resolve(__dirname, "../../supabase/functions");
    for (const f of ["flights-search/index.ts", "flights-search/search.ts", "hotels-search/index.ts", "hotels-search/search.ts", "serpapi-quote/index.ts"]) {
      const src = readFileSync(path.join(root, f), "utf8");
      expect(src, f).not.toMatch(/source\s*=\s*"ai-fallback"/);
    }
  });
});
