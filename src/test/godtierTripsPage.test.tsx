// Mis viajes (grupo godtier): agrupado por próximos/pasados, cuenta regresiva y sin "$0" en borradores.
import React from "react";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { vi, it, expect } from "vitest";
import { localISODatePlus } from "@/lib/localDate";

const trips = [
  { id: "p1", user_id: "u1", destino: "Puebla", fecha_salida: localISODatePlus(10), fecha_regreso: localISODatePlus(12), created_at: "2026-01-02", total_estimado: 23560 },
  { id: "b1", user_id: "u1", destino: "Borrador", fecha_salida: localISODatePlus(30), fecha_regreso: localISODatePlus(31), created_at: "2026-03-02", total_estimado: 0 },
  { id: "o1", user_id: "u1", destino: "Oaxaca", fecha_salida: localISODatePlus(-40), fecha_regreso: localISODatePlus(-35), created_at: "2026-05-02", total_estimado: 9000 },
];
function qb(table: string) {
  const api: any = {
    select: () => api, eq: () => api, in: () => api,
    then: (res: any, rej: any) => Promise.resolve({ data: table === "trips" ? trips : [], error: null }).then(res, rej),
  };
  return api;
}
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: (t: string) => qb(t), functions: { invoke: async () => ({ data: null }) } } }));
const user = vi.hoisted(() => ({ id: "u1" }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user, loading: false }) }));
vi.mock("@/components/DashboardLayout", () => ({ DashboardLayout: ({ children }: any) => <>{children}</> }));
vi.mock("@/components/DestinationVideo", () => ({ DestinationVideo: () => null }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import Trips from "@/pages/Trips";

it("separa próximos y pasados, dice cuánto falta y no muestra $0 a un borrador", async () => {
  render(<MemoryRouter><Trips /></MemoryRouter>);
  const proximos = await screen.findByRole("region", { name: /Próximos y en curso/ });
  const pasados = screen.getByRole("region", { name: /Viajes pasados/ });
  const names = within(proximos).getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
  expect(names).toEqual(["Puebla", "Borrador"]);
  expect(within(pasados).getByRole("heading", { level: 3 })).toHaveTextContent("Oaxaca");
  expect(within(proximos).getByText("Faltan 10 días")).toBeInTheDocument();
  expect(within(proximos).getByText("$23,560 MXN")).toBeInTheDocument();
  expect(within(proximos).getByText("Sin cotización")).toBeInTheDocument();
  expect(screen.queryByText("$0")).toBeNull();
});
