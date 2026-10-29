// R3 viajes P1-2: para Valle de Bravo, que sale mañana sin hotel, Inicio decía «QUÉ SIGUE · Prepara tu
// maleta» y el viaje «Elige y reserva · Sales en 2 días y aún te falta elegir cómo llegar y hotel»: el
// centro de mando de Inicio llamaba nextTripAction sin `missing`. Ahora los dos usan la misma fuente.
import React from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { vi, it, expect, beforeEach, describe } from "vitest";
import { localISODatePlus, localISODate } from "@/lib/localDate";

const db = { full: null as any, marks: [] as any[] };

vi.mock("@/integrations/supabase/client", () => {
  const from = (table: string) => {
    const api: any = {
      select: () => api, eq: () => api, gte: () => api, order: () => api, limit: () => api, in: () => api,
      maybeSingle: async () => ({ data: table === "trips" ? db.full : null, error: null }),
      then: (res: any, rej: any) => Promise.resolve({ data: table === "trip_purchase_marks" ? db.marks : [], error: null }).then(res, rej),
    };
    return api;
  };
  return { supabase: { from, functions: { invoke: vi.fn(async () => ({ data: null })) } } };
});
vi.mock("@/lib/weatherNow", async () => {
  const actual: any = await vi.importActual("@/lib/weatherNow");
  return { ...actual, fetchWeatherNow: async () => null };
});
vi.mock("@/components/media/SmartImage", () => ({ SmartImage: ({ children }: any) => <div>{children}</div> }));

import { TripCommandCenter } from "@/components/TripCommandCenter";
import { TripNextStep } from "@/components/TripNextStep";
import { savedTripMissing } from "@/lib/tripMissing";

const VB = "33333333-3333-4333-8333-333333333333";
const valle = () => ({
  id: VB, user_id: "u1", destino: "Valle de Bravo", pais_destino: "México", ciudad_origen: "Ciudad de México",
  fecha_salida: localISODatePlus(1), fecha_regreso: localISODatePlus(3), num_viajeros: 2,
  created_at: new Date().toISOString(), total_estimado: 16953,
  vuelos_json: [{ modo: "auto", aerolinea: "En coche", precio_por_persona: 900 }],
  hospedaje_json: [{ nombre: "Hotel Avándaro", precio_por_noche: 3000, fuente_precio: "en_vivo", tier: "medio" }],
  itinerario_json: [],
  desglose_presupuesto: { vuelos: 1800, hospedaje: 6000, comida: 4000 },
});

beforeEach(() => { db.full = valle(); db.marks = []; });

describe("P1-2 · «Qué sigue» de Inicio = el del viaje", () => {
  it("sin hotel elegido y saliendo mañana: Inicio pide elegir, no la maleta", async () => {
    render(<MemoryRouter><TripCommandCenter trip={db.full} today={localISODate()} /></MemoryRouter>);
    expect(await screen.findByText("Elige y reserva")).toBeInTheDocument();
    expect(screen.getByText(/Sales mañana y aún te falta elegir cómo llegar y hotel/)).toBeInTheDocument();
    expect(screen.queryByText("Prepara tu maleta")).toBeNull();
  });

  it("el viaje dice lo mismo con lo que calcula la misma fuente", () => {
    const missing = savedTripMissing(db.full);
    expect(missing).toEqual(["cómo llegar", "hotel"]);
    render(<MemoryRouter><TripNextStep trip={db.full} quote={null} isOwner missing={missing} /></MemoryRouter>);
    expect(screen.getByText("Elige y reserva")).toBeInTheDocument();
    expect(screen.getByText(/Sales mañana y aún te falta elegir cómo llegar y hotel/)).toBeInTheDocument();
  });

  it("con todo elegido (o marcado como comprado) sí toca la maleta", async () => {
    db.full = { ...valle(), selections: { v: 1, vuelo: { i: 0, key: null }, hospedaje: { i: 0, key: null }, noches_hospedaje: null, tours: [] } };
    expect(savedTripMissing(db.full)).toEqual([]);
    render(<MemoryRouter><TripCommandCenter trip={db.full} today={localISODate()} /></MemoryRouter>);
    expect(await screen.findByText("Prepara tu maleta")).toBeInTheDocument();
  });
});
