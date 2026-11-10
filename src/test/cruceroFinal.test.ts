// Crucero al final (recorrido 9-nov-2026, «Vuelo a Miami, 2 noches en Miami, crucero de 5 noches Miami → Miami»):
// el plan repartía 1 + 1 noches y ponía «Hotel en Miami» después del crucero; el tramo salía como «Ferry».
import { describe, expect, it } from "vitest";
import L0 from "./fixtures/cruceroMiamiLogistics.json";
import IATO from "./fixtures/cruceroMiamiIato.json";
import { multiDestTripInsert, logisticsPlanArgs } from "@/lib/multiDestGenerate";
import { buildBuyFlow } from "@/lib/buyFlow";
import { finalizeSpec } from "@/lib/tripSpecLocal";
import { routeOfSpec, setTripBasics } from "../../supabase/functions/_shared/tripSpec.ts";

const Q = "Vuelo de Ciudad de México a Miami, 2 noches en Miami, luego crucero de 5 noches por el Caribe con Royal Caribbean que sale de Miami y regresa a Miami, 2 adultos";

describe("crucero al final del viaje", () => {
  it("el resumen manda Miami 2 noches y 0 en el puerto final (desembarca y vuela a casa)", () => {
    const s = setTripBasics(finalizeSpec(IATO as any, Q, { origen: "Ciudad de México" }), { fecha_salida: "2027-03-06" });
    expect(s.fecha_regreso).toBe("2027-03-13");
    const r: any = routeOfSpec(s);
    expect(r).toMatchObject({ kind: "multi", noches: [2, 0], destinos: ["Miami", "Miami"] });
    const args: any = logisticsPlanArgs({ userId: null, origin: r.origen, stops: r.destinos, viajeros: 2, prefs: {}, nightsPerCity: r.noches, seaLegs: r.seaLegs, fechaSalida: r.fecha_salida, fechaRegreso: r.fecha_regreso } as any);
    expect(args.nights_per_city).toEqual([2, 0]);
  });
  it("Comprar: vuelo, hotel en Miami (2 noches), el crucero con la naviera; sin hotel después del crucero", () => {
    const L: any = JSON.parse(JSON.stringify(L0));
    L.per_destination[0] = { ...L.per_destination[0], checkin: "2027-03-06", checkout: "2027-03-08", nights: 2 };
    L.per_destination[1] = { ...L.per_destination[1], checkin: "2027-03-13", checkout: "2027-03-13", nights: 0, hospedaje: [] };
    const row: any = multiDestTripInsert({ userId: "u", origin: "Ciudad de México", stops: ["Miami", "Miami"], viajeros: 2, prefs: {}, fechaSalida: "2027-03-06", fechaRegreso: "2027-03-13" } as any, L);
    const f = buildBuyFlow({ ...row, id: "t1", num_viajeros: 2 }, { selVuelo: -1, selHospedaje: -1, selTours: new Set() });
    const titles = f.steps.map((s: any) => s.title);
    expect(titles.filter((t: string) => /^Hotel/.test(t))).toEqual(["Hotel en Miami"]);
    const leg: any = f.steps.find((s: any) => s.kind === "traslado");
    expect(leg.title).toBe("Crucero Royal Caribbean: Miami → Miami");
    expect(leg.date).toBe("2027-03-08");
    expect(leg.item).toMatchObject({ price: null, priceNote: "Precio por cotizar con la naviera · no suma al total", buttonLabel: "Ver en Royal Caribbean" });
    expect(leg.item.url).toMatch(/^https:\/\/www\.royalcaribbean\.com\//);
    expect(JSON.stringify(f.steps)).not.toMatch(/Ferryhopper|Ferry Miami/);
  });
});
