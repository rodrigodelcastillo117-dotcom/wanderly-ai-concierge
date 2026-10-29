// R2 viajes P2-11: en Comprar la procedencia del vuelo salía dos veces: «Consultado hace 9 h · Google
// Flights» y «Google Flights · consultado 10:40 (hace 9 h)». Ahora va en una sola línea.
import React from "react";
import { render, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { vi, it, expect } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: null } }) },
    from: () => ({ select: () => ({ eq: () => ({ then: (r: any) => r({ data: [], error: null }) }) }) }),
    functions: { invoke: vi.fn(async () => { throw new Error("sin red en pruebas"); }) },
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));

import { TripPurchasePlan } from "@/components/booking/TripPurchasePlan";

const at = new Date(Date.now() - 9 * 3600_000).toISOString();
const flight = (tier: string, aerolinea: string, precio: number) => ({
  tier, mode: "vuelo", aerolinea, precio_por_persona: precio, escalas: "Directo", duracion: "11h 0m",
  fuente_precio: "en_vivo", estado_dato: "CONSULTADO_EN_VIVO", consultado_at: at, from: "Ciudad de México", to: "Madrid",
});
const TRIP = {
  id: "t1", destino: "Madrid", pais_destino: "España", ciudad_origen: "Ciudad de México", fecha_salida: "2027-03-10", fecha_regreso: "2027-03-17",
  num_viajeros: 2, created_at: at, total_estimado: 80000, desglose_presupuesto: { vuelos: 40000, hospedaje: 40000 },
  vuelos_json: [flight("ahorro", "Iberia", 15863), flight("equilibrio", "Aeroméxico", 17466), flight("premium", "Air Europa", 21000)],
  hospedaje_json: [], tours_json: [], itinerario_json: [],
};

it("una sola línea de procedencia en el paso del vuelo", () => {
  const { getByTestId } = render(<MemoryRouter><TripPurchasePlan trip={TRIP as any} selVuelo={-1} selHospedaje={-1} selTours={new Set()} bookings={[]} userId={null} /></MemoryRouter>);
  const step = getByTestId("comprar-vuelo");
  // Lo visible (sin el detalle plegado «Ver detalles», que repite el precio para la compra).
  const visible = step.cloneNode(true) as HTMLElement;
  visible.querySelectorAll("details").forEach((d) => d.remove());
  const text = visible.textContent ?? "";
  expect(within(step).getByTestId("vuelo-en-vivo").textContent).toMatch(/^Google Flights · consultado \d{2}:\d{2} \(hace 9 h\)$/);
  expect(text).not.toMatch(/Consultado hace 9 h · Google Flights/);
  expect((text.match(/hace 9 h/g) ?? []).length).toBe(1);
});
