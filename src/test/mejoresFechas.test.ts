// «Mejores fechas para viajar al lugar por precios» (pedido del dueño, 10-nov-2026): meses y días más baratos de una
// ruta con el calendario de Aviasales (grouped_prices). Respuestas con el formato del ejemplo de la documentación.
import { describe, expect, it, vi } from "vitest";
import { diasBaratos, mejoresFechas, mesesBaratos } from "../../supabase/functions/_shared/mejoresFechas";

const want = { origin: "MEX", destination: "CUN" };
const t = (dep: string, ret: string | null, price: number, extra: Record<string, unknown> = {}) => ({
  origin: "MEX", destination: "CUN", origin_airport: "MEX", destination_airport: "CUN", price, airline: "VB", transfers: 0,
  departure_at: `${dep}T06:40:00-06:00`, ...(ret ? { return_at: `${ret}T20:00:00-05:00` } : {}), duration_to: 135, ...extra,
});
const POR_MES = {
  "2026-11": t("2026-11-05", null, 60), // ya pasó (hoy 10-nov)
  "2026-12": t("2026-12-14", "2026-12-19", 150),
  "2027-01": t("2027-01-20", "2027-01-26", 95),
  "2027-02": t("2027-02-03", "2027-02-08", 110),
  "2027-03": { ...t("2027-03-10", null, 70), destination: "MAD", destination_airport: "MAD" }, // otra ruta: fuera
};
const POR_DIA = {
  "2027-01-12": t("2027-01-12", "2027-01-18", 120),
  "2027-01-20": t("2027-01-20", "2027-01-26", 95),
  "2027-01-21": t("2027-01-21", "2027-01-27", 99),
  "2027-01-29": t("2027-01-29", null, 101),
};

describe("mejores fechas por precio", () => {
  it("meses de más barato a más caro; sin meses pasados ni tarifas de otra ruta", () => {
    const m = mesesBaratos(POR_MES, want, 20, "2026-11-10");
    expect(m.map((x) => [x.mes, x.precio_mxn_pp])).toEqual([["2027-01", 1900], ["2027-02", 2200], ["2026-12", 3000]]);
    expect(m[0]).toMatchObject({ etiqueta: "enero 2027", ida_y_vuelta: true, salida: "2027-01-20" });
  });
  it("días más baratos del mes, con ida o ida y vuelta dicho", () => {
    const d = diasBaratos(POR_DIA, want, 20, "2026-11-10");
    expect(d.map((x) => [x.salida, x.precio_mxn_pp])).toEqual([["2027-01-20", 1900], ["2027-01-21", 1980], ["2027-01-29", 2020], ["2027-01-12", 2400]]);
    expect(d[2]).toMatchObject({ ida_y_vuelta: false, regreso: null, aerolinea: "VB", escalas: 0 });
  });
  it("llama a grouped_prices por mes y por día con el token en el encabezado", async () => {
    const fetchImpl = vi.fn(async (url: string) => new Response(JSON.stringify({ success: true, data: /group_by=month/.test(url) ? POR_MES : POR_DIA })));
    const r = await mejoresFechas({ origen: "mex", destino: "CUN", mes: "2027-01" }, { token: "tk", usdMxn: 20, hoyISO: "2026-11-10", fetchImpl: fetchImpl as any });
    expect(r.ok).toBe(true);
    expect(r.meses[0].mes).toBe("2027-01");
    expect(r.dias[0].salida).toBe("2027-01-20");
    expect(r.nota).toMatch(/NO precios en vivo/);
    expect(r.google_flights).toMatch(/^https:\/\/www\.google\.com\/travel\/flights/);
    const urls = fetchImpl.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => /group_by=month/.test(u))).toBe(true);
    expect(urls.some((u) => /group_by=departure_at/.test(u) && /departure_at=2027-01/.test(u))).toBe(true);
    expect(((fetchImpl.mock.calls[0] as any[])[1] as any).headers["X-Access-Token"]).toBe("tk");
  });
  it("sin token, sin ruta o sin datos: lo dice (nunca inventa un mes barato)", async () => {
    expect((await mejoresFechas({ origen: "MEX", destino: "CUN" }, { token: "", usdMxn: 20, hoyISO: "2026-11-10" })).motivo).toBe("sin_token");
    expect((await mejoresFechas({ origen: "MEX", destino: "MEX" }, { token: "tk", usdMxn: 20, hoyISO: "2026-11-10" })).motivo).toBe("sin_ruta");
    const vacio = vi.fn(async () => new Response(JSON.stringify({ success: true, data: {} })));
    const r = await mejoresFechas({ origen: "MEX", destino: "CUN" }, { token: "tk", usdMxn: 20, hoyISO: "2026-11-10", fetchImpl: vacio as any });
    expect(r).toMatchObject({ ok: false, motivo: "sin_datos", meses: [], dias: [] });
    const falla = vi.fn(async () => { throw new Error("red"); });
    expect((await mejoresFechas({ origen: "MEX", destino: "CUN" }, { token: "tk", usdMxn: 20, hoyISO: "2026-11-10", fetchImpl: falla as any })).motivo).toBe("sin_datos");
  });
});

describe("Iato: «¿cuándo es más barato ir a…?»", () => {
  it("detecta la pregunta y propone best_travel_dates; no confunde otras preguntas", async () => {
    const { cheapDatesRequested, detectIntents, planTurn, toolStatusText } = await import("../../supabase/functions/concierge-chat/planner");
    for (const q of ["¿Cuándo es más barato ir a Cancún?", "¿Qué mes conviene por precio para ir a Madrid?", "mejores fechas para volar a Tokio por precio", "¿en qué fechas sale más barato el vuelo a Lima?"]) {
      expect(cheapDatesRequested(q), q).toBe(true);
      expect(detectIntents(q)).toContain("cheap_dates");
    }
    for (const q of ["¿Es barato comer en Japón?", "¿Cuándo sale mi vuelo?", "¿Qué hago el sábado en Mérida?"]) expect(cheapDatesRequested(q), q).toBe(false);
    expect(toolStatusText("best_travel_dates", { destination: "Cancún" })).toBe("Buscando las fechas más baratas a Cancún (Aviasales)…");
    expect(typeof planTurn).toBe("function");
  });
  it("la herramienta existe, pide origen y destino y dice que no es precio en vivo", async () => {
    const { TOOL_DEFS, validateToolInput } = await import("../../supabase/functions/concierge-chat/toolDefs");
    const def = TOOL_DEFS.find((t) => t.name === "best_travel_dates")!;
    expect(def.description).toMatch(/no en vivo/);
    expect(validateToolInput("best_travel_dates", { destination: "Cancún", origin: "Ciudad de México" }).ok).toBe(true);
    expect(validateToolInput("best_travel_dates", { destination: "Cancún" }).ok).toBe(false);
  });
});
