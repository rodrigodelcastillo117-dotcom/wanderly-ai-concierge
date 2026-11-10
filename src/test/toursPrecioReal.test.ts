// Recorrido 10-nov-2026 (Cancún familiar): «Museo Maya, $900 por persona» era un precio que puso la IA (estado ESTIMADO).
// Regla: un tour sin precio de fuente real no tiene precio. No se suma como precio ni va en el correo de la selección.
import { describe, expect, it } from "vitest";
import { computeTripDesglose } from "@/lib/quote";
import { tourHasRealPrice } from "@/lib/tripPicks";

const trip = {
  id: "t", num_viajeros: 4, desglose_presupuesto: { vuelos: 16828, hospedaje: 80315, tours: 14000, comida: 12000 },
  tours_json: [
    { nombre: "Museo Maya", precio_por_persona: 900, estado_dato: "ESTIMADO", fuente: "google_places" },
    { nombre: "Xcaret", precio_por_persona: 2900, estado_dato: "CONSULTADO_EN_VIVO", fuente: "viator" },
    { nombre: "Playa Delfines", precio_por_persona: 0, estado_dato: "ESTIMADO" },
  ],
};
const sel = (tours: number[]) => ({ selVuelo: -1, selHospedaje: -1, nochesHospedaje: 5, selTours: new Set(tours) });

describe("experiencias: solo precios reales", () => {
  it("tourHasRealPrice: el ESTIMADO no cuenta", () => {
    expect(tourHasRealPrice(trip.tours_json[0])).toBe(false);
    expect(tourHasRealPrice(trip.tours_json[1])).toBe(true);
  });
  it("solo tours con precio real: suma su precio × viajeros", () => {
    expect(computeTripDesglose(trip, sel([1]), 4).tours).toBe(2900 * 4);
  });
  it("con un tour de precio inventado: el renglón queda en el estimado de la cotización (no $900 × 4)", () => {
    expect(computeTripDesglose(trip, sel([0]), 4).tours).toBe(14000);
    // real + estimado: nunca menos que lo real
    expect(computeTripDesglose(trip, sel([0, 1]), 4).tours).toBe(14000);
    expect(computeTripDesglose({ ...trip, desglose_presupuesto: { tours: 5000 } }, sel([0, 1]), 4).tours).toBe(11600);
  });
});

describe("correo de la selección: la experiencia con precio de la IA va sin precio (cliente y servidor)", () => {
  it("Tepoztlán + un tour ESTIMADO elegido: la petición pasa la validación y el tour va sin precio", async () => {
    const { tepozNuevo } = await import("./fixtures/casoTepoztlan");
    const { buildSelectionRequest } = await import("@/lib/selectionEmail");
    const { tripTotals } = await import("@/components/RealTripTotal");
    const { validateSelectionRequest } = await import("../../supabase/functions/_shared/selection-email");
    const t = { ...(await tepozNuevo()), tours_json: [{ nombre: "Museo de Tepoztlán", precio_por_persona: 900, estado_dato: "ESTIMADO", fuente: "google_places" }] };
    const sel = { selVuelo: 1, selHospedaje: 0, selTours: new Set([0]), selHoteles: {} as Record<string, number> };
    const d = computeTripDesglose(t, { ...sel, nochesHospedaje: 2 }, 2);
    const r = buildSelectionRequest(t, sel, { travelers: 2, nights: 2, desglose: d, total: tripTotals(t, 2, d).total });
    expect(r.ready).toBe(true);
    const act = (r.payload as any).items.find((x: any) => x.kind === "actividad");
    expect(act.price).toBeNull();
    const v = validateSelectionRequest({ ...r.payload, trip_id: t.id }, { trip: t, now: new Date("2026-10-27T16:00:00Z") }) as any;
    expect(v.ok ? 'ok' : `${v.code}: ${v.message}`).toBe('ok');
    // Si alguien manda el precio de la IA, el servidor no lo acepta.
    const forjado = { ...r.payload, trip_id: t.id, items: (r.payload as any).items.map((x: any) => x.kind === "actividad" ? { ...x, price: 1800 } : x) };
    expect((validateSelectionRequest(forjado, { trip: t, now: new Date("2026-10-27T16:00:00Z") }) as any).code).toBe("precio_no_coincide");
  });
});
