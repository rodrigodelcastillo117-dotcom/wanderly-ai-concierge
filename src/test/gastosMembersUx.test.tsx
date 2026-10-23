// Gastos y Members Only más claros (oct 2026): pestañas con nombre y explicación, estados vacíos
// con acción, calculadora de ahorro sin viaje, resumen útil con pocos datos; en Members Only,
// búsqueda sin acentos, ciudades arriba y un video distinto por ciudad.
import React from "react";
import { render, screen, fireEvent, waitFor, act, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { vi, it, expect, beforeEach, afterEach, describe } from "vitest";

const db = vi.hoisted(() => ({
  tables: {} as Record<string, any[]>,
  inserts: [] as { table: string; row: any }[],
  rpc: {} as Record<string, unknown>,
  rpcCalls: [] as { fn: string; args: unknown }[],
}));
vi.mock("@/integrations/supabase/client", () => {
  const from = (table: string) => {
    let ins = false;
    const api: any = {
      select: () => api, eq: () => api, in: () => api, is: () => api, gte: () => api, order: () => api, limit: () => api,
      insert: (row: any) => { db.inserts.push({ table, row }); ins = true; return api; },
      update: () => api,
      maybeSingle: async () => ({ data: (db.tables[table] ?? [])[0] ?? null, error: null }),
      single: async () => ({ data: (db.tables[table] ?? [])[0] ?? null, error: null }),
      then: (res: any, rej: any) => Promise.resolve(ins ? { data: null, error: null } : { data: db.tables[table] ?? [], error: null }).then(res, rej),
    };
    return api;
  };
  return {
    supabase: {
      from,
      rpc: async (fn: string, args?: unknown) => {
        db.rpcCalls.push({ fn, args });
        const v = db.rpc[fn];
        return typeof v === "function" ? (v as (a: unknown) => unknown)(args) : { data: v ?? null, error: v === undefined ? { message: "x" } : null };
      },
      auth: { getSession: async () => ({ data: { session: { access_token: "t", user: { id: "u1" } } } }) },
      functions: { invoke: vi.fn(async () => ({ data: {}, error: null })) },
      storage: { from: () => ({ upload: async () => ({ error: null }) }) },
    },
  };
});
const authUser = vi.hoisted(() => ({ id: "u1", email: "u1@example.test", user_metadata: {} }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: authUser, loading: false }) }));
vi.mock("@/components/DashboardLayout", () => ({ DashboardLayout: ({ children }: any) => <>{children}</> }));
vi.mock("@/hooks/useSubscription", () => ({ useSubscription: () => ({ loading: false, isPro: true }) }));
vi.mock("@/components/media/VenueImage", () => ({ VenueImage: () => null }));
vi.mock("@/lib/insights", () => ({ logInsight: vi.fn(async () => {}) }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
const FX = vi.hoisted(() => ({ rates: { USD: 1, MXN: 20, EUR: 0.9, JPY: 150 }, source: "prueba", asOf: "2026-10-22T00:00:00Z", isFallback: false, kind: "live" as const }));
vi.mock("@/hooks/useFxTable", () => ({ useFxTable: () => FX }));

import Gastos, { GASTOS_TABS } from "@/pages/Gastos";
import { TripSavingsCalculator } from "@/components/TripSavingsCalculator";
import { computeGoal, monthsUntil } from "@/lib/savingsGoal";
import { estimateTripCost, regionOf } from "@/lib/tripEstimate";
import { spendInsights } from "@/lib/spendInsights";
import { MembersOnlyPanel, venueMatches } from "@/components/MembersOnlyPanel";
import { CityVideoCard } from "@/components/CityVideoCard";
import { __resetVideoClaims, cityVideoQueries, matchCities, orderCities, resolveCityName, videoKey } from "@/lib/cityVisuals";
import { __resetVideoSearch } from "@/lib/videoSearch";

const NOW = new Date(2026, 9, 22); // 22 oct 2026

// recharts (dona del Resumen) mide su contenedor.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
}

beforeEach(() => {
  db.tables = { trips: [], expenses: [], profiles: [{ id: "u1", active_trip_id: null }], trip_collaborators: [] };
  db.inserts.length = 0;
  db.rpc = {};
  db.rpcCalls.length = 0;
  localStorage.clear();
});

// ── Gastos: pestañas ────────────────────────────────────────────────────────────────────────
describe("Gastos: tres pestañas que se entienden en 3 segundos", () => {
  it("nombres claros, cada una con su explicación de una línea", async () => {
    render(<MemoryRouter><Gastos /></MemoryRouter>);
    const tabs = screen.getAllByRole("tab").map((t) => t.textContent?.trim());
    expect(tabs).toEqual(["Mis gastos", "Resumen", "Ahorro"]);
    expect(screen.queryByText(/Smart Spend|^Lista$|Calculadora de viaje/)).toBeNull();
    const explainer = () => screen.getByTestId("gastos-explainer").textContent;
    expect(screen.getByRole("tab", { name: "Mis gastos" })).toHaveAttribute("aria-selected", "true");
    expect(explainer()).toMatch(/Anota cada gasto en cualquier moneda/);
    fireEvent.click(screen.getByRole("tab", { name: "Resumen" }));
    expect(explainer()).toMatch(/En qué se te va el dinero.*por categoría y por viaje.*pesos/);
    fireEvent.click(screen.getByRole("tab", { name: "Ahorro" }));
    expect(explainer()).toMatch(/Ahorro para tu viaje.*cuánto apartar cada mes.*No necesitas un viaje planeado/);
    for (const t of GASTOS_TABS) expect(t.explainer.length).toBeLessThan(110);
  });

  it("pestañas accesibles: flechas, Inicio y Fin cambian de pestaña y mueven el foco", () => {
    render(<MemoryRouter><Gastos /></MemoryRouter>);
    const first = screen.getByRole("tab", { name: "Mis gastos" });
    expect(first).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("tab", { name: "Resumen" })).toHaveAttribute("tabindex", "-1");
    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Resumen" })).toHaveAttribute("aria-selected", "true");
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Resumen" }));
    fireEvent.keyDown(document.activeElement!, { key: "End" });
    expect(screen.getByRole("tab", { name: "Ahorro" })).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Mis gastos" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", "gastos-tab-gastos");
  });

  it("los enlaces viejos (?tab=calc) abren la pestaña nueva", () => {
    render(<MemoryRouter initialEntries={["/dashboard/gastos?tab=calc"]}><Gastos /></MemoryRouter>);
    expect(screen.getByRole("tab", { name: "Ahorro" })).toHaveAttribute("aria-selected", "true");
  });

  it("sin gastos: estado vacío con 'Registra tu primer gasto' que abre el formulario", async () => {
    render(<MemoryRouter><Gastos /></MemoryRouter>);
    expect(screen.getByText("Aún no registras gastos")).toBeInTheDocument();
    expect(screen.queryByText("Total registrado")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Registra tu primer gasto/ }));
    expect(await screen.findByLabelText("Monto")).toBeInTheDocument();
  });

  it("Resumen vacío: invita a registrar y lleva al formulario de Mis gastos", async () => {
    render(<MemoryRouter initialEntries={["/dashboard/gastos?tab=resumen"]}><Gastos /></MemoryRouter>);
    // La pestaña se carga aparte (recharts): se espera a que llegue.
    const btn = await screen.findByRole("button", { name: /Registra tu primer gasto/ }, { timeout: 8000 });
    expect(screen.getByText("Aquí verás en qué se te va el dinero")).toBeInTheDocument();
    fireEvent.click(btn);
    expect(screen.getByRole("tab", { name: "Mis gastos" })).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByLabelText("Monto")).toBeInTheDocument();
  });

  it("Resumen con pocos datos: total, categoría principal y por viaje", async () => {
    db.tables.trips = [{ id: "t1", user_id: "u1", destino: "Tokio", fecha_salida: "2099-11-01", fecha_regreso: "2099-11-08", created_at: "2026-01-01" }];
    db.tables.expenses = [
      { id: "e1", amount: 3000, currency: "JPY", category: "Restaurantes", description: "Ramen", expense_date: "2026-10-01", receipt_url: null, trip_id: "t1" },
      { id: "e2", amount: 100, currency: "MXN", category: "Transporte local", description: "Taxi", expense_date: "2026-10-02", receipt_url: null, trip_id: null },
    ];
    render(<MemoryRouter initialEntries={["/dashboard/gastos?tab=resumen"]}><Gastos /></MemoryRouter>);
    expect(await screen.findByText("Donde más gastas", {}, { timeout: 8000 })).toBeInTheDocument();
    // 3000 JPY = 400 MXN + 100 MXN
    expect(screen.getByText("Total gastado").parentElement!.textContent).toMatch(/\$500\s*MXN/);
    const porViaje = screen.getByText("Por viaje").closest("section")!;
    expect(within(porViaje).getByText(/Tokio/)).toBeInTheDocument();
    expect(within(porViaje).getByText(/Sin viaje/)).toBeInTheDocument();
  });
});

// ── Resumen: lógica ─────────────────────────────────────────────────────────────────────────
describe("spendInsights", () => {
  const trips = [
    { id: "roma", destino: "Roma", fecha_salida: "2026-10-20", fecha_regreso: "2026-10-29", total_estimado: 1000, moneda: "EUR" },
    { id: "lima", destino: "Lima", fecha_salida: "2027-01-10", fecha_regreso: "2027-01-15", total_estimado: null, moneda: null },
  ];
  const items = [
    { amount: 90, currency: "EUR", category: "Gastronomía", expense_date: "2026-10-20", trip_id: "roma" }, // 2,000 MXN
    { amount: 2000, currency: "MXN", category: "Hospedaje", expense_date: "2026-10-21", trip_id: "roma" },
    { amount: 500, currency: "MXN", category: "Compras", expense_date: "2026-10-05", trip_id: null },
    { amount: 10, currency: "GTQ", category: "Otros", expense_date: "2026-10-05", trip_id: "lima" }, // sin tasa
  ];

  it("totales por viaje, categoría principal y gasto por día contra presupuesto", () => {
    const r = spendInsights(items, trips, FX, { activeTripId: "roma", now: NOW });
    expect(r.total).toBeCloseTo(4500, 6);
    expect(r.unconvertedCount).toBe(1);
    expect(r.perTrip.map((t) => [t.label, Math.round(t.total)])).toEqual([["Roma", 4000], ["Lima", 0], ["Sin viaje", 500]]);
    // "Gastronomía" (viejo) cuenta como Restaurantes.
    expect(r.topCategory).toMatchObject({ name: "Restaurantes" });
    expect(r.topCategory!.pct).toBeCloseTo((2000 / 4500) * 100, 6);
    const a = r.active!;
    expect(a.diasViaje).toBe(10);
    expect(a.diasTranscurridos).toBe(3); // 20, 21 y 22 de octubre
    expect(a.promedioDiario).toBeCloseTo(4000 / 3, 6);
    expect(a.presupuesto).toBeCloseTo(1000 / 0.9 * 20, 6);
    expect(a.presupuestoDiario).toBeCloseTo((1000 / 0.9 * 20) / 10, 6);
    expect(a.usoPresupuesto).toBeCloseTo(4000 / (1000 / 0.9 * 20), 6);
  });

  it("viaje que aún no sale: sin promedio diario (no divide entre cero)", () => {
    const r = spendInsights(items, trips, FX, { activeTripId: "lima", now: NOW });
    expect(r.active).toMatchObject({ diasTranscurridos: 0, promedioDiario: null, presupuesto: null });
  });
});

// ── Ahorro: lógica ──────────────────────────────────────────────────────────────────────────
describe("Ahorro para tu viaje: cuentas", () => {
  it("cuánto apartar al mes y a la semana", () => {
    const g = computeGoal({ costMxn: 120000, savedMxn: 20000, dateISO: "2027-04-22", now: NOW });
    expect(g.estado).toBe("ok");
    expect(g.meses).toBe(6);
    expect(g.faltante).toBe(100000);
    expect(g.mensual).toBeCloseTo(100000 / 6, 6);
    expect(g.semanal).toBeCloseTo(100000 / 26, 6); // 182 días = 26 semanas
    expect(g.avance).toBeCloseTo(1 / 6, 6);
    expect(g.calendario).toHaveLength(6);
    expect(g.calendario[5].acumulado).toBeCloseTo(120000, 6);
  });

  it("casos borde: sin costo, cubierto, fecha pasada, sale este mes", () => {
    expect(computeGoal({ costMxn: 0, savedMxn: 0, dateISO: "2027-01-01", now: NOW }).estado).toBe("sin_costo");
    expect(computeGoal({ costMxn: 50000, savedMxn: 60000, dateISO: "2027-01-01", now: NOW }).estado).toBe("cubierto");
    expect(computeGoal({ costMxn: 50000, savedMxn: 0, dateISO: "2026-10-01", now: NOW }).estado).toBe("fecha_pasada");
    expect(computeGoal({ costMxn: 50000, savedMxn: 0, dateISO: "", now: NOW }).estado).toBe("sin_fecha");
    const pronto = computeGoal({ costMxn: 50000, savedMxn: 10000, dateISO: "2026-10-30", now: NOW });
    expect(pronto).toMatchObject({ estado: "ok", meses: 0, mesesAhorro: 1, mensual: 40000 });
    expect(monthsUntil(new Date(2027, 3, 21), NOW)).toBe(5);
  });

  it("estimación de referencia por región (etiquetada; nunca sin región)", () => {
    expect(regionOf("París")).toBe("europa");
    expect(regionOf("Ciudad de México")).toBe("mexico");
    expect(regionOf("Tokio, Japón")).toBe("asia");
    expect(regionOf("Atlantis")).toBeNull();
    expect(estimateTripCost({ destino: "París", dias: 7, personas: 2 })).toMatchObject({ total: 156000, region: "europa" });
    expect(estimateTripCost({ destino: "Atlantis", dias: 7, personas: 2 })).toBeNull();
    expect(estimateTripCost({ destino: "Atlantis", region: "caribe", dias: 4, personas: 1 })!.total).toBe(31000);
  });
});

describe("Ahorro para tu viaje: pantalla", () => {
  it("funciona SIN viaje planeado: destino, fecha, estimación y ahorro → monto mensual", async () => {
    render(<MemoryRouter><TripSavingsCalculator /></MemoryRouter>);
    expect(screen.queryByText(/Planea un viaje próximo/)).toBeNull();
    expect(screen.getByText("¿Cuánto cuesta el viaje?")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("¿A dónde quieres ir?"), { target: { value: "París" } });
    fireEvent.change(screen.getByLabelText("¿Cuándo sales?"), { target: { value: "2099-01-01" } });
    fireEvent.click(screen.getByRole("button", { name: /Usa una estimación \(\$156,000\)/ }));
    expect((screen.getByLabelText("¿Cuánto cuesta el viaje? (MXN)") as HTMLInputElement).value).toBe("156000");
    expect(screen.getByRole("note").textContent).toMatch(/Estimación de referencia.*no es una cotización/);
    fireEvent.change(screen.getByLabelText("¿Cuánto llevas ahorrado para este viaje?"), { target: { value: "6000" } });
    expect(screen.getByText("Aparta cada mes")).toBeInTheDocument();
    expect(screen.getByTestId("ahorro-mensual").textContent).toMatch(/\$/);
    expect(screen.getByRole("img", { name: "Llevas el 4% de la meta" })).toBeInTheDocument();
    // Escribir el costo a mano quita la etiqueta de estimación.
    fireEvent.change(screen.getByLabelText("¿Cuánto cuesta el viaje? (MXN)"), { target: { value: "100000" } });
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("destino que no reconoce: pide la región antes de estimar", () => {
    render(<MemoryRouter><TripSavingsCalculator /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText("¿A dónde quieres ir?"), { target: { value: "Atlantis" } });
    expect(screen.getByRole("button", { name: /Usa una estimación/ })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Región del destino"), { target: { value: "europa" } });
    expect(screen.getByRole("button", { name: /Usa una estimación/ })).toBeEnabled();
  });

  it("se puede ligar a un viaje existente (llena destino, fecha y costo convertido)", async () => {
    db.tables.trips = [{ id: "tk", destino: "Tokio", pais_destino: "Japón", fecha_salida: "2099-03-01", fecha_regreso: "2099-03-10", total_estimado: 3000, moneda: "USD" }];
    render(<MemoryRouter><TripSavingsCalculator /></MemoryRouter>);
    fireEvent.click(await screen.findByRole("button", { name: /Tokio/ }));
    expect((screen.getByLabelText("¿A dónde quieres ir?") as HTMLInputElement).value).toBe("Tokio");
    expect((screen.getByLabelText("¿Cuándo sales?") as HTMLInputElement).value).toBe("2099-03-01");
    expect((screen.getByLabelText("¿Cuánto cuesta el viaje? (MXN)") as HTMLInputElement).value).toBe("60000");
    expect((screen.getByLabelText("Días") as HTMLInputElement).value).toBe("10");
    expect(screen.getByText(/Costo estimado de tu viaje a Tokio/)).toBeInTheDocument();
  });
});

// ── Members Only ────────────────────────────────────────────────────────────────────────────
const venue = (over: Record<string, unknown>) => ({
  id: "x", ciudad: "ciudad de mexico", ciudad_display: "Ciudad de México", categoria: "speakeasy", emoji: null, nombre: "X",
  por_que: null, descripcion: null, dress_code: null, precio_estimado: null, reserva_requerida: false, tags: [], address: null,
  website: null, fuente: "curaduria", effective_state: null, effective_label: null, source_url: null, verified_at: null,
  neighborhood: null, season_state: null, age_policy: null, ...over,
});
const VENUES = [
  venue({ id: "a", nombre: "Licorería Limantour", categoria: "cocktail_bar", neighborhood: "Roma-Condesa" }),
  venue({ id: "b", nombre: "Parker & Lenox", categoria: "jazz_lounge" }),
  venue({ id: "c", nombre: "Hanky Panky", categoria: "speakeasy", tags: ["Cóctel de autor"] }),
];

describe("Members Only: buscar y elegir sin bajar", () => {
  // Las tarjetas de ciudad piden su video: aquí la red responde error (sin video, fondo sobrio).
  beforeEach(() => { __resetVideoSearch(); vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 }))); });
  afterEach(() => vi.unstubAllGlobals());
  it("búsqueda sin acentos: lugares, tipos, barrios y ciudades (también en inglés)", () => {
    expect(venueMatches(VENUES[0] as never, "licoreria")).toBe(true);
    expect(venueMatches(VENUES[0] as never, "CONDESA")).toBe(true);
    expect(venueMatches(VENUES[1] as never, "jazz")).toBe(true);
    expect(venueMatches(VENUES[2] as never, "coctel")).toBe(true);
    expect(venueMatches(VENUES[1] as never, "rooftop")).toBe(false);
    const cities = ["Ciudad de México", "París", "Mónaco", "Tokio", "Milán"];
    expect(matchCities(cities, "paris")).toEqual(["París"]);
    expect(matchCities(cities, "monaco")).toEqual(["Mónaco"]);
    expect(matchCities(cities, "tokyo")).toEqual(["Tokio"]);
    expect(matchCities(cities, "mexico city")).toEqual(["Ciudad de México"]);
    expect(resolveCityName("Paris, Francia", cities)).toBe("París");
    expect(resolveCityName("CDMX", cities)).toBe("Ciudad de México");
    expect(resolveCityName("Atlantis", cities)).toBeNull();
    expect(orderCities(cities, ["Tu ubicación", "Milan", "Tokio, Japón"])).toEqual(["Milán", "Tokio", "Ciudad de México", "París", "Mónaco"]);
  });

  it("el panel abre en la ciudad del viaje, filtra al escribir y encuentra ciudades sin acento", async () => {
    db.rpc.members_access_state = { access: true, via: "plan", password_gate: false };
    db.rpc.members_cities = [
      { ciudad: "paris", ciudad_display: "París", pais: "Francia", venues: 12 },
      { ciudad: "ciudad de mexico", ciudad_display: "Ciudad de México", pais: "México", venues: 3 },
      { ciudad: "mc", ciudad_display: "Mónaco", pais: "Mónaco", venues: 2 },
    ];
    db.rpc.members_venues = () => ({ data: VENUES, error: null });
    render(<MemoryRouter><MembersOnlyPanel preferredCities={[null, "CDMX"]} /></MemoryRouter>);
    expect(await screen.findByText("Licorería Limantour")).toBeInTheDocument();
    await waitFor(() => expect(db.rpcCalls.filter((c) => c.fn === "members_venues").map((c) => c.args)).toContainEqual({ p_ciudad: "Ciudad de México" }));
    // La ciudad del viaje va primero en el carrusel y está marcada.
    const carousel = screen.getByRole("region", { name: "Ciudades destacadas" });
    const cards = within(carousel).getAllByRole("button");
    expect(cards[0]).toHaveAccessibleName("Ciudad de México, 3 lugares");
    expect(cards[0]).toHaveAttribute("aria-pressed", "true");
    // Sin filtro: una fila por categoría.
    expect(screen.getByRole("region", { name: "Jazz Lounge" })).toBeInTheDocument();
    // Escribir filtra al instante (sin acentos).
    const input = screen.getByLabelText("Buscar ciudad o lugar");
    fireEvent.change(input, { target: { value: "jazz" } });
    expect(screen.getByText("Parker & Lenox")).toBeInTheDocument();
    expect(screen.queryByText("Hanky Panky")).toBeNull();
    fireEvent.change(input, { target: { value: "monaco" } });
    expect(within(carousel).getByRole("button", { name: /Mónaco/ })).toBeInTheDocument();
    expect(screen.getByText(/Nada con “monaco” en Ciudad de México/)).toBeInTheDocument();
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(db.rpcCalls.map((c) => c.args)).toContainEqual({ p_ciudad: "Mónaco" }));
  });

  it("en escritorio: una rejilla con la categoría en cada tarjeta y flechas para el carrusel", async () => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("min-width"), media: q, addEventListener() {}, removeEventListener() {} }));
    db.rpc.members_access_state = { access: true, via: "plan", password_gate: false };
    db.rpc.members_cities = null; // falla → lista fija (18 ciudades)
    db.rpc.members_venues = () => ({ data: VENUES, error: null });
    render(<MemoryRouter><MembersOnlyPanel /></MemoryRouter>);
    const card = (await screen.findByText("Parker & Lenox")).closest("article")!;
    expect(within(card).getByText("Jazz Lounge")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Jazz Lounge" })).toBeNull();
    expect(screen.getByRole("button", { name: "Más ciudades" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ciudades anteriores" })).toBeInTheDocument();
  });

  it("sin PRO: el adelanto compacto no pide ni muestra lugares", async () => {
    db.rpc.members_access_state = { access: false, via: null, password_gate: false };
    db.rpc.members_teaser = Array.from({ length: 20 }, (_, i) => ({ ciudad: `c${i}`, ciudad_display: `Ciudad ${i}`, pais: null, categoria: "rooftop", venues: 20 - i }));
    db.rpc.members_venues = () => ({ data: VENUES, error: null });
    render(<MemoryRouter><MembersOnlyPanel /></MemoryRouter>);
    expect(await screen.findByText(/lugares en 20 ciudades/)).toBeInTheDocument();
    // 12 ciudades a la vista; el resto con un toque.
    expect(within(screen.getByRole("list", { name: "Ciudades" })).getAllByRole("listitem")).toHaveLength(12);
    fireEvent.click(screen.getByRole("button", { name: "Ver las 20" }));
    expect(within(screen.getByRole("list", { name: "Ciudades" })).getAllByRole("listitem")).toHaveLength(20);
    expect(db.rpcCalls.map((c) => c.fn)).not.toContain("members_venues");
    for (const v of VENUES) expect(screen.queryByText(v.nombre)).toBeNull();
  });
});

describe("Ciudades destacadas: un video distinto (y de día) por ciudad", () => {
  const fetchMock = vi.fn();
  const flush = () => act(async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); });
  beforeEach(() => {
    __resetVideoSearch();
    __resetVideoClaims();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("consultas en inglés con su lugar emblemático, nunca de noche", () => {
    expect(cityVideoQueries("París")[0]).toMatch(/Eiffel/);
    expect(cityVideoQueries("Mykonos")[0]).toMatch(/windmills/);
    expect(cityVideoQueries("Londres")[0]).toMatch(/London/);
    expect(cityVideoQueries("Milán")[0]).toMatch(/Milan Duomo/);
    expect(cityVideoQueries("Tokio")[0]).toMatch(/Tokyo/);
    expect(cityVideoQueries("Atlantis")[0]).toBe("Atlantis landmark day");
    for (const c of ["París", "Londres", "Milán", "Roma", "Mykonos", "Atlantis"]) {
      for (const q of cityVideoQueries(c)) expect(q).not.toMatch(/night|noche/i);
    }
    expect(videoKey("https://videos.pexels.com/video-files/11363927/11363927-hd_1280_720_25fps.mp4")).toBe("pexels:11363927");
    expect(videoKey(null, "https://images.pexels.com/videos/11363927/pexels-photo-11363927.jpeg")).toBe("pexels:11363927");
  });

  it("si dos ciudades reciben el mismo clip, la segunda usa su respaldo o su foto fija: nunca se repite", async () => {
    const SAME = { url: "https://videos.pexels.com/video-files/11363927/a-hd.mp4", poster: "https://images.pexels.com/videos/11363927/p.jpeg" };
    fetchMock.mockImplementation(async (u: string) => {
      const q = new URL(u).searchParams.get("q") ?? "";
      // Todo lo de París, Mykonos y Santorini regresa el mismo clip genérico, salvo el respaldo de Mykonos.
      const body = /Little Venice/.test(q) ? { url: "https://videos.pexels.com/video-files/222/b-hd.mp4", poster: null } : SAME;
      return new Response(JSON.stringify(body), { status: 200 });
    });
    const { container } = render(<>
      {["París", "Mykonos", "Santorini"].map((c) => <CityVideoCard key={c} city={c} active={false} onClick={() => {}} />)}
    </>);
    await flush();
    await flush();
    const srcs = [...container.querySelectorAll("video")].map((v) => v.getAttribute("src"));
    expect(srcs).toHaveLength(2);
    expect(new Set(srcs).size).toBe(2);
    // Santorini no tiene clip propio: fondo sobrio con su nombre, sin video ni foto repetidos.
    const santorini = screen.getByRole("button", { name: "Santorini" });
    expect(santorini.querySelector("video, img")).toBeNull();
  });
});
