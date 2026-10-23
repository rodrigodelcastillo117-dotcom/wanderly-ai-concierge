// Clima del viaje (caso Roma → Florencia → Venecia): cada ciudad muestra SOLO sus días (antes Roma
// mostraba del 22 oct al 1 nov), y por ciudad un radar de lluvia animado que se descarga al abrirlo,
// con reproducir/pausar, línea de tiempo, viento real y la atribución que piden las fuentes.
// Fuentes con licencia comercial clara (23-oct-2026): MET Norway (pronóstico, "Hoy", viento), NASA POWER
// (clima típico del mes), NASA GIBS (radar). Ya no se usa Open-Meteo en ninguna parte.
import React from "react";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { vi, it, expect, describe, beforeEach, afterEach } from "vitest";
import { CASO_TRIP } from "./fixtures/casoRomaFlorenciaVenecia";
import { buildCityWeather, cityWeatherRanges, daysInRange, keepCityDays } from "@/lib/tripWeather";
import {
  __resetNowcastCache, findLatestFrame, frameTimes, lonLatToPixel, parseNowcast, precipTileUrl, round4, tileGrid, windFromLabel, windVector,
} from "@/lib/weatherRadar";
import { __resetMetCache, dailyFromMet, metSymbolToCode, nowFromMet } from "@/lib/metNorway";
import { __resetPowerCache, parsePowerClimatology } from "@/lib/nasaPower";
import { __resetCityLocationCache, currentTripCity, resolveCityLocation } from "@/lib/cityLocation";
import { fetchWeatherNow } from "@/lib/weatherNow";

const db = { trip: null as any };
vi.mock("@/integrations/supabase/client", () => {
  const api: any = { select: () => api, eq: () => api, single: async () => ({ data: db.trip, error: null }) };
  return { supabase: { from: () => api } };
});
vi.mock("@/components/DashboardLayout", () => ({ DashboardLayout: ({ children }: any) => <>{children}</> }));
vi.mock("@/components/Tooltip", () => ({ FeatureTooltip: () => null }));
vi.mock("@/hooks/useTooltipShown", () => ({ useTooltipShown: () => ({ shouldShow: false, dismiss: () => {} }) }));

import TripWeather from "@/pages/TripWeather";

/**
 * Serie de MET Norway (Locationforecast 2.0 "complete") de `from` a `to`: cada hora las primeras 60 h
 * (con next_1_hours) y luego cada 6 h (con next_6_hours), como la real.
 */
function metSeries(from: string, to: string, opts: { symbol?: string; rainMmAtHour?: Record<number, number> } = {}) {
  const t0 = Date.parse(from);
  const t1 = Date.parse(to);
  const ts: any[] = [];
  for (let t = t0, i = 0; t <= t1; i++) {
    const hourly = t - t0 < 60 * 3600_000;
    const temp = 12 + 6 * Math.sin(((new Date(t).getUTCHours() - 8) / 24) * 2 * Math.PI);
    const data: any = { instant: { details: { air_temperature: Math.round(temp * 10) / 10, wind_speed: 5, wind_from_direction: 315 } },
      next_6_hours: { summary: { symbol_code: opts.symbol ?? "cloudy" }, details: { air_temperature_max: temp + 1, air_temperature_min: temp - 1, precipitation_amount: hourly ? 0 : 0.6 } } };
    if (hourly) data.next_1_hours = { summary: { symbol_code: opts.symbol ?? "cloudy" }, details: { precipitation_amount: opts.rainMmAtHour?.[i] ?? 0 } };
    ts.push({ time: new Date(t).toISOString().replace(".000", ""), data });
    t += (hourly ? 1 : 6) * 3600_000;
  }
  return { properties: { meta: { updated_at: from }, timeseries: ts } };
}

const POWER = { header: { fill_value: -999 }, properties: { parameter: {
  T2M: { JAN: 7.01, FEB: 8, MAR: 10, APR: 13, MAY: 17, JUN: 22, JUL: 26, AUG: 26, SEP: 21, OCT: 17.16, NOV: 12.45, DEC: 8.3, ANN: 15 },
  T2M_RANGE: { JAN: 7.88, FEB: 8, MAR: 9, APR: 10, MAY: 11, JUN: 12, JUL: 11.86, AUG: 12, SEP: 11, OCT: 9.51, NOV: 7.97, DEC: 7.6, ANN: 10 },
  PRECTOTCORR: { JAN: 2.34, FEB: 2.73, MAR: 2.21, APR: 1.88, MAY: 1.84, JUN: 1.14, JUL: 0.83, AUG: 0.85, SEP: 2.32, OCT: 2.64, NOV: 3.81, DEC: 2.95, ANN: 2.12 },
} } };

/** MET Norway y NASA POWER simulados. `metTo`: hasta dónde llega el pronóstico. */
const urls: string[] = [];
let met = { from: "2026-10-21T10:00:00Z", to: "2026-10-29T18:00:00Z", symbol: "rain" as string, powerFails: false };
function fakeFetch(url: string) {
  urls.push(url);
  const u = new URL(url);
  let body: any = null;
  let ok = true;
  if (u.hostname === "api.met.no") body = metSeries(met.from, met.to, { symbol: met.symbol, rainMmAtHour: { 2: 1.4 } });
  else if (u.hostname === "power.larc.nasa.gov") { if (met.powerFails) ok = false; else body = POWER; }
  else ok = false;
  return Promise.resolve({ ok, status: ok ? 200 : 503, headers: new Headers(), json: async () => body } as any);
}
const noGeocoder = async () => { throw new Error("no debería geocodificar ciudades de la tabla"); };

beforeEach(() => {
  urls.length = 0;
  met = { from: "2026-10-21T10:00:00Z", to: "2026-10-29T18:00:00Z", symbol: "rain", powerFails: false };
  __resetMetCache(); __resetPowerCache(); __resetCityLocationCache(); __resetNowcastCache();
});

describe("días por ciudad (cityStays)", () => {
  it("Roma 22–25 oct (4 noches), Florencia 26–28 oct, Venecia 29 oct – 1 nov (incluye el regreso)", () => {
    expect(cityWeatherRanges(CASO_TRIP)).toEqual([
      { city: "Roma", start: "2026-10-22", end: "2026-10-25" },
      { city: "Florencia", start: "2026-10-26", end: "2026-10-28" },
      { city: "Venecia", start: "2026-10-29", end: "2026-11-01" },
    ]);
  });

  it("un destino usa las fechas del viaje", () => {
    expect(cityWeatherRanges({ destino: "Madrid", fecha_salida: "2026-11-10", fecha_regreso: "2026-11-15", hospedaje_json: [] }))
      .toEqual([{ city: "Madrid", start: "2026-11-10", end: "2026-11-15" }]);
  });

  it("Roma: solo sus 4 días del pronóstico de MET Norway (aunque MET dé 9) y nada inventado", async () => {
    const roma = cityWeatherRanges(CASO_TRIP)[0];
    const b = await buildCityWeather(roma, { fetchImpl: fakeFetch as any, geocoder: noGeocoder, now: new Date("2026-10-21T10:00:00Z") });
    expect(b!.days.map((d) => d.date)).toEqual(["2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25"]);
    expect(b!.typical).toEqual([]);
    expect(b!.sources).toEqual(["met"]);
    // Una sola petición, al punto de la tabla de ciudades, con máximo 4 decimales.
    expect(urls).toEqual(["https://api.met.no/weatherapi/locationforecast/2.0/complete?lat=41.8&lon=12.239"]);
    const extra = daysInRange("2026-10-22", "2026-11-01").map((date) => ({ date }));
    expect(keepCityDays(extra, roma)).toHaveLength(4);
  });

  it("más allá del pronóstico: 'clima típico del mes' de NASA POWER, por mes y sin días inventados", async () => {
    const b = await buildCityWeather({ city: "Venecia", start: "2026-10-29", end: "2026-11-01" },
      { fetchImpl: fakeFetch as any, geocoder: noGeocoder, now: new Date("2026-10-21T10:00:00Z") });
    expect(b!.days.map((d) => d.date)).toEqual(["2026-10-29"]);
    expect(b!.typical).toEqual([
      { month: 10, label: "octubre", days: ["2026-10-30", "2026-10-31"], tmax: 22, tmin: 12, precipMmDay: 2.6 },
      { month: 11, label: "noviembre", days: ["2026-11-01"], tmax: 16, tmin: 8, precipMmDay: 3.8 },
    ]);
    expect(b!.sources).toEqual(["met", "power"]);
    expect(urls.find((x) => x.includes("power.larc.nasa.gov"))).toMatch(/climatology\/point\?parameters=T2M,T2M_RANGE,PRECTOTCORR&community=AG&longitude=12.35&latitude=45.51/);
  });

  it("si NASA POWER no responde, no inventa: el mes queda sin cifras ('Pronóstico disponible ~9 días antes')", async () => {
    met.powerFails = true;
    const b = await buildCityWeather({ city: "Roma", start: "2026-12-30", end: "2027-01-02" },
      { fetchImpl: fakeFetch as any, geocoder: noGeocoder, now: new Date("2026-10-21T10:00:00Z") });
    expect(b!.days).toEqual([]);
    expect(b!.typical.map((m) => [m.label, m.days.length, m.tmax])).toEqual([["diciembre", 2, null], ["enero", 2, null]]);
    expect(b!.sources).toEqual(["met"]);
  });

  it("días que ya pasaron: no se piden ni se inventan", async () => {
    met.from = "2026-10-23T10:00:00Z"; // MET solo da de ahora en adelante
    const b = await buildCityWeather({ city: "Roma", start: "2026-10-22", end: "2026-10-25" },
      { fetchImpl: fakeFetch as any, geocoder: noGeocoder, now: new Date("2026-10-23T10:00:00Z") });
    expect(b!.pastDays).toEqual(["2026-10-22"]);
    expect(b!.days.map((d) => d.date)).toEqual(["2026-10-23", "2026-10-24", "2026-10-25"]);
  });
});

describe("MET Norway, NASA POWER y coordenadas", () => {
  it("resumen diario: máx/mín, lluvia sin contar dos veces, viento y símbolo", () => {
    const f = { timeseries: metSeries("2026-10-22T00:00:00Z", "2026-10-25T00:00:00Z", { symbol: "lightrain", rainMmAtHour: { 10: 1.2, 11: 0.3 } }).properties.timeseries, updatedAt: null };
    const days = dailyFromMet(f, 12.5);
    const d22 = days.find((d) => d.date === "2026-10-22")!;
    expect(d22.precipMm).toBe(1.5);
    expect(d22.code).toBe(61);
    expect(d22.windKmh).toBe(18);
    expect(d22.tmax).toBeGreaterThan(d22.tmin);
    expect(metSymbolToCode("clearsky_day")).toBe(0);
    expect(metSymbolToCode("heavyrainshowers_night")).toBe(82);
    expect(metSymbolToCode("lightsnow")).toBe(71);
    expect(metSymbolToCode("rainandthunder")).toBe(95);
    expect(nowFromMet(f, Date.parse("2026-10-22T10:20:00Z"))).toMatchObject({ code: 61, windKmh: 18, windFromDeg: 315 });
  });

  it("NASA POWER: máxima y mínima típicas = media ± rango diario / 2", () => {
    expect(parsePowerClimatology(POWER)!.find((m) => m.month === 7)).toEqual({ month: 7, tmax: 32, tmin: 20, precipMmDay: 0.8 });
    expect(parsePowerClimatology({ properties: { parameter: {} } })).toBeNull();
  });

  it("coordenadas: primero la tabla de ciudades; si no está, la función 'geocode' de la app (no Open-Meteo)", async () => {
    expect(await resolveCityLocation("Florencia", noGeocoder)).toEqual({ lat: 43.81, lng: 11.205, source: "tabla" });
    const geocoder = vi.fn(async () => [{ lat: 36.39, lng: 25.46 }]);
    expect(await resolveCityLocation("Pueblo De Prueba", geocoder)).toEqual({ lat: 36.39, lng: 25.46, source: "geocode" });
    expect(geocoder).toHaveBeenCalledWith("Pueblo De Prueba");
    expect(await resolveCityLocation("Lugar Inexistente", async () => [])).toBeNull();
  });

  it("Inicio ('Ahora en …'): MET Norway en la ciudad donde está hoy el viajero", async () => {
    expect(currentTripCity(CASO_TRIP, "2026-10-27")).toBe("Florencia");
    expect(currentTripCity(CASO_TRIP, "2026-10-01")).toBe("Roma");
    expect(currentTripCity({ destino: "Madrid" }, "2026-10-27")).toBe("Madrid");
    met.symbol = "clearsky_day";
    const w = await fetchWeatherNow("Florencia", fakeFetch as any, noGeocoder);
    expect(w).toMatchObject({ label: "Despejado", source: "MET Norway" });
    expect(urls).toEqual(["https://api.met.no/weatherapi/locationforecast/2.0/complete?lat=43.81&lon=11.205"]);
  });

  it("ningún archivo de la app llama a la API de Open-Meteo (solo se menciona en comentarios con sus términos)", () => {
    const files: string[] = [];
    const walk = (dir: string) => readdirSync(dir).forEach((f) => {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) { if (f !== "test" && f !== "node_modules") walk(p); }
      else if (/\.(ts|tsx)$/.test(f)) files.push(p);
    });
    walk("src"); walk("supabase/functions");
    const offenders = files.filter((f) => /(api|geocoding-api|archive-api|customer-api|air-quality-api|marine-api)\.open-meteo\.com/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});

describe("radar: lógica", () => {
  it("teselas centradas en la ciudad y URL de NASA GIBS IMERG", () => {
    const p = lonLatToPixel(41.9, 12.5, 6);
    expect(Math.floor(p.x / 256)).toBe(34);
    expect(Math.floor(p.y / 256)).toBe(23);
    const g = tileGrid(41.9, 12.5);
    expect(g.tiles).toHaveLength(15);
    expect(g.cityX).toBeGreaterThan(512);
    expect(g.cityX).toBeLessThan(768);
    expect(precipTileUrl("2026-10-22T18:30:00Z", 6, 34, 23))
      .toBe("https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/IMERG_Precipitation_Rate_30min/default/2026-10-22T18:30:00Z/GoogleMapsCompatible_Level6/6/23/34.png");
  });

  it("encuentra el último cuadro publicado y arma 8 cuadros de 30 min", async () => {
    const latest = await findLatestFrame(async (t) => t <= "2026-10-22T18:30:00Z", new Date("2026-10-23T01:10:00Z"));
    expect(latest).toBe("2026-10-22T18:30:00Z");
    expect(frameTimes(latest!, 8)).toEqual([
      "2026-10-22T15:00:00Z", "2026-10-22T15:30:00Z", "2026-10-22T16:00:00Z", "2026-10-22T16:30:00Z",
      "2026-10-22T17:00:00Z", "2026-10-22T17:30:00Z", "2026-10-22T18:00:00Z", "2026-10-22T18:30:00Z",
    ]);
    expect(await findLatestFrame(async () => false)).toBeNull();
  });

  it("viento y próximas horas de MET Norway (máx. 4 decimales)", () => {
    expect(round4(41.902784123)).toBe(41.9028);
    const n = parseNowcast({ properties: { timeseries: [
      { time: "2026-10-23T01:00:00Z", data: { instant: { details: { wind_speed: 4, wind_from_direction: 315 } }, next_1_hours: { details: { precipitation_amount: 0.3 } } } },
    ] } }, new Date("2026-10-23T01:10:00Z"));
    expect(n).toEqual({ windMs: 4, windFromDeg: 315, hours: [{ time: "2026-10-23T01:00:00Z", precipMm: 0.3 }] });
    expect(windFromLabel(315)).toBe("del NO");
    const v = windVector(0); // viento del norte: va hacia el sur (abajo en pantalla)
    expect(Math.round(v.dx)).toBe(0);
    expect(Math.round(v.dy)).toBe(1);
  });
});

describe("pantalla Clima del viaje", () => {
  const OrigImage = globalThis.Image;
  beforeEach(() => {
    db.trip = JSON.parse(JSON.stringify(CASO_TRIP));
    // Solo el reloj: los temporizadores siguen siendo reales. "Hoy" = 21-oct, un día antes del viaje.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-21T10:00:00Z"));
    vi.stubGlobal("fetch", vi.fn(fakeFetch));
    // Toda tesela de GIBS "carga" (sin red en las pruebas).
    class FakeImage { onload: null | (() => void) = null; onerror: null | (() => void) = null;
      set src(v: string) { setTimeout(() => (v.includes("gibs.earthdata.nasa.gov") ? this.onload?.() : this.onerror?.()), 0); } }
    vi.stubGlobal("Image", FakeImage as any);
    HTMLCanvasElement.prototype.getContext = (() => null) as any;
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); globalThis.Image = OrigImage; });

  const renderPage = () => render(
    <MemoryRouter initialEntries={[`/dashboard/viajes/${CASO_TRIP.id}/clima`]}>
      <Routes><Route path="/dashboard/viajes/:id/clima" element={<TripWeather />} /></Routes>
    </MemoryRouter>,
  );

  it("cada ciudad muestra solo sus días; lo que aún no tiene pronóstico es 'clima típico del mes'", async () => {
    renderPage();
    const roma = await screen.findByTestId("city-weather-Roma");
    const dates = (el: HTMLElement) => within(el).queryAllByTestId("weather-day").map((d) => d.getAttribute("data-date"));
    expect(dates(roma)).toEqual(["2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25"]);
    expect(within(roma).getByTestId("city-weather-range")).toHaveTextContent("4 días");
    expect(within(roma).getAllByTestId("weather-day")[0]).toHaveTextContent(/mm/);
    expect(dates(screen.getByTestId("city-weather-Florencia"))).toEqual(["2026-10-26", "2026-10-27", "2026-10-28"]);
    const venecia = screen.getByTestId("city-weather-Venecia");
    expect(dates(venecia)).toEqual(["2026-10-29"]);
    const typical = within(venecia).getAllByTestId("weather-typical");
    expect(typical[0]).toHaveTextContent(/30 oct – 31 oct · Pronóstico disponible ~9 días antes/);
    expect(typical[0]).toHaveTextContent("Clima típico de octubre: 22° / 12° · ~2.6 mm de lluvia al día");
    expect(typical[1]).toHaveTextContent(/1 nov · Pronóstico disponible ~9 días antes/);
    // Atribución visible de las dos fuentes.
    const attr = screen.getByTestId("weather-attribution");
    expect(attr).toHaveTextContent("Datos: MET Norway (CC BY 4.0)");
    expect(attr).toHaveTextContent("Clima típico: NASA POWER");
    expect(within(attr).getAllByRole("link").map((a) => a.getAttribute("href")))
      .toEqual(["https://api.met.no/doc/License", "https://power.larc.nasa.gov/docs/referencing/"]);
    // Una petición a MET por ciudad (Roma, Florencia, Venecia) y nada a Open-Meteo.
    expect(urls.filter((u) => u.includes("api.met.no"))).toHaveLength(3);
    expect(urls.some((u) => /open-meteo/.test(u))).toBe(false);
  });

  it("'Hoy en …' con lluvia lleva gotas animadas que respetan 'reducir movimiento' (motion-safe)", async () => {
    renderPage();
    const roma = await screen.findByTestId("city-weather-Roma");
    const icon = within(roma).getByTestId("today-icon");
    expect(icon).toHaveAttribute("data-anim", "lluvia");
    const drops = icon.querySelectorAll("span");
    expect(drops.length).toBe(3);
    drops.forEach((d) => expect(d.className).toMatch(/(^|\s)motion-safe:animate-rain-fall(\s|$)/));
  });

  it("el radar empieza plegado, se descarga al abrirlo y muestra controles, viento y atribución", async () => {
    renderPage();
    const roma = await screen.findByTestId("city-weather-Roma");
    expect(screen.queryByTestId("weather-radar")).toBeNull();
    const before = urls.length;
    const toggle = within(roma).getByTestId("radar-toggle");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    const radar = await within(roma).findByTestId("weather-radar", {}, { timeout: 8000 });
    const attr = within(radar).getByTestId("radar-attribution");
    expect(attr).toHaveTextContent(/NASA GIBS · GPM IMERG/);
    expect(attr).toHaveTextContent(/MET Norway \(CC BY 4\.0\)/);
    expect(within(attr).getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual([
      "https://www.earthdata.nasa.gov/engage/open-data-services-software-policies/data-use-guidance",
      "https://nasa-gibs.github.io/gibs-api-docs/",
      "https://api.met.no/doc/License",
    ]);
    // Cuadros listos: reproducir/pausar y línea de tiempo con 8 cuadros.
    await waitFor(() => expect(within(radar).getByRole("slider", { name: "Línea de tiempo del radar" })).toHaveAttribute("max", "7"));
    expect(radar.querySelectorAll("[data-frame]")).toHaveLength(8);
    const play = within(radar).getByTestId("radar-play");
    expect(play).toHaveAccessibleName("Pausar radar"); // arranca en movimiento
    fireEvent.click(play);
    expect(play).toHaveAccessibleName("Reproducir radar");
    expect(await within(radar).findByTestId("radar-wind")).toHaveTextContent("18 km/h del NO");
    expect(within(radar).getByTestId("radar-nowcast")).toHaveTextContent("1.4 mm");
    // El viento y las próximas horas salen de la MISMA petición a MET que el pronóstico (caché): no se pide otra vez.
    expect(urls.slice(before).filter((u) => u.includes("api.met.no"))).toHaveLength(0);
  });

  it("el radar es un import diferido (React.lazy), no estático", () => {
    const src = readFileSync("src/pages/TripWeather.tsx", "utf8");
    expect(src).toMatch(/lazy\(\(\) => import\("@\/components\/weather\/WeatherRadar"\)\)/);
    expect(src).not.toMatch(/^import .*WeatherRadar/m);
  });
});
