// Prueba E2E real en producción (23-oct-2026), datos crudos guardados como fixtures:
//  - P1-1 CDMX → Tokio, 2 personas, Comprar sin elegir nada: el resumen mostraba el hotel Mercure
//    (estimado por IA) y el total sumaba Sakura (SerpApi en vivo).
//  - P1-2 Roma → Florencia → Venecia: el total incluía "Vuelos · estimado $49,530" sin decirlo.
//  - P1-3 Iato: precio de Google Flights y botón de Aviasales; "ida y vuelta" sin regreso consultado.
//  - P2: "Escalas por confirmar" con escalas "1 escala" de Google Flights; "USD 3,110 USD".
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: null } }) },
    from: () => ({ select: () => ({ eq: () => ({ then: (r: any) => r({ data: [], error: null }) }) }) }),
  },
}));

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));

import TOKIO from "./fixtures/demo23octTokio.json";
import MULTI_LOGISTICS from "./fixtures/demo23octMultiLogistics.json";
import { TripPurchasePlan } from "@/components/booking/TripPurchasePlan";
import { RichCard } from "@/components/concierge/ConciergeCards";
import { tripTotals } from "@/components/RealTripTotal";
import { computeTripDesglose } from "@/lib/quote";
import { buildBuyFlow } from "@/lib/buyFlow";
import { buildPurchasePlan } from "@/lib/purchasePlan";
import { tripTotalSummary } from "@/lib/tripTotal";
import { buildTripPdfModel } from "@/lib/tripPdfModel";
import { flightStopsLabel } from "@/lib/flightDisplay";
import { multiDestTripInsert } from "@/lib/multiDestGenerate";
import { googleFlightResult } from "../../supabase/functions/flights-search/search";
import { parseGoogleFlightsSearch } from "../../supabase/functions/_shared/booking/links";
import { collectEvidence, prepareToolResultForModel, validateCards } from "../../supabase/functions/concierge-chat/cards";
import { finalizeTurn } from "../../supabase/functions/concierge-chat/finalize";

const NONE = { selVuelo: -1, selHospedaje: -1, selTours: new Set<number>(), selHoteles: {} as Record<string, number> };

/** Lo que hace TripDetail: desglose con la selección, el total de la página y su resumen. */
function page(trip: any, sel = NONE) {
  const n = trip.num_viajeros;
  const desglose = computeTripDesglose(trip, { ...sel, nochesHospedaje: 10 } as any, n);
  const total = tripTotals(trip, n, desglose).total;
  const items = buildBuyFlow(trip, sel, {}).items;
  const summary = tripTotalSummary({ trip, sel, desglose, items });
  return { desglose, total, summary };
}

const listoRows = () => within(screen.getByTestId("comprar-listo-lista")).getAllByTestId("comprar-listo-item");
const money = (s: string) => Number(s.replace(/[^\d]/g, ""));

describe("P1-1 · Comprar muestra las mismas partidas que suma el total (CDMX → Tokio)", () => {
  const trip = TOKIO as any;

  it("sin elegir nada, el hotel de Comprar es el que suma el total (Sakura, en vivo), no el primero de la lista", () => {
    const { desglose, total } = page(trip);
    expect(total).toBe(152988);
    expect(desglose.hospedaje).toBe(26640);
    const hotel = buildPurchasePlan(trip, NONE).find((i) => i.kind === "hospedaje")!;
    expect(hotel.title).toMatch(/Sakura/);
    expect(hotel.price).toBe(26640);
    const vuelo = buildPurchasePlan(trip, NONE).find((i) => i.kind === "vuelo")!;
    expect(vuelo.price).toBe(desglose.vuelos);
  });

  it("'Listo · Revisa y compra': las partidas suman exactamente el total de la página", () => {
    const { desglose, total, summary } = page(trip);
    render(<MemoryRouter><TripPurchasePlan trip={trip} selVuelo={-1} selHospedaje={-1} selTours={new Set()} bookings={[]} userId={null}
      selectionTotal={total} selectionDesglose={desglose} estimadosNote={summary.estimadosNote} /></MemoryRouter>);
    const rows = listoRows();
    const text = rows.map((r) => r.textContent ?? "").join(" | ");
    expect(text).toMatch(/Sakura/);
    expect(text).not.toMatch(/Mercure/);
    const sum = rows.map((r) => (r.textContent ?? "").match(/\$[\d,]+ MXN/)?.[0]).filter(Boolean).reduce((s, m) => s + money(m!), 0);
    expect(sum).toBe(total);
    expect(money(screen.getByTestId("comprar-listo-total").textContent!.match(/\$[\d,]+ MXN/)![0])).toBe(total);
  });
});

describe("P1-2 · un vuelo estimado por la IA no entra callado al total (Roma → Florencia → Venecia)", () => {
  const trip = { id: "demo-multi", ...multiDestTripInsert({ userId: "u1", origin: "Ciudad de México", stops: ["Roma", "Florencia", "Venecia"],
    fechaSalida: "2027-05-10", fechaRegreso: "2027-05-19", viajeros: 2, prefs: {} }, MULTI_LOGISTICS) } as any;

  it("el total de la página dice 'Incluye estimados: vuelos'", () => {
    const { total, summary } = page(trip);
    expect(total).toBe(166825);
    expect(summary.sinPrecioReal).toEqual(["vuelos"]);
    expect(summary.hint).toMatch(/Incluye estimados: vuelos\./);
  });

  it("Comprar: el vuelo aparece con su monto estimado y la nota del total lo dice", () => {
    const { desglose, total, summary } = page(trip);
    render(<MemoryRouter><TripPurchasePlan trip={trip} selVuelo={-1} selHospedaje={-1} selTours={new Set()} selHoteles={{}} bookings={[]} userId={null}
      selectionTotal={total} selectionDesglose={desglose} estimadosNote={summary.estimadosNote} /></MemoryRouter>);
    const vuelo = listoRows().find((r) => /Vuelo/.test(r.textContent ?? ""))!;
    expect(vuelo.textContent).toMatch(/\$49,530 MXN/);
    expect(vuelo.textContent).toMatch(/estimado/);
    expect(screen.getByTestId("comprar-listo-total-nota").textContent).toMatch(/Incluye estimados: vuelos\./);
  });

  it("PDF: la nota del total dice lo mismo", () => {
    const m = buildTripPdfModel(trip, { sel: NONE });
    expect(m.totals.total).toBe(166825);
    expect(m.totalNote).toMatch(/Incluye estimados: vuelos\./);
  });
});

// Un resultado de Google Flights (SerpApi) como el de la prueba: United + ANA, MEX → HND, 2 viajeros.
const SERP_UNITED = {
  price: 3110, total_duration: 1125,
  flights: [
    { airline: "United", flight_number: "UA 1234", departure_airport: { id: "MEX", time: "2027-02-10 05:40" }, arrival_airport: { id: "IAH", time: "2027-02-10 08:40" } },
    { airline: "ANA", flight_number: "NH 117", departure_airport: { id: "IAH", time: "2027-02-10 10:25" }, arrival_airport: { id: "HND", time: "2027-02-11 15:25" } },
  ],
  layovers: [{ id: "IAH", name: "Houston", duration: 105 }],
};
const AVIASALES = "https://www.aviasales.com/search/MEX1002HND20022?marker=533299";
const run = (ret: string | null) => {
  const r = googleFlightResult(SERP_UNITED, 2, !!ret, AVIASALES, { origin: "MEX", destination: "HND", depart: "2027-02-10", ret });
  return { name: "search_flights", args: { origin: "MEX", destination: "HND", departure_date: "2027-02-10", ...(ret ? { return_date: ret } : {}), adults: 2 },
    result: prepareToolResultForModel("search_flights", { ok: true, source: "serpapi", results: [r], consulted_at: "2026-10-23T06:01:24Z",
      meta: { origin: "MEX", destination: "HND", depart: "2027-02-10", return_date: ret, travelers: 2, dep_iata: "MEX", arr_iata: "HND" } }) };
};
const MODEL_CARD = { type: "flight", title: "United + ANA", subtitle: "MEX→HND · 18h 45m · 1 escala (IAH) · ida y vuelta 2 pax",
  meta: "Salida 05:40 · Llegada 11 feb 15:25", cta_label: "Ver y comprar", cta_action: AVIASALES, price: 3110, currency: "USD" };

describe("P1-3 · Iato compra en la misma fuente que dio el precio", () => {
  it("flights-search: un resultado de Google Flights se compra en Google Flights (tfs) y Aviasales queda como alternativa", () => {
    const r: any = googleFlightResult(SERP_UNITED, 2, true, AVIASALES, { origin: "MEX", destination: "HND", depart: "2027-02-10", ret: "2027-02-20" });
    expect(parseGoogleFlightsSearch(r.buy_url)).toMatchObject({ origin: "MEX", destination: "HND", depart: "2027-02-10", ret: "2027-02-20", adults: 2 });
    expect(r.alt_buy_url).toBe(AVIASALES);
    expect(r.alt_buy_note).toMatch(/el precio puede variar/);
  });

  it("la card lleva el enlace de Google Flights aunque el modelo ponga Aviasales, y no afirma 'ida y vuelta' del itinerario", () => {
    const ev = collectEvidence([run("2027-02-20")]);
    const [card] = validateCards([MODEL_CARD], ev).cards;
    expect(new URL(card.cta_action!).hostname).toBe("www.google.com");
    expect(card.subtitle).toBe("MEX→HND · 18h 45m · 1 escala (IAH) · 2 pax");
    expect(card.price_basis).toBe("total ida y vuelta · horarios de la ida");
  });

  it("solo ida: ni la card ni el texto dicen 'ida y vuelta'; si manda a Aviasales, dice que el precio puede variar", () => {
    const out = finalizeTurn({
      raw: `Compra en Aviasales con el botón. Precio: $3,110 USD para 2 viajeros, ida y vuelta.\n<<<IATO_DATA>>>${JSON.stringify({ cards: [MODEL_CARD] })}`,
      toolRuns: [run(null)], plan: { cards: [], suggestedActions: [] }, actionCtx: { todayISO: "2026-10-23", trips: [], activeTripId: null },
    });
    const card = out.cards[0];
    expect(card.subtitle).toMatch(/solo ida/);
    expect(`${card.subtitle} ${card.meta} ${card.price_basis}`).not.toMatch(/ida y vuelta/);
    expect(out.text).not.toMatch(/ida y vuelta/);
    expect(out.text).toMatch(/Aviasales es una búsqueda alternativa: el precio puede variar/);
  });
});

describe("P2 rápidos", () => {
  it("una tarifa de Google Flights con '1 escala' dice '1 escala', no 'Escalas por confirmar'", () => {
    const united = (TOKIO as any).vuelos_json.find((v: any) => /United/.test(v.aerolinea));
    expect(flightStopsLabel(united)).toBe("1 escala");
  });
  it("la card de Iato no repite la moneda ('$3,110 USD', no 'USD 3,110 USD')", () => {
    render(<RichCard card={{ type: "flight", title: "United + ANA", price: 3110, price_usd: 3110, currency: "USD", estado_dato: "CONSULTADO_EN_VIVO", fuente: "serpapi" }} />);
    expect(document.body.textContent).toMatch(/\$3,110 USD/);
    expect(document.body.textContent).not.toMatch(/USD\s*3,110/);
  });
});
