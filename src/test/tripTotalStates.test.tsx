// Un solo total en la página del viaje, con su estado (caso Roma → Florencia → Venecia, 23-oct-2026).
// Antes: "TOTAL DE TU VIAJE $542,407 (estimado con los precios de la cotización de $561,468)" y, en el
// desglose, otro "TOTAL ESTIMADO $542,407 MXN". Ahora una sola cifra que dice si es estimada (falta elegir),
// la de tu selección o cuánto ya compraste y cuánto falta; la barra móvil dice lo mismo.
import React from "react";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { vi, it, expect, beforeEach, describe } from "vitest";
import { CASO_TRIP } from "./fixtures/casoRomaFlorenciaVenecia";
import { tripTotalSummary } from "@/lib/tripTotal";
import { buildBuyFlow } from "@/lib/buyFlow";
import { computeTripDesglose } from "@/lib/quote";
import type { PurchaseItem } from "@/lib/purchasePlan";

const db = { trip: null as any, bookings: [] as any[] };
vi.mock("@/integrations/supabase/client", () => {
  const from = (table: string) => {
    let kind = "select";
    const api: any = {
      select: () => api, eq: () => api, not: () => api, order: () => api, limit: () => api, in: () => api,
      update: () => { kind = "update"; return api; }, insert: () => api,
      maybeSingle: async () => ({ data: table === "trips" ? db.trip : null, error: null }),
      single: async () => ({ data: null, error: null }),
      then: (res: any, rej: any) => {
        if (kind === "update") return Promise.resolve({ data: [db.trip], error: null }).then(res, rej);
        return Promise.resolve({ data: table === "bookings" ? db.bookings : [], error: null }).then(res, rej);
      },
    };
    return api;
  };
  return { supabase: { from, functions: { invoke: vi.fn(async () => ({ data: null, error: null })) }, auth: { getSession: async () => ({ data: { session: null } }) } } };
});
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" }, loading: false }) }));
vi.mock("@/components/DashboardLayout", () => ({ DashboardLayout: ({ children }: any) => <>{children}</> }));
vi.mock("@/components/DestinationVideo", () => ({ DestinationVideo: () => null }));
vi.mock("@/components/CityCollapsible", () => ({ CityCollapsible: ({ children }: any) => <div>{children}</div>, useCityImage: () => null }));
vi.mock("@/components/EditWithAIDialog", () => ({ EditWithAIDialog: () => null }));
vi.mock("@/components/LiveTripQuote", () => ({ LiveTripQuote: () => null }));
vi.mock("@/components/InviteFriendDialog", () => ({ InviteFriendDialog: () => null }));
vi.mock("@/components/PriceWatchCard", () => ({ PriceWatchCard: () => null }));
vi.mock("@/components/TripDocuments", () => ({ TripDocuments: () => null }));
vi.mock("@/lib/tripPdf", () => ({ generateTripPDF: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

import TripDetail from "@/pages/TripDetail";

// Los hoteles del caso se consultaron en vivo el 22-oct a las 15:00 UTC; una hora después siguen vigentes.
const NOW = new Date("2026-10-22T16:00:00Z");
const ALL_HOTELS = { Roma: 1, Florencia: 4, Venecia: 7 }; // Hotel Eden, Milu, Ca' Bonfadini (equilibrio)

const summaryFor = (sel: any, bought: (it: PurchaseItem) => boolean = () => false) => {
  const items = buildBuyFlow(CASO_TRIP, sel).items;
  const desglose = computeTripDesglose(CASO_TRIP, { ...sel, nochesHospedaje: 10, selTours: new Set(sel.selTours) }, 2);
  return { s: tripTotalSummary({ trip: CASO_TRIP, sel, desglose, items, itemState: (it) => (bought(it) ? "marcado" : "pendiente"), now: NOW }), items, desglose };
};

describe("tripTotalSummary (lógica)", () => {
  it("sin elegir: 'Total estimado · elige vuelo y hoteles para ver el total real', con la cifra de la cotización", () => {
    const { s } = summaryFor({ selVuelo: -1, selHospedaje: -1, selTours: [], selHoteles: {} });
    expect(s.state).toBe("estimado");
    expect(s.title).toBe("Total estimado");
    expect(s.hint).toBe("Elige vuelo y hoteles para ver el total real.");
    expect(s.total).toBe(561468);
    expect(s.barLabel).toBe("Total $561,468 MXN · estimado");
  });

  it("elegido a medias: dice exactamente qué falta", () => {
    const { s } = summaryFor({ selVuelo: -2, selHospedaje: -1, selTours: [], selHoteles: { Roma: 1 } });
    expect(s.state).toBe("estimado");
    expect(s.missing).toEqual(["hotel en Florencia", "hotel en Venecia"]);
    expect(s.hint).toBe("Elige hotel en Florencia y hotel en Venecia para ver el total real.");
  });

  it("todo elegido: 'Total de tu selección' y en qué rubros el precio es estimado", () => {
    const { s, desglose } = summaryFor({ selVuelo: -2, selHospedaje: -1, selTours: [], selHoteles: ALL_HOTELS });
    expect(s.state).toBe("seleccion");
    expect(s.title).toBe("Total de tu selección");
    // Hoteles en vivo y vigentes: no se dicen estimados; comida, transporte, tours y extras sí.
    expect(s.estimatedIn).toEqual(["comida", "transporte local", "experiencias", "extras"]);
    expect(s.hint).toBe("Incluye precios estimados en: comida, transporte local, experiencias y extras.");
    const expected = Object.values(desglose).reduce((a, b) => a + b, 0);
    expect(s.total).toBe(expected);
    // Hotel Eden 28,029 × 4 + Milu 7,017 × 3 + Ca' Bonfadini 9,962 × 3 (precio en vivo = del grupo).
    expect(desglose.hospedaje).toBe(28029 * 4 + 7017 * 3 + 9962 * 3);
    expect(s.barLabel).toBe(`Total $${expected.toLocaleString("es-MX")} MXN · tu selección`);
  });

  it("un precio de hotel viejo (>24 h) cuenta como estimado", () => {
    const items = buildBuyFlow(CASO_TRIP, { selVuelo: -2, selHospedaje: -1, selTours: [], selHoteles: ALL_HOTELS }).items;
    const sel = { selVuelo: -2, selHospedaje: -1, selTours: [] as number[], selHoteles: ALL_HOTELS };
    const desglose = computeTripDesglose(CASO_TRIP, { ...sel, nochesHospedaje: 10, selTours: new Set() }, 2);
    const s = tripTotalSummary({ trip: CASO_TRIP, sel, desglose, items, now: new Date("2026-10-25T12:00:00Z") });
    expect(s.estimatedIn.slice(0, 3)).toEqual(["hotel en Roma", "hotel en Florencia", "hotel en Venecia"]);
  });

  it("renglón 'por cotizar' de la cotización: el total es estimado y dice que falta (no lo cuenta como $0)", () => {
    const sel = { selVuelo: -2, selHospedaje: -1, selTours: [] as number[], selHoteles: ALL_HOTELS };
    const items = buildBuyFlow(CASO_TRIP, sel).items;
    const desglose = { ...computeTripDesglose(CASO_TRIP, { ...sel, nochesHospedaje: 10, selTours: new Set() }, 2), comida: 0 };
    // "Ya tengo vuelo" (-2): el vuelo por cotizar ya no falta; la comida no es vuelo/hospedaje.
    expect(tripTotalSummary({ trip: CASO_TRIP, sel, desglose, items, porCotizar: ["vuelos"], now: NOW }).porCotizar).toEqual([]);
    const sel2 = { ...sel, selVuelo: -1 };
    const d2 = { ...desglose, vuelos: 0 };
    const s = tripTotalSummary({ trip: CASO_TRIP, sel: sel2, desglose: d2, items: buildBuyFlow(CASO_TRIP, sel2).items, porCotizar: ["vuelos"], now: NOW });
    expect(s.porCotizar).toEqual(["el vuelo"]);
    expect(s.complete).toBe(false);
    expect(s.title).toBe("Total estimado");
    expect(s.hint).toBe("Elige vuelo para ver el total real. Falta cotizar el vuelo: no está sumado al total.");
    expect(s.total).toBe(Object.values(d2).reduce((a, b) => a + b, 0));
    // Con hoteles elegidos y el vuelo con precio, ya no falta nada por cotizar.
    expect(tripTotalSummary({ trip: CASO_TRIP, sel: sel2, desglose: { ...d2, vuelos: 40000 }, items: [], porCotizar: ["vuelos"], now: NOW }).porCotizar).toEqual([]);
  });

  it("ya comprado: 'Ya compraste $X · Falta $Y' y las dos partes suman el total", () => {
    const { s } = summaryFor({ selVuelo: -2, selHospedaje: -1, selTours: [], selHoteles: ALL_HOTELS }, (it) => it.kind === "hospedaje" && it.city === "Roma");
    expect(s.state).toBe("comprado");
    expect(s.boughtCount).toBe(1);
    expect(s.paid).toBe(28029 * 4);
    expect(s.paid + s.pending).toBe(s.total);
    expect(s.barLabel).toBe(`Total $${s.total.toLocaleString("es-MX")} MXN · falta $${s.pending.toLocaleString("es-MX")} MXN`);
    expect(s.barTotal).toBe(`Total $${s.total.toLocaleString("es-MX")} MXN`);
    expect(s.barNote).toBe(`Falta $${s.pending.toLocaleString("es-MX")} MXN · ya compraste $${s.paid.toLocaleString("es-MX")} MXN`);
  });
});

const renderTrip = () => render(
  <MemoryRouter initialEntries={[`/dashboard/viajes/${CASO_TRIP.id}`]}>
    <Routes><Route path="/dashboard/viajes/:id" element={<TripDetail />} /></Routes>
  </MemoryRouter>,
);

beforeEach(() => {
  db.trip = { ...JSON.parse(JSON.stringify(CASO_TRIP)), user_id: "u1", quote_basis: null, quote_needs_update: false, selections: null };
  db.bookings = [];
});

describe("TripDetail: un solo total", () => {
  it("sin elegir: una sola cifra, 'Total estimado', el desglose plegado sin repetir título ni cifra y la barra igual", async () => {
    renderTrip();
    const card = await screen.findByTestId("trip-total-card");
    expect(card).toHaveAttribute("data-state", "estimado");
    expect(within(card).getByTestId("trip-total-title")).toHaveTextContent("Total estimado");
    expect(within(card).getByTestId("trip-total-hint")).toHaveTextContent("Elige vuelo y hoteles para ver el total real.");
    expect(within(card).getByTestId("trip-total-label")).toHaveTextContent("Total para 2 personas");
    expect(within(card).getByTestId("trip-total-label")).toHaveTextContent(/aproximado/i);
    // Una sola cifra en lo que se ve; el resumen final de Comprar (pestaña oculta) repite la misma cifra.
    expect(screen.getAllByText("$561,468 MXN").filter((el) => !el.closest("[hidden]"))).toHaveLength(1);
    expect(screen.getByTestId("comprar-listo-total")).toHaveTextContent("$561,468 MXN");
    // El desglose va dentro de la tarjeta del total y no tiene su propio "Total estimado" ni la cifra.
    const desglose = within(card).getByTestId("trip-desglose");
    expect(within(desglose).queryByText(/Total estimado/i)).toBeNull();
    expect(within(desglose).queryByText("$561,468 MXN")).toBeNull();
    expect(within(desglose).queryByText(/Calculado en base/)).toBeNull();
    expect(within(desglose).queryByText(/Desglose por vuelo/)).toBeNull();
    expect(screen.getAllByTestId("trip-total-amount")).toHaveLength(1);
    expect(screen.getByTestId("trip-next-bar")).toHaveTextContent("Total $561,468 MXN");
    expect(screen.getByTestId("trip-next-bar-note")).toHaveTextContent("Estimado · falta elegir");
  });

  it("con todo elegido y la cotización vieja: 'Total de tu selección', sin la cifra de la cotización y el aviso en una línea", async () => {
    db.trip.selections = { v: 1, vuelo: { i: -2, key: null }, hospedaje: { i: -1, key: null }, noches_hospedaje: null, tours: [],
      hoteles: Object.entries(ALL_HOTELS).map(([ciudad, i]) => ({ ciudad, i, key: null })) };
    db.trip.quote_basis = { num_viajeros: 2, fecha_salida: "2026-10-22", fecha_regreso: "2026-11-01", selections: null };
    renderTrip();
    const card = await screen.findByTestId("trip-total-card");
    expect(card).toHaveAttribute("data-state", "seleccion");
    expect(within(card).getByTestId("trip-total-title")).toHaveTextContent("Total de tu selección");
    expect(within(card).getByTestId("trip-total-hint")).toHaveTextContent(/^Incluye precios estimados en: .*comida, transporte local/);
    expect(document.body.textContent).not.toMatch(/561,468/);
    const amount = within(card).getByTestId("trip-total-amount").textContent!;
    expect(screen.getByTestId("trip-next-bar")).toHaveTextContent(`Total ${amount}`);
    expect(screen.getByTestId("trip-next-bar-note")).toHaveTextContent("Tu selección");
    const stale = within(card).getByTestId("trip-total-stale");
    expect(stale.tagName).toBe("P");
    expect(stale).toHaveTextContent(/Cambiaste tu selección.*Actualizar cotización/);
  });

  it("ya comprado: distingue lo pagado de lo pendiente (reserva confirmada del hotel de Roma)", async () => {
    db.trip.selections = { v: 1, vuelo: { i: -2, key: null }, hospedaje: { i: -1, key: null }, noches_hospedaje: null, tours: [],
      hoteles: Object.entries(ALL_HOTELS).map(([ciudad, i]) => ({ ciudad, i, key: null })) };
    db.bookings = [{ trip_id: CASO_TRIP.id, category: "hotel", status: "confirmed", title: "Hotel Eden", confirmation_code: "ABC123" }];
    renderTrip();
    const pagado = await screen.findByTestId("trip-total-pagado");
    expect(pagado).toHaveTextContent(`Ya compraste $${(28029 * 4).toLocaleString("es-MX")} MXN`);
    expect(pagado).toHaveTextContent(/Falta \$[\d,]+ MXN/);
    expect(screen.getByTestId("trip-total-card")).toHaveAttribute("data-state", "comprado");
    expect(screen.getByTestId("trip-next-bar-note")).toHaveTextContent(new RegExp(`^Falta \\$[\\d,]+ MXN · ya compraste \\$${(28029 * 4).toLocaleString("es-MX")} MXN$`));
  });
});
