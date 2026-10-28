// Defecto 7 del E2E en producción (28-oct-2026): Iato no sabía el clima ("No tengo una herramienta de
// pronóstico del clima") y, con el viaje a Madrid elegido, la búsqueda web "no respondió" y adivinó
// "13–15 °C / 4–6 °C" cuando la pantalla Clima decía 14°/2°. Ahora Iato usa la MISMA fuente y el MISMO
// cálculo que la pantalla (MET Norway + NASA POWER) y, sin datos, no da cifras.
import { describe, expect, it } from "vitest";
import { runWeather, weatherRequested, WEATHER_USER_AGENT } from "../../supabase/functions/_shared/weather";
import { buildCityWeather } from "@/lib/tripWeather";
import { detectIntents, leadSentence, planTurn } from "../../supabase/functions/concierge-chat/planner";
import { TOOL_DEFS, validateToolInput } from "../../supabase/functions/concierge-chat/toolDefs";
import { prepareToolResultForModel } from "../../supabase/functions/concierge-chat/cards";
import { runWebSearch } from "../../supabase/functions/concierge-chat/webSearch";

function metSeries(from: string, to: string) {
  const ts: any[] = [];
  for (let t = Date.parse(from), i = 0; t <= Date.parse(to); i++) {
    const hourly = t - Date.parse(from) < 60 * 3600_000;
    const temp = 12 + 6 * Math.sin(((new Date(t).getUTCHours() - 8) / 24) * 2 * Math.PI);
    const data: any = { instant: { details: { air_temperature: Math.round(temp * 10) / 10, wind_speed: 5 } },
      next_6_hours: { summary: { symbol_code: "rain" }, details: { air_temperature_max: temp + 1, air_temperature_min: temp - 1, precipitation_amount: 0.6 } } };
    if (hourly) data.next_1_hours = { summary: { symbol_code: "rain" }, details: { precipitation_amount: 0.2 } };
    ts.push({ time: new Date(t).toISOString().replace(".000", ""), data });
    t += (hourly ? 1 : 6) * 3600_000;
  }
  return { properties: { meta: { updated_at: from }, timeseries: ts } };
}
// Climatología de NASA POWER con marzo de Madrid: T2M 8.0 °C y rango 12.0 °C → 14° / 2° (lo que dice la pantalla).
const POWER = { header: { fill_value: -999 }, properties: { parameter: {
  T2M: { JAN: 5, FEB: 6.5, MAR: 8, APR: 11, MAY: 15, JUN: 21, JUL: 25, AUG: 24.5, SEP: 20, OCT: 14, NOV: 9, DEC: 6, ANN: 14 },
  T2M_RANGE: { JAN: 9, FEB: 11, MAR: 12, APR: 12, MAY: 13, JUN: 14, JUL: 15, AUG: 14, SEP: 13, OCT: 11, NOV: 9, DEC: 8, ANN: 12 },
  PRECTOTCORR: { JAN: 1.2, FEB: 1.1, MAR: 0.9, APR: 1.5, MAY: 1.4, JUN: 0.7, JUL: 0.3, AUG: 0.3, SEP: 0.8, OCT: 1.6, NOV: 1.7, DEC: 1.4, ANN: 1.1 },
} } };

const NOW = Date.parse("2026-10-28T16:00:00Z");
function fakeFetch(opts: { metDown?: boolean; powerDown?: boolean; seen?: Array<{ url: string; headers?: any }> } = {}) {
  return (async (url: string, init?: any) => {
    opts.seen?.push({ url, headers: init?.headers });
    const u = new URL(url);
    if (u.hostname === "api.met.no") return opts.metDown ? { ok: false, status: 503, json: async () => null } : { ok: true, status: 200, headers: new Headers(), json: async () => metSeries("2026-10-28T16:00:00Z", "2026-11-06T18:00:00Z") };
    if (u.hostname === "power.larc.nasa.gov") return opts.powerDown ? { ok: false, status: 500, json: async () => null } : { ok: true, status: 200, json: async () => POWER };
    return { ok: false, status: 404, json: async () => null };
  }) as unknown as typeof fetch;
}

describe("herramienta de clima de Iato (misma fuente que la pantalla Clima)", () => {
  it("Madrid 10–17 mar: fuera del pronóstico → lo dice y da el clima típico de NASA POWER, igual que la pantalla", async () => {
    const seen: any[] = [];
    const r: any = await runWeather({ city: "Madrid", date_from: "2027-03-10", date_to: "2027-03-17" }, { fetchImpl: fakeFetch({ seen }), now: () => NOW });
    expect(r).toMatchObject({ ok: true, ciudad: "Madrid", fuera_de_pronostico: true, consultado_at: "2026-10-28T16:00:00.000Z" });
    expect(r.pronostico).toEqual([]);
    expect(r.tipico).toEqual([expect.objectContaining({ mes: "marzo", max_tipica_c: 14, min_tipica_c: 2 })]);
    expect(r.tipico[0].dias).toHaveLength(8);
    expect(r.fuentes.map((f: any) => f.label).join(" ")).toMatch(/MET Norway.*NASA POWER/);
    expect(r.nota).toMatch(/no hay pronóstico todavía/);
    expect(r.nota).toMatch(/típico del mes/);
    // MET Norway exige identificarse desde un servidor.
    expect(seen.find((s) => s.url.includes("api.met.no")).headers["User-Agent"]).toBe(WEATHER_USER_AGENT);
    // La pantalla Clima calcula exactamente lo mismo con la misma fuente.
    const block = await buildCityWeather({ city: "Madrid", start: "2027-03-10", end: "2027-03-17" }, { fetchImpl: fakeFetch(), now: new Date(NOW), geocoder: async () => [] });
    expect(block!.typical[0]).toMatchObject({ month: 3, tmax: r.tipico[0].max_tipica_c, tmin: r.tipico[0].min_tipica_c });
  });

  it("dentro del pronóstico: días con máxima, mínima, cielo y lluvia de MET Norway", async () => {
    const r: any = await runWeather({ city: "Madrid" }, { fetchImpl: fakeFetch(), now: () => NOW });
    expect(r.ok).toBe(true);
    expect(r.pronostico.length).toBeGreaterThanOrEqual(6);
    expect(r.pronostico[0]).toMatchObject({ fecha: "2026-10-28", cielo: "lluvia" });
    expect(typeof r.pronostico[0].max_c).toBe("number");
    expect(r.fuera_de_pronostico).toBe(false);
    expect(r.fuentes).toEqual([{ label: "Datos: MET Norway (CC BY 4.0)", url: "https://api.met.no/doc/License" }]);
  });

  it("sin respuesta de MET ni de NASA: no hay cifras y el modelo recibe 'no des cifras de memoria'", async () => {
    const r: any = await runWeather({ city: "Madrid", date_from: "2027-03-10", date_to: "2027-03-17" }, { fetchImpl: fakeFetch({ metDown: true, powerDown: true }), now: () => NOW });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toMatch(/°|max_c|tipica/);
    const p = prepareToolResultForModel("get_weather", r);
    expect(p).toMatchObject({ disponible: false, estado: "no_respondio" });
    expect(String(p.motivo)).toMatch(/No des cifras ni datos de memoria/);
  });

  it("ciudad fuera de la tabla: usa la geocodificación; sin coordenadas no inventa", async () => {
    const r: any = await runWeather({ city: "Valle de Bravo" }, { fetchImpl: fakeFetch(), now: () => NOW, geocode: async () => ({ lat: 19.19, lng: -100.13 }) });
    expect(r).toMatchObject({ ok: true, coordenadas: "Google Maps (geocodificación)" });
    const none: any = await runWeather({ city: "Pueblo Inventado" }, { fetchImpl: fakeFetch(), now: () => NOW, geocode: async () => null });
    expect(none).toMatchObject({ ok: false, error: "ciudad_no_encontrada" });
  });

  it("Iato detecta la pregunta, consulta con las fechas del viaje y la herramienta existe", () => {
    expect(weatherRequested("¿qué clima hará?")).toBe(true);
    expect(weatherRequested("¿va a llover en Roma?")).toBe(true);
    expect(weatherRequested("¿cuánto tiempo de vuelo es?")).toBe(false);
    const intents = detectIntents("¿qué clima hará?");
    expect(intents).toContain("weather");
    const trip = { id: "t1", destino: "Madrid", fecha_salida: "2027-03-10", fecha_regreso: "2027-03-17" };
    const plan = planTurn({ message: "¿qué clima hará?", intents, trip, todayISO: "2026-10-28", coords: null, hasPriveSession: false, exigente: false });
    expect(plan.prefetch).toContainEqual({ name: "get_weather", args: { city: "Madrid", date_from: "2027-03-10", date_to: "2027-03-17" }, reason: "clima" });
    expect(leadSentence(plan)).toMatch(/MET Norway/);
    expect(TOOL_DEFS.find((t) => t.name === "get_weather")!.description).toMatch(/misma fuente que la pantalla Clima/i);
    expect(validateToolInput("get_weather", { city: "Madrid", date_from: "2027-03-10" })).toMatchObject({ ok: true });
    expect(validateToolInput("get_weather", {})).toMatchObject({ ok: false });
  });
});

describe("web_search: el respaldo llega aunque Google tarde (webSearch.ts:139/153)", () => {
  it("SerpApi colgado: deja tiempo al respaldo y responde dentro del tope de la herramienta", async () => {
    const fetchImpl = ((url: string, init?: any) => {
      if (url.includes("serpapi.com")) {
        return new Promise((_r, reject) => init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))));
      }
      return Promise.resolve({ ok: true, status: 200, text: async () => JSON.stringify({ pages: [{ title: "Clima de Madrid", key: "Clima_de_Madrid", excerpt: "Clima mediterráneo" }] }) });
    }) as unknown as typeof fetch;
    const t0 = Date.now();
    const out: any = await runWebSearch({ query: "clima Madrid marzo" }, { fetchImpl, serpKey: "k", timeoutMs: 3000 });
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(out).toMatchObject({ ok: true, source: "wikipedia" });
    expect(out.nota_fuente).toMatch(/tardó demasiado/);
  });
  it("proveedor caído y sin respaldo: lo dice con su motivo y el modelo no recibe cifras", async () => {
    const fetchImpl = (async (url: string) => (url.includes("serpapi.com")
      ? { ok: false, status: 429, text: async () => JSON.stringify({ error: "Your account has run out of searches." }) }
      : { ok: false, status: 503, text: async () => "" })) as unknown as typeof fetch;
    const out: any = await runWebSearch({ query: "clima Madrid marzo" }, { fetchImpl, serpKey: "k", timeoutMs: 3000 });
    expect(out).toMatchObject({ error: "http_429" });
    expect(out.motivo).toMatch(/proveedor, HTTP 429/);
    expect(String(prepareToolResultForModel("web_search", out).motivo)).toMatch(/No des cifras/);
  });
});
