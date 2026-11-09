// Road trip desde casa (recorrido 9-nov-2026): «Road trip en coche desde CDMX a Querétaro, San Miguel de Allende y
// Guanajuato» cotizaba un VUELO CDMX → Querétaro ($8,004 estimado), traslados a aeropuertos y «Vigila el precio de
// tus vuelos». Ahora: sin vuelos, «Cómo llegar» = tu coche (gasolina + casetas), sin paso de renta de auto.
import { describe, expect, it } from "vitest";
import L0 from "./fixtures/roadTripBajioLogistics.json";
import { conRutas, filaLlegadaTierra, gasolinaTramoMxn, llegadaPorTierra, totalLlegadaTierra } from "../../supabase/functions/_shared/llegadaTierra.ts";
import { makeStop, routeOfSpec, emptySpec } from "../../supabase/functions/_shared/tripSpec.ts";
import { multiDestTripInsert } from "@/lib/multiDestGenerate";
import { buildBuyFlow } from "@/lib/buyFlow";
import { arrivalByLand, arrivalStepTitle } from "@/lib/groundTrip";
import { nextTripAction } from "@/lib/tripCommand";

const STOPS = ["Querétaro", "San Miguel de Allende", "Guanajuato"];

describe("llegadaPorTierra", () => {
  it("dijo coche: por tierra aunque no sepa la distancia del regreso", () => {
    const t = llegadaPorTierra("Ciudad de México", STOPS, { arrival_mode: "coche" })!;
    expect(t).toMatchObject({ modo: "coche", origen: "Ciudad de México", primera: "Querétaro", ultima: "Guanajuato" });
    expect(t.costo_auto?.gasolina.total_mxn).toBeGreaterThan(0);
  });
  it("sin decir nada, a menos de 300 km de casa: por tierra; lejos (Europa): con vuelo", () => {
    expect(llegadaPorTierra("Ciudad de México", ["Puebla", "Cholula"], {})).not.toBeNull();
    expect(llegadaPorTierra("Ciudad de México", ["Madrid", "París"], {})).toBeNull();
  });
  it("dijo avión de ida o de regreso: con vuelo", () => {
    expect(llegadaPorTierra("Ciudad de México", STOPS, { arrival_mode: "coche", return_mode: "avion" })).toBeNull();
    expect(llegadaPorTierra("Ciudad de México", ["Puebla", "Cholula"], { arrival_mode: "avion" })).toBeNull();
  });
  it("con las rutas de Google: km reales y casetas de ida + regreso (no «ida × 2»)", () => {
    const toll = (m: number) => ({ estado: "CON_MONTO", montos: [], monto_mxn: m, fx: [], fuente: "google_routes", consultado_at: "2026-11-09T00:00:00Z", pase: null, from_cache: false });
    const t = conRutas(llegadaPorTierra("Ciudad de México", STOPS, { arrival_mode: "coche" })!,
      { ok: true, distance_meters: 215000, duration_seconds: 9000, tolls: toll(300) as any },
      { ok: true, distance_meters: 360000, duration_seconds: 15000, tolls: toll(450) as any });
    expect(t).toMatchObject({ km_ida: 215, km_regreso: 360, fuente_km: "google_routes", horas_ida: 2.5, casetas_ida_mxn: 300, casetas_regreso_mxn: 450 });
    expect(t.costo_auto!.casetas.total_mxn).toBe(750);
    expect(t.costo_auto!.gasolina.km_total).toBe(575);
    expect(totalLlegadaTierra(t)).toBe(750 + (gasolinaTramoMxn(575) ?? 0));
    const fila: any = filaLlegadaTierra(t, 2);
    expect(fila).toMatchObject({ modo: "auto", aerolinea: "En tu coche", escalas: "Terrestre", fuente_precio: "estimado" });
    expect(fila.notas).toContain("Casetas: $750 MXN ida + regreso ($300 + $450)");
    expect(fila.duracion).toBe("2.5 h de ida según Google Maps (sin tráfico)");
  });
});

describe("del resumen al plan: la ida y el regreso en coche viajan a logistics-plan", () => {
  it("routeOfSpec lleva llegada y regreso", () => {
    const s: any = { ...emptySpec("x", "ia"), origen: "Ciudad de México", fecha_salida: "2027-04-08", fecha_regreso: "2027-04-13", viajeros: 2,
      paradas: STOPS.map((c, i) => makeStop(c, { llegada_por: "coche", noches: [2, 2, 1][i] })), regreso: { a: "Ciudad de México", via: null, modo: "coche" }, preguntas: [] };
    expect(routeOfSpec(s)).toMatchObject({ kind: "multi", llegada: "coche", regresoModo: "coche" });
  });
});

describe("el viaje guardado: «Cómo llegar» en tu coche, sin vuelo", () => {
  const t = llegadaPorTierra("Ciudad de México", STOPS, { arrival_mode: "coche" })!;
  const L: any = { ...L0, flights: [], llegada_por_tierra: t };
  const row: any = multiDestTripInsert({ userId: "u", origin: "Ciudad de México", stops: STOPS, viajeros: 2, prefs: {}, fechaSalida: "2027-04-08", fechaRegreso: "2027-04-13" } as any, L);
  const trip = { ...row, id: "t1", num_viajeros: 2 };
  it("vuelos_json = el coche; por tierra; «Cómo llegar»", () => {
    expect(trip.vuelos_json).toHaveLength(1);
    expect(trip.vuelos_json[0]).toMatchObject({ modo: "auto", aerolinea: "En tu coche" });
    expect(arrivalByLand(trip)).toBe(true);
    expect(arrivalStepTitle(trip)).toBe("Cómo llegar");
  });
  it("Comprar: el primer paso es tu coche con su costo y no hay renta de auto", () => {
    const f = buildBuyFlow(trip, { selVuelo: -1, selHospedaje: -1, selTours: new Set() });
    expect(f.steps[0]).toMatchObject({ kind: "vuelo", title: "Cómo llegar" });
    expect((f.steps[0] as any).item).toMatchObject({ title: "En tu coche", price: t.costo_auto!.total_mxn });
    expect(f.steps.some((s: any) => s.kind === "auto")).toBe(false);
  });
  it("lo que sigue habla de cómo llegar, no de vuelo", () => {
    const n = nextTripAction(trip as any, { today: "2026-11-09" });
    expect(JSON.stringify(n)).not.toMatch(/vuelo/i);
  });
});

import { nextPlanStep } from "@/lib/planDirect";
describe("ruta con «En coche (road trip)»", () => {
  it("todos los tramos en coche y la casa a ≤ 800 km: se sale manejando de casa", () => {
    expect(llegadaPorTierra("Ciudad de México", STOPS, { transport_mode: "coche" })).toMatchObject({ modo: "coche" });
    expect(llegadaPorTierra("Monterrey", ["Saltillo", "Zacatecas"], { transport_mode: "mixto", leg_modes: ["coche"] })).not.toBeNull();
  });
  it("road trip en Europa saliendo de CDMX: con vuelo", () => {
    expect(llegadaPorTierra("Ciudad de México", ["Madrid", "Toledo", "Córdoba"], { transport_mode: "coche" })).toBeNull();
  });
  it("«Road trip en coche…» llega a la ruta con modo=coche", () => {
    const s: any = { ...emptySpec("Road trip en coche desde Ciudad de México a Querétaro, San Miguel de Allende y Guanajuato", "local"), origen: "Ciudad de México",
      fecha_salida: "2027-04-08", fecha_regreso: "2027-04-13", viajeros: 2, paradas: STOPS.map((c) => makeStop(c)), preguntas: [] };
    const n = nextPlanStep(s);
    expect(n.kind).toBe("ruta");
    expect(new URLSearchParams((n as any).qs).get("modo")).toBe("coche");
  });
});
