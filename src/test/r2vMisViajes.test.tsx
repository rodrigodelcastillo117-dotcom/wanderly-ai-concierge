// R2 viajes P2-7: «E2E PRUEBA Presupuesto Los Cabos» aparecía como «México»; los 3 «Madrid · 10–17 mar» no se
// distinguían; y Mis viajes (24 viajes) no tenía filtros.
import React from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { vi, it, expect, describe, beforeEach } from "vitest";
import { localISODatePlus } from "@/lib/localDate";

const db = { trips: [] as any[] };
vi.mock("@/integrations/supabase/client", () => {
  const from = (table: string) => {
    const api: any = { select: () => api, eq: () => api, in: () => api, order: () => api,
      then: (res: any, rej: any) => Promise.resolve({ data: table === "trips" ? db.trips : [], error: null }).then(res, rej) };
    return api;
  };
  return { supabase: { from } };
});
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));
vi.mock("@/components/DashboardLayout", () => ({ DashboardLayout: ({ children }: any) => <>{children}</> }));
vi.mock("@/components/DestinationVideo", () => ({ DestinationVideo: () => null }));
vi.mock("@/components/media/SmartImage", () => ({ SmartImage: ({ children }: any) => <div>{children}</div> }));

import Trips from "@/pages/Trips";
import { shortTripName } from "@/lib/tripName";
import { duplicateTripMarks } from "@/lib/tripList";

const M = (id: string, created: string, extra: any = {}) => ({ id, user_id: "u1", destino: "Madrid", fecha_salida: localISODatePlus(130), fecha_regreso: localISODatePlus(137), created_at: created, ...extra });

beforeEach(() => {
  localStorage.clear();
  db.trips = [
    M("m1", "2026-10-20T10:00:00Z"), M("m2", "2026-10-25T10:00:00Z"), M("m3", "2026-10-28T10:00:00Z"),
    { id: "lc", user_id: "u1", destino: "E2E PRUEBA Presupuesto Los Cabos", pais_destino: "México", fecha_salida: localISODatePlus(40), fecha_regreso: localISODatePlus(44), created_at: "2026-10-27T10:00:00Z" },
    { id: "old", user_id: "u1", destino: "Lisboa", fecha_salida: localISODatePlus(-60), fecha_regreso: localISODatePlus(-55), created_at: "2026-08-01T10:00:00Z" },
  ];
});

describe("nombres", () => {
  it("la ciudad del texto antes que el país", () => {
    expect(shortTripName({ destino: "E2E PRUEBA Presupuesto Los Cabos", pais_destino: "México" })).toBe("Los Cabos");
    expect(shortTripName({ destino: "Quiero conocer España 15 días, no sé qué ciudades", pais_destino: "España" })).toBe("España");
  });

  it("viajes iguales: (2), (3) por orden de creación", () => {
    const { n, ids } = duplicateTripMarks(db.trips);
    expect([n.get("m1"), n.get("m2"), n.get("m3")]).toEqual([undefined, 2, 3]);
    expect([...ids].sort()).toEqual(["m1", "m2", "m3"]);
    expect(n.has("lc")).toBe(false);
  });
});

describe("Mis viajes", () => {
  it("distingue los Madrid y muestra Los Cabos", async () => {
    render(<MemoryRouter><Trips /></MemoryRouter>);
    expect(await screen.findByRole("heading", { name: "Madrid (2)" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Madrid (3)" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Madrid" })).toBeInTheDocument();
    // R3 P2-7: con la hora, para distinguir dos creados el mismo día.
    expect(screen.getAllByTestId("trip-card-creado").map((e) => e.textContent)).toEqual(expect.arrayContaining([
      expect.stringMatching(/^Creado el 20 oct 2026, \d{2}:\d{2}$/), expect.stringMatching(/^Creado el 25 oct 2026, \d{2}:\d{2}$/), expect.stringMatching(/^Creado el 28 oct 2026, \d{2}:\d{2}$/)]));
    expect(screen.getByRole("heading", { name: "Los Cabos" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "México" })).toBeNull();
  });

  it("filtros Próximos / Pasados / Todos", async () => {
    render(<MemoryRouter><Trips /></MemoryRouter>);
    const filtros = await screen.findByTestId("trips-filtros");
    expect(screen.getByRole("heading", { name: "Lisboa" })).toBeInTheDocument();
    fireEvent.click(within(filtros).getByRole("button", { name: "Próximos" }));
    expect(screen.queryByRole("heading", { name: "Lisboa" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Los Cabos" })).toBeInTheDocument();
    fireEvent.click(within(filtros).getByRole("button", { name: "Pasados" }));
    expect(screen.getByRole("heading", { name: "Lisboa" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Los Cabos" })).toBeNull();
    expect(within(filtros).getByRole("button", { name: "Pasados" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(within(filtros).getByRole("button", { name: "Todos" }));
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(5);
  });
});
