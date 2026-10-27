// Tripadvisor Terra (plan Discover): búsqueda, autenticación, tope de gasto, respaldo de Google y
// sonda. Fixtures armados con la forma de la documentación oficial (docs.terra.tripadvisor.com,
// consultada el 27-oct-2026): /locations/search → { data: [{ location, matched_value }], pagination }.
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  GLOBAL_BUCKET, mapLocation, parsePhotos, parseSearch, PROBE_QUERY, probeTripadvisor, reserveEntities,
  searchEntities, searchUrl, TERRA_BASE, TERRA_DEFAULTS, terraConfig, terraErrorDetail, terraGet, terraLocale,
  type HitFn,
} from "../../supabase/functions/_shared/tripadvisor-terra";
import { handleSearch, type CoreDeps } from "../../supabase/functions/tripadvisor-search/core";
import { TripadvisorBubbles, TripadvisorRating } from "@/components/tripadvisor/TripadvisorRating";
import { TripadvisorPlaceCard } from "@/components/tripadvisor/TripadvisorPlaceCard";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke } } }));

const FAKE_KEY = "terra-llave-falsa-0123456789abcdef";

const location = (id: number, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  geo: "Ciudad de México",
  geo_id: 150800,
  names: [
    { language: "en_US", value: `${name} (EN)`, primary: true },
    { language: "es_MX", value: name, primary: false },
  ],
  descriptions: [{ language: "es_MX", value: `Descripción de ${name}` }],
  addresses: [{ language: "es_MX", formatted: "Londres 247, Del Carmen, Coyoacán, 04100 Ciudad de México", city: "Ciudad de México", country_code: "MX" }],
  coordinates: { latitude: 19.3551, longitude: -99.1625 },
  categories: [{ id: "47", display_name: "Museos de arte", top_level_category: {} }],
  phone_numbers: [{ type: "phone", value: "+52 55 5554 5999" }],
  rankings: [{ display_text: "N.º 3 de 1,200 cosas que hacer en Ciudad de México", rank: 3, total: 1200 }],
  traveler_ratings: { overall: { rating: 4.5, count: 21345, icon_url: "https://static.tacdn.com/img2/ratings/traveler/4.5.svg" } },
  urls: {
    official: "https://www.museofridakahlo.org.mx",
    tripadvisor: {
      main: `https://www.tripadvisor.com.mx/Attraction_Review-g150800-d${id}`,
      photos: `https://www.tripadvisor.com.mx/Attraction_Review-g150800-d${id}#photos`,
      write_review: `https://www.tripadvisor.com.mx/UserReview-g150800-d${id}`,
    },
  },
  photos: { total_count: 8123 },
  status: { value: "OPEN" },
  ...extra,
});

const searchPage = (n: number) => ({
  data: Array.from({ length: n }, (_, i) => ({ location: location(324000 + i, `Lugar ${i + 1}`), matched_value: { language: "es", value: "frida" } })),
  pagination: { page: 1, size: n, total_elements: n, total_pages: 1 },
});

const photosPage = {
  data: [
    { id: 1, location_id: 324000, photo: { key: "a", original_size_url: "https://media-cdn.tripadvisor.com/media/photo-o/a.jpg" }, source: { name: "Traveler" } },
    { id: 2, location_id: 324000, photo: { key: "b", original_size_url: "https://media-cdn.tripadvisor.com/media/photo-o/b.jpg" }, source: { name: "Management" } },
    { id: 3, location_id: 324000, photo: { key: "c", original_size_url: "http://inseguro.example/c.jpg" }, source: { name: "Traveler" } },
  ],
  pagination: { page: 1, size: 3, total_elements: 3, total_pages: 1 },
};

type Call = { url: string; headers: Record<string, string> };
function fakeFetch(respond: (url: string) => { status: number; body: unknown }) {
  const calls: Call[] = [];
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), headers: { ...(init?.headers as Record<string, string>) } });
    const r = respond(String(url));
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { "Content-Type": "application/json" } });
  });
  return { fetchImpl: fn as unknown as typeof fetch, calls };
}

/** check_rate_limit en memoria: misma regla (cuenta en la ventana e inserta solo si cabe). */
function memoryHit(opts: { fail?: boolean } = {}) {
  const counts = new Map<string, number>();
  const hit: HitFn = async (subject, bucket, rule) => {
    if (opts.fail) return null;
    const k = `${subject}|${bucket}`;
    const c = counts.get(k) ?? 0;
    if (c >= rule.limit) return false;
    counts.set(k, c + 1);
    return true;
  };
  return { hit, counts };
}

function deps(over: Partial<CoreDeps> & { fetchImpl: typeof fetch }): CoreDeps & { usage: unknown[]; fallbacks: Array<{ reason: string; status: number; detail: unknown }>; pauses: Array<[number, number | null]> } {
  const usage: unknown[] = [];
  const fallbacks: Array<{ reason: string; status: number; detail: unknown }> = [];
  const pauses: Array<[number, number | null]> = [];
  return {
    apiKey: FAKE_KEY,
    userId: "user-1",
    config: { ...TERRA_DEFAULTS },
    hit: memoryHit().hit,
    logUsage: (row) => { usage.push(row); },
    paused: async () => false,
    log: () => undefined,
    pause: async (s, st) => { pauses.push([s, st]); },
    fallback: async (reason, status, detail) => {
      fallbacks.push({ reason, status, detail });
      return { status: 200, body: { ok: true, source: "google_places", tripadvisor_motivo: reason, results: [{ id: "g1", name: "Lugar de Google" }] } };
    },
    ...over,
    usage, fallbacks, pauses,
  };
}

const SCREEN = { query: "Ciudad de México", category: "attractions" as const, language: "es_MX", uso: "pantalla" };

describe("Terra · URL, locale y configuración", () => {
  it("base terra.tripadvisor.com/api, version=1, categoría y locale con guion, sin llave en la URL", () => {
    const u = new URL(searchUrl({ query: "Frida", category: "attractions", locale: terraLocale("es_MX"), size: 5 }));
    expect(`${u.origin}${u.pathname}`).toBe(`${TERRA_BASE}/locations/search`);
    expect(u.searchParams.get("version")).toBe("1");
    expect(u.searchParams.get("category")).toBe("ATTRACTION");
    expect(u.searchParams.get("locale")).toBe("es-MX");
    expect(u.searchParams.get("size")).toBe("5");
    expect(u.toString()).not.toMatch(/key/i);
    expect(new URL(searchUrl({ query: "x", category: "restaurants", locale: "es-MX", size: 50 })).searchParams.get("size")).toBe("20");
    expect(new URL(searchUrl({ query: "x", category: "geos", locale: "es-MX", size: 5 })).searchParams.has("category")).toBe(false);
  });

  it("terraLocale acepta es_MX, es-mx y vacío", () => {
    expect(terraLocale("es_MX")).toBe("es-MX");
    expect(terraLocale("es-mx")).toBe("es-MX");
    expect(terraLocale("en")).toBe("en");
    expect(terraLocale(undefined)).toBe("es-MX");
  });

  it("terraConfig: valores por omisión y variables fuera de rango ignoradas", () => {
    expect(terraConfig(() => undefined)).toEqual(TERRA_DEFAULTS);
    expect(terraConfig((k) => ({ TRIPADVISOR_DAILY_ENTITIES: "50", TRIPADVISOR_SEARCH_SIZE: "99" } as Record<string, string>)[k]))
      .toMatchObject({ dailyEntities: 50, searchSize: 5 });
  });
});

describe("Terra · búsqueda parseada", () => {
  it("Location → misma forma de la app (nombre en español, calificación, reseñas, web_url, lat/lng, categoría)", () => {
    const [r] = parseSearch(searchPage(1), "es-MX", "attractions");
    expect(r).toMatchObject({
      id: "324000",
      name: "Lugar 1",
      address: "Londres 247, Del Carmen, Coyoacán, 04100 Ciudad de México",
      rating: 4.5,
      num_reviews: 21345,
      rating_image_url: "https://static.tacdn.com/img2/ratings/traveler/4.5.svg",
      web_url: "https://www.tripadvisor.com.mx/Attraction_Review-g150800-d324000",
      photos_url: "https://www.tripadvisor.com.mx/Attraction_Review-g150800-d324000#photos",
      write_review_url: "https://www.tripadvisor.com.mx/UserReview-g150800-d324000",
      latitude: 19.3551,
      longitude: -99.1625,
      category: "Museos de arte",
      phone: "+52 55 5554 5999",
      website: "https://www.museofridakahlo.org.mx",
      ranking: "N.º 3 de 1,200 cosas que hacer en Ciudad de México",
      description: "Descripción de Lugar 1",
      photos: [],
      photo_count: 8123,
      fuente: "tripadvisor",
    });
  });

  it("v2 (es-MX con guion) y campos ausentes: sin romper, con nulos", () => {
    const r = mapLocation({ id: 9, names: [{ language: "es-MX", value: "Solo nombre", primary: true }] }, "es-MX", "restaurants");
    expect(r).toMatchObject({ id: "9", name: "Solo nombre", rating: null, num_reviews: null, web_url: null, latitude: null, category: "restaurants", address: "" });
    expect(mapLocation({ id: 1 }, "es-MX")).toBeNull();
    expect(parseSearch({ nada: true }, "es-MX")).toEqual([]);
  });

  it("entidades cobrables = location IDs devueltos", () => {
    expect(searchEntities(searchPage(3))).toBe(3);
    expect(searchEntities({ data: [] })).toBe(0);
    expect(searchEntities(null)).toBe(0);
  });

  it("fotos: solo https del CDN, primero las de la administración, con tope", () => {
    expect(parsePhotos(photosPage)).toEqual([
      "https://media-cdn.tripadvisor.com/media/photo-o/b.jpg",
      "https://media-cdn.tripadvisor.com/media/photo-o/a.jpg",
    ]);
    expect(parsePhotos(photosPage, 1)).toHaveLength(1);
  });
});

describe("Terra · autenticación sin filtrar la llave", () => {
  it("la llave va en el encabezado X-API-Key, nunca en la URL", async () => {
    const f = fakeFetch(() => ({ status: 200, body: searchPage(1) }));
    await terraGet(f.fetchImpl, searchUrl({ query: "Frida", locale: "es-MX", size: 1 }), FAKE_KEY);
    expect(f.calls[0].headers["X-API-Key"]).toBe(FAKE_KEY);
    expect(f.calls[0].url).not.toContain(FAKE_KEY);
    expect(f.calls[0].url).not.toMatch(/[?&]key=/);
  });

  it("la respuesta de la función no contiene la llave (éxito ni error que la repita)", async () => {
    const ok = fakeFetch(() => ({ status: 200, body: searchPage(2) }));
    const out = await handleSearch(SCREEN, deps({ fetchImpl: ok.fetchImpl }));
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ ok: true, source: "tripadvisor", atribucion: "Tripadvisor", entidades: 2 });
    expect(JSON.stringify(out)).not.toContain(FAKE_KEY);

    const echo = fakeFetch(() => ({ status: 401, body: { status: 401, title: "Unauthorized", detail: `API key has not been found: ${FAKE_KEY}` } }));
    const d = deps({ fetchImpl: echo.fetchImpl });
    const bad = await handleSearch(SCREEN, d);
    expect(JSON.stringify(bad)).not.toContain(FAKE_KEY);
    expect(JSON.stringify(d.fallbacks)).not.toContain(FAKE_KEY);
    expect(terraErrorDetail({ ok: false, status: 401, json: { detail: `x ${FAKE_KEY}` } }, FAKE_KEY)).toBe("x ***");
  });

  it("403 de Terra: se lee `message` (no solo `detail`)", () => {
    const d = terraErrorDetail({ ok: false, status: 403, json: { title: "Forbidden", detail: "Access Denied", message: "API Key does not have access to endpoint" } });
    expect(d).toContain("API Key does not have access to endpoint");
  });
});

describe("Terra · tope diario y por persona", () => {
  it("reserveEntities aparta solo lo que cabe en el tope de 24 h", async () => {
    const { hit, counts } = memoryHit();
    expect(await reserveEntities(hit, 5, 7)).toBe(5);
    expect(await reserveEntities(hit, 5, 7)).toBe(2);
    expect(await reserveEntities(hit, 5, 7)).toBe(0);
    expect([...counts.entries()].find(([k]) => k.endsWith(GLOBAL_BUCKET))?.[1]).toBe(7);
    expect(await reserveEntities(hit, 5, 0)).toBe(0);
  });

  it("si la base no responde, no se gasta (falla cerrada)", async () => {
    expect(await reserveEntities(memoryHit({ fail: true }).hit, 5, 200)).toBe(0);
    const f = fakeFetch(() => ({ status: 200, body: searchPage(5) }));
    const d = deps({ fetchImpl: f.fetchImpl, hit: memoryHit({ fail: true }).hit });
    await handleSearch(SCREEN, d);
    expect(f.calls).toHaveLength(0);
    expect(d.fallbacks[0].reason).toBe("tope_por_persona");
  });

  it("el tope recorta el tamaño de la búsqueda y al llegar a 0 se usa Google sin llamar a Terra", async () => {
    const { hit } = memoryHit();
    const f = fakeFetch((url) => ({ status: 200, body: searchPage(Number(new URL(url).searchParams.get("size"))) }));
    const d = deps({ fetchImpl: f.fetchImpl, hit, config: { ...TERRA_DEFAULTS, dailyEntities: 7 } });
    const a = await handleSearch(SCREEN, d);
    const b = await handleSearch(SCREEN, d);
    const c = await handleSearch(SCREEN, d);
    expect(f.calls.map((x) => new URL(x.url).searchParams.get("size"))).toEqual(["5", "2"]);
    expect(a.body.entidades).toBe(5);
    expect(b.body.entidades).toBe(2);
    expect(c.body).toMatchObject({ source: "google_places", tripadvisor_motivo: "tope_diario" });
    expect(d.usage).toEqual([
      expect.objectContaining({ provider: "tripadvisor", model: "terra:locations/search", searches: 5, cost_estimate_usd: 0.075 }),
      expect.objectContaining({ provider: "tripadvisor", model: "terra:locations/search", searches: 2 }),
    ]);
  });

  it("tope por persona: pasado el límite, esa persona va a Google y el tope global no se toca", async () => {
    const { hit, counts } = memoryHit();
    const f = fakeFetch(() => ({ status: 200, body: searchPage(1) }));
    const d = deps({ fetchImpl: f.fetchImpl, hit, config: { ...TERRA_DEFAULTS, userDailyCalls: 1 } });
    await handleSearch(SCREEN, d);
    const second = await handleSearch(SCREEN, d);
    expect(f.calls).toHaveLength(1);
    expect(second.body.tripadvisor_motivo).toBe("tope_por_persona");
    expect([...counts.entries()].find(([k]) => k.endsWith(GLOBAL_BUCKET))?.[1]).toBe(5);
  });
});

describe("Terra · respaldo de Google", () => {
  for (const status of [402, 403, 429]) {
    it(`HTTP ${status} → Google Places, pausa y sin registrar entidades`, async () => {
      const f = fakeFetch(() => ({ status, body: { status, title: "x", message: "API Key does not have access to endpoint" } }));
      const d = deps({ fetchImpl: f.fetchImpl });
      const out = await handleSearch(SCREEN, d);
      expect(out).toMatchObject({ status: 200, body: { ok: true, source: "google_places" } });
      expect(d.fallbacks[0]).toMatchObject({ reason: "TripAdvisor error", status });
      expect(d.pauses[0]).toEqual([status === 429 ? 60 : 900, status]);
      expect(d.usage).toEqual([]);
    });
  }

  it("con pausa vigente no se llama a Terra", async () => {
    const f = fakeFetch(() => ({ status: 200, body: searchPage(5) }));
    const d = deps({ fetchImpl: f.fetchImpl, paused: async () => true });
    const out = await handleSearch(SCREEN, d);
    expect(f.calls).toHaveLength(0);
    expect(out.body.tripadvisor_motivo).toBe("tripadvisor_en_pausa");
  });

  it("sin llave, sin red o sin resultados (allowlist vacía) → Google", async () => {
    const f = fakeFetch(() => ({ status: 200, body: { data: [], pagination: { total_elements: 0 } } }));
    const d = deps({ fetchImpl: f.fetchImpl });
    expect((await handleSearch(SCREEN, d)).body.tripadvisor_motivo).toBe("sin_resultados_tripadvisor");
    expect(d.usage).toEqual([]);

    const d2 = deps({ fetchImpl: f.fetchImpl, apiKey: undefined });
    expect((await handleSearch(SCREEN, d2)).body.tripadvisor_motivo).toBe("TRIPADVISOR_API_KEY no configurada");

    const net = vi.fn(async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch;
    const d3 = deps({ fetchImpl: net });
    expect((await handleSearch(SCREEN, d3)).body.source).toBe("google_places");
  });

  it("llamadas que no vienen de una pantalla (análisis, logística, concierge) nunca consultan Terra", async () => {
    const f = fakeFetch(() => ({ status: 200, body: searchPage(5) }));
    const d = deps({ fetchImpl: f.fetchImpl });
    const out = await handleSearch({ query: "Roma", category: "attractions", language: "es_MX" }, d);
    expect(f.calls).toHaveLength(0);
    expect(out.body).toMatchObject({ source: "google_places", tripadvisor_motivo: "solo_pantallas" });
  });

  it("query vacío → 400 sin llamar a nada", async () => {
    const f = fakeFetch(() => ({ status: 200, body: searchPage(1) }));
    const out = await handleSearch({ query: "  ", uso: "pantalla" }, deps({ fetchImpl: f.fetchImpl }));
    expect(out.status).toBe(400);
    expect(f.calls).toHaveLength(0);
  });
});

describe("Terra · no se enriquece de más", () => {
  it("una búsqueda = UNA llamada (sin detalles ni fotos por resultado)", async () => {
    const f = fakeFetch(() => ({ status: 200, body: searchPage(5) }));
    const out = await handleSearch(SCREEN, deps({ fetchImpl: f.fetchImpl }));
    expect(f.calls).toHaveLength(1);
    expect(new URL(f.calls[0].url).pathname).toBe("/api/locations/search");
    expect((out.body.results as unknown[]).length).toBe(5);
    expect(f.calls.some((c) => /\/photos|\/reviews|\/locations\/\d+/.test(new URL(c.url).pathname))).toBe(false);
  });

  it("fotos solo del lugar que se abre: 1 llamada, size pequeño, 1 entidad registrada", async () => {
    const f = fakeFetch(() => ({ status: 200, body: photosPage }));
    const d = deps({ fetchImpl: f.fetchImpl });
    const out = await handleSearch({ action: "fotos", location_id: "324000", uso: "pantalla" }, d);
    expect(f.calls).toHaveLength(1);
    const u = new URL(f.calls[0].url);
    expect(u.pathname).toBe("/api/locations/324000/photos");
    expect(u.searchParams.get("size")).toBe(String(TERRA_DEFAULTS.photosSize));
    expect(out.body).toMatchObject({ ok: true, entidades: 1 });
    expect(d.usage).toEqual([expect.objectContaining({ model: "terra:locations/photos", searches: 1 })]);
    expect(JSON.stringify(out)).not.toContain(FAKE_KEY);
  });

  it("fotos fuera de una pantalla o con error: sin gasto y sin romper", async () => {
    const f = fakeFetch(() => ({ status: 403, body: { message: "API Key does not have access to endpoint" } }));
    const d = deps({ fetchImpl: f.fetchImpl });
    expect((await handleSearch({ action: "fotos", location_id: "1" }, d)).status).toBe(400);
    expect(f.calls).toHaveLength(0);
    const out = await handleSearch({ action: "fotos", location_id: "1", uso: "pantalla" }, d);
    expect(out).toMatchObject({ status: 200, body: { ok: false, photos: [], http: 403 } });
    expect(d.usage).toEqual([]);
  });
});

describe("Sonda health-check ?action=tripadvisor", () => {
  it("una búsqueda mínima que no cobra (consulta sin coincidencias, size=1) y sin exponer la llave", async () => {
    const f = fakeFetch(() => ({ status: 200, body: { data: [], pagination: { total_elements: 0 } } }));
    const r = await probeTripadvisor({ fetchImpl: f.fetchImpl, apiKey: FAKE_KEY });
    expect(f.calls).toHaveLength(1);
    const u = new URL(f.calls[0].url);
    expect(u.searchParams.get("query")).toBe(PROBE_QUERY);
    expect(u.searchParams.get("size")).toBe("1");
    expect(f.calls[0].headers["X-API-Key"]).toBe(FAKE_KEY);
    expect(r).toMatchObject({ llave_configurada: true, ok: true, http: 200, resultados: 0, entidades_cobrables: 0, detail: null });
    expect(JSON.stringify(r)).not.toContain(FAKE_KEY);
    expect(JSON.stringify(r)).not.toContain("terra.tripadvisor.com");
  });

  it("401/403: estado y motivo legibles, sin la llave", async () => {
    const f = fakeFetch(() => ({ status: 401, body: { status: 401, title: "Unauthorized", detail: `API key has not been found ${FAKE_KEY}` } }));
    const r = await probeTripadvisor({ fetchImpl: f.fetchImpl, apiKey: FAKE_KEY });
    expect(r).toMatchObject({ ok: false, http: 401, resultados: null });
    expect(r.detail).toContain("API key has not been found");
    expect(JSON.stringify(r)).not.toContain(FAKE_KEY);
  });

  it("sin llave: no llama", async () => {
    const f = fakeFetch(() => ({ status: 200, body: {} }));
    expect(await probeTripadvisor({ fetchImpl: f.fetchImpl, apiKey: undefined })).toMatchObject({ ok: false, llave_configurada: false, http: null, detail: "Falta TRIPADVISOR_API_KEY" });
    expect(f.calls).toHaveLength(0);
  });

  it("muestra=1: lugar real (≤1 entidad) y, si la allowlist lo esconde, catálogo para explicarlo", async () => {
    const f = fakeFetch((url) => ({ status: 200, body: url.includes("/catalog/") ? searchPage(1) : { data: [] } }));
    const r = await probeTripadvisor({ fetchImpl: f.fetchImpl, apiKey: FAKE_KEY, muestra: true });
    expect(f.calls.map((c) => new URL(c.url).pathname)).toEqual(["/api/locations/search", "/api/catalog/locations/search"]);
    expect(r).toMatchObject({ ok: true, resultados: 0, entidades_cobrables: 1, catalogo: { http: 200, resultados: 1 } });
    expect(r.detail).toContain("allowlist");
  });

  it("health-check enruta ?action=tripadvisor a la sonda", () => {
    const src = readFileSync("supabase/functions/health-check/index.ts", "utf8");
    expect(src).toContain('searchParams.get("action") === "tripadvisor"');
    expect(src).toContain("probeTripadvisor(");
  });
});

describe("Atribución en pantalla", () => {
  it("calificación con el texto de Tripadvisor, burbujas y reseñas que enlazan a su página", () => {
    render(<TripadvisorRating rating={4.5} numReviews={21345} webUrl="https://www.tripadvisor.com.mx/Attraction_Review-g150800-d324000" />);
    expect(screen.getByText("Calificación de viajeros de Tripadvisor")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "4.5 de 5 burbujas" })).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "21,345 opiniones" });
    expect(link).toHaveAttribute("href", "https://www.tripadvisor.com.mx/Attraction_Review-g150800-d324000");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });

  it("burbujas: llenas, media y vacías", () => {
    const { container } = render(<TripadvisorBubbles rating={3.5} />);
    expect([...container.querySelectorAll("svg")].map((s) => s.getAttribute("data-fill"))).toEqual(["1", "1", "1", "0.5", "0"]);
  });

  it("TripActivities: consulta solo al tocar Buscar, marca uso pantalla y escribe Tripadvisor bien", () => {
    const src = readFileSync("src/pages/TripActivities.tsx", "utf8");
    const card = readFileSync("src/components/tripadvisor/TripadvisorPlaceCard.tsx", "utf8");
    expect(src).toContain('uso: "pantalla"');
    expect(card).toContain('action: "fotos"');
    expect(card).toContain('uso: "pantalla"');
    expect(src + card).not.toContain("TripAdvisor");
    // La búsqueda solo vive en buscar() (botón), no en un efecto al abrir la pantalla.
    const effects: string[] = src.match(/useEffect\([\s\S]*?\);/g) ?? [];
    expect(effects.some((e) => e.includes("tripadvisor-search"))).toBe(false);
  });

  it("tarjeta: no pide nada al mostrarse; las fotos solo al tocar «Ver fotos» (una llamada)", async () => {
    invoke.mockReset();
    invoke.mockResolvedValue({ data: { ok: true, photos: ["https://media-cdn.tripadvisor.com/media/photo-o/b.jpg"] }, error: null });
    const [r] = parseSearch(searchPage(1), "es-MX", "attractions");
    render(<TripadvisorPlaceCard r={r} cat="attractions" />);
    expect(invoke).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "Lugar 1" })).toHaveAttribute("href", r.web_url);
    expect(screen.queryByRole("img", { name: "Lugar 1" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Ver fotos/ }));
    await waitFor(() => expect(screen.getByRole("link", { name: "Ver todas las fotos en Tripadvisor" })).toBeInTheDocument());
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("tripadvisor-search", { body: { action: "fotos", location_id: "324000", language: "es_MX", uso: "pantalla" } });
    expect(screen.getByRole("link", { name: "Fotos de Lugar 1 en Tripadvisor" })).toHaveAttribute("href", r.photos_url);
    expect(screen.queryByRole("button", { name: /Ver fotos/ })).toBeNull();
  });
});
