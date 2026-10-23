// Clima del viaje (caso Roma → Florencia → Venecia): cada ciudad muestra SOLO sus días (antes Roma
// mostraba del 22 oct al 1 nov), y por ciudad un radar de lluvia animado que se descarga al abrirlo,
// con reproducir/pausar, línea de tiempo, viento real y la atribución que piden las fuentes.
import React from "react";
import { readFileSync } from "node:fs";
import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { vi, it, expect, describe, beforeEach, afterEach } from "vitest";
import { CASO_TRIP } from "./fixtures/casoRomaFlorenciaVenecia";
import { buildCityWeather, cityWeatherRanges, daysInRange, keepCityDays } from "@/lib/tripWeather";
import {
  __resetNowcastCache, findLatestFrame, frameTimes, lonLatToPixel, parseNowcast, precipTileUrl, round4, tileGrid, windFromLabel, windVector,
} from "@/lib/weatherRadar";

const db = { trip: null as any };
vi.mock("@/integrations/supabase/client", () => {
  const api: any = { select: () => api, eq: () => api, single: async () => ({ data: db.trip, error: null }) };
  return { supabase: { from: () => api } };
});
vi.mock("@/components/DashboardLayout", () => ({ DashboardLayout: ({ children }: any) => <>{children}</> }));
vi.mock("@/components/Tooltip", () => ({ FeatureTooltip: () => null }));
vi.mock("@/hooks/useTooltipShown", () => ({ useTooltipShown: () => ({ shouldShow: false, dismiss: () => {} }) }));

import TripWeather from "@/pages/TripWeather";

/** Open-Meteo y MET Norway simulados: responden con los días que se piden. */
const urls: string[] = [];
function fakeFetch(url: string) {
  urls.push(url);
  const u = new URL(url);
  let body: any = null;
  if (u.hostname.startsWith("geocoding")) body = { results: [{ latitude: 41.9, longitude: 12.5 }] };
  else if (u.hostname === "api.met.no") {
    const t0 = Date.now();
    body = { properties: { timeseries: Array.from({ length: 8 }, (_, i) => ({
      time: new Date(t0 + i * 3600_000).toISOString(),
      data: { instant: { details: { wind_speed: 5, wind_from_direction: 315 } }, next_1_hours: { details: { precipitation_amount: i === 2 ? 1.4 : 0 } } },
    })) } };
  } else if (u.searchParams.get("current")) body = { current: { temperature_2m: 18, weather_code: 61, wind_speed_10m: 12 }, daily: { temperature_2m_max: [20], temperature_2m_min: [12], precipitation_probability_max: [70] } };
  else {
    const days = daysInRange(u.searchParams.get("start_date")!, u.searchParams.get("end_date")!);
    body = { daily: { time: days, temperature_2m_max: days.map(() => 20), temperature_2m_min: days.map(() => 12), weather_code: days.map(() => 3),
      precipitation_probability_max: days.map(() => 10), precipitation_sum: days.map(() => 1), wind_speed_10m_max: days.map(() => 9) } };
  }
  return Promise.resolve({ ok: true, status: 200, json: async () => body } as any);
}

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

  it("pide a la API solo los días de la ciudad y descarta los que sobren", async () => {
    urls.length = 0;
    const roma = cityWeatherRanges(CASO_TRIP)[0];
    const b = await buildCityWeather(roma, fakeFetch as any, new Date("2026-10-23T12:00:00"));
    expect(b!.days.map((d) => d.date)).toEqual(["2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25"]);
    expect(urls.find((x) => x.includes("start_date"))).toMatch(/start_date=2026-10-22&end_date=2026-10-25/);
    const extra = daysInRange("2026-10-22", "2026-11-01").map((date) => ({ date, tmax: 1, tmin: 1, code: 0, precip: 0, wind: 0, source: "forecast" as const }));
    expect(keepCityDays(extra, roma)).toHaveLength(4);
  });

  it("fuera de la ventana de pronóstico usa las mismas fechas del año anterior, re-mapeadas", async () => {
    urls.length = 0;
    const b = await buildCityWeather({ city: "Roma", start: "2026-12-30", end: "2027-01-02" }, fakeFetch as any, new Date("2026-10-23T12:00:00"));
    expect(urls.find((x) => x.includes("archive"))).toMatch(/start_date=2025-12-30&end_date=2026-01-02/);
    expect(b!.days.map((d) => d.date)).toEqual(["2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02"]);
    expect(b!.days[0].source).toBe("historical");
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
    urls.length = 0;
    __resetNowcastCache();
    vi.stubGlobal("fetch", vi.fn(fakeFetch));
    // Toda tesela de GIBS "carga" (sin red en las pruebas).
    class FakeImage { onload: null | (() => void) = null; onerror: null | (() => void) = null;
      set src(v: string) { setTimeout(() => (v.includes("gibs.earthdata.nasa.gov") ? this.onload?.() : this.onerror?.()), 0); } }
    vi.stubGlobal("Image", FakeImage as any);
    HTMLCanvasElement.prototype.getContext = (() => null) as any;
  });
  afterEach(() => { vi.unstubAllGlobals(); globalThis.Image = OrigImage; });

  const renderPage = () => render(
    <MemoryRouter initialEntries={[`/dashboard/viajes/${CASO_TRIP.id}/clima`]}>
      <Routes><Route path="/dashboard/viajes/:id/clima" element={<TripWeather />} /></Routes>
    </MemoryRouter>,
  );

  it("cada ciudad muestra solo sus días", async () => {
    renderPage();
    const roma = await screen.findByTestId("city-weather-Roma");
    const dates = (el: HTMLElement) => within(el).getAllByTestId("weather-day").map((d) => d.getAttribute("data-date"));
    expect(dates(roma)).toEqual(["2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25"]);
    expect(within(roma).getByTestId("city-weather-range")).toHaveTextContent("4 días");
    expect(dates(screen.getByTestId("city-weather-Florencia"))).toEqual(["2026-10-26", "2026-10-27", "2026-10-28"]);
    expect(dates(screen.getByTestId("city-weather-Venecia"))).toEqual(["2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"]);
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
    // Ninguna tesela ni MET Norway se piden antes de abrir el radar.
    expect(urls.some((u) => u.includes("api.met.no"))).toBe(false);
    const toggle = within(roma).getByTestId("radar-toggle");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    const radar = await within(roma).findByTestId("weather-radar");
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
    expect(urls.find((u) => u.includes("api.met.no"))).toMatch(/lat=41\.8&lon=12\.239$/);
  });

  it("el radar es un import diferido (React.lazy), no estático", () => {
    const src = readFileSync("src/pages/TripWeather.tsx", "utf8");
    expect(src).toMatch(/lazy\(\(\) => import\("@\/components\/weather\/WeatherRadar"\)\)/);
    expect(src).not.toMatch(/^import .*WeatherRadar/m);
  });
});
