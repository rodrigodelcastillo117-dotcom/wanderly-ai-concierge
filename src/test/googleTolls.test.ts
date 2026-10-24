// Casetas reales de Google Routes (extraComputations TOLLS): monto en MXN, en USD con tasa
// verificable, tollInfo vacío, sin tollInfo, caché de 24 h y que la llave nunca sale en la respuesta.
// Sin llamadas reales: fetch simulado con fixtures del formato documentado.
import { describe, expect, it, vi } from "vitest";
import mxn from "./fixtures/googlemax/routes_tolls_mxn.json";
import usd from "./fixtures/googlemax/routes_tolls_usd.json";
import sinPrecio from "./fixtures/googlemax/routes_tolls_sin_precio.json";
import sinInfo from "./fixtures/googlemax/routes_sin_tollinfo.json";
import { createGoogleTransport } from "../../supabase/functions/_shared/google-maps";
import {
  driveWithTolls, normalizeTollPass, parseMoney, readTollInfo, tollLine, TOLLS_SKU, TOLLS_TTL_SECONDS, withTolls,
} from "../../supabase/functions/_shared/google-tolls";
import { memoryCacheStore } from "../../supabase/functions/_shared/serpCache";
import { computeRoutes } from "../../supabase/functions/get-routes/routes";
import { buildRoadTripPlan } from "../../supabase/functions/_shared/roadtrip/plan";
import { planRoadTrip, tollRouteFn } from "../../supabase/functions/logistics-plan/roadtrip";
import { computeTripDesglose } from "@/lib/quote";

const KEY = "AIzaSECRETOcasetas0000000000";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const NOW = Date.parse("2026-10-24T18:05:00Z");
const CDMX = { address: "Ciudad de México" };
const PUEBLA = { address: "Puebla, México" };
const verified = vi.fn(async (code: string) => (code === "USD" ? { rate: 18.5, source: "frankfurter" as const, fetched_at: "2026-10-23T00:00:00Z", is_fallback: false } : null));
const fallback = async () => ({ rate: 20.5, source: "fallback" as const, fetched_at: "2026-10-22T00:00:00Z", is_fallback: true });

function transport(responder: (url: string, init: RequestInit) => Response) {
  const calls: Array<{ sku: string; ok: boolean }> = [];
  const f = vi.fn(async (url: string, init: RequestInit) => responder(url, init));
  const t = createGoogleTransport({ mapsKey: KEY, lovableKey: "L", fetch: f as unknown as typeof fetch, onCall: (e) => { calls.push({ sku: e.sku, ok: e.ok }); } })!;
  return { t, f, calls };
}
const sentBody = (f: ReturnType<typeof vi.fn>, i = 0) => JSON.parse(String((f.mock.calls[i][1] as RequestInit).body));
const sentMask = (f: ReturnType<typeof vi.fn>, i = 0) => ((f.mock.calls[i][1] as RequestInit).headers as Record<string, string>)["X-Goog-FieldMask"];

describe("casetas: lectura del formato documentado", () => {
  it("Money: units en texto + nanos (omitidos cuando son cero)", () => {
    expect(parseMoney({ currencyCode: "USD", units: "4", nanos: 400000000 })).toEqual({ moneda: "USD", monto: 4.4 });
    expect(parseMoney({ currencyCode: "MXN", units: "412" })).toEqual({ moneda: "MXN", monto: 412 });
    expect(parseMoney({ currencyCode: "MXN" })).toEqual({ moneda: "MXN", monto: 0 });
    expect(parseMoney({ units: "4" })).toBeNull();
  });

  it("pide TOLLS y el pase solo si es de la lista oficial (TAG de México)", () => {
    expect(withTolls({ travelMode: "DRIVE" })).toEqual({ travelMode: "DRIVE", extraComputations: ["TOLLS"] });
    expect(withTolls({ travelMode: "DRIVE" }, "mx_tag_iave").routeModifiers).toEqual({ tollPasses: ["MX_TAG_IAVE"] });
    expect(normalizeTollPass("MX_INVENTADO")).toBeNull();
    expect(normalizeTollPass("US_MA_EZPASSMA")).toBe("US_MA_EZPASSMA");
    expect(withTolls({ travelMode: "DRIVE" }, "x").routeModifiers).toBeUndefined();
  });

  it("tollInfo vacío = hay casetas sin monto; sin tollInfo = no disponible (nunca 'sin casetas')", () => {
    expect(readTollInfo(sinPrecio.routes[0])).toEqual({ estado: "SIN_MONTO", montos: [] });
    expect(readTollInfo(sinInfo.routes[0])).toEqual({ estado: "NO_DISPONIBLE", montos: [] });
    expect(tollLine(null)).toBe("Información de casetas no disponible para esta ruta");
    expect(tollLine({ estado: "SIN_MONTO" } as any)).toBe("Hay casetas en la ruta; Google no publica el monto");
    expect(tollLine(null)).not.toMatch(/sin casetas/i);
  });
});

describe("driveWithTolls (logistics-plan)", () => {
  it("monto en MXN: una llamada con TOLLS, máscara de tollInfo y texto con hora de consulta", async () => {
    const { t, f, calls } = transport(() => json(mxn));
    const r = await driveWithTolls(t, { origin: CDMX, destination: PUEBLA }, { rate: verified, now: () => NOW }) as any;
    expect(r.ok).toBe(true);
    expect(r.distance_meters).toBe(134500);
    expect(r.tolls).toMatchObject({ estado: "CON_MONTO", montos: [{ moneda: "MXN", monto: 412 }], monto_mxn: 412, fx: [], fuente: "google_routes", from_cache: false });
    expect(sentBody(f).extraComputations).toEqual(["TOLLS"]);
    expect(sentMask(f)).toContain("routes.travelAdvisory.tollInfo");
    expect(sentMask(f)).toContain("routes.legs.travelAdvisory.tollInfo");
    expect(calls).toEqual([{ sku: TOLLS_SKU, ok: true }]);
    expect(tollLine(r.tolls, "America/Mexico_City")).toBe("Casetas: $412 MXN · Google Maps · consultado 12:05");
  });

  it("monto en USD con tasa verificable (BCE, con fecha) → MXN; con la tasa de respaldo se queda en USD", async () => {
    const { t } = transport(() => json(usd));
    const r = await driveWithTolls(t, { origin: CDMX, destination: PUEBLA }, { rate: verified, now: () => NOW }) as any;
    expect(r.tolls.monto_mxn).toBe(81); // 4.40 × 18.5
    expect(r.tolls.fx).toEqual([{ moneda: "USD", tasa: 18.5, fuente: "frankfurter", fecha: "2026-10-23T00:00:00Z" }]);
    expect(tollLine(r.tolls, "UTC")).toBe("Casetas: $81 MXN (4.40 USD; tipo de cambio 18.50 MXN/USD, BCE 2026-10-23) · Google Maps · consultado 18:05");

    const { t: t2 } = transport(() => json(usd));
    const r2 = await driveWithTolls(t2, { origin: CDMX, destination: PUEBLA }, { rate: fallback, now: () => NOW }) as any;
    expect(r2.tolls.monto_mxn).toBeNull();
    expect(tollLine(r2.tolls, "UTC")).toBe("Casetas: 4.40 USD · Google Maps · consultado 18:05");
  });

  it("tollInfo vacío y sin tollInfo: nunca hay monto", async () => {
    for (const [fx, estado] of [[sinPrecio, "SIN_MONTO"], [sinInfo, "NO_DISPONIBLE"]] as const) {
      const { t } = transport(() => json(fx));
      const r = await driveWithTolls(t, { origin: CDMX, destination: PUEBLA }, { rate: verified }) as any;
      expect(r.tolls.estado).toBe(estado);
      expect(r.tolls.monto_mxn).toBeNull();
      expect(r.tolls.montos).toEqual([]);
    }
  });

  it("caché de 24 h en serp_cache por origen, destino y pase", async () => {
    let now = NOW;
    const store = memoryCacheStore(() => now);
    const { t, f } = transport(() => json(mxn));
    const a = await driveWithTolls(t, { origin: CDMX, destination: PUEBLA }, { store, rate: verified, now: () => now }) as any;
    now += 3600_000;
    const b = await driveWithTolls(t, { origin: CDMX, destination: PUEBLA }, { store, rate: verified, now: () => now }) as any;
    expect(f).toHaveBeenCalledTimes(1);
    expect(b.from_cache).toBe(true);
    expect(b.tolls.from_cache).toBe(true);
    expect(b.tolls.consultado_at).toBe(a.tolls.consultado_at); // la hora real de la consulta
    expect(b.tolls.monto_mxn).toBe(412);
    expect([...store.rows.values()][0]).toMatchObject({ engine: "google_routes_tolls", ttl_seconds: TOLLS_TTL_SECONDS });
    // Otro pase = otra entrada.
    await driveWithTolls(t, { origin: CDMX, destination: PUEBLA, pase: "MX_TAG_IAVE" }, { store, rate: verified, now: () => now });
    expect(f).toHaveBeenCalledTimes(2);
    expect(sentBody(f, 1).routeModifiers).toEqual({ tollPasses: ["MX_TAG_IAVE"] });
    // Pasadas 24 h se vuelve a consultar.
    now += 24 * 3600_000;
    await driveWithTolls(t, { origin: CDMX, destination: PUEBLA }, { store, rate: verified, now: () => now });
    expect(f).toHaveBeenCalledTimes(3);
  });
});

describe("get-routes: casetas solo en el modo coche", () => {
  it("4 modos = 4 llamadas; TOLLS y tollInfo solo en DRIVE; cada una registrada con su SKU", async () => {
    const { t, f, calls } = transport((_u, init) => json(JSON.parse(String(init.body)).travelMode === "DRIVE" ? mxn : sinInfo));
    const routes = await computeRoutes(t, { origin: CDMX, destination: PUEBLA }, { rate: verified, store: memoryCacheStore() }) as any[];
    expect(f).toHaveBeenCalledTimes(4);
    for (let i = 0; i < 4; i++) {
      const body = sentBody(f, i);
      const mask = sentMask(f, i);
      if (body.travelMode === "DRIVE") {
        expect(body.extraComputations).toEqual(["TOLLS"]);
        expect(mask).toContain("routes.travelAdvisory.tollInfo");
      } else {
        expect(body.extraComputations).toBeUndefined();
        expect(mask).not.toContain("tollInfo");
      }
    }
    const drive = routes.find((r) => r.mode === "DRIVE");
    expect(drive.tolls.monto_mxn).toBe(412);
    expect(drive.tolls_text).toMatch(/^Casetas: \$412 MXN · Google Maps · consultado \d{2}:\d{2}$/);
    expect(routes.find((r) => r.mode === "WALK").tolls).toBeNull();
    expect(calls.map((c) => c.sku).sort()).toEqual(["Compute Routes Enterprise", "Compute Routes Essentials", "Compute Routes Essentials", "Compute Routes Essentials"]);
  });

  it("con casetas en caché, el coche se pide SIN TOLLS y usa las guardadas", async () => {
    const store = memoryCacheStore();
    const { t, f } = transport(() => json(mxn));
    await computeRoutes(t, { origin: CDMX, destination: PUEBLA, modes: ["DRIVE"] }, { store, rate: verified });
    const again = await computeRoutes(t, { origin: CDMX, destination: PUEBLA, modes: ["DRIVE"] }, { store, rate: verified }) as any[];
    expect(sentBody(f, 1).extraComputations).toBeUndefined();
    expect(again[0].tolls).toMatchObject({ monto_mxn: 412, from_cache: true });
  });

  it("la llave nunca sale en la respuesta (ni en errores que la repiten)", async () => {
    const leaky = { error: { code: 403, status: "PERMISSION_DENIED", message: `API key not valid: ${KEY} for https://routes.googleapis.com?key=${KEY}` } };
    const { t } = transport((_u, init) => (JSON.parse(String(init.body)).travelMode === "DRIVE" ? json(leaky, 403) : json(sinInfo)));
    const routes = await computeRoutes(t, { origin: CDMX, destination: PUEBLA }, { rate: verified });
    const out = JSON.stringify(routes);
    expect(out).not.toContain(KEY);
    expect(out).not.toContain("AIza");
    expect(routes.find((r: any) => r.mode === "DRIVE")).toMatchObject({ available: false });
    const ok = await driveWithTolls(transport(() => json(mxn)).t, { origin: CDMX, destination: PUEBLA }, { rate: verified });
    expect(JSON.stringify(ok)).not.toContain(KEY);
  });
});

describe("plan del road trip y total del viaje", () => {
  const legOk = (tolls: any) => ({ ok: true, distance_meters: 134500, duration_seconds: 7980, consultado_at: "2026-10-24T18:05:00Z", tolls });
  const q = (over: any) => ({ estado: "CON_MONTO", montos: [{ moneda: "MXN", monto: 412 }], monto_mxn: 412, fx: [], fuente: "google_routes", consultado_at: "2026-10-24T18:05:00Z", pase: null, from_cache: false, ...over });

  it("con monto real: renglón CONSULTADO y suma en vivo; sin monto: no suma nada y avisa", () => {
    const p = buildRoadTripPlan({
      stops: ["Ciudad de México", "Puebla", "Oaxaca"], legModes: ["coche", "coche"],
      live: [legOk(q({})), legOk(q({ estado: "SIN_MONTO", montos: [], monto_mxn: null }))],
    })!;
    expect(p.casetas.mxn_en_vivo).toBe(412);
    expect(p.casetas.tramos_con_monto).toBe(1);
    expect(p.casetas.faltan).toEqual([{ index: 1, from: "Puebla", to: "Oaxaca", motivo: "Hay casetas en la ruta; Google no publica el monto" }]);
    expect(p.costs.find((c) => c.id === "casetas-0")).toMatchObject({ monto: 412, moneda: "MXN", estado: "CONSULTADO" });
    const missing = p.costs.find((c) => c.id === "peajes")!;
    expect(missing.monto).toBeNull();
    expect(missing.detalle).toMatch(/no se suma nada al total/);
    expect(p.totals_by_currency.MXN).toBe(412);
  });

  it("monto en otra moneda sin tasa: se muestra en su moneda y no entra al total en MXN", () => {
    const p = buildRoadTripPlan({ stops: ["Florencia", "Siena"], legModes: ["coche"], live: [legOk(q({ montos: [{ moneda: "EUR", monto: 3.6 }], monto_mxn: null }))] })!;
    expect(p.casetas.mxn_en_vivo).toBe(0);
    expect(p.costs.find((c) => c.id === "casetas-0-EUR")).toMatchObject({ monto: 3.6, moneda: "EUR", estado: "CONSULTADO" });
    expect(p.casetas.faltan[0].motivo).toMatch(/sin tipo de cambio verificable/);
  });

  it("logistics-plan: la llamada del tramo usa TOLLS, cuenta como no cobrada si viene de caché", async () => {
    const store = memoryCacheStore();
    const { t, f } = transport(() => json(mxn));
    const route = tollRouteFn(t, store, { rate: verified });
    const a = await planRoadTrip({ destinations: ["Ciudad de México", "Puebla"], legModes: ["coche"], legDates: [null], route, apiSku: { sku: TOLLS_SKU, usdPerCall: 0.015, freePerMonth: 1000 } });
    expect(a!.legs[0].tolls?.monto_mxn).toBe(412);
    expect(a!.api).toMatchObject({ sku: TOLLS_SKU, calls: 1, list_price_usd: 0.015 });
    const b = await planRoadTrip({ destinations: ["Ciudad de México", "Puebla"], legModes: ["coche"], legDates: [null], route, apiSku: { sku: TOLLS_SKU, usdPerCall: 0.015, freePerMonth: 1000 } });
    expect(f).toHaveBeenCalledTimes(1);
    expect(b!.api.calls).toBe(0);
  });

  it("computeTripDesglose conserva las casetas en vivo del servidor (y no agrega el renglón si no hay)", () => {
    const sel = { selVuelo: -1, selHospedaje: -1, nochesHospedaje: 0, selTours: new Set<number>() };
    expect(computeTripDesglose({ desglose_presupuesto: { vuelos: 1000, casetas: 412 } }, sel, 1).casetas).toBe(412);
    expect("casetas" in computeTripDesglose({ desglose_presupuesto: { vuelos: 1000 } }, sel, 1)).toBe(false);
  });
});
