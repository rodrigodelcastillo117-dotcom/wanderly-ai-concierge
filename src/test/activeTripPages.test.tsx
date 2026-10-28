// Un solo viaje activo en Gastos, Fixer y herramientas del viaje; trip_id en reservas y gastos
// (E-22); estado reservado/cotizado en Mis viajes; categoría real de los clics del concierge.
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { vi, it, expect, beforeEach, describe } from "vitest";
import { __resetActiveTripColumn } from "@/lib/profileActiveTrip";

const ROMA = "11111111-1111-4111-8111-111111111111";
const LIMA = "22222222-2222-4222-8222-222222222222";
const AJENO = "33333333-3333-4333-8333-333333333333";

const db = {
  tables: {} as Record<string, any[]>,
  profileError: null as any,
  inserts: [] as { table: string; row: any }[],
  updates: [] as { table: string; row: any }[],
};

vi.mock("@/integrations/supabase/client", () => {
  const from = (table: string) => {
    const f: Record<string, unknown> = {};
    let ins: { row: any } | null = null;
    const rows = () => {
      if (table === "profiles" && db.profileError) return { data: null, error: db.profileError };
      let r = db.tables[table] ?? [];
      for (const [k, v] of Object.entries(f)) r = r.filter((x) => (k === "__in" ? (v as any).vals.includes(x[(v as any).col]) : x[k] === v));
      return { data: r, error: null };
    };
    const api: any = {
      select: () => api,
      eq: (k: string, v: unknown) => { f[k] = v; return api; },
      in: (col: string, vals: unknown[]) => { f.__in = { col, vals }; return api; },
      is: () => api, gte: () => api, order: () => api, limit: () => api,
      insert: (row: any) => { db.inserts.push({ table, row }); ins = { row }; return api; },
      update: (row: any) => { db.updates.push({ table, row }); return api; },
      single: async () => ({ data: ins ? { id: "new", ...ins.row } : rows().data?.[0] ?? null, error: null }),
      maybeSingle: async () => { const r = rows(); return { data: r.data?.[0] ?? null, error: r.error }; },
      then: (res: any, rej: any) => Promise.resolve(ins ? { data: null, error: null } : rows()).then(res, rej),
    };
    return api;
  };
  return {
    supabase: {
      from,
      auth: { getSession: async () => ({ data: { session: { user: { id: "u1" } } } }) },
      functions: { invoke: vi.fn(async () => ({ data: { ok: true }, error: null })) },
      storage: { from: () => ({ upload: async () => ({ error: null }) }) },
    },
  };
});
// Usuario estable (como en la app): un objeto nuevo en cada render re-dispararía los efectos.
const authUser = vi.hoisted(() => ({ id: "u1", email: "u1@example.test", user_metadata: {} }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: authUser, loading: false }) }));
vi.mock("@/components/DashboardLayout", () => ({ DashboardLayout: ({ children }: any) => <>{children}</> }));
vi.mock("@/components/DestinationVideo", () => ({ DestinationVideo: () => null }));
vi.mock("@/components/SmartSpendPanel", () => ({ default: () => null }));
vi.mock("@/components/TripSavingsCalculator", () => ({ TripSavingsCalculator: () => null }));
vi.mock("@/hooks/useFxTable", () => ({ useFxTable: () => null }));
vi.mock("@/lib/insights", () => ({ logInsight: vi.fn(async () => {}) }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));

import Gastos from "@/pages/Gastos";
import TripCars from "@/pages/TripCars";
import Trips from "@/pages/Trips";
import { FixerButton } from "@/components/FixerButton";
import { RichCard, bookingCategoryForCard } from "@/components/concierge/ConciergeCards";
import { ACTIVE_TRIP_LOCAL_KEY } from "@/lib/activeTripStore";

const trips = () => [
  { id: ROMA, user_id: "u1", destino: "Roma", fecha_salida: "2099-11-01", fecha_regreso: "2099-11-08", created_at: "2026-01-01", total_estimado: 50000, vuelos_json: [{ aerolinea: "ITA" }], hospedaje_json: [{ nombre: "Hotel Roma" }] },
  { id: LIMA, user_id: "u1", destino: "Lima", fecha_salida: "2099-12-01", fecha_regreso: "2099-12-05", created_at: "2026-06-01", total_estimado: 20000 },
];

beforeEach(() => {
  __resetActiveTripColumn();
  db.tables = { trips: trips(), expenses: [], profiles: [{ id: "u1", active_trip_id: LIMA }], bookings: [], trip_collaborators: [] };
  db.profileError = null;
  db.inserts.length = 0;
  db.updates.length = 0;
  localStorage.clear();
});

describe("Gastos: el gasto se liga al viaje activo (y se puede cambiar)", () => {
  it("por defecto usa el viaje fijado en el perfil y lo guarda en trip_id", async () => {
    render(<MemoryRouter><Gastos /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: /Nuevo gasto/ }));
    const select = await screen.findByLabelText("Viaje") as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe(LIMA));
    fireEvent.change(screen.getByPlaceholderText("0"), { target: { value: "250" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(db.inserts.find((i) => i.table === "expenses")).toBeTruthy());
    expect(db.inserts.find((i) => i.table === "expenses")!.row).toMatchObject({ amount: 250, trip_id: LIMA });
  });

  it("sin la columna active_trip_id (400 en producción) usa la elección local; 'Sin viaje' guarda null", async () => {
    db.profileError = { code: "42703", message: "column profiles.active_trip_id does not exist" };
    localStorage.setItem(ACTIVE_TRIP_LOCAL_KEY, ROMA);
    render(<MemoryRouter><Gastos /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: /Nuevo gasto/ }));
    const select = await screen.findByLabelText("Viaje") as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe(ROMA));
    fireEvent.change(select, { target: { value: "" } });
    fireEvent.change(screen.getByPlaceholderText("0"), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(db.inserts.find((i) => i.table === "expenses")).toBeTruthy());
    expect(db.inserts.find((i) => i.table === "expenses")!.row.trip_id).toBeNull();
  });

  it("con dos viajes y nada fijado no adivina: el gasto queda sin viaje hasta elegir", async () => {
    db.tables.profiles = [{ id: "u1", active_trip_id: null }];
    render(<MemoryRouter><Gastos /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: /Nuevo gasto/ }));
    const select = await screen.findByLabelText("Viaje") as HTMLSelectElement;
    await screen.findByRole("option", { name: /Roma/ });
    expect(select.value).toBe("");
  });
});

describe("Fixer sin viaje explícito recibe el viaje activo", () => {
  it("la escalación lleva el trip_id del viaje fijado", async () => {
    render(<FixerButton />);
    fireEvent.click(screen.getByRole("button", { name: /Hablar con una persona/ }));
    fireEvent.click(await screen.findByText("Crítico"));
    // Esperar a que el viaje activo cargue antes de enviar.
    await waitFor(() => expect(db.tables.profiles).toBeTruthy());
    await new Promise((r) => setTimeout(r, 0));
    fireEvent.click(screen.getByRole("button", { name: /Enviar al equipo/ }));
    await waitFor(() => expect(db.inserts.find((i) => i.table === "fixer_escalations")).toBeTruthy());
    expect(db.inserts.find((i) => i.table === "fixer_escalations")!.row.trip_id).toBe(LIMA);
  });
});

describe("Herramientas del viaje con ?trip=<id> (E-22)", () => {
  const url = (trip: string) => `/dashboard/autos?city=Roma&pickup=2099-11-01&return=2099-11-08&trip=${trip}`;
  it("muestra a qué viaje se agrega y el clic al socio guarda trip_id", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue({ opener: null } as unknown as Window);
    render(<MemoryRouter initialEntries={[url(ROMA)]}><TripCars /></MemoryRouter>);
    expect(await screen.findByText("Roma", { selector: "a" })).toBeInTheDocument();
    expect(screen.getByText(/Agregando a tu viaje/)).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: /Buscar|Comparar|Ver/ })[0]);
    expect(open).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(db.inserts.find((i) => i.table === "bookings")).toBeTruthy());
    expect(db.inserts.find((i) => i.table === "bookings")!.row).toMatchObject({ category: "car", trip_id: ROMA, status: "pending" });
    open.mockRestore();
  });

  it("un viaje sin acceso (RLS no lo devuelve) no se muestra ni se registra", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue({ opener: null } as unknown as Window);
    render(<MemoryRouter initialEntries={[url(AJENO)]}><TripCars /></MemoryRouter>);
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByText(/Agregando a tu viaje/)).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: /Buscar|Comparar|Ver/ })[0]);
    await waitFor(() => expect(db.inserts.find((i) => i.table === "bookings")).toBeTruthy());
    expect(db.inserts.find((i) => i.table === "bookings")!.row.trip_id).toBeNull();
    open.mockRestore();
  });
});

describe("Mis viajes: reservado vs. cotizado (status 'listo' no lo dice)", () => {
  it("con vuelo y hotel confirmados dice 'Reservado'; sin reservas, 'Cotizado · sin reservar'", async () => {
    db.tables.bookings = [
      { trip_id: ROMA, category: "flight", status: "confirmed", title: "ITA Airways" },
      { trip_id: ROMA, category: "hotel", status: "pending", confirmation_code: "H1", title: "Hotel Roma" },
      { trip_id: LIMA, category: "flight", status: "pending", title: "clic a Aviasales" },
    ];
    render(<MemoryRouter><Trips /></MemoryRouter>);
    await screen.findByText("Roma");
    await waitFor(() => {
      const states = screen.getAllByTestId("trip-booking-state").map((e) => e.getAttribute("data-state"));
      expect(states.sort()).toEqual(["cotizado", "reservado"]);
    });
    expect(screen.getByText("Reservado")).toBeInTheDocument();
    expect(screen.getByText("Cotizado · sin reservar")).toBeInTheDocument();
  });
});

describe("Concierge: categoría real del clic de afiliado", () => {
  it("mapea el tipo de card a la categoría de bookings", () => {
    expect(bookingCategoryForCard("flight")).toBe("flight");
    expect(bookingCategoryForCard("hotel")).toBe("hotel");
    expect(bookingCategoryForCard("attraction")).toBe("activity");
    expect(bookingCategoryForCard("restaurant")).toBe("restaurant");
    expect(bookingCategoryForCard("jet")).toBe("other");
  });
  it("un clic en una card de vuelo queda como 'flight' (antes 'restaurant') con el viaje", async () => {
    render(<RichCard tripId={ROMA} card={{ type: "flight", title: "Iberia", subtitle: "MEX→MAD", cta_action: "https://www.aviasales.com/x", estado_dato: "CONSULTADO_EN_VIVO", fuente: "serpapi", price: 900, currency: "USD" }} />);
    fireEvent.click(screen.getByRole("link", { name: /Ver y comprar/ }));
    await waitFor(() => expect(db.inserts.find((i) => i.table === "bookings")).toBeTruthy());
    expect(db.inserts.find((i) => i.table === "bookings")!.row).toMatchObject({ category: "flight", trip_id: ROMA, status: "pending" });
    expect(db.inserts.find((i) => i.table === "affiliate_clicks")!.row).toMatchObject({ trip_id: ROMA, accion: "concierge_flight" });
  });
});
