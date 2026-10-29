// R3 viajes P1-3: Resumen tenía dos «Total» («Total para 2 personas $117,184» y debajo «Total con precios
// reales: $76,984»), luego repetía «$76,984 con precio consultado en vivo · $40,200 estimado», 4 insignias
// seguidas, y Comprar decía «Total del viaje con tu selección» con todo «aún sin elegir». Ahora: una cifra
// principal con su etiqueta, una línea «De eso…», las insignias por rubro plegadas, y los MISMOS números.
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: null } }) },
    from: () => ({ select: () => ({ eq: () => ({ then: (r: any) => r({ data: [], error: null }) }) }) }),
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));

import TOKIO from "./fixtures/demo23octTokio.json";
import { RealTripTotal, tripTotals } from "@/components/RealTripTotal";
import { BookingStateBadge } from "@/components/BookingStateBadge";
import { TripPurchasePlan } from "@/components/booking/TripPurchasePlan";
import { quoteTrust } from "@/lib/quoteTrust";
import { computeTripDesglose, quoteValidity } from "@/lib/quote";
import { buildBuyFlow } from "@/lib/buyFlow";
import { tripTotalSummary } from "@/lib/tripTotal";
import { splitTripTotal } from "@/lib/totalSplit";

const visibleText = (root: HTMLElement) => {
  const clone = root.cloneNode(true) as HTMLElement;
  // Lo plegado (details cerrado, salvo su summary) no se ve.
  const closed = [...clone.querySelectorAll("details:not([open])"), ...(clone.matches("details:not([open])") ? [clone] : [])];
  closed.forEach((d) => { [...d.children].forEach((c) => { if (c.tagName !== "SUMMARY") c.remove(); }); });
  return clone.textContent ?? "";
};

describe("P1-3 · Resumen: una sola cifra de total", () => {
  const trip = { total_estimado: 117184, vuelos_json: [{}], hospedaje_json: [], desglose_presupuesto: { vuelos: 32380, hospedaje: 44604, comida: 25200, tours: 7000, transporte_local: 3000, extras: 5000 } };
  const trust = quoteTrust({
    valid_until: new Date(Date.now() + 3600_000).toISOString(),
    line_items: [
      { category: "vuelos", label: "Vuelos", amount: 32380, state: "COTIZADO" },
      { category: "hospedaje", label: "Hospedaje", amount: 44604, state: "COTIZADO" },
      { category: "comida", label: "Comida", amount: 25200, state: "ESTIMADO" },
      { category: "tours", label: "Experiencias", amount: 7000, state: "ESTIMADO" },
      { category: "transporte_local", label: "Transporte local", amount: 3000, state: "ESTIMADO" },
      { category: "extras", label: "Extras", amount: 5000, state: "ESTIMADO" },
    ],
  });
  const split = { total: 117184, real: 76984, estimado: 40200, realParts: ["vuelo", "hotel"], estParts: ["comida", "experiencias", "transporte local", "extras"] } as any;

  it("la cifra grande, por persona y noches en una línea, y «De eso…» en una sola línea secundaria", () => {
    render(<RealTripTotal trip={trip} noches={7} viajeros={2} trust={trust} split={split}><div>desglose</div></RealTripTotal>);
    const card = screen.getByTestId("trip-total-card");
    const seen = visibleText(card);
    expect(screen.getByTestId("trip-total-amount")).toHaveTextContent("$117,184 MXN");
    expect(screen.getByTestId("trip-total-reparto")).toHaveTextContent("De eso, $76,984 MXN con precio en vivo y $40,200 MXN estimado.");
    // Un solo «Total…» con cifra a la vista; nada de «Total con precios reales» ni el resumen repetido.
    expect(seen).not.toMatch(/Total con precios reales/);
    expect(seen).not.toMatch(/con precio consultado en vivo/);
    expect(seen.match(/\$76,984 MXN/g)).toHaveLength(1);
    expect(seen).toMatch(/\$58,592 MXN por persona · 7 noches/);
    // El detalle por rubro (en vivo / estimado) sigue, plegado en «Ver desglose del total».
    const row = document.querySelector('[data-trust="verificado"]')!;
    expect(row.closest("details")).not.toBeNull();
  });

  it("los números no cambian: mismo total que tripTotals", () => {
    expect(tripTotals(trip, 2, null).total).toBe(117184);
    render(<RealTripTotal trip={trip} noches={7} viajeros={2} split={split} />);
    expect(screen.getByTestId("trip-total-amount")).toHaveTextContent("$117,184 MXN");
  });

  it("insignias: una a la vista, el estado por rubro plegado", () => {
    const summary = { estado: "cotizado", label: "Cotizado · sin reservar", por_tipo: { vuelo: "cotizado", hospedaje: "cotizado", tour: "cotizado" }, reservas_confirmadas: 0, clics_sin_confirmar: 0 } as never;
    render(<BookingStateBadge summary={summary} estimated={["tour"]} />);
    const box = screen.getByLabelText("Estado de reservas del viaje");
    const seen = visibleText(box);
    expect(seen).toMatch(/Cotizado · incluye estimados · sin reservar/);
    expect(seen).not.toMatch(/Vuelo: Cotizado/);
    expect(screen.getByText("Vuelo: Cotizado · no reservado").closest("details")).not.toBeNull();
  });
});

describe("P1-3 · Comprar: sin «Total con tu selección» si no hay nada elegido", () => {
  const trip = TOKIO as any;
  const page = (sel: any) => {
    const desglose = computeTripDesglose(trip, { ...sel, nochesHospedaje: 10 }, trip.num_viajeros);
    const total = tripTotals(trip, trip.num_viajeros, desglose).total;
    const items = buildBuyFlow(trip, sel, {}).items;
    return { desglose, total, items, summary: tripTotalSummary({ trip, sel, desglose, items }) };
  };
  const NONE = { selVuelo: -1, selHospedaje: -1, selTours: new Set<number>(), selHoteles: {} };

  it("nada elegido: «Total estimado del viaje», misma cifra y una línea «De eso…»", () => {
    const { desglose, total, summary, items } = page(NONE);
    render(<MemoryRouter><TripPurchasePlan trip={trip} selVuelo={-1} selHospedaje={-1} selTours={new Set()} bookings={[]} userId={null}
      selectionTotal={total} selectionDesglose={desglose} estimadosNote={summary.estimadosNote} /></MemoryRouter>);
    const row = screen.getByTestId("comprar-listo-total");
    expect(screen.getByTestId("comprar-listo-total-label")).toHaveTextContent(/^Total estimado del viaje/);
    expect(row.textContent).not.toMatch(/con tu selección/);
    expect(row.textContent).toContain(`$${total.toLocaleString("es-MX")} MXN`);
    const sp = splitTripTotal({ trip, sel: { selVuelo: -1, selTours: new Set() }, desglose, items });
    if (sp.real > 0 && sp.estimado > 0) {
      // R4 P2-7: con la cotización vencida dice «con precio consultado hace …», no «en vivo».
      const age = quoteValidity(trip, null).age;
      expect(screen.getByTestId("comprar-listo-reparto")).toHaveTextContent(`De eso, $${sp.real.toLocaleString("es-MX")} MXN ${age ? `con precio consultado ${age}` : "con precio en vivo"} y $${sp.estimado.toLocaleString("es-MX")} MXN estimado.`);
    }
    expect(screen.queryByText(/Total con precios reales/)).toBeNull();
  });

  it("con algo elegido: «Total del viaje con tu selección»", () => {
    const sel = { ...NONE, selVuelo: 0 };
    const { desglose, total, summary } = page(sel);
    render(<MemoryRouter><TripPurchasePlan trip={trip} selVuelo={0} selHospedaje={-1} selTours={new Set()} bookings={[]} userId={null}
      selectionTotal={total} selectionDesglose={desglose} estimadosNote={summary.estimadosNote} /></MemoryRouter>);
    expect(screen.getByTestId("comprar-listo-total-label")).toHaveTextContent(/^Total del viaje con tu selección/);
  });
});
