// Defecto 21 (E2E 28-oct-2026, celular a 390 px):
//  - nombres y precios de hotel cortados ("Dear Hotel Madr…") → hasta 2 líneas;
//  - el botón fijo seguía diciendo "Elegir vuelo y hotel" después de elegir ambos → "Ver tu selección";
//  - "Te falta elegir hotel" repetido → se dice una vez (en su paso); "Listo" solo lleva a elegirlo.
import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { nextTripAction } from "@/lib/tripCommand";

vi.mock("@/integrations/supabase/client", () => {
  const api: any = {
    select: () => api, eq: () => api, order: () => api, limit: () => api, in: () => api, not: () => api,
    maybeSingle: async () => ({ data: null, error: null }),
    then: (res: any, rej: any) => Promise.resolve({ data: [], error: null }).then(res, rej),
  };
  return { supabase: { from: () => api, functions: { invoke: async () => ({ data: null, error: null }) }, auth: { getSession: async () => ({ data: { session: null } }) } } };
});
vi.mock("@/lib/trackBooking", () => ({ logBookingClick: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { TripPurchasePlan } from "@/components/booking/TripPurchasePlan";
import { TripNextStep } from "@/components/TripNextStep";

const hotel = (nombre: string, precio: number, tier: string) => ({
  nombre, tier, tipo: tier, precio_por_noche: precio, ciudad: "Madrid", fuente_precio: "serpapi", estado_dato: "CONSULTADO_EN_VIVO", consultado_at: "2026-10-28T15:00:00Z",
});
const TRIP = {
  id: "t-madrid", user_id: "u1", destino: "Madrid", pais_destino: "España", ciudad_origen: "Ciudad de México",
  fecha_salida: "2027-03-10", fecha_regreso: "2027-03-17", num_viajeros: 2, total_estimado: 81831, created_at: "2026-10-28T15:00:00Z",
  vuelos_json: [{ tier: "premium", mode: "vuelo", aerolinea: "Iberia", escalas: "Directo", duracion: "10h 10m", precio_por_persona: 17346, fuente_precio: "serpapi", estado_dato: "CONSULTADO_EN_VIVO", consultado_at: "2026-10-28T15:00:00Z", from: "Ciudad de México", to: "Madrid", dep_iata: "MEX", arr_iata: "MAD" }],
  hospedaje_json: [hotel("Hotel Ibis Styles Madrid City Las Ventas", 2683, "ahorro"), hotel("Dear Hotel Madrid", 3093, "equilibrio"), hotel("Hotel Montera Madrid, Curio Collection by Hilton", 6372, "premium")],
  tours_json: [], restaurantes_json: [], itinerario_json: [],
};

describe("Comprar a 390 px", () => {
  it("el nombre del hotel y la aerolínea pueden ocupar 2 líneas (no se cortan en una)", () => {
    render(<MemoryRouter><TripPurchasePlan trip={TRIP} selVuelo={-1} selHospedaje={-1} selTours={new Set()} bookings={[]} userId="u1" onSelectVuelo={() => {}} onSelectHotel={() => {}} /></MemoryRouter>);
    const name = screen.getAllByText("Hotel Montera Madrid, Curio Collection by Hilton")[0];
    expect(name.className).toMatch(/line-clamp-2/);
    expect(name.className).not.toMatch(/\btruncate\b/);
    const vuelo = within(screen.getAllByTestId("vuelo-opcion")[0]).getByText(/Iberia/);
    expect(vuelo.className).toMatch(/line-clamp-2/);
  });

  it("'Te falta elegir hotel' una sola vez; en 'Listo' solo el atajo para ir a elegirlo", () => {
    render(<MemoryRouter><TripPurchasePlan trip={TRIP} selVuelo={0} selHospedaje={-1} selTours={new Set()} bookings={[]} userId="u1" onSelectVuelo={() => {}} onSelectHotel={() => {}} /></MemoryRouter>);
    expect(screen.getAllByText(/Te falta elegir hotel/)).toHaveLength(1);
    const listo = screen.getByTestId("comprar-listo-falta");
    expect(listo).toHaveTextContent("Elegir hotel");
    expect(within(listo).getByRole("button")).toBeInTheDocument();
  });
});

describe("botón fijo después de elegir vuelo y hotel", () => {
  const base = { id: "t1", fecha_salida: "2027-03-10", fecha_regreso: "2027-03-17", total_estimado: 81831, created_at: "2026-10-28T15:00:00Z" };
  const NOW = new Date("2026-10-28T16:00:00Z");
  it("con algo por elegir: 'Elegir vuelo y hotel'; ya elegido todo: 'Ver tu selección'", () => {
    expect(nextTripAction(base, { today: "2026-10-28", now: NOW, missing: ["hotel"] }).cta).toBe("Elegir vuelo y hotel");
    expect(nextTripAction(base, { today: "2026-10-28", now: NOW, missing: [] })).toMatchObject({ key: "comprar", cta: "Ver tu selección" });
    // Sin saber qué falta (Inicio), igual que antes.
    expect(nextTripAction(base, { today: "2026-10-28", now: NOW }).cta).toBe("Elegir vuelo y hotel");
  });

  it("la barra móvil dice 'Ver tu selección' y lleva a 'Listo · Revisa y compra'", () => {
    const scrolled: string[] = [];
    Element.prototype.scrollIntoView = function (this: Element) { scrolled.push(this.id); } as any;
    render(<MemoryRouter><div id="paso-listo" /><TripNextStep trip={base} quote={null} isOwner variant="bar" totalLabel="Total $81,273 MXN" totalNote="Tu selección" missing={[]} now={NOW} /></MemoryRouter>);
    const btn = within(screen.getByTestId("trip-next-bar")).getByRole("button");
    // R4 P2-3: texto corto en la barra; «Ver tu selección» es su nombre accesible.
    expect(btn).toHaveTextContent("Ver selección");
    expect(btn).toHaveAccessibleName("Ver tu selección");
    fireEvent.click(btn);
    expect(scrolled.at(-1)).toBe("paso-listo");
  });
});
