// Grupo terrestre (2026-10-24): trenes, autobuses, ferris, renta de auto y yates.
//  1. Cada enlace precargado lleva los parámetros que el sitio aplica (formatos comprobados con Chromium).
//  2. La lista blanca acepta los dominios nuevos y nada más.
//  3. La devolución del auto en un tramo de ida es la fecha del tramo, no el fin del viaje.
//  4. Nunca un precio sin fuente: los ferris en vivo dicen Ferryhopper y "consultado HH:MM".
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import fixture from "./fixtures/ferryhopperBarcelonaPalma.json";
import {
  adoRouteUrl, busSearches, clickAndBoatSearchUrl, dbSearchUrl, ferryhopperResultsUrl, flixbusSearchUrl, renfeSearchUrl, twelveGoSearchUrl,
} from "../../supabase/functions/_shared/booking/groundLinks";
import { checkAllowlisted, checkUntrusted } from "../../supabase/functions/_shared/booking/allowlist";
import { busActions, operatorAction, OPERATORS } from "../../supabase/functions/_shared/booking/railOperators";
import { idsCode, mapFerryOptions, parseMcpResponse, runFerrySearch, searchBody, FERRY_CACHE_TTL_SECONDS } from "../../supabase/functions/_shared/ferryhopper";
import { memoryCacheStore } from "../../supabase/functions/_shared/serpCache";
import { carSearchDefaults, legCarRentalDates } from "@/lib/multiDestTrip";
import { legStep } from "@/lib/buyFlow";
import { summarizeFerries, consultedText } from "@/lib/ferryLive";
import { groundCardLink } from "@/lib/groundCardLinks";
import { GroundBuyButtons } from "@/components/booking/FlightBuyButtons";

const sse = (obj: unknown) => `event: message\ndata: ${JSON.stringify(obj)}\n\n`;

describe("1. enlaces precargados con los parámetros correctos", () => {
  it("Renfe: estaciones de renfe.com, fecha DD/MM/AAAA y adultos", () => {
    const u = new URL(renfeSearchUrl({ from: "Madrid", to: "Córdoba", date: "2027-05-07", adults: 3 })!);
    expect(u.origin + u.pathname).toBe("https://venta.renfe.com/vol/buscarTren.do");
    expect(u.searchParams.get("cdgoOrigen")).toBe("MADRI");
    expect(u.searchParams.get("desOrigen")).toBe("MADRID (TODAS)");
    expect(u.searchParams.get("cdgoDestino")).toBe("50500");
    expect(u.searchParams.get("FechaIdaSel")).toBe("07/05/2027");
    expect(u.searchParams.get("_fechaIdaVisual")).toBe("07/05/2027");
    expect(u.searchParams.get("adultos_")).toBe("3");
    expect(renfeSearchUrl({ from: "Barcelona", to: "Sevilla", date: "2027-05-07" })).toContain("cdgoDestino=51003");
    // Ciudad fuera de la tabla, misma ciudad o sin fecha: no se arma (no se inventa un código).
    expect(renfeSearchUrl({ from: "Madrid", to: "Ronda del Sur", date: "2027-05-07" })).toBeNull();
    expect(renfeSearchUrl({ from: "Madrid", to: "Madrid", date: "2027-05-07" })).toBeNull();
    expect(renfeSearchUrl({ from: "Madrid", to: "Sevilla", date: null })).toBeNull();
    expect(renfeSearchUrl({ from: "Madrid", to: "Sevilla", date: "2027-02-30" })).toBeNull();
  });

  it("Deutsche Bahn: estaciones con su número EVA (bahnhof.de), fecha, hora y viajeros", () => {
    const url = dbSearchUrl({ from: "Berlín", to: "Múnich", date: "2026-11-10", adults: 2, time: "09:30" })!;
    expect(url.startsWith("https://int.bahn.de/en/buchung/fahrplan/suche#")).toBe(true);
    const h = new URLSearchParams(url.split("#")[1]);
    expect(h.get("so")).toBe("Berlin Hbf");
    expect(h.get("zo")).toBe("München Hbf");
    expect(h.get("soid")).toBe("A=1@O=Berlin Hbf@L=8011160@");
    expect(h.get("zoid")).toBe("A=1@O=München Hbf@L=8000261@");
    expect(h.get("hd")).toBe("2026-11-10T09:30:00");
    expect(h.get("r")).toBe("13:16:KLASSENLOS:2");
    expect(dbSearchUrl({ from: "Frankfurt", to: "Hamburgo", date: "2026-11-10" })).toContain("hd=2026-11-10T08:00:00");
    expect(dbSearchUrl({ from: "Berlín", to: "Potsdam", date: "2026-11-10" })).toBeNull();
  });

  it("FlixBus: id de ciudad del sitio, fecha DD.MM.AAAA y adultos (México y Europa)", () => {
    const mx = new URL(flixbusSearchUrl({ from: "Ciudad de México", to: "Puebla", date: "2026-11-12", adults: 2 })!);
    expect(mx.origin + mx.pathname).toBe("https://shop.flixbus.com/search");
    expect(mx.searchParams.get("departureCity")).toBe("de2da3db-1fa4-469b-b687-c5ab89d09c42");
    expect(mx.searchParams.get("arrivalCity")).toBe("5f8c0dfa-952a-4a23-992a-9b7aa1c3b86f");
    expect(mx.searchParams.get("rideDate")).toBe("12.11.2026");
    expect(mx.searchParams.get("adult")).toBe("2");
    expect(flixbusSearchUrl({ from: "Roma", to: "Florencia", date: "2026-11-12" })).toContain("arrivalCity=40de71c6-8646-11e6-9066-549f350fcb0c");
    expect(flixbusSearchUrl({ from: "Oaxaca", to: "Puebla", date: "2026-11-12" })).toBeNull();
  });

  it("12Go (Asia), ADO (ruta sin fecha), Ferryhopper y Click&Boat", () => {
    expect(twelveGoSearchUrl({ from: "Bangkok", to: "Chiang Mai", date: "2026-11-10", adults: 2 })).toBe("https://12go.asia/en/travel/bangkok/chiang-mai?date=2026-11-10&people=2");
    expect(twelveGoSearchUrl({ from: "Bangkok", to: "Pattaya", date: "2026-11-10" })).toBeNull();
    expect(adoRouteUrl("CDMX", "Puebla")).toBe("https://international.ado.com.mx/ado-bus/mexico-city-to-puebla?locale=es-MX&currency=MXN");
    expect(adoRouteUrl("Cancún", "Tulum")).toContain("/ado-bus/cancun-to-tulum");
    expect(adoRouteUrl("Puebla", "Oaxaca")).toBeNull();
    expect(ferryhopperResultsUrl({ ports: ["BRC", "PAL"], dates: ["2026-11-10"], passengers: 2 }))
      .toBe("https://www.ferryhopper.com/en/booking/results?itinerary=BRC%2CPAL&dates=20261110&passengers=2&vehicles=0&pets=0");
    expect(ferryhopperResultsUrl({ ports: ["BRC"], dates: [], passengers: 2 })).toBeNull();
    const cb = new URL(clickAndBoatSearchUrl({ city: "Cancún", from: "2026-12-12", to: "2026-12-13", people: 4 })!);
    expect(cb.origin + cb.pathname).toBe("https://www.clickandboat.com/es/alquiler");
    expect(cb.searchParams.get("where")).toBe("Cancún, México");
    expect(cb.searchParams.get("dateFrom")).toBe("2026-12-12");
    expect(cb.searchParams.get("dateTo")).toBe("2026-12-13");
    expect(cb.searchParams.get("numberOfPeople")).toBe("4");
    // Sin país conocido no hay búsqueda (Click&Boat no da resultados con "Ibiza" a secas).
    expect(clickAndBoatSearchUrl({ city: "Pueblito Desconocido" })).toBeNull();
    expect(clickAndBoatSearchUrl({ city: "Ibiza", country: "España", from: "2026-11-14" })).toContain("dateTo=2026-11-14");
  });

  it("operador de tren: precargado cuando hay formato (Renfe, DB); portada con instrucción cuando no (SNCF)", () => {
    const q = { from: "Madrid", to: "Sevilla", date: "2026-12-07", adults: 2 };
    const renfe = operatorAction(OPERATORS.renfe, q);
    expect(renfe).toMatchObject({ prefilled: true, label: "Ver horarios y precio en Renfe", site: "Renfe" });
    const sncf = operatorAction(OPERATORS.sncf, { from: "París", to: "Lyon", date: "2026-12-07", adults: 2 }, "7 dic");
    expect(sncf).toMatchObject({ prefilled: false, url: "https://www.sncf-connect.com/", label: "SNCF Connect · busca la ruta en su sitio" });
    expect(sncf.hint).toBe("SNCF Connect no recibe la ruta por enlace: escribe París → Lyon y el 7 dic. Precio en el sitio del operador.");
    const bus = busActions({ from: "CDMX", to: "Puebla", date: "2026-11-12", adults: 1, provider: "ADO Platino" });
    expect(bus.map((b) => b.site)).toEqual(["ADO", "FlixBus"]);
    expect(busSearches({ from: "Granada", to: "Málaga", date: "2026-11-12" }).map((b) => b.provider)).toEqual(["flixbus"]);
  });
});

describe("2. la lista blanca acepta los nuevos (y nada más)", () => {
  const cases: Array<[string | null, string]> = [
    [renfeSearchUrl({ from: "Madrid", to: "Sevilla", date: "2026-12-07" }), "renfe"],
    [dbSearchUrl({ from: "Berlín", to: "Múnich", date: "2026-11-10" }), "db"],
    [flixbusSearchUrl({ from: "Madrid", to: "Valencia", date: "2026-11-10" }), "flixbus"],
    [twelveGoSearchUrl({ from: "Hanoi", to: "Sapa", date: "2026-11-10" }), "12go"],
    [ferryhopperResultsUrl({ ports: ["BRC", "PAL"], dates: ["2026-11-10"] }), "ferryhopper"],
    [clickAndBoatSearchUrl({ city: "Mykonos", from: "2026-11-14" }), "clickandboat"],
    [adoRouteUrl("Cancún", "Tulum"), "ado"],
  ];
  it.each(cases)("%s → %s", (url, provider) => {
    expect(url).toBeTruthy();
    const v = checkAllowlisted(url);
    expect(v.ok).toBe(true);
    expect(v.provider?.provider).toBe(provider);
    expect(checkUntrusted(url).ok).toBe(true);
  });
  it("rechaza dominios parecidos y rutas que no son la búsqueda", () => {
    for (const bad of ["https://venta.renfe.com.reservas.io/vol/buscarTren.do", "https://renfe-billetes.com/vol/buscarTren.do", "https://int.bahn.de/en/kontakt",
      "https://shop.flixbus.com/rides/123", "https://flixbus-ofertas.com/search", "https://www.ferryhopper.com/en/account", "https://www.clickandboat.com/es/mi-cuenta"]) {
      expect(checkAllowlisted(bad).ok, bad).toBe(false);
    }
  });
});

describe("3. renta de auto en un tramo de ida: devolución el día del tramo", () => {
  const trip = { id: "t9", num_viajeros: 2, destino: "Madrid → Córdoba", fecha_salida: "2027-05-03", fecha_regreso: "2027-05-19" };
  it("la fecha del tramo manda; nunca el fin del viaje", () => {
    expect(legCarRentalDates(trip, "Madrid", "Córdoba", "2027-05-07")).toEqual({ pickup: "2027-05-07", dropoff: "2027-05-07" });
    expect(legCarRentalDates(trip, "Madrid", "Córdoba").dropoff).not.toBe("2027-05-19");
  });
  it("la pantalla Renta de auto: tramo de ida sin 'return' en la URL no toma fecha_regreso", () => {
    const d = carSearchDefaults({ city: "Madrid", dropoff: "Córdoba", pickup: "2027-05-07", ret: null }, trip);
    expect(d).toMatchObject({ pickup: "2027-05-07", ret: "2027-05-07", oneWayLeg: true });
    const sinFecha = carSearchDefaults({ city: "Madrid", dropoff: "Córdoba" }, trip);
    expect(sinFecha.ret).not.toBe("2027-05-19");
    expect(sinFecha.pickup).toBe("");
    // Misma ciudad (o sin URL): las fechas del viaje, como antes.
    expect(carSearchDefaults({}, trip)).toMatchObject({ city: "Madrid → Córdoba", pickup: "2027-05-03", ret: "2027-05-19", oneWayLeg: false });
    expect(carSearchDefaults({ city: "Madrid", dropoff: "Madrid", ret: "2027-05-01", pickup: "2027-05-05" }, trip).ret).toBe("2027-05-05");
  });
  it("Comprar: 'Rentar auto' del tramo lleva la fecha del tramo", () => {
    const leg = legStep(trip, "Madrid", "Córdoba", "2027-05-07", 2, "coche");
    const coche = leg.choices.find((c) => c.mode === "coche")!;
    const qs = new URLSearchParams(coche.fallbackHref!.split("?")[1]);
    expect(qs.get("city")).toBe("Madrid");
    expect(qs.get("dropoff")).toBe("Córdoba");
    expect(qs.get("pickup")).toBe("2027-05-07");
    expect(qs.get("return")).toBe("2027-05-07");
    expect(coche.fallbackHref).not.toContain("2027-05-19");
  });
});

describe("4. nunca un precio sin fuente", () => {
  it("ferry en vivo: hora, naviera y 'desde' en EUR del asiento más barato, con el enlace del widget de Ferryhopper", () => {
    const m = mapFerryOptions(fixture, 2);
    expect(m.from).toEqual({ nombre: "BARCELONA", codigo: "BRC" });
    expect(m.options.map((o) => [o.naviera, o.sale, o.desde?.monto])).toEqual([
      ["GRANDI NAVI VELOCI", "21:30", 36.68], ["BALEARIA", "22:15", 60], ["TRASMED", "22:30", 41],
    ]);
    const u = new URL(m.options[0].url);
    expect(u.searchParams.get("itinerary")).toBe("BRC,PAL");
    expect(u.searchParams.get("dates")).toBe("20261110");
    expect(u.searchParams.get("passengers")).toBe("2");
    expect(u.searchParams.get("aff_uid")).toBe("mcpint");
    expect(u.searchParams.get("IDSCode")).toBe("BRCPALGNV202611102130202611110600-40c430");
    expect(idsCode({})).toBeNull();
    // Una salida solo con cabinas no tiene "desde" (no se usa el precio de la cabina como asiento).
    const soloCabina = JSON.parse(JSON.stringify(fixture));
    soloCabina.result.structuredContent.legs[0].options[0].segments[0].accommodations = [{ type: "CABIN_FULL", expectedPrice: { totalPriceInCents: 22963 } }];
    expect(mapFerryOptions(soloCabina, 1).options[0].desde).toBeNull();
  });

  it("runFerrySearch: caché de 30 min, bolsa de búsquedas, tope de la cuenta y devolución si falla", async () => {
    const store = memoryCacheStore(() => Date.parse("2026-10-24T12:00:00Z"));
    const fetchImpl = vi.fn(async () => new Response(sse(fixture), { status: 200, headers: { "Content-Type": "text/event-stream" } }));
    const gate = vi.fn(async () => ({ allow: true as const, refund: vi.fn(async () => {}) }));
    const now = () => Date.parse("2026-10-24T12:05:00Z");
    const args = { from: "Barcelona", to: "Palma", date: "2026-11-10", passengers: 2 };
    const r1 = await runFerrySearch(args, { fetchImpl: fetchImpl as any, store, gate, limiter: async () => true, now });
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    expect(r1).toMatchObject({ fuente: "Ferryhopper", from_cache: false, consultado_at: "2026-10-24T12:05:00.000Z", pasajeros: 2 });
    expect(r1.url_ruta).toBe("https://www.ferryhopper.com/en/booking/results?itinerary=BRC%2CPAL&dates=20261110&passengers=2&vehicles=0&pets=0");
    expect(JSON.parse((fetchImpl.mock.calls[0] as any)[1].body)).toEqual(searchBody("Barcelona", "Palma", "2026-11-10"));
    expect([...store.rows.values()][0].ttl_seconds).toBe(FERRY_CACHE_TTL_SECONDS);
    const r2 = await runFerrySearch(args, { fetchImpl: fetchImpl as any, store, gate, limiter: async () => true, now });
    expect(r2.ok && r2.from_cache).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(gate).toHaveBeenCalledTimes(1);

    const refund = vi.fn(async () => {});
    const down = await runFerrySearch({ ...args, date: "2026-11-11" }, { fetchImpl: (async () => new Response("x", { status: 502 })) as any, store, gate: async () => ({ allow: true as const, refund }), now });
    expect(down).toMatchObject({ ok: false, code: "ferry_error" });
    expect(refund).toHaveBeenCalled();
    const busy = await runFerrySearch({ ...args, date: "2026-11-12" }, { fetchImpl: fetchImpl as any, store, limiter: async () => false, now });
    expect(busy).toMatchObject({ ok: false, code: "ferry_ocupado" });
    const limit = await runFerrySearch({ ...args, date: "2026-11-13" }, { fetchImpl: fetchImpl as any, store, gate: async () => ({ allow: false as const, soft: false, info: {} }), now });
    expect(limit).toMatchObject({ ok: false, code: "FREE_LIMIT_REACHED" });
    expect(await runFerrySearch({ ...args, date: "2026-10-01" }, { fetchImpl: fetchImpl as any, now })).toMatchObject({ ok: false, code: "entrada_invalida" });
    expect(parseMcpResponse("basura")).toBeNull();
  });

  it("pantalla: precio solo con fuente y hora de consulta; sin enlace válido no se muestra la salida", () => {
    const m = mapFerryOptions(fixture, 1);
    const data = { ok: true, fuente: "Ferryhopper", consultado_at: "2026-10-24T18:05:00.000Z", from_cache: false, origen: m.from, destino: m.to,
      results: [...m.options, { ...m.options[0], id: "x", url: "https://ferryhopper-ofertas.com/x" }, { ...m.options[1], id: "y", desde: { monto: 10, moneda: "USD" } }],
      url_ruta: "https://www.ferryhopper.com/en/booking/results?itinerary=BRC%2CPAL&dates=20261110&passengers=1&vehicles=0&pets=0", nota: "n" };
    const s = summarizeFerries(data);
    expect(s.ok).toBe(true);
    if (!s.ok) return;
    expect(s.rows).toHaveLength(4);
    expect(s.rows[0].priceText).toBe("desde €36.68 por persona");
    expect(s.rows[3].priceText).toBeNull(); // moneda que no es la de Ferryhopper: sin precio
    expect(s.consultedLabel).toMatch(/^en vivo · consultado \d{2}:\d{2}$/);
    expect(consultedText("2026-10-24T18:05:00.000Z", true)).toMatch(/^guardado · consultado/);
    expect(summarizeFerries({ ok: false, motivo: "Ferryhopper no respondió" })).toEqual({ ok: false, message: "Ferryhopper no respondió" });
  });

  it("tramos: tren, autobús y ferry sin precio del plan no muestran precio; nunca 'Reservado'", () => {
    const trip = { id: "t1", num_viajeros: 2, destino: "Barcelona → Palma", pais_destino: "España",
      itinerario_json: { logistics: { per_destination: [{ city: "Palma", arrival_options: [{ mode: "Ferry", from: "Barcelona", provider: "Baleària" }] }] } } };
    const leg = legStep(trip, "Barcelona", "Palma", "2026-11-10", 2);
    const ferry = leg.choices.find((c) => c.mode === "ferry")!;
    expect(ferry.pricePp).toBeNull();
    expect(ferry.buttonLabel).toBe("Ver salidas y precio en vivo");
    expect(ferry.fallbackHref).toBe("/dashboard/ferries?origin=Barcelona&dest=Palma&date=2026-11-10&pax=2&trip=t1");
    for (const c of leg.choices) expect(`${c.completa ?? ""} ${c.buttonLabel ?? ""}`).not.toMatch(/reservado|\$\s?\d/i);
    const { container } = render(<MemoryRouter><GroundBuyButtons option={{ mode: "ferry", from: "Barcelona", to: "Palma" }} trip={trip} /></MemoryRouter>);
    expect(screen.getByTestId("ground-ferry-live").getAttribute("href")).toContain("/dashboard/ferries?origin=Barcelona&dest=Palma");
    expect(container.textContent).not.toMatch(/\$\s?\d|€\s?\d|Reservado/);
  });

  it("cards de Iato: tren y ferry abren la pantalla con la ruta; yate a Click&Boat; un taxi no", () => {
    expect(groundCardLink({ title: "Tren AVE", subtitle: "Madrid → Sevilla" })).toEqual({ mode: "tren", label: "Ver horarios y precio", href: "/dashboard/trenes?origin=Madrid&dest=Sevilla" });
    expect(groundCardLink({ title: "Ferry a Mallorca", subtitle: "Barcelona → Palma" })?.href).toBe("/dashboard/ferries?origin=Barcelona&dest=Palma");
    expect(groundCardLink({ title: "Lancha privada", subtitle: "Cancún" })?.href).toBe("/dashboard/ferries?boat=Canc%C3%BAn#yate");
    expect(groundCardLink({ title: "Taxi oficial", subtitle: "Aeropuerto → Hotel" })).toBeNull();
  });
});
