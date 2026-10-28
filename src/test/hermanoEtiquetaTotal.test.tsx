// Defecto 5 (E2E 28-oct-2026, Nueva York): el mismo monto decía "Hospedaje · en vivo $25,060" en los
// renglones de la cotización y "$25,060 estimado" en "Ver desglose del total". Ahora una sola lista de
// rubros estimados (estimatedRubros) etiqueta los dos lugares, y no elegir todavía no vuelve "estimado"
// un precio consultado en vivo.
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { CASO_TRIP } from "./fixtures/casoRomaFlorenciaVenecia";
import { estimatedRubros, tripTotalSummary } from "@/lib/tripTotal";
import { buildBuyFlow } from "@/lib/buyFlow";
import { computeTripDesglose } from "@/lib/quote";
import { alignTrust, quoteTrust } from "@/lib/quoteTrust";
import { RealTripTotal } from "@/components/RealTripTotal";
import { ReadonlyBudget } from "@/components/ReadonlyBudget";

const NOW = new Date("2026-10-22T16:00:00Z");
const sel = { selVuelo: -1, selHospedaje: -1, selTours: [] as number[], selHoteles: {} as Record<string, number> };

function setup() {
  const items = buildBuyFlow(CASO_TRIP, sel).items;
  const desglose = computeTripDesglose(CASO_TRIP, { ...sel, nochesHospedaje: 10, selTours: new Set() }, 2);
  const summary = tripTotalSummary({ trip: CASO_TRIP, sel, desglose, items, now: NOW });
  // Snapshot de la cotización: hospedaje y vuelo consultados (COTIZADO), comida estimada.
  const snapshot = {
    valid_until: "2026-10-23T15:00:00Z",
    line_items: Object.entries(desglose).map(([category, amount]) => ({
      category, amount, state: category === "hospedaje" || category === "vuelos" ? "COTIZADO" : "ESTIMADO",
    })),
  };
  const trust = quoteTrust(snapshot, NOW);
  const keys = estimatedRubros(summary, trust);
  return { desglose, summary, trust, keys, aligned: alignTrust(trust, keys) };
}

describe("una sola etiqueta por rubro", () => {
  it("hotel con precio en vivo aún sin elegir: no es 'estimado' en el desglose", () => {
    const { summary } = setup();
    expect(summary.estimatedKeys).not.toContain("hospedaje");
    // El vuelo de la cotización es un estimado de referencia (Aviasales, fechas cercanas): sí lo es.
    expect(summary.estimatedKeys).toContain("vuelos");
  });

  it("cada renglón de la cotización dice lo mismo que el desglose", () => {
    const { aligned, keys } = setup();
    for (const l of aligned.lines) expect(l.trust === "estimado").toBe(keys.includes(l.category));
    // El vuelo venía como COTIZADO en el snapshot, pero el total lo suma sin tarifa real: estimado en los dos.
    expect(aligned.lines.find((l) => l.category === "vuelos")?.trust).toBe("estimado");
    expect(aligned.lines.find((l) => l.category === "hospedaje")?.trust).toBe("verificado");
    // La frase y la barra se recalculan con las etiquetas alineadas.
    expect(aligned.verified).toBe(aligned.lines.filter((l) => l.trust === "verificado").reduce((s, l) => s + l.amount, 0));
  });

  it("en pantalla: 'Hospedaje · en vivo' arriba y sin 'estimado' en el desglose; 'Vuelos' estimado en los dos", () => {
    const { desglose, summary, keys, aligned } = setup();
    const total = Object.values(desglose).reduce((a, b) => a + b, 0);
    render(
      <RealTripTotal trip={CASO_TRIP} noches={10} viajeros={2} trust={aligned} summary={summary} selectionDesglose={desglose}>
        <ReadonlyBudget desglose={desglose} total={total} travelers={2} embedded estimatedKeys={keys} />
      </RealTripTotal>,
    );
    const lines = screen.getAllByText((_, el) => el?.getAttribute("data-trust") != null && el.tagName === "LI");
    const hotelLine = lines.find((li) => /Hospedaje/.test(li.textContent ?? ""))!;
    expect(hotelLine.textContent).toMatch(/en vivo/);
    const vueloLine = lines.find((li) => /Vuelos/.test(li.textContent ?? ""))!;
    expect(vueloLine.textContent).toMatch(/estimado/);
    const desg = screen.getByTestId("trip-desglose");
    const rows = within(desg).getAllByText(/^(Hospedaje|Vuelos)$/).map((n) => n.closest("li") ?? n.parentElement!.parentElement!);
    const hotelRow = rows.find((r) => /Hospedaje/.test(r.textContent ?? ""))!;
    const vueloRow = rows.find((r) => /Vuelos/.test(r.textContent ?? ""))!;
    expect(hotelRow.textContent).not.toMatch(/estimado/);
    expect(vueloRow.textContent).toMatch(/estimado/);
  });
});
