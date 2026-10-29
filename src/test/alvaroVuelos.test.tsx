// Caso Álvaro (feedback real, 28-oct-2026), puntos 4 y 7:
//  4. "No logré cotizar los vuelos, más que para México en fechas cercanas; todos los demás me decían
//     que checara en Google Flights". Causa: el tope diario de SerpApi se acabó (búsquedas de hoteles y
//     de la cuenta de auditoría) y "India" / "beijin" no resolvían a aeropuerto.
//  7. "En la India o en Oaxaca quiero a alguien que me maneje": solo había "Renta de auto".
// Datos simulados, respuestas grabadas; sin red.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const env: Record<string, string> = {};
(globalThis as unknown as { Deno: unknown }).Deno = { env: { get: (k: string) => env[k] } };

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: { user: { id: "u1" } } } }) },
    functions: { invoke: invokeMock },
    from: () => ({ insert: () => ({ then: (r: any) => r({ error: null }) }) }),
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import flightsFixture from "./fixtures/googlemax/serp_flights_round.json";
import { mainAirport, nearestAirport, resolveFlightPlace } from "../../supabase/functions/_shared/airports";
import { tripFlightRoute } from "../../supabase/functions/_shared/booking/tripRoute";
import { createSerpFetch, memoryCacheStore } from "../../supabase/functions/_shared/serpCache";
import { flightsReserve, makeAccountBrake } from "../../supabase/functions/_shared/serpBrake";
import { searchFlights } from "../../supabase/functions/flights-search/search";
import { groupedPricesUrl, travelpayoutsReference } from "../../supabase/functions/_shared/tpReference";
import { annotateNoLivePrice, noLivePriceReason } from "../../supabase/functions/_shared/flightNoPrice";
import { flightNoLiveInfo, liveQuoteOutcome } from "@/lib/flightLiveQuote";
import { FlightLiveQuote } from "@/components/booking/FlightLiveQuote";
import { driverOption } from "@/lib/driverService";
import { buildBuyFlow } from "@/lib/buyFlow";
import { DriverService } from "@/components/booking/DriverService";
import { FIXER_RULE } from "../../supabase/functions/concierge-chat/prompt";
import { validateAction } from "../../supabase/functions/concierge-chat/actions";

const NOW = Date.parse("2026-10-28T23:14:00Z");
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

beforeEach(() => { invokeMock.mockReset(); });

describe("4a · destinos mal escritos o país → aeropuerto principal (o se pide la ciudad)", () => {
  it("India, China, Japón, Perú, 'beijin', 'Pekín', 'Oaxaca de Juárez' y una ruta resuelven a su aeropuerto", () => {
    expect(mainAirport("India")).toBe("DEL");
    expect(mainAirport("beijin")).toBe("PEK");
    expect(mainAirport("Pekín")).toBe("PEK");
    expect(mainAirport("Beijing")).toBe("PEK");
    expect(mainAirport("China")).toBe("PEK");
    expect(mainAirport("Japón")).toBe("HND");
    expect(mainAirport("Perú")).toBe("LIM");
    expect(mainAirport("Oaxaca de Juárez")).toBe("OAX");
    expect(mainAirport("Tokio y Kioto")).toBe("HND");
    expect(mainAirport("Delhi - Agra - Jaipur")).toBe("DEL");
    const r = resolveFlightPlace("beijin");
    expect(r).toMatchObject({ ok: true, airport: "PEK", city: "Pekín", via: "aproximado" });
    expect((r as any).note).toContain('"beijin"');
    expect(resolveFlightPlace("India")).toMatchObject({ ok: true, airport: "DEL", via: "pais" });
  });

  it("país sin una sola entrada: se pide la ciudad; nunca se inventa un código", () => {
    expect(mainAirport("Estados Unidos")).toBeNull();
    expect(resolveFlightPlace("Estados Unidos")).toMatchObject({ ok: false, reason: "pais_sin_ciudad", question: expect.stringContaining("¿A qué ciudad de Estados Unidos vas?") });
    expect(resolveFlightPlace("Zzyzx Qwerty")).toMatchObject({ ok: false, reason: "desconocido" });
  });

  it("el fuzzy es acotado: nombres cortos no se adivinan, un lugar sin aeropuerto sigue con su aeropuerto cercano y Génova no es Ginebra", () => {
    expect(mainAirport("Bari")).toBeNull(); // no es Bali
    expect(mainAirport("Siena")).toBeNull(); // no es Viena
    expect(nearestAirport("Siena")?.airport).toBe("FLR");
    expect(mainAirport("Genova")).toBe("GOA");
    expect(mainAirport("Sienna")).toBeNull(); // el más cercano es un lugar sin aeropuerto: no se adivina
  });

  it("la ruta del viaje guardado (India, 'beijin') ya tiene aeropuerto de llegada", () => {
    expect(tripFlightRoute({ destino: "India", ciudad_origen: "Ciudad de México", fecha_salida: "2027-09-24", fecha_regreso: "2027-10-10", num_viajeros: 8 }))
      .toMatchObject({ origin: "MEX", destination: "DEL", missing: [] });
    expect(tripFlightRoute({ destino: "beijin", ciudad_origen: "Ciudad de México" }).destination).toBe("PEK");
  });

  it("flights-search con 'beijin' busca MEX→PEK en Google Flights y dice qué destino buscó", async () => {
    const impl = vi.fn(async () => json(flightsFixture));
    const serp = createSerpFetch({ store: memoryCacheStore(() => NOW), fetchImpl: impl as unknown as typeof fetch, now: () => NOW });
    const r = await searchFlights({ origin: "Ciudad de México", destination: "beijin", depart: "2026-11-11", return_date: "2026-11-16", travelers: 2, type: "round" },
      { serpKey: "s", serpFetch: serp.fetch });
    const u = new URL(String((impl.mock.calls[0] as unknown[])[0]));
    expect(u.searchParams.get("departure_id")).toBe("MEX");
    expect(u.searchParams.get("arrival_id")).toBe("PEK");
    expect(r.body.destino_nota).toContain("Pekín (PEK)");
  });

  it("flights-search con un país ambiguo responde no_iata con la pregunta para la persona", async () => {
    const r = await searchFlights({ origin: "Ciudad de México", destination: "Estados Unidos", depart: "2026-11-11", travelers: 1 }, { serpKey: "s" });
    expect(r.status).toBe(400);
    expect(r.body).toMatchObject({ error: "no_iata", motivo_codigo: "ciudad_no_reconocida" });
    expect(String(r.body.motivo_detalle)).toContain("Estados Unidos");
  });
});

describe("4b · los vuelos tienen prioridad cuando queda poco del tope diario", () => {
  it("reserva: 20 % del tope (mínimo 2) o la configurada", () => {
    expect(flightsReserve(25)).toBe(5);
    expect(flightsReserve(10)).toBe(2);
    expect(flightsReserve(25, 3)).toBe(3);
    expect(flightsReserve(null)).toBe(0);
  });

  it("con 20 de 25 usadas, hoteles/cron se detienen y los vuelos siguen; con 25, todo se detiene", async () => {
    let used = 20;
    const deps = { store: null, dailyBudget: 25, used: async () => used, now: () => NOW };
    expect(await makeAccountBrake({ ...deps }).paused()).toBe("budget"); // normal (hoteles)
    expect(await makeAccountBrake({ ...deps, priority: "vuelos" }).paused()).toBeNull();
    used = 25;
    expect(await makeAccountBrake({ ...deps, priority: "vuelos" }).paused()).toBe("budget");
    used = 19;
    expect(await makeAccountBrake({ ...deps }).paused()).toBeNull();
  });

  it("caché compartida: el mismo origen-destino-fechas no gasta dos veces (análisis y luego la persona)", async () => {
    const store = memoryCacheStore(() => NOW);
    const impl = vi.fn(async () => json(flightsFixture));
    const onLive = vi.fn();
    const body = { origin: "Ciudad de México", destination: "Oaxaca de Juárez", depart: "2026-10-30", return_date: "2026-11-01", travelers: 2, type: "round" };
    const analysis = createSerpFetch({ store, fetchImpl: impl as unknown as typeof fetch, now: () => NOW, onLive, inflight: new Map() });
    const gate = vi.fn(async () => ({ allow: true as const }));
    const user = createSerpFetch({ store, gate, fetchImpl: impl as unknown as typeof fetch, now: () => NOW, onLive, inflight: new Map() });
    const a = await searchFlights(body, { serpKey: "s", serpFetch: analysis.fetch });
    const b = await searchFlights({ ...body, origin: "CDMX" }, { serpKey: "s", serpFetch: user.fetch });
    expect(a.body.source).toBe("serpapi");
    expect(b.body.source).toBe("serpapi");
    expect(impl).toHaveBeenCalledTimes(1);
    expect(onLive).toHaveBeenCalledTimes(1);
    expect(gate).not.toHaveBeenCalled(); // un acierto de caché no gasta la bolsa del usuario
    expect(user.trace.hits).toBe(1);
  });
});

describe("4c · Travelpayouts: tarifa de referencia para rutas o fechas lejanas (respuestas grabadas, NO VERIFICADO EN VIVO)", () => {
  const MONTHS = { success: true, data: {
    "2026-12": { origin: "MEX", destination: "BJS", origin_airport: "MEX", destination_airport: "PEK", price: 1180, airline: "AM", transfers: 1,
      departure_at: "2026-12-03T23:55:00-06:00", return_at: "2026-12-14T15:10:00+08:00", link: "/search/MEX0312BJS14121?t=AM1" },
    "2026-11": { origin: "MEX", destination: "BUH", origin_airport: "MEX", destination_airport: "OTP", price: 400, airline: "Y4", transfers: 2,
      departure_at: "2026-11-12T10:00:00-06:00", return_at: "2026-11-20T10:00:00+02:00", link: "/search/MEX1211BUH20111" },
  } };

  it("URL documentada de grouped_prices (group_by, fechas, moneda)", () => {
    const u = new URL(groupedPricesUrl({ origin: "MEX", destination: "BJS", groupBy: "departure_at", departureAt: "2026-11", returnAt: "2026-11", token: "T" }));
    expect(u.origin + u.pathname).toBe("https://api.travelpayouts.com/aviasales/v3/grouped_prices");
    expect(Object.fromEntries(u.searchParams)).toMatchObject({ origin: "MEX", destination: "BJS", group_by: "departure_at", departure_at: "2026-11", return_at: "2026-11", currency: "usd" });
  });

  it("sin tarifas del mes: la del mes más cercano de ESTA ruta (nunca la de Bucarest), con su fecha, fuente y 'estimado'", async () => {
    const calls: string[] = [];
    const impl = vi.fn(async (url: string) => {
      calls.push(String(url));
      return String(url).includes("group_by=month") ? json(MONTHS) : json({ success: true, data: {} });
    });
    const r = await travelpayoutsReference({ origin: "MEX", destination: "BJS", depart: "2026-11-11", ret: "2026-11-16", destinationCity: "beijin" }, "T", "533299",
      { fetchImpl: impl as unknown as typeof fetch, now: () => NOW });
    expect(calls).toHaveLength(2);
    expect(r).toMatchObject({ precio_usd_pp: 1180, salida: "2026-12-03", regreso: "2026-12-14", ida_y_vuelta: true, mismo_mes: false, fuente: "travelpayouts", estado_dato: "ESTIMADO",
      consultado_at: new Date(NOW).toISOString(), link: "https://www.aviasales.com/search/MEX0312BJS14121?t=AM1&marker=533299" });
    expect(r!.etiqueta).toMatch(/búsquedas recientes en Aviasales: ida y vuelta, salida 3 dic 2026 \(no hay tarifa para nov 2026: es de otro mes\)\. No es precio en vivo/);
  });

  it("con tarifas por día del mes: el día más cercano a la salida", async () => {
    const days = { success: true, data: {
      "2026-11-02": { origin: "MEX", destination: "BJS", price: 990, departure_at: "2026-11-02T10:00:00-06:00", return_at: "2026-11-09T10:00:00+08:00" },
      "2026-11-12": { origin: "MEX", destination: "BJS", price: 1250, departure_at: "2026-11-12T10:00:00-06:00", return_at: "2026-11-17T10:00:00+08:00" },
    } };
    const r = await travelpayoutsReference({ origin: "MEX", destination: "BJS", depart: "2026-11-11", ret: "2026-11-16" }, "T", "m",
      { fetchImpl: (async () => json(days)) as unknown as typeof fetch, now: () => NOW });
    expect(r).toMatchObject({ precio_usd_pp: 1250, salida: "2026-11-12", mismo_mes: true });
  });

  it("flights-search sin vuelos: devuelve la referencia aparte (no como vuelo comprable)", async () => {
    const tp = vi.fn(async (url: string) => (String(url).includes("group_by=month") ? json(MONTHS) : json({ success: true, data: {} })));
    const r = await searchFlights({ origin: "MEX", destination: "beijin", depart: "2026-11-11", return_date: "2026-11-16", travelers: 2, type: "round" },
      { tpToken: "T", tpFetch: tp as unknown as typeof fetch });
    expect(r.body).toMatchObject({ disponible: false, results: [] });
    expect(r.body.tarifa_referencia).toMatchObject({ precio_usd_pp: 1180, fuente: "travelpayouts" });
  });
});

describe("4d · mensaje honesto y 'Consultar precio en vivo'", () => {
  it("el motivo depende de lo que pasó: tope del día, pausa, ciudad no reconocida, sin resultados", () => {
    expect(noLivePriceReason({ ok: true, source: "none", results: [], pausa: "budget", busquedas_en_pausa: true })?.texto).toMatch(/^Hoy ya se usaron las búsquedas de precios en vivo/);
    expect(noLivePriceReason({ ok: true, source: "none", results: [], pausa: "quota" })?.codigo).toBe("busquedas_en_pausa");
    expect(noLivePriceReason({ ok: false, error: "no_iata", motivo_detalle: "¿A qué ciudad de Estados Unidos vas?" })).toEqual({ codigo: "ciudad_no_reconocida", texto: "¿A qué ciudad de Estados Unidos vas?" });
    expect(noLivePriceReason({ ok: true, source: "none", results: [], fallas: ["google_flights_sin_resultados"] })?.codigo).toBe("sin_resultados");
    expect(noLivePriceReason({ ok: true, source: "serpapi", results: [{ price_usd: 1 }] })).toBeNull();
  });

  it("el análisis marca solo los vuelos estimados (no el autobús ni una tarifa real)", () => {
    const out = annotateNoLivePrice([
      { tier: "ahorro", aerolinea: "Aerolínea por confirmar", fuente_precio: "estimado", estado_dato: "ESTIMADO" },
      { tier: "equilibrio", aerolinea: "AM", fuente_precio: "travelpayouts" },
      { tier: "premium", modo: "autobus", fuente_precio: "estimado" },
    ], { reason: { codigo: "busquedas_agotadas_hoy", texto: "Hoy ya…" }, destinoNota: "India es un país…" });
    expect(out[0]).toMatchObject({ sin_precio_vivo: { codigo: "busquedas_agotadas_hoy" }, destino_nota: "India es un país…" });
    expect(out[1].sin_precio_vivo).toBeUndefined();
    expect(out[2].sin_precio_vivo).toBeUndefined();
  });

  const INDIA = {
    id: "384f220e-6f0e-4b28-8f1d-2b14bf0bb49f", destino: "India", ciudad_origen: "Ciudad de México", fecha_salida: "2027-09-24", fecha_regreso: "2027-10-10", num_viajeros: 8,
    vuelos_json: [{ tier: "equilibrio", aerolinea: "Aerolínea por confirmar", precio_por_persona: 30000, fuente_precio: "estimado", estado_dato: "ESTIMADO",
      sin_precio_vivo: { codigo: "busquedas_agotadas_hoy", texto: "Hoy ya se usaron las búsquedas de precios en vivo disponibles. Vuelve a intentar mañana con «Consultar precio en vivo»." } }],
  };

  it("la pantalla sabe qué decir y qué pedir (la ruta del viaje, India → DEL)", () => {
    const info = flightNoLiveInfo(INDIA);
    expect(info.texto).toMatch(/^Hoy ya se usaron/);
    expect(info.destinoNota).toMatch(/India es un país: buscamos vuelos a Delhi \(DEL\)/);
    expect(info.body).toEqual({ origin: "MEX", destination: "DEL", depart: "2027-09-24", return_date: "2027-10-10", travelers: 8, type: "round" });
    // Destino ambiguo: no hay botón, se pide la ciudad.
    expect(flightNoLiveInfo({ ...INDIA, destino: "Estados Unidos", vuelos_json: [] })).toMatchObject({ body: null, pregunta: expect.stringContaining("Estados Unidos") });
  });

  it("'Consultar precio en vivo' muestra el precio con su fuente y hora, o el motivo honesto", async () => {
    const live = { ok: true, source: "serpapi", disponible: true, consulted_at: "2026-10-29T15:04:00Z",
      results: [{ price_per_person_usd: 1320, airline: "Air India", buy_url: "https://www.google.com/travel/flights?tfs=x" }, { price_per_person_usd: 1500, airline: "AM" }] };
    expect(liveQuoteOutcome(live, true)).toMatchObject({ kind: "precio", precioPpUsd: 1320, aerolinea: "Air India", fuente: "Google Flights" });
    expect((liveQuoteOutcome(live, true) as any).nota).toMatch(/^Google Flights · consultado .+ · ida y vuelta, por persona\. No cambia tu total/);
    expect(liveQuoteOutcome({ ok: true, source: "none", results: [], disponible: false, motivo_detalle: "Hoy ya se usaron…" }, true)).toEqual({ kind: "sin_precio", texto: "Hoy ya se usaron…", referencia: null });

    const invoke = vi.fn(async () => ({ data: live, error: null }));
    render(<FlightLiveQuote trip={INDIA} invoke={invoke} />);
    expect(screen.getByTestId("vuelo-motivo")).toHaveTextContent("Hoy ya se usaron las búsquedas de precios en vivo");
    fireEvent.click(screen.getByTestId("vuelo-consultar-vivo"));
    await waitFor(() => expect(screen.getByTestId("vuelo-vivo-resultado")).toHaveTextContent("Desde $1,320 USD por persona · Air India"));
    expect(invoke).toHaveBeenCalledWith("flights-search", { body: expect.objectContaining({ origin: "MEX", destination: "DEL" }) });
  });
});

describe("7 · chofer privado / traslados con conductor", () => {
  it("va primero en India, Oaxaca, premium o si la persona no maneja; en Madrid normal es la alternativa", () => {
    expect(driverOption({ destino: "India" })).toMatchObject({ recommended: true, reason: expect.stringContaining("India") });
    expect(driverOption({ destino: "Oaxaca de Juárez" })).toMatchObject({ recommended: true, reason: expect.stringContaining("Oaxaca de Juárez") });
    expect(driverOption({ destino: "Madrid" })).toMatchObject({ recommended: false, reason: null });
    expect(driverOption({ destino: "Madrid" }, { premium: true })?.recommended).toBe(true);
    expect(driverOption({ destino: "Madrid", itinerario_json: { consulta: { consulta_original: "Madrid 5 días, no manejo", interpretacion: {} } } })?.reason).toBe("Nos dijiste que prefieres no manejar.");
    const req = driverOption({ destino: "Oaxaca de Juárez", fecha_salida: "2026-10-30", fecha_regreso: "2026-11-01", num_viajeros: 2 })!.request;
    // La misma solicitud que usa Iato (concierge-action, tipo transport). Sin precio.
    expect(req).toMatchObject({ type: "transport", title: "Chofer privado en Oaxaca de Juárez", payload: { servicio: "chofer_privado", fecha: "2026-10-30", personas: 2 } });
    expect(JSON.stringify(req)).not.toMatch(/\$\d|precio_/);
  });

  it("Comprar: en Oaxaca el paso dice 'Chofer o auto' y la renta queda como alternativa", () => {
    const trip = { id: "f67b01e9-be40-40c6-b882-a2328d78c85b", destino: "Oaxaca de Juárez", ciudad_origen: "Ciudad de México", fecha_salida: "2026-10-30", fecha_regreso: "2026-11-01", num_viajeros: 2,
      vuelos_json: [], hospedaje_json: [{ nombre: "Hotel Los Amantes", precio_por_noche: 4000, tier: "equilibrio", fuente_precio: "estimado" }] };
    const car = buildBuyFlow(trip, { selVuelo: -1, selHospedaje: -1, selTours: new Set() }).steps.find((s) => s.kind === "auto") as any;
    expect(car.title).toBe("Chofer o auto (opcional)");
    expect(car.driver.recommended).toBe(true);
    expect(car.item.title).toBe("Renta de auto · Oaxaca de Juárez");
  });

  it("'Pedírselo a Iato / al equipo' crea la solicitud real (concierge-action) y Welcome Pickups lleva el afiliado", async () => {
    invokeMock.mockResolvedValue({ data: { ok: true, request: { id: "abcd1234-0000-0000-0000-000000000000", status: "solicitado" }, human_notified: true }, error: null });
    const driver = driverOption({ destino: "India", fecha_salida: "2027-09-24", num_viajeros: 8 })!;
    render(<MemoryRouter><DriverService driver={driver} tripId="384f220e-6f0e-4b28-8f1d-2b14bf0bb49f" /></MemoryRouter>);
    expect(screen.getByTestId("chofer-precio")).toHaveTextContent("Por cotizar");
    expect(screen.getByTestId("chofer-welcome").getAttribute("href")).toContain("aff_track_id=");
    fireEvent.click(screen.getByRole("button", { name: "Pedírselo a Iato / al equipo" }));
    await waitFor(() => expect(screen.getByTestId("chofer-folio")).toHaveTextContent("Folio ABCD1234"));
    expect(invokeMock).toHaveBeenCalledWith("concierge-action", { body: expect.objectContaining({ type: "transport", title: "Chofer privado en India", trip_id: "384f220e-6f0e-4b28-8f1d-2b14bf0bb49f" }) });
  });

  it("Iato sabe ofrecer chofer privado por la misma vía (fixer_request tipo transport, sin precio)", () => {
    expect(FIXER_RULE).toMatch(/CHOFER PRIVADO/);
    expect(FIXER_RULE).toMatch(/tipo \\?"transport\\?"/);
    expect(FIXER_RULE).toMatch(/nunca des ni inventes un precio de chofer/);
    const v = validateAction("fixer_request", { tipo: "transport", titulo: "Chofer privado en Oaxaca", personas: 2 }, { todayISO: "2026-10-29", trips: [], activeTripId: null });
    expect(v).toMatchObject({ ok: true, action: { type: "fixer_request", params: { tipo: "transport", titulo: "Chofer privado en Oaxaca" } } });
  });
});
