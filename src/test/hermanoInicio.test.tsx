// Defectos 6 y 23 (E2E 28-oct-2026, hermano del dueño):
//  6. Tras elegir vuelo y hotel el viaje decía $81,273 y Inicio ("Total cotizado") y Mis viajes seguían con
//     $81,831 (el total_estimado de la cotización). Ahora los tres usan la misma función del total.
// 23. "PRÓXIMO VIAJE" mostraba Madrid (en 133 días, el viaje fijado en Iato) cuando Valle de Bravo salía en
//     2 días: el próximo es el de salida futura más cercana.
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { vi, it, expect, beforeEach, describe } from "vitest";
import { __resetActiveTripColumn } from "@/lib/profileActiveTrip";
import { localISODatePlus, localISODate } from "@/lib/localDate";
import { CASO_TRIP } from "./fixtures/casoRomaFlorenciaVenecia";
import { computeTripDesglose } from "@/lib/quote";
import { homeCommandTrip } from "@/lib/homeTrips";
import { displayedTripTotal } from "@/lib/tripPageTotal";

const MADRID = "11111111-1111-4111-8111-111111111111";
const VALLE = "22222222-2222-4222-8222-222222222222";
const db = { trips: [] as any[], pinned: null as string | null, full: null as any };

vi.mock("@/integrations/supabase/client", () => {
  const from = (table: string) => {
    let cols = "";
    const api: any = {
      select: (c: string) => { cols = c; return api; },
      eq: () => api, gte: () => api, order: () => api, limit: () => api, in: () => api,
      maybeSingle: async () => {
        if (table === "trips") return { data: db.full, error: null };
        if (table !== "profiles") return { data: null, error: null };
        if (cols.includes("active_trip_id")) return { data: { active_trip_id: db.pinned }, error: null };
        return { data: { full_name: "Ana Pérez" }, error: null };
      },
      update: () => api,
      then: (res: any, rej: any) => Promise.resolve({ data: table === "trips" ? db.trips : [], error: null }).then(res, rej),
    };
    return api;
  };
  return { supabase: { from, functions: { invoke: vi.fn(async () => ({ data: null })) } } };
});
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" }, loading: false }) }));
vi.mock("@/components/DashboardLayout", () => ({ DashboardLayout: ({ children }: any) => <>{children}</> }));
vi.mock("@/components/DestinationVideo", () => ({ DestinationVideo: () => null }));
vi.mock("@/components/VoiceInput", () => ({ VoiceInput: () => null }));
vi.mock("@/components/TripFileUpload", () => ({ TripFileUpload: () => null }));
vi.mock("@/hooks/useAIRecommendations", () => ({ useAIRecommendations: () => ({ recos: [], loading: false }) }));
vi.mock("@/lib/fx", async () => {
  const actual: any = await vi.importActual("@/lib/fx");
  return { ...actual, fetchFxTable: async () => actual.FX_FALLBACK_TABLE };
});
vi.mock("@/lib/weatherNow", async () => {
  const actual: any = await vi.importActual("@/lib/weatherNow");
  return { ...actual, fetchWeatherNow: async () => null };
});

import DashboardHome from "@/pages/DashboardHome";
import Trips from "@/pages/Trips";
import { TripCommandCenter } from "@/components/TripCommandCenter";

beforeEach(() => {
  __resetActiveTripColumn();
  db.trips = [
    { id: MADRID, user_id: "u1", destino: "Madrid", fecha_salida: localISODatePlus(133), fecha_regreso: localISODatePlus(140), created_at: "2026-10-28T10:00:00Z" },
    { id: VALLE, user_id: "u1", destino: "Valle de Bravo", fecha_salida: localISODatePlus(2), fecha_regreso: localISODatePlus(5), created_at: "2026-10-28T11:00:00Z" },
  ];
  db.pinned = MADRID;
  db.full = null;
  localStorage.clear();
});

describe("23 · Próximo viaje en Inicio", () => {
  it("homeCommandTrip: el de salida futura más cercana, aunque Iato tenga fijado otro", () => {
    const today = localISODate();
    expect(homeCommandTrip(db.trips, today, db.trips[0])?.id).toBe(VALLE);
    // El activo en curso sí manda.
    const enCurso = { id: MADRID, destino: "Madrid", fecha_salida: localISODatePlus(-1), fecha_regreso: localISODatePlus(3) };
    expect(homeCommandTrip([enCurso, db.trips[1]], today, enCurso)?.id).toBe(MADRID);
    // Sin fechas futuras: el activo si no terminó.
    const sinFecha = { id: "x", destino: "Lima", fecha_salida: null, fecha_regreso: null };
    expect(homeCommandTrip([sinFecha], today, sinFecha)?.id).toBe("x");
  });

  it("Inicio dice Valle de Bravo (en 2 días), no Madrid fijado (en 133 días)", async () => {
    render(<MemoryRouter initialEntries={["/dashboard"]}><Routes><Route path="/dashboard" element={<DashboardHome />} /></Routes></MemoryRouter>);
    expect(await screen.findByText("Próximo viaje")).toBeInTheDocument();
    await waitFor(() => expect(document.getElementById("command-center-title")?.textContent).toMatch(/^Valle de Bravo/));
  });
});

describe("6 · El total de Inicio y Mis viajes es el de la página del viaje", () => {
  const ALL_HOTELS = { Roma: 1, Florencia: 4, Venecia: 7 };
  const selections = {
    v: 1, vuelo: { i: -2, key: null }, hospedaje: { i: -1, key: null }, noches_hospedaje: null, tours: [],
    hoteles: Object.entries(ALL_HOTELS).map(([ciudad, i]) => ({ ciudad, i, key: null })),
  };
  const trip = { ...CASO_TRIP, selections, fecha_salida: localISODatePlus(40), fecha_regreso: localISODatePlus(50) } as any;
  // Lo que calcula la página del viaje con esa selección (computeTripDesglose, 10 noches, 2 viajeros).
  const expected = Object.values(computeTripDesglose(trip, { selVuelo: -2, selHospedaje: -1, nochesHospedaje: 10, selTours: new Set(), selHoteles: ALL_HOTELS }, 2))
    .reduce((a, b) => a + b, 0);
  const fmt = (n: number) => `$${Math.round(n).toLocaleString("es-MX")} MXN`;

  it("displayedTripTotal = total con la selección guardada (≠ total_estimado de la cotización)", () => {
    expect(Math.round(expected)).not.toBe(CASO_TRIP.total_estimado);
    expect(displayedTripTotal(trip)).toBe(Math.round(expected));
    // Sin selección guardada: la cifra de la cotización.
    expect(displayedTripTotal({ ...trip, selections: null })).toBe(CASO_TRIP.total_estimado);
  });

  it("Inicio ('Total cotizado') muestra el total de la selección", async () => {
    db.full = trip;
    render(<MemoryRouter><TripCommandCenter trip={{ id: trip.id, destino: trip.destino, fecha_salida: trip.fecha_salida, fecha_regreso: trip.fecha_regreso }} today={localISODate()} /></MemoryRouter>);
    expect(await screen.findByText(`Total cotizado ${fmt(expected)}`)).toBeInTheDocument();
    expect(screen.queryByText(new RegExp(fmt(CASO_TRIP.total_estimado).replace(/\$/g, "\\$")))).toBeNull();
  });

  it("Mis viajes muestra el mismo total", async () => {
    db.trips = [{ ...trip, user_id: "u1", created_at: "2026-10-28T10:00:00Z" }];
    render(<MemoryRouter><Trips /></MemoryRouter>);
    expect(await screen.findByText(fmt(expected))).toBeInTheDocument();
  });
});
