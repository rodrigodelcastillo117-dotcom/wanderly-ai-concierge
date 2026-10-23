// Viator Partner API v2 (Acceso básico de afiliado), 23-oct-2026. Fixtures armados según la
// documentación técnica (docs.viator.com/partner-api/technical): /search/freetext (DESTINATIONS y
// PRODUCTS), /products/search (filtering.destination) y el resumen de producto (productCode, title,
// images[].variants, reviews.combinedAverageRating/totalReviews, duration, pricing.summary.fromPrice +
// pricing.currency, productUrl con el afiliado). Sin llamadas reales: fetch, caché y bolsa simulados.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => {
  const done = Promise.resolve({ data: null, error: null });
  const from = () => ({ insert: () => ({ then: done.then.bind(done), select: () => ({ single: async () => ({ data: null, error: null }) }) }), update: () => ({ eq: () => done }) });
  return { supabase: { from, functions: { invoke: (...a: any[]) => invoke(...a) } } };
});
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

import {
  affiliateProductUrl, formatDuration, mapViatorProducts, NO_DISPONIBLE_MOTIVO, pickDestination, runViatorSearch, toursRequested,
  VIATOR_PROD_BASE, VIATOR_SANDBOX_BASE, viatorConfig, type ViatorDeps,
} from "../../supabase/functions/_shared/viator";
import { CACHE_TTL_SECONDS, memoryCacheStore } from "../../supabase/functions/_shared/serpCache";
import { checkAllowlisted, checkUntrusted } from "../../supabase/functions/_shared/booking/allowlist";
import { applyToolPolicy, detectIntents } from "../../supabase/functions/concierge-chat/planner";
import { runAgentTurn, type ModelCaller } from "../../supabase/functions/concierge-chat/agent";
import { CircuitBreaker, type ProviderStep } from "../../supabase/functions/concierge-chat/router";
import { collectEvidence, prepareToolResultForModel, tourCards, validateCards } from "../../supabase/functions/concierge-chat/cards";
import { finalizeTurn } from "../../supabase/functions/concierge-chat/finalize";
import { TOOL_DEFS } from "../../supabase/functions/concierge-chat/toolDefs";
import { summarizeViator, VIATOR_NO_DISPONIBLE } from "@/lib/viatorTours";
import { ViatorToursButton } from "@/components/booking/ViatorTours";
import { RichCard } from "@/components/concierge/ConciergeCards";

// ─── Fixtures con la forma documentada ───
const variants = (id: string) => [
  { height: 50, width: 50, url: `https://hare-media-cdn.tripadvisor.com/media/attractions-splice-spp-50x50/${id}.jpg` },
  { height: 320, width: 480, url: `https://hare-media-cdn.tripadvisor.com/media/attractions-splice-spp-480x320/${id}.jpg` },
  { height: 480, width: 720, url: `https://hare-media-cdn.tripadvisor.com/media/attractions-splice-spp-720x480/${id}.jpg` },
];
const PRODUCT_COLISEO = {
  productCode: "12345P1",
  title: "Coliseo, Foro Romano y Palatino con guía",
  description: "Texto largo…",
  images: [{ imageSource: "SUPPLIER_PROVIDED", caption: "Coliseo", isCover: true, variants: variants("coliseo") }],
  reviews: { sources: [{ provider: "VIATOR", totalCount: 900, averageRating: 4.7 }, { provider: "TRIPADVISOR", totalCount: 334, averageRating: 4.6 }], totalReviews: 1234, combinedAverageRating: 4.6731 },
  duration: { fixedDurationInMinutes: 180 },
  confirmationType: "INSTANT",
  itineraryType: "STANDARD",
  pricing: { summary: { fromPrice: 1234.5, fromPriceBeforeDiscount: 1300 }, currency: "MXN" },
  productUrl: "https://www.viator.com/tours/Rome/Colosseum-Roman-Forum-and-Palatine-Hill/d511-12345P1?mcid=42383&pid=P00327354&medium=api&api_version=2.0",
  destinations: [{ ref: "511", primary: true }],
  flags: ["FREE_CANCELLATION"],
};
const PRODUCT_VATICANO = {
  productCode: "6789P2",
  title: "Museos Vaticanos y Capilla Sixtina sin filas",
  images: [{ isCover: false, variants: variants("vaticano") }],
  reviews: { totalReviews: 88, combinedAverageRating: 4.5 },
  duration: { variableDurationFromMinutes: 120, variableDurationToMinutes: 180 },
  pricing: { summary: { fromPrice: 980 }, currency: "MXN" },
  // Sin afiliado: se le agregan pid y mcid de IATOS.
  productUrl: "https://www.viator.com/tours/Rome/Vatican-Museums/d511-6789P2",
};
const PRODUCT_SIN_URL = { productCode: "000X", title: "Sin enlace", pricing: { summary: { fromPrice: 10 }, currency: "MXN" } };
const PRODUCT_URL_FALSA = { ...PRODUCT_COLISEO, productCode: "999Z", productUrl: "https://www.viator-tours.example/tours/x?pid=P00327354" };

const FREETEXT_DEST = { destinations: { totalCount: 2, results: [
  { id: 511, name: "Roma", parentDestinationId: 57, parentDestinationName: "Lacio" },
  { id: 50762, name: "Roma Norte", parentDestinationId: 628 },
] } };
const PRODUCTS_SEARCH = { products: [PRODUCT_COLISEO, PRODUCT_VATICANO, PRODUCT_SIN_URL, PRODUCT_URL_FALSA], totalCount: 4 };
const FREETEXT_PRODUCTS = { products: { totalCount: 1, results: [PRODUCT_COLISEO] } };

type Call = { url: string; init: RequestInit; body: any };
function viatorFetch(opts: { status?: number; retryAfter?: string } = {}) {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    calls.push({ url, init, body });
    const headers = new Headers(opts.retryAfter ? { "Retry-After": opts.retryAfter } : {});
    if (opts.status && opts.status !== 200) return new Response(JSON.stringify({ code: "UNAUTHORIZED", message: "x" }), { status: opts.status, headers });
    if (url.endsWith("/products/search")) return new Response(JSON.stringify(PRODUCTS_SEARCH), { status: 200, headers });
    const type = body.searchTypes?.[0]?.searchType;
    return new Response(JSON.stringify(type === "DESTINATIONS" ? FREETEXT_DEST : FREETEXT_PRODUCTS), { status: 200, headers });
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls, spy: fetchImpl };
}
const KEY = "llave-de-prueba-no-real";
const NOW = Date.parse("2026-10-23T15:04:00Z");
function deps(extra: Partial<ViatorDeps> = {}) {
  const f = viatorFetch();
  const store = memoryCacheStore(() => NOW);
  const refund = vi.fn(async () => {});
  const gate = vi.fn(async () => ({ allow: true as const, refund }));
  return { f, store, gate, refund, d: { fetchImpl: f.fetchImpl, apiKey: KEY, baseUrl: VIATOR_PROD_BASE, store, gate, now: () => NOW, ...extra } as ViatorDeps };
}

beforeEach(() => invoke.mockReset());

describe("1. parseo del resumen de producto", () => {
  it("título, foto de portada (~480 px), calificación (1 decimal) y reseñas, duración, 'desde' con su moneda y productUrl", () => {
    const tours = mapViatorProducts(PRODUCTS_SEARCH.products);
    expect(tours.map((t) => t.codigo)).toEqual(["12345P1", "6789P2"]); // sin productUrl válido no se muestra
    expect(tours[0]).toEqual({
      codigo: "12345P1", title: "Coliseo, Foro Romano y Palatino con guía",
      foto: "https://hare-media-cdn.tripadvisor.com/media/attractions-splice-spp-480x320/coliseo.jpg",
      rating: 4.7, resenas: 1234, duracion: "3 h", desde: { monto: 1234.5, moneda: "MXN" },
      url: PRODUCT_COLISEO.productUrl,
    });
    expect(tours[1].duracion).toBe("2–3 h");
    expect(formatDuration({ fixedDurationInMinutes: 90 })).toBe("1 h 30 min");
    expect(formatDuration({ fixedDurationInMinutes: 45 })).toBe("45 min");
    expect(formatDuration({ unstructuredDuration: "varios días" })).toBeUndefined();
  });
  it("destino: el de nombre igual a la ciudad", () => {
    expect(pickDestination(FREETEXT_DEST, "roma")).toEqual({ id: "511", nombre: "Roma" });
    expect(pickDestination({ destinations: { results: [] } }, "Roma")).toBeNull();
  });
  it("llave y base: producción primero; sandbox solo sin la de producción", () => {
    expect(viatorConfig((k) => ({ VIATOR_API_KEY: "a", VIATOR_API_KEY_SANDBOX: "b" } as any)[k])).toEqual({ apiKey: "a", baseUrl: "https://api.viator.com/partner" });
    expect(viatorConfig((k) => ({ VIATOR_API_KEY_SANDBOX: "b" } as any)[k])).toEqual({ apiKey: "b", baseUrl: "https://api.sandbox.viator.com/partner" });
    expect(viatorConfig(() => undefined)).toEqual({ baseUrl: VIATOR_PROD_BASE });
    expect(VIATOR_SANDBOX_BASE).toBe("https://api.sandbox.viator.com/partner");
  });
});

describe("2. afiliado de IATOS en productUrl", () => {
  it("se conserva el que trae Viator; si falta, se agregan pid P00327354 y mcid 42383", () => {
    expect(affiliateProductUrl(PRODUCT_COLISEO.productUrl)).toBe(PRODUCT_COLISEO.productUrl);
    const u = new URL(affiliateProductUrl(PRODUCT_VATICANO.productUrl)!);
    expect(u.searchParams.get("pid")).toBe("P00327354");
    expect(u.searchParams.get("mcid")).toBe("42383");
  });
  it("solo https de viator.com y fichas /tours/…", () => {
    for (const bad of ["http://www.viator.com/tours/x", "https://www.viator.com.evil.io/tours/x", "https://www.viator.com/searchResults/all?text=x",
      "https://user:p@www.viator.com/tours/x", "javascript:alert(1)", "https://viator-tours.example/tours/x"]) expect(affiliateProductUrl(bad), bad).toBeNull();
    expect(affiliateProductUrl("https://shop.live.rc.viator.com/tours/Edinburgh/x/d739-62330P2?mcid=42383&pid=P00045135")).toContain("pid=P00045135");
  });
  it("toda URL que devuelve la búsqueda lleva pid y mcid", async () => {
    const { d } = deps();
    const r = await runViatorSearch({ city: "Roma" }, d);
    expect(r.ok).toBe(true);
    for (const t of (r as any).results) {
      const u = new URL(t.url);
      expect(u.hostname.endsWith("viator.com")).toBe(true);
      expect(u.searchParams.get("pid")).toBeTruthy();
      expect(u.searchParams.get("mcid")).toBe("42383");
    }
  });
});

describe("3. llamadas según la documentación (sin exponer la llave)", () => {
  it("encabezados exp-api-key, Accept version=2.0 y Accept-Language; destino con freetext y luego /products/search", async () => {
    const { d, f } = deps();
    const r = await runViatorSearch({ city: "Roma", date_from: "2026-11-02", date_to: "2026-11-06" }, d);
    expect(f.calls.map((c) => c.url)).toEqual([`${VIATOR_PROD_BASE}/search/freetext`, `${VIATOR_PROD_BASE}/products/search`]);
    const h = f.calls[0].init.headers as Record<string, string>;
    expect(h["exp-api-key"]).toBe(KEY);
    expect(h.Accept).toBe("application/json;version=2.0");
    expect(h["Accept-Language"]).toBe("es-MX");
    expect(f.calls[0].body).toEqual({ searchTerm: "Roma", searchTypes: [{ searchType: "DESTINATIONS", pagination: { start: 1, count: 3 } }], currency: "MXN" });
    expect(f.calls[1].body).toEqual({
      filtering: { destination: "511", startDate: "2026-11-02", endDate: "2026-11-06" },
      sorting: { sort: "TRAVELER_RATING", order: "DESCENDING" }, pagination: { start: 1, count: 6 }, currency: "MXN",
    });
    expect(r).toMatchObject({ ok: true, fuente: "Viator", consultado_at: new Date(NOW).toISOString(), from_cache: false, moneda: "MXN", destino: { id: "511" } });
    expect(JSON.stringify(r)).not.toContain(KEY);
  });
  it("con consulta: freetext PRODUCTS filtrado por el destino", async () => {
    const { d, f } = deps();
    const r = await runViatorSearch({ city: "Roma", query: "Coliseo" }, d);
    expect(f.calls[1].body).toEqual({ searchTerm: "Coliseo", productFiltering: { destination: "511" }, searchTypes: [{ searchType: "PRODUCTS", pagination: { start: 1, count: 6 } }], currency: "MXN" });
    expect((r as any).results.map((t: any) => t.codigo)).toEqual(["12345P1"]);
  });
  it("otra moneda: el 'desde' en esa moneda y el equivalente en MXN solo con la tasa con fuente (nunca la de respaldo)", async () => {
    const usd = { ...PRODUCTS_SEARCH, products: [{ ...PRODUCT_COLISEO, pricing: { summary: { fromPrice: 60 }, currency: "USD" } }] };
    const fetchImpl = vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith("/products/search") ? usd : FREETEXT_DEST), { status: 200 })) as unknown as typeof fetch;
    const live = vi.fn(async () => ({ rate: 18.5, source: "frankfurter" as const, fetched_at: "2026-10-22T00:00:00Z", is_fallback: false }));
    const r = await runViatorSearch({ city: "Roma", currency: "USD" }, { fetchImpl, apiKey: KEY, fx: live, now: () => NOW });
    expect((r as any).results[0]).toMatchObject({ desde: { monto: 60, moneda: "USD" }, desde_mxn: { monto: 1110, fx_fuente: "Banco Central Europeo (frankfurter.app)", fx_fecha: "2026-10-22" } });
    const fallback = vi.fn(async () => ({ rate: 20.5, source: "fallback" as const, fetched_at: "2026-10-22T00:00:00Z", is_fallback: true }));
    const r2 = await runViatorSearch({ city: "Roma", currency: "USD" }, { fetchImpl, apiKey: KEY, fx: fallback, now: () => NOW });
    expect((r2 as any).results[0].desde_mxn).toBeUndefined();
  });
});

describe("4. caché privada de 6 h y cuota", () => {
  it("TTL viator_products = 6 h", () => expect(CACHE_TTL_SECONDS.viator_products).toBe(6 * 3600));
  it("la misma consulta sale de la caché: una sola búsqueda de la bolsa y ninguna llamada nueva", async () => {
    const { d, f, gate } = deps();
    await runViatorSearch({ city: "Roma", query: "Coliseo" }, d);
    const again = await runViatorSearch({ city: "roma", query: "coliseo" }, d);
    expect(again).toMatchObject({ ok: true, from_cache: true });
    expect(f.calls).toHaveLength(2);
    expect(gate).toHaveBeenCalledTimes(1);
    // Otra moneda u otra consulta = otra llave.
    await runViatorSearch({ city: "Roma", query: "Coliseo", currency: "EUR" }, d);
    expect(gate).toHaveBeenCalledTimes(2);
  });
  it("vencida (más de 6 h) ya no se sirve", async () => {
    const { d, f, store } = deps();
    await runViatorSearch({ city: "Roma" }, d);
    for (const row of store.rows.values()) row.fetched_at = new Date(NOW - 7 * 3600 * 1000).toISOString();
    const r = await runViatorSearch({ city: "Roma" }, d);
    expect(r).toMatchObject({ ok: true, from_cache: false });
    expect(f.calls).toHaveLength(4);
  });
  it("sin búsquedas en el plan: no llama a Viator y lo dice", async () => {
    const { d, f } = deps({ gate: async () => ({ allow: false, soft: false, info: { plan: "free" } }) });
    const r = await runViatorSearch({ city: "Roma" }, d);
    expect(r).toMatchObject({ ok: false, code: "FREE_LIMIT_REACHED", soft: false });
    expect(f.calls).toHaveLength(0);
    expect(prepareToolResultForModel("search_tours", r)).toMatchObject({ disponible: false, estado: "limite_del_plan" });
  });
  it("429 de Viator: devuelve la búsqueda a la bolsa y pausa (Retry-After) sin volver a llamar", async () => {
    const f = viatorFetch({ status: 429, retryAfter: "30" });
    const { d, refund } = deps({ fetchImpl: f.fetchImpl });
    const r = await runViatorSearch({ city: "Roma" }, d);
    expect(r).toMatchObject({ ok: false, code: "viator_ocupado" });
    expect(refund).toHaveBeenCalledTimes(1);
    await runViatorSearch({ city: "Lisboa" }, d);
    expect(f.calls).toHaveLength(1);
  });
});

describe("5. sin llave o llave aún no habilitada → mensaje honesto, nada se rompe", () => {
  it("sin VIATOR_API_KEY: viator_no_disponible y ninguna llamada", async () => {
    const { d, f } = deps({ apiKey: undefined });
    const r = await runViatorSearch({ city: "Roma" }, d);
    expect(r).toEqual({ ok: false, code: "viator_no_disponible", motivo: NO_DISPONIBLE_MOTIVO, error: "sin_llave" });
    expect(f.calls).toHaveLength(0);
  });
  it("401/403: viator_no_disponible, devuelve la bolsa y no reintenta en 15 min", async () => {
    for (const status of [401, 403]) {
      const f = viatorFetch({ status });
      const { d, refund } = deps({ fetchImpl: f.fetchImpl });
      expect(await runViatorSearch({ city: "Roma" }, d)).toMatchObject({ ok: false, code: "viator_no_disponible", error: "llave_no_habilitada" });
      expect(refund).toHaveBeenCalledTimes(1);
      expect(await runViatorSearch({ city: "Madrid" }, d)).toMatchObject({ code: "viator_no_disponible" });
      expect(f.calls).toHaveLength(1);
    }
  });
  it("Iato lo dice así y la pantalla también (con 'Buscar en Viator' de respaldo)", async () => {
    expect(prepareToolResultForModel("search_tours", { ok: false, code: "viator_no_disponible", motivo: NO_DISPONIBLE_MOTIVO }))
      .toMatchObject({ disponible: false, estado: "no_disponible", error: "viator_no_disponible", motivo: expect.stringMatching(/aún no están disponibles/) });
    expect(summarizeViator({ ok: false, code: "viator_no_disponible" })).toEqual({ ok: false, message: VIATOR_NO_DISPONIBLE });
    invoke.mockResolvedValueOnce({ data: { ok: false, code: "viator_no_disponible", motivo: NO_DISPONIBLE_MOTIVO }, error: null });
    render(<ViatorToursButton city="Roma" />);
    fireEvent.click(screen.getByTestId("viator-ver"));
    await waitFor(() => expect(screen.getByTestId("viator-sin")).toHaveTextContent("Los tours de Viator aún no están disponibles en IATOS"));
    expect(screen.getByRole("link", { name: /Buscar en Viator/ }).getAttribute("href")).toContain("pid=P00327354");
  });
});

describe("6. Iato no busca tours si no se los piden", () => {
  it("la herramienta existe y su descripción lo limita", () => {
    const def = TOOL_DEFS.find((t) => t.name === "search_tours")!;
    expect(def.input_schema.required).toEqual(["city"]);
    expect(def.description).toMatch(/SOLO cuando el usuario pida tours/);
  });
  it("detección y política", () => {
    for (const m of ["¿Qué tours hay en Roma?", "excursiones desde Cancún", "actividades para niños en Madrid", "paseo en barco en Lisboa", "una visita guiada al Vaticano"]) expect(toursRequested(m), m).toBe(true);
    for (const m of ["restaurantes cerca de mi hotel", "vuelos a París", "¿qué conciertos hay en Madrid?", "¿a qué hora abre el museo?"]) expect(toursRequested(m), m).toBe(false);
    expect(detectIntents("tours en Roma")).toContain("tours");
    expect(applyToolPolicy("search_tours", { city: "Roma" }, "cenar en Roma")).toMatchObject({ blocked: "tours_no_pedidos" });
    expect(applyToolPolicy("search_tours", { city: "Roma" }, "tours en Roma").blocked).toBeUndefined();
  });

  const steps: ProviderStep[] = [{ provider: "anthropic", model: "claude-sonnet-5-5", effort: "low", key: "anthropic:claude-sonnet-5-5" }];
  const usage = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  function turn(userMessage: string) {
    let call = 0;
    const callModel: ModelCaller = async () => {
      call += 1;
      if (call === 1) return { provider: "anthropic", model: "m", content: [], text: "", stopReason: "tool_use", usage, toolUses: [{ id: "t1", name: "search_tours", input: { city: "Roma" } }] };
      return { provider: "anthropic", model: "m", content: [], text: "Listo.", stopReason: "end_turn", usage, toolUses: [] };
    };
    const execTool = vi.fn(async () => ({ ok: true, fuente: "Viator", source: "viator", results: mapViatorProducts(PRODUCTS_SEARCH.products), consultado_at: "2026-10-23T15:04:00Z" }));
    const now = () => 0;
    return {
      execTool,
      run: () => runAgentTurn({
        chain: steps, callModel, breaker: new CircuitBreaker(now), cooldownMs: 1000, stableSystem: "s", dynamicSystem: "d",
        messages: [{ role: "user", content: userMessage }], tools: TOOL_DEFS, maxIterations: 3, maxTokens: 500, userMessage,
        execTool, prepare: (n, raw) => prepareToolResultForModel(n, raw), toolTimeoutMs: () => 5000,
        emit: { status: () => {}, delta: () => {}, reset: () => {} }, now, deadlineMs: 30_000,
      }),
    };
  }
  it("si el modelo la pide sin que el usuario pidiera tours, no se ejecuta (ni gasta)", async () => {
    const t = turn("recomiéndame un restaurante en Roma");
    const r = await t.run();
    expect(t.execTool).not.toHaveBeenCalled();
    expect(r.toolRuns).toHaveLength(0);
  });
  it("si los pidió, se ejecuta una vez", async () => {
    const t = turn("¿qué tours me recomiendas en Roma?");
    const r = await t.run();
    expect(t.execTool).toHaveBeenCalledTimes(1);
    expect(r.toolRuns.map((x) => x.name)).toEqual(["search_tours"]);
  });
});

describe("7. cards de tour y lista blanca", () => {
  const prepared = prepareToolResultForModel("search_tours", { ok: true, fuente: "Viator", source: "viator", results: mapViatorProducts(PRODUCTS_SEARCH.products), consultado_at: "2026-10-23T15:04:00Z" });
  const runs = [{ name: "search_tours", args: { city: "Roma" }, result: prepared }];
  const hhmm = new Date("2026-10-23T15:04:00Z").toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", hour12: false });

  it("las arma IATOS con el resultado; una card de tour del modelo se descarta", () => {
    const cards = tourCards(runs);
    expect(cards).toHaveLength(2);
    expect(cards[0]).toMatchObject({
      type: "tour", title: "Coliseo, Foro Romano y Palatino con guía", fuente: "viator", provider: "Viator", consultado_at: "2026-10-23T15:04:00Z",
      cta_label: "Ver en Viator", cta_action: PRODUCT_COLISEO.productUrl, price: 1234.5, currency: "MXN", price_basis: "desde", rating: 4.7, subtitle: "3 h",
    });
    const fromModel = validateCards([{ type: "tour", title: "Tour inventado", price: 50, cta_action: "https://www.viator.com/tours/x" }], collectEvidence(runs));
    expect(fromModel.cards).toHaveLength(0);
    expect(fromModel.dropped).toEqual([{ type: "tour", reason: "tour_solo_de_la_busqueda" }]);
    expect(tourCards([{ name: "search_tours", result: { disponible: false, motivo: "x" } }])).toEqual([]);
  });
  it("finalize: incluye las cards de tour del turno", () => {
    const out = finalizeTurn({
      raw: "Estos son algunos tours.", toolRuns: runs, plan: { cards: [], suggestedActions: [] },
      actionCtx: { todayISO: "2026-10-23", trips: [], activeTripId: null }, makeId: () => "a1", userMessage: "tours en Roma",
    } as any);
    expect(out.cards.filter((c) => c.type === "tour").map((c) => c.title)).toEqual(["Coliseo, Foro Romano y Palatino con guía", "Museos Vaticanos y Capilla Sixtina sin filas"]);
  });
  it("RichCard: 'Ver en Viator' con afiliado, 'desde $X MXN · consultado HH:MM', fuente; nunca 'Reservado'", () => {
    const { container } = render(<RichCard card={tourCards(runs)[0]} />);
    expect(container.querySelector('[data-card-type="tour"]')).not.toBeNull();
    const ver = screen.getByRole("link", { name: /Ver en Viator/ });
    expect(ver).toHaveAttribute("href", PRODUCT_COLISEO.productUrl);
    expect(ver).toHaveAttribute("target", "_blank");
    expect(screen.getByTestId("viator-tour-precio")).toHaveTextContent(`desde $1,235 MXN · consultado ${hhmm}`);
    expect(screen.getByTestId("viator-tour-fuente")).toHaveTextContent("Fuente: Viator");
    expect(container.textContent).not.toMatch(/reservado|comprado|confirmado/i);
  });
  it("Comprar / Tours: el botón explícito llama a viator-search y pinta las tarjetas", async () => {
    invoke.mockResolvedValueOnce({ data: { ok: true, fuente: "Viator", results: mapViatorProducts(PRODUCTS_SEARCH.products), consultado_at: "2026-10-23T15:04:00Z" }, error: null });
    render(<ViatorToursButton city="Roma" dateFrom="2026-11-02" dateTo="2026-11-06" />);
    expect(invoke).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Ver tours reales en Viator/ }));
    await waitFor(() => expect(screen.getAllByTestId("viator-tour")).toHaveLength(2));
    expect(invoke).toHaveBeenCalledWith("viator-search", { body: { city: "Roma", currency: "MXN", date_from: "2026-11-02", date_to: "2026-11-06" } });
    expect(screen.getByTestId("viator-fuente")).toHaveTextContent(`Fuente: Viator · consultado ${hhmm}`);
    const links = screen.getAllByRole("link", { name: /Ver en Viator/ });
    expect(links.every((a) => new URL(a.getAttribute("href")!).searchParams.get("mcid") === "42383")).toBe(true);
    expect(screen.getAllByTestId("viator-tour-precio")[1]).toHaveTextContent("desde $980 MXN");
  });
  it("lista blanca: viator.com/tours/… solo si viene del servidor; la búsqueda sigue permitida", () => {
    expect(checkAllowlisted(PRODUCT_COLISEO.productUrl)).toMatchObject({ ok: true, provider: { provider: "viator" } });
    expect(checkUntrusted(PRODUCT_COLISEO.productUrl)).toEqual({ ok: false, reason: "enlace_solo_del_servidor" });
    const search = "https://www.viator.com/searchResults/all?text=Roma&pid=P00327354&mcid=42383";
    expect(checkUntrusted(search).ok).toBe(true);
    expect(checkAllowlisted("https://www.viator.com/es-MX/otra-cosa").ok).toBe(false);
    // Un productUrl que no sea de viator.com no llega a la pantalla.
    expect(summarizeViator({ ok: true, results: [{ codigo: "x", title: "Falso", url: "https://evil.example/tours/x" }] })).toMatchObject({ ok: false });
  });
});
