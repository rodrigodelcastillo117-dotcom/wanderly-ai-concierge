// Recorrido en producción (9-nov-2026, Puerto Escondido): el mapa del viaje llegaba a «Día 4» en un itinerario de 5
// días y cada día decía «Día libre» aunque tuviera mañana, tarde y noche. Ahora usa los mismos días del Itinerario.
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const TRIP = {
  id: "c0b1", destino: "Puerto Escondido", ciudad_origen: "Ciudad de México", fecha_salida: "2026-11-12", fecha_regreso: "2026-11-16", num_viajeros: 2,
  vuelos_json: [{ aerolinea: "Volaris", precio_por_persona: 10054 }],
  itinerario_json: [
    { dia: 1, titulo: "Llegada", "mañana": "Vuelo a Puerto Escondido", tarde: "Check-in y playa Zicatela", noche: "Cena en Rinconada" },
    { dia: 2, titulo: "Playas", "mañana": "Snorkel en Carrizalillo", tarde: "Comida en Puerto Angelito", noche: "Atardecer en Punta Zicatela" },
    { dia: 3, titulo: "Laguna", "mañana": "Lagunas de Manialtepec", tarde: "Siesta", noche: "Bioluminiscencia" },
    { dia: 4, titulo: "Tortugas", "mañana": "Liberación de tortugas", tarde: "Mercado", noche: "Mezcalería" },
  ],
};

vi.mock("@/integrations/supabase/client", () => {
  const api: any = { select: () => api, eq: () => api, maybeSingle: async () => ({ data: TRIP, error: null }) };
  return { supabase: { from: () => api, functions: { invoke: async () => ({ data: null, error: null }) } } };
});
vi.mock("@/lib/googleMapsLoader", () => ({ loadGoogleMaps: () => new Promise(() => {}) }));
vi.mock("@/components/opinion/OpinionEntry", () => ({ StandaloneOpinion: () => null }));
vi.mock("@/components/BackButton", () => ({ BackButton: () => null }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" }, loading: false }) }));

import TripMap from "@/pages/TripMap";

describe("mapa del viaje", () => {
  it("tiene los mismos días que el Itinerario (con el de regreso) y cada día muestra su plan", async () => {
    render(<MemoryRouter initialEntries={["/dashboard/viajes/c0b1/mapa"]}><Routes><Route path="/dashboard/viajes/:id/mapa" element={<TripMap />} /></Routes></MemoryRouter>);
    expect(await screen.findByRole("button", { name: "Día 5" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Día 2" }));
    expect(screen.getByText(/Mañana: .*Carrizalillo/)).toBeInTheDocument();
    expect(screen.queryByText("Día libre.")).toBeNull();
  });
});

describe("leyenda del mapa (10-nov-2026: solo lo que hay en el mapa)", () => {
  it("mientras el mapa no se dibuja, la leyenda sale completa (no se pierde nada)", async () => {
    render(<MemoryRouter initialEntries={["/dashboard/viajes/c0b1/mapa"]}><Routes><Route path="/dashboard/viajes/:id/mapa" element={<TripMap />} /></Routes></MemoryRouter>);
    await screen.findByRole("button", { name: "Día 5" });
    for (const k of ["Hotel", "Restaurante", "Tour", "Puerto", "Metro", "Avión", "Tren", "Crucero", "Tierra"]) expect(screen.getByText(k)).toBeInTheDocument();
  });
});

describe("modo de cada tramo entre ciudades", () => {
  it("manda el tramo cotizado del plan: el Shinkansen es tren aunque haya una alternativa de vuelo", async () => {
    const { planLegMode } = await import("@/pages/TripMap");
    const japon = { itinerario_json: { logistics: { internal_transport: [
      { from: "Tokio", to: "Kioto", mode: "tren", provider: "Shinkansen" },
      { from: "Kioto", to: "Osaka", mode: "tren" },
      { from: "Osaka", to: "Seúl", mode: "vuelo_interno" },
    ] } } };
    expect(planLegMode(japon, "Tokio", "Kioto")).toBe("train");
    expect(planLegMode(japon, "Osaka", "Seúl")).toBe("flight");
    expect(planLegMode(japon, "Kioto", "Nara")).toBeNull();
  });
});
