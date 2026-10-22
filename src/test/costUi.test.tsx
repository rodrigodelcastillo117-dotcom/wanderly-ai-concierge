import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const env: Record<string, string> = {};
(globalThis as unknown as { Deno: unknown }).Deno = { env: { get: (k: string) => env[k] } };

const { invoke, rpc, fromRows } = vi.hoisted(() => ({ invoke: vi.fn(), rpc: vi.fn(), fromRows: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => {
  const chain = (table: string) => {
    const q: Record<string, unknown> = {};
    q.select = () => q;
    q.eq = () => q;
    q.order = () => q;
    q.limit = async () => ({ data: (fromRows[`${table}:list`] as unknown[]) ?? [] });
    q.maybeSingle = async () => ({ data: fromRows[table] ?? null });
    return q;
  };
  return { supabase: { from: chain, rpc: (...a: unknown[]) => rpc(...a), functions: { invoke: (...a: unknown[]) => invoke(...a) } } };
});
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));

import { collectEvidence, enforceAvailabilityHonesty, prepareToolResultForModel, validateCards } from "../../supabase/functions/concierge-chat/cards";
import { aiFetchDetailed } from "../../supabase/functions/_shared/ai";
import { ProvenanceBadge, RichCard } from "@/components/concierge/ConciergeCards";
import { FreeLimitDialog } from "@/components/FreeLimitDialog";
import { getFreeLimitDialog, closeFreeLimitDialog } from "@/lib/freeLimitStore";
import { PriceWatchCard } from "@/components/PriceWatchCard";
import { LiveTripQuote } from "@/components/LiveTripQuote";
import { AdminCostCard } from "@/components/AdminCostCard";

const limit402 = (body: Record<string, unknown>) => ({
  message: "Edge Function returned a non-2xx status code",
  context: new Response(JSON.stringify({ code: "FREE_LIMIT_REACHED", ...body }), { status: 402 }),
});

describe("Iato: precios de la caché y límite de búsquedas", () => {
  it("un precio guardado (uso justo) queda OBSOLETO con su fecha real, nunca 'en vivo'", () => {
    const result = prepareToolResultForModel("search_flights", {
      ok: true, source: "serpapi", disponible: true, consulted_at: "2026-10-21T08:00:00.000Z", estado_dato: "OBSOLETO", precio_guardado: true,
      results: [{ airline: "Iberia", price_usd: 812 }],
    });
    expect(String(result.nota_fuente)).toMatch(/GUARDADOS/);
    const ev = collectEvidence([{ name: "search_flights", result }]);
    const { cards } = validateCards([{ type: "flight", title: "Iberia", price_usd: 812, currency: "USD" }], ev, "2026-10-22T12:00:00.000Z");
    expect(cards[0]).toMatchObject({ estado_dato: "OBSOLETO", consultado_at: "2026-10-21T08:00:00.000Z", price_note: "precio guardado" });
  });

  it("un acierto vigente de la caché conserva la hora real de la consulta", () => {
    const result = prepareToolResultForModel("search_flights", {
      ok: true, source: "serpapi", consulted_at: "2026-10-22T09:00:00.000Z", estado_dato: "CONSULTADO_EN_VIVO", results: [{ price_usd: 640 }],
    });
    const { cards } = validateCards([{ type: "flight", title: "AM", price_usd: 640 }], collectEvidence([{ name: "search_flights", result }]), "2026-10-22T12:00:00.000Z");
    expect(cards[0]).toMatchObject({ estado_dato: "CONSULTADO_EN_VIVO", consultado_at: "2026-10-22T09:00:00.000Z" });
  });

  it("402 de búsquedas en vivo: la herramienta dice 'límite del plan' y la respuesta lo explica", () => {
    const result = prepareToolResultForModel("search_hotels", {
      code: "FREE_LIMIT_REACHED", quota: "live_searches_daily", ok: false, error: "http_402",
      message: "Usaste tus 5 búsquedas en vivo de hoy (vuelos y hoteles); se renuevan el 23 de octubre de 2026.",
    });
    expect(result).toMatchObject({ disponible: false, error: "limite_del_plan" });
    const text = enforceAvailabilityHonesty("Aquí van opciones.", collectEvidence([{ name: "search_hotels", result }]));
    expect(text).toMatch(/^Llegaste al límite de búsquedas en vivo de tu plan para hoteles/);
  });

  it("la tarjeta muestra 'Precio guardado' (no 'consultado en vivo')", () => {
    const card = { type: "flight" as const, title: "Iberia", price: 812, price_usd: 812, currency: "USD", fuente: "serpapi", estado_dato: "OBSOLETO" as const, consultado_at: "2026-10-21T08:00:00Z" };
    render(<ProvenanceBadge card={card} />);
    expect(screen.getByText(/Precio guardado/)).toBeInTheDocument();
    expect(screen.queryByText(/consultado en vivo/)).toBeNull();
    render(<RichCard card={card} />);
    expect(screen.getAllByText(/precio guardado/i).length).toBeGreaterThan(0);
  });
});

describe("aiFetchDetailed: quién respondió (para ai_usage_log)", () => {
  const fetchMock = vi.fn();
  beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); vi.spyOn(console, "warn").mockImplementation(() => {}); });
  afterEach(() => { vi.unstubAllGlobals(); delete env.GEMINI_API_KEY; });
  const init = { method: "POST", body: JSON.stringify({ model: "google/gemini-flash-latest", messages: [] }) };

  it("Gemini directo con su modelo; si falla, el gateway con el nombre que publica", async () => {
    env.GEMINI_API_KEY = "g";
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 200 }));
    expect(await aiFetchDetailed(init)).toMatchObject({ provider: "gemini", model: "gemini-flash-latest" });
    fetchMock.mockResolvedValueOnce(new Response("no", { status: 500 })).mockResolvedValueOnce(new Response("{}", { status: 200 }));
    expect(await aiFetchDetailed(init)).toMatchObject({ provider: "lovable", model: "google/gemini-2.5-flash" });
  });
});

describe("avisos de límite en la app", () => {
  beforeEach(() => { invoke.mockReset(); rpc.mockReset(); closeFreeLimitDialog(); for (const k of Object.keys(fromRows)) delete fromRows[k]; });

  it("FreeLimitDialog: títulos propios para alertas, vuelos y búsquedas", () => {
    const { rerender } = render(<FreeLimitDialog onClose={() => {}} onUpgrade={() => {}}
      info={{ quota: "price_watches_active", limit: 0, used: 0, renewsAt: null, upgradeAvailable: true }} />);
    expect(screen.getByText("Alertas de precio con IATOS PRO")).toBeInTheDocument();
    expect(screen.getByText("Conocer IATOS PRO")).toBeInTheDocument();
    rerender(<FreeLimitDialog onClose={() => {}} onUpgrade={() => {}}
      info={{ quota: "tracked_flights_active", limit: 4, used: 4, renewsAt: null, upgradeAvailable: false }} />);
    expect(screen.getByText("Llegaste al máximo de vuelos seguidos")).toBeInTheDocument();
    expect(screen.queryByText("Conocer IATOS PRO")).toBeNull();
    rerender(<FreeLimitDialog onClose={() => {}} onUpgrade={() => {}}
      info={{ quota: "live_searches_daily", limit: 5, used: 5, renewsAt: "2026-10-23T00:00:00Z", upgradeAvailable: true }} />);
    expect(screen.getByText("Usaste tus búsquedas en vivo")).toBeInTheDocument();
  });

  it("PriceWatchCard en FREE: 'Activar alerta' abre el diálogo de PRO, no un error técnico", async () => {
    const future = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
    invoke.mockResolvedValue({ data: null, error: limit402({ quota: "price_watches_active", limit: 0, used: 0, renews_at: null, upgrade_available: true }) });
    render(<PriceWatchCard tripId="t1" departureDate={future} />);
    expect(await screen.findByText("Vigila el precio de tus vuelos")).toBeInTheDocument();
    expect(screen.queryByText(/Gratis\./)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Activar alerta" }));
    await waitFor(() => expect(getFreeLimitDialog()?.quota).toBe("price_watches_active"));
    expect(toastMock.error).not.toHaveBeenCalled();
  });

  it("PriceWatchCard: misma tarifa en dólares con el dólar más barato no dice 'Bajó'", async () => {
    const future = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
    fromRows.price_watches = {
      id: "w1", trip_id: "t1", active: true, origin_iata: "MEX", destination_iata: "MAD", baseline_price_mxn: 10250,
      baseline_approximate: false, baseline_source: "travelpayouts", baseline_currency: "USD", baseline_amount_original: 500,
      last_amount_original: 500, last_price_mxn: 9450, lowest_price_mxn: 9450, last_checked_at: new Date().toISOString(), departure_date: future,
    };
    render(<PriceWatchCard tripId="t1" departureDate={future} />);
    expect(await screen.findByText("Vigilando tu vuelo MEX → MAD")).toBeInTheDocument();
    expect(screen.queryByText(/Bajó/)).toBeNull();
    expect(screen.getAllByText("$9,450")).toHaveLength(3);
    expect(screen.getByText(/comparado en USD, al tipo de cambio de hoy/)).toBeInTheDocument();
  });

  it("LiveTripQuote: muestra la cotización guardada como precio de hace X y solo actualiza al pedirlo", async () => {
    const saved = {
      flight: null, hotel: { name: "Hotel Real", nightly_usd: 200 }, breakdown: { flights_usd: 0, hotel_nightly_usd: 200, hotel_total_usd: 1000, nights: 5, buffer_usd: 0 },
      total_usd: 1000, total_mxn: 18900, source: "serpapi", fetched_at: "2026-10-19T10:00:00Z", estado_dato: "OBSOLETO", precio_guardado: true, cached: true, can_refresh: true,
    };
    invoke.mockResolvedValueOnce({ data: saved, error: null });
    render(<LiveTripQuote tripId="t1" origin="CDMX" destination="Roma" depart="2026-11-10" return_date="2026-11-15" nights={5} travelers={1} fallbackMxn={0} />);
    const btn = await screen.findByRole("button", { name: /Actualizar precio/ });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls[0][1].body).toMatchObject({ trip_id: "t1", refresh: false });
    expect(document.querySelector('[data-estado="OBSOLETO"]')).not.toBeNull();
    invoke.mockResolvedValueOnce({ data: null, error: limit402({ quota: "live_searches_daily", limit: 5, used: 5, renews_at: "2026-10-23T00:00:00Z", upgrade_available: true }) });
    fireEvent.click(btn);
    await waitFor(() => expect(getFreeLimitDialog()?.quota).toBe("live_searches_daily"));
    expect(invoke.mock.calls[1][1].body).toMatchObject({ trip_id: "t1", refresh: true });
  });

  it("AdminCostCard: costo de 30 días por plan y por función", async () => {
    rpc.mockResolvedValue({
      data: {
        generated_at: "2026-10-22T12:00:00Z", days: 30, total: { cost_usd: 3.4567, calls: 120, searches: 80, users: 6 },
        by_plan: [{ plan: "free", cost_usd: 1.2, calls: 50, searches: 40, users: 4 }, { plan: "pro", cost_usd: 2.25, calls: 70, searches: 40, users: 2 }],
        by_function: [{ function: "analizar-viaje", provider: "anthropic", cost_usd: 1.5, calls: 12, searches: 0, input_tokens: 1, output_tokens: 1 }],
        cache: { entries: 30, hits: 45 },
      },
      error: null,
    });
    render(<AdminCostCard />);
    expect(await screen.findByText("US$3.46")).toBeInTheDocument();
    expect(rpc).toHaveBeenCalledWith("admin_cost_metrics", { _days: 30 });
    expect(screen.getByText("Gratis")).toBeInTheDocument();
    expect(screen.getByText("US$2.25")).toBeInTheDocument();
    expect(screen.getByText(/analizar-viaje/)).toBeInTheDocument();
    expect(screen.getByText("45")).toBeInTheDocument();
  });

  it("AdminCostCard: si la RPC niega o falta, no rompe la página", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "not_authorized" } });
    render(<AdminCostCard />);
    expect(await screen.findByText(/No pudimos cargar el costo/)).toBeInTheDocument();
  });
});
