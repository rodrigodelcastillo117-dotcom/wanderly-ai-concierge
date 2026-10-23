// Precio verificable (rama claude/precio-verificable): frescura determinista del precio, vuelo
// redondo completo (departure_token → regresos → booking_token → booking_options), "Actualizar
// precio" con aceptación de la diferencia, alcance del precio de hotel y candado de web_search.
// Todo con fixtures: ninguna llamada real a SerpApi.
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { EN_VIVO_MAX_MINUTES, frescuraPrecio } from "../../supabase/functions/_shared/priceFreshness";
import { finalizeSearchResponse } from "../../supabase/functions/_shared/liveSearch";
import { createSerpFetch, memoryCacheStore, type SerpTrace } from "../../supabase/functions/_shared/serpCache";
import { searchFlights } from "../../supabase/functions/flights-search/search";
import { hotelResult } from "../../supabase/functions/hotels-search/search";
import { recheckFlight, type RecheckResult } from "../../supabase/functions/_shared/booking/recheck";
import { type BridgeDeps, handleBridge } from "../../supabase/functions/booking-bridge/handler";
import { collectEvidence, prepareToolResultForModel, validateCards } from "../../supabase/functions/concierge-chat/cards";
import { ProvenanceBadge, sourceLabel } from "@/components/concierge/ConciergeCards";
import { priceChangeText } from "@/components/booking/BookingSheet";

const NOW = Date.parse("2026-10-23T12:00:00Z");
const minAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();

describe("frescura del precio (determinista)", () => {
  it("en_vivo solo ≤ 15 min; caché vigente con su antigüedad; obsoleto pasada la vigencia; estimado", () => {
    expect(frescuraPrecio({ consultadoAt: minAgo(EN_VIVO_MAX_MINUTES) }, NOW)).toMatchObject({ frescura: "en_vivo", etiqueta: "Consultado en vivo" });
    expect(frescuraPrecio({ consultadoAt: minAgo(180) }, NOW)).toMatchObject({ frescura: "cache", etiqueta: "Consultado hace 3 h" });
    expect(frescuraPrecio({ consultadoAt: minAgo(7 * 60), vigenciaHoras: 6 }, NOW)).toMatchObject({ frescura: "obsoleto" });
    expect(frescuraPrecio({ consultadoAt: minAgo(5), estado: "OBSOLETO" }, NOW).frescura).toBe("obsoleto");
    expect(frescuraPrecio({ consultadoAt: null }, NOW).frescura).toBe("obsoleto");
    expect(frescuraPrecio({ consultadoAt: minAgo(1), estado: "ESTIMADO" }, NOW).frescura).toBe("estimado");
    expect(frescuraPrecio({ consultadoAt: minAgo(-60) }, NOW).frescura).toBe("obsoleto"); // fecha en el futuro
  });

  it("flights-search: una respuesta de la caché de hace 3 h sale 'cache', nunca 'en vivo'", () => {
    const trace: SerpTrace = { live: 0, hits: 1, stale: 0, denied: null, oldestFetchedAt: minAgo(180) };
    const out = finalizeSearchResponse({ status: 200, body: { ok: true, source: "serpapi", results: [{ price_usd: 900 }] } }, trace, NOW);
    expect(out.body).toMatchObject({ estado_dato: "CONSULTADO_EN_VIVO", frescura: "cache", etiqueta_frescura: "Consultado hace 3 h" });
    expect((out.body.results as any[])[0]).toMatchObject({ frescura: "cache", consultado_at: minAgo(180) });
    const live = finalizeSearchResponse({ status: 200, body: { ok: true, source: "serpapi", results: [{ price_usd: 900 }] } },
      { live: 1, hits: 0, stale: 0, denied: null, oldestFetchedAt: new Date(NOW).toISOString() }, NOW);
    expect(live.body.frescura).toBe("en_vivo");
  });

  it("Iato recibe la nota 'no digas en vivo' para precios de la caché", () => {
    const r = prepareToolResultForModel("search_flights", { ok: true, source: "serpapi", results: [{ airline: "Iberia", price_usd: 900 }],
      frescura: "cache", etiqueta_frescura: "Consultado hace 3 h" });
    expect(String(r.nota_fuente)).toMatch(/no digas "en vivo"/);
  });

  it("card de Iato: 'consultado en vivo' solo con consulta reciente (E2E 23-oct: salía con la hora de hace horas)", () => {
    const base = { type: "flight" as const, title: "Iberia", price: 900, price_usd: 900, currency: "USD", estado_dato: "CONSULTADO_EN_VIVO" as const, fuente: "serpapi" };
    expect(sourceLabel({ ...base, consultado_at: minAgo(5) }, NOW)).toBe("Google Flights · consultado en vivo");
    expect(sourceLabel({ ...base, consultado_at: minAgo(180) }, NOW)).toBe("Google Flights · consultado hace 3 h");
    render(<ProvenanceBadge card={{ ...base, consultado_at: new Date(Date.now() - 3 * 3600_000).toISOString() }} />);
    expect(screen.getByText(/Google Flights · consultado hace 3 h/)).toBeInTheDocument();
    expect(screen.queryByText(/en vivo/)).toBeNull();
  });
});

// ─── Vuelo redondo completo con fixtures de SerpApi ───
const OUTBOUND = { best_flights: [{ price: 1850, total_duration: 660, departure_token: "DEP_TOKEN_1",
  flights: [{ airline: "Iberia", flight_number: "IB 6400", departure_airport: { id: "MEX", time: "2026-12-05 07:00" }, arrival_airport: { id: "MAD", time: "2026-12-06 01:00" }, duration: 660 }] }] };
const RETURNS = { best_flights: [{ price: 1850, total_duration: 690, booking_token: "BOOK_TOKEN_1",
  flights: [{ airline: "Iberia", flight_number: "IB 6403", departure_airport: { id: "MAD", time: "2026-12-12 12:00" }, arrival_airport: { id: "MEX", time: "2026-12-12 17:30" }, duration: 690 }] }] };
const BOOKING_OPTIONS = { booking_options: [
  { together: { book_with: "Iberia", price: 1990, booking_request: { url: "https://www.google.com/travel/clk/f", post_data: "u=abc&tfu=xyz" } } },
  { separate_tickets: true, departing: { book_with: "X" } },
] };

function fixtureFetch(calls: URL[]) {
  return (async (input: string | URL) => {
    const u = new URL(String(input));
    calls.push(u);
    const json = u.searchParams.get("booking_token") ? BOOKING_OPTIONS : u.searchParams.get("departure_token") ? RETURNS : OUTBOUND;
    return new Response(JSON.stringify(json), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

describe("vuelo redondo: ida → regreso (departure_token) → opciones de compra (booking_token)", () => {
  const body = { origin: "MEX", destination: "MAD", depart: "2026-12-05", return_date: "2026-12-12", travelers: 2, type: "round" };

  it("la ida trae departure_token; con él se piden SUS regresos, cada uno con booking_token", async () => {
    const calls: URL[] = [];
    const ida = await searchFlights(body, { serpKey: "k", serpFetch: fixtureFetch(calls) });
    const r0 = (ida.body.results as any[])[0];
    expect(r0).toMatchObject({ departure_token: "DEP_TOKEN_1", booking_token: null, tramo: "ida" });
    expect(r0.tramos).toMatch(/elige el regreso/);

    const vuelta = await searchFlights({ ...body, departure_token: r0.departure_token }, { serpKey: "k", tpToken: "tp", serpFetch: fixtureFetch(calls) });
    expect(calls[1].searchParams.get("departure_token")).toBe("DEP_TOKEN_1");
    expect(calls[1].searchParams.get("return_date")).toBe("2026-12-12");
    const r1 = (vuelta.body.results as any[])[0];
    expect(r1).toMatchObject({ booking_token: "BOOK_TOKEN_1", tramo: "regreso", departure: { id: "MAD" } });
    expect((vuelta.body.meta as any).leg).toBe("return");
    // Ningún otro fetch (Travelpayouts no aplica al paso del regreso).
    expect(calls.every((c) => c.hostname === "serpapi.com")).toBe(true);
  });

  it("departure_token sin viaje redondo → 400 (no se gasta búsqueda)", async () => {
    const calls: URL[] = [];
    const r = await searchFlights({ ...body, type: "oneway", return_date: null, departure_token: "x" }, { serpKey: "k", serpFetch: fixtureFetch(calls) });
    expect(r.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("Comprobar precio salta la caché pero respeta la bolsa del plan (gate)", async () => {
    const calls: URL[] = [];
    const store = memoryCacheStore(() => NOW);
    let gateCalls = 0;
    const allow = createSerpFetch({ store, fetchImpl: fixtureFetch(calls), gate: async () => { gateCalls++; return { allow: true }; }, now: () => NOW });
    const q = { booking_token: "BOOK_TOKEN_1", origin: "MEX", destination: "MAD", depart: "2026-12-05", return_date: "2026-12-12", adults: 2, old_price: 1850 };
    const r1 = await recheckFlight(q, { serpKey: "k", serpFetch: allow.fetch, now: () => NOW });
    const r2 = await recheckFlight(q, { serpKey: "k", serpFetch: allow.fetch, now: () => NOW });
    expect(calls.map((c) => c.searchParams.get("no_cache"))).toEqual(["true", "true"]);
    expect(gateCalls).toBe(2); // dos consultas reales, nunca la caché
    expect(r1.ok && r2.ok && r1.cached).toBe(false);
    expect(r1).toMatchObject({ ok: true, price: 1990, price_change: { changed: true, direction: "up", delta: 140 } });
    // Boletos separados no son UNA compra exacta.
    expect((r1 as any).options).toHaveLength(1);
    const deny = createSerpFetch({ store, fetchImpl: fixtureFetch(calls), gate: async () => ({ allow: false, soft: false }), now: () => NOW });
    expect(await recheckFlight(q, { serpKey: "k", serpFetch: deny.fetch })).toMatchObject({ ok: false, code: "LIVE_LIMIT" });
  });
});

// ─── booking-bridge: "Actualizar precio" con aceptación y bandera BOOKING_EXACT_FLIGHT_FORM ───
const SRC = { type: "flight_result", result: { airline: "Iberia", price_usd: 1850, stops: 0, booking_token: "BOOK_TOKEN_1",
  departure: { id: "MAD", time: "2026-12-12 12:00" }, arrival: { id: "MEX", time: "2026-12-12 17:30" } },
  meta: { dep_iata: "MEX", arr_iata: "MAD", depart: "2026-12-05", return_date: "2026-12-12", travelers: 2, consulted_at: minAgo(10), source: "serpapi" } };
const INTENT = "11111111-1111-4111-8111-111111111111";

function deps(recheck: RecheckResult, flags: BridgeDeps["flags"] = {}) {
  const transitions: any[] = [];
  const d: BridgeDeps = {
    userId: "u1", userLabel: "u1", flags, now: () => NOW,
    loadTrip: async () => null, venueLookup: async () => null,
    rpc: (async (fn: string, args: any) => {
      if (fn === "booking_intent_transition") { transitions.push(args); return { data: { ok: true, intent: { id: args._id, state: args._to, redirect_count: 0 } }, error: null }; }
      return { data: null, error: { message: "no" } };
    }) as any,
    userRpc: (async () => ({ data: null, error: null })) as any,
    listIntents: async () => [], createAssistRequest: async () => null, notifyTeam: async () => true, tripDocumentOk: async () => false,
    recheckFlight: async () => recheck, recheckHotel: async () => recheck,
    goUrl: async () => "https://x.supabase.co/functions/v1/booking-go?t=firmado",
    intentTarget: async () => ({ target_url: "https://www.aviasales.com/search/MEX0512MAD12122", action_trust: "builder" }),
  };
  return { d, transitions };
}
const okRecheck = (price: number, changed: boolean): RecheckResult => ({
  ok: true, checked_at: new Date(NOW).toISOString(), availability: "available_at_check", price, currency: "USD", room_match: "not_selected", cached: false,
  options: [{ seller: "Iberia", price, currency: "USD", form: { action: "https://www.google.com/travel/clk/f", fields: [["u", "abc"]] } }],
  price_change: changed ? { changed: true, direction: "up", old: 1850, new: price, delta: price - 1850, pct: 7.6 } : { changed: false, direction: "same", old: 1850, new: price, delta: 0, pct: 0 },
});

describe("booking-bridge recheck_price", () => {
  it("precio cambió: queda PRICE_RECHECK_REQUIRED, sin enlace de salida, hasta aceptar la diferencia", async () => {
    const { d, transitions } = deps(okRecheck(1990, true));
    const r = await handleBridge("recheck_price", { source: SRC, intent_id: INTENT }, d);
    expect(r.body).toMatchObject({ needs_price_ack: true, go_url: null, intent: { state: "PRICE_RECHECK_REQUIRED" } });
    expect(transitions[0]).toMatchObject({ _to: "PRICE_RECHECK_REQUIRED", _patch: { price: 1990 } });
    const a = await handleBridge("confirm_price_ack", { intent_id: INTENT, accepted_price: 1990, currency: "USD" }, d);
    expect(a.status).toBe(200);
    expect(transitions[1]).toMatchObject({ _to: "READY_TO_BOOK", _note: "Aceptó el precio actualizado: 1990 USD" });
  });

  it("precio igual: READY_TO_BOOK y ya trae la salida firmada", async () => {
    const { d } = deps(okRecheck(1850, false));
    const r = await handleBridge("recheck_price", { source: SRC, intent_id: INTENT }, d);
    expect(r.body).toMatchObject({ needs_price_ack: false, intent: { state: "READY_TO_BOOK" }, go_url: expect.stringContaining("booking-go") });
  });

  it("bandera BOOKING_EXACT_FLIGHT_FORM apagada: el formulario booking_request no llega al cliente", async () => {
    const off = await handleBridge("recheck_price", { source: SRC }, deps(okRecheck(1850, false)).d);
    expect((off.body.recheck as any).options[0].form).toBeNull();
    const on = await handleBridge("recheck_price", { source: SRC }, deps(okRecheck(1850, false), { exact_flight_form: true }).d);
    expect((on.body.recheck as any).options[0].form).toMatchObject({ action: "https://www.google.com/travel/clk/f" });
  });

  it("texto de la diferencia que ve el usuario", () => {
    expect(priceChangeText({ changed: true, direction: "up", old: 1850, new: 1990, delta: 140, pct: 7.6 }, "USD", 1990))
      .toBe("El precio subió: antes $1,850 USD, ahora $1,990 USD (+$140 USD, +7.6 %).");
    expect(priceChangeText({ changed: false, direction: "same", old: 1850, new: 1850, delta: 0, pct: 0 }, "USD", 1850)).toMatch(/confirmado ahora/);
  });
});

describe("hoteles: a qué corresponde el precio", () => {
  it("total = estancia completa de esas fechas y ocupantes; no se afirma un número de habitaciones", () => {
    const p = { name: "Hotel Urban", rate_per_night: { extracted_lowest: 200 }, total_rate: { extracted_lowest: 430 } };
    const h = hotelResult(p, 200, 430, 2, "Madrid", "2026-12-05", "2026-12-07", 3, "m");
    expect(h).toMatchObject({ nightly_usd: 200, total_usd: 430, nights: 2, precio_para: { checkin: "2026-12-05", checkout: "2026-12-07", noches: 2, adultos: 3, habitaciones: null } });
    expect(h.nota_precio).toMatch(/estancia completa: 2 noches .* 3 adultos, con impuestos/);
    const calc = hotelResult({ name: "H" }, 150, 0, 3, "Madrid", "2026-12-05", "2026-12-08", 2, "m");
    expect(calc).toMatchObject({ total_usd: 450, total_calculado: true });
    expect(calc.nota_precio).toMatch(/noche × noches/);
  });
});

describe("Iato: un resultado web nunca es tarifa verificada", () => {
  it("un precio que solo aparece en web_search queda NO_VERIFICADO", () => {
    const ev = collectEvidence([
      { name: "web_search", result: { source: "google", results: [{ title: "Hotel Urban desde 430 USD", snippet: "430", link: "https://hotelurban.com", price: 430, price_usd: 430 }] } },
      { name: "search_hotels", result: { source: "serpapi", results: [{ name: "Otro hotel", total_usd: 999 }] } },
    ]);
    const out = validateCards([{ type: "hotel", title: "Hotel Urban", price: 430, currency: "USD" }], ev);
    expect(out.cards[0]).toMatchObject({ estado_dato: "NO_VERIFICADO" });
    expect(out.cards[0].fuente).toBeUndefined();
  });
});
