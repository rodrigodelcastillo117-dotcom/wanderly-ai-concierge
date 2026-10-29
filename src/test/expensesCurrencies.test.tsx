// Gastos: más divisas y más categorías. Las tasas salen siempre de lib/fx (nunca 1:1, nunca
// inventadas); una moneda sin tasa se muestra en su moneda con "sin tipo de cambio disponible".
import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { convert, convertedTotal, summarizeSpend, FX_FALLBACK_TABLE, type FxTable } from "@/lib/fx";
import { CURRENCIES, destinationCurrency, matchesCurrency, orderedCurrencies, currencyLabel } from "@/lib/currencies";
import {
  EXPENSE_CATEGORIES, canonicalCategory, categoryBreakdown, donutSlices, CATEGORY_COLORS, OTHER_GROUP_LABEL, isKnownCategory,
} from "@/lib/expenseCategories";

const REQUIRED = ["MXN", "USD", "EUR", "GBP", "CAD", "JPY", "CHF", "AUD", "BRL", "ARS", "COP", "CLP", "PEN", "CNY", "KRW", "SGD",
  "HKD", "THB", "AED", "SAR", "QAR", "MAD", "ZAR", "NZD", "TRY", "DKK", "SEK", "NOK", "CZK", "PLN", "HUF", "INR", "IDR", "MYR",
  "PHP", "VND", "ILS", "EGP", "DOP", "CRC", "GTQ", "UYU", "BOB", "PYG"];

// Tabla "en vivo" de prueba con la forma de open.er-api.com (unidades por 1 USD).
const LIVE: FxTable = {
  rates: { USD: 1, MXN: 18, EUR: 0.9, JPY: 150, KRW: 1350, CLP: 900, PYG: 7300, VND: 25000, THB: 36, COP: 4000, AED: 3.6725 },
  source: "open.er-api.com", asOf: "2026-10-22T00:00:00Z", isFallback: false, kind: "live",
};

describe("catálogo de monedas", () => {
  it("incluye todas las monedas que piden los viajeros, sin duplicados y con nombre en español", () => {
    const codes = CURRENCIES.map((c) => c.code);
    for (const c of REQUIRED) expect(codes, c).toContain(c);
    expect(new Set(codes).size).toBe(codes.length);
    for (const c of CURRENCIES) expect(c.code).toMatch(/^[A-Z]{3}$/);
    expect(currencyLabel("JPY")).toBe("JPY · Yen japonés");
    expect(currencyLabel("XYZ")).toBe("XYZ");
  });

  it("orden: sugerida del destino → las que ya usaste → populares → resto A-Z", () => {
    const o = orderedCurrencies({ suggested: "JPY", used: ["EUR", "EUR", "THB", "MXN"] });
    expect(o.suggested?.code).toBe("JPY");
    expect(o.frequent.map((c) => c.code).slice(0, 4)).toEqual(["EUR", "THB", "MXN", "USD"]);
    expect(o.frequent.map((c) => c.code)).not.toContain("JPY");
    const all = [o.suggested!, ...o.frequent, ...o.rest].map((c) => c.code);
    expect(new Set(all).size).toBe(CURRENCIES.length);
    const restNames = o.rest.map((c) => c.name);
    expect(restNames).toEqual([...restNames].sort((a, b) => a.localeCompare(b, "es")));
  });

  it("moneda del destino del viaje (país o ciudad, con o sin acentos); desconocido = sin sugerencia", () => {
    expect(destinationCurrency({ destino: "Tokio", pais_destino: "Japón" })).toBe("JPY");
    expect(destinationCurrency({ destino: "Barcelona" })).toBe("EUR");
    expect(destinationCurrency({ destino: "Cusco, Perú" })).toBe("PEN");
    expect(destinationCurrency({ destino: "Dubái" })).toBe("AED");
    expect(destinationCurrency({ destino: "La Paz, Baja California Sur" })).toBe("MXN");
    expect(destinationCurrency({ destino: "Marrakech" })).toBe("MAD");
    expect(destinationCurrency({ destino: "Atlántida" })).toBeNull();
    expect(destinationCurrency(null)).toBeNull();
  });

  it("búsqueda por código, nombre o país", () => {
    const find = (q: string) => CURRENCIES.filter((c) => matchesCurrency(c, q)).map((c) => c.code);
    expect(find("yen")).toEqual(["JPY"]);
    expect(find("jpy")).toEqual(["JPY"]);
    expect(find("japon")).toEqual(["JPY"]);
    expect(find("corona")).toEqual(expect.arrayContaining(["DKK", "SEK", "NOK", "CZK"]));
    expect(find("")).toHaveLength(CURRENCIES.length);
  });
});

describe("tipo de cambio con muchas monedas", () => {
  it("convierte entre monedas vía USD con la tasa publicada", () => {
    expect(convert(1500, "JPY", "MXN", LIVE)).toBeCloseTo(180, 6);
    expect(convert(100, "EUR", "JPY", LIVE)).toBeCloseTo((100 / 0.9) * 150, 6);
    expect(convert(73000, "PYG", "MXN", LIVE)).toBeCloseTo(180, 6);
    expect(convert(250000, "VND", "USD", LIVE)).toBeCloseTo(10, 6);
    expect(convert(36.725, "AED", "USD", LIVE)).toBeCloseTo(10, 6);
  });

  it("sin tasa: null (nunca 1:1) y el total lo deja aparte", () => {
    expect(convert(100, "GTQ", "MXN", LIVE)).toBeNull();
    // La tabla de respaldo solo tiene USD/MXN/EUR/GBP: el resto queda sin convertir.
    expect(convert(1000, "JPY", "MXN", FX_FALLBACK_TABLE)).toBeNull();
    const t = convertedTotal([{ amount: 1500, currency: "JPY" }, { amount: 50, currency: "GTQ" }, { amount: 100, currency: "MXN" }], "MXN", LIVE);
    expect(t.total).toBeCloseTo(280, 6);
    expect(t.unconverted).toEqual({ GTQ: 50 });
  });

  it("Smart Spend: las filas viejas se suman a su categoría nueva y lo que no tiene tasa se cuenta aparte", () => {
    const s = summarizeSpend([
      { amount: 1000, currency: "MXN", category: "Alojamiento", expense_date: "2026-10-02" },
      { amount: 450, currency: "THB", category: "Hospedaje", expense_date: "2026-10-03" },
      { amount: 99, currency: "GTQ", category: "Compras", expense_date: "2026-10-03" },
    ], "MXN", LIVE, new Date(2026, 9, 15));
    expect(s.unconvertedCurrencies).toEqual(["GTQ"]);
    const slices = donutSlices(s.byCat);
    expect(slices).toEqual([{ name: "Hospedaje", value: 1000 + (450 / 36) * 18, color: CATEGORY_COLORS.Hospedaje }]);
  });
});

describe("categorías", () => {
  it("las categorías nuevas de viaje están en el formulario", () => {
    const values = EXPENSE_CATEGORIES.map((c) => c.value);
    for (const c of ["Vuelos", "Hospedaje", "Restaurantes", "Bares y vida nocturna", "Tours y experiencias", "Transporte local", "Compras",
      "Salud y farmacia", "Seguros", "Visas y trámites", "Conectividad / eSIM", "Propinas", "Comisiones bancarias", "Regalos", "Otros"]) {
      expect(values, c).toContain(c);
    }
  });

  it("los valores viejos se leen como su categoría nueva; un texto desconocido se respeta", () => {
    expect(canonicalCategory("Alojamiento")).toBe("Hospedaje");
    expect(canonicalCategory("Gastronomía")).toBe("Restaurantes");
    expect(canonicalCategory("gastronomia")).toBe("Restaurantes");
    expect(canonicalCategory("Experiencias")).toBe("Tours y experiencias");
    expect(canonicalCategory("Transporte")).toBe("Transporte local");
    expect(canonicalCategory("Otros")).toBe("Otros");
    expect(canonicalCategory("Vuelos")).toBe("Vuelos");
    expect(canonicalCategory("")).toBe("Otros");
    expect(canonicalCategory("Lavandería")).toBe("Lavandería");
    expect(isKnownCategory("Lavandería")).toBe(false);
    expect(isKnownCategory("Alojamiento")).toBe(true);
  });

  it("dona: colores fijos por categoría, en orden de paleta; el resto se agrupa en gris al final", () => {
    const slices = donutSlices({ "Propinas": 10, "Vuelos": 300, "Alojamiento": 500, "Lavandería": 5, "Restaurantes": 100 });
    expect(slices.map((s) => s.name)).toEqual(["Hospedaje", "Vuelos", "Restaurantes", OTHER_GROUP_LABEL]);
    expect(slices[3].value).toBe(15);
    // El color sigue a la categoría aunque cambie su lugar en el ranking.
    expect(donutSlices({ Vuelos: 1 })[0].color).toBe(CATEGORY_COLORS.Vuelos);
    const b = categoryBreakdown({ "Propinas": 10, "Vuelos": 300, "Alojamiento": 500 });
    expect(b.map((x) => x.name)).toEqual(["Hospedaje", "Vuelos", "Propinas"]);
    expect(b.reduce((a, x) => a + x.pct, 0)).toBeCloseTo(100, 6);
  });
});

// ── Formulario de Gastos ────────────────────────────────────────────────────────────────────────
const db = vi.hoisted(() => ({ inserts: [] as { table: string; row: any }[], tables: {} as Record<string, any[]> }));
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
      auth: { getSession: async () => ({ data: { session: { user: { id: "u1" } } } }) },
      functions: { invoke: vi.fn(async () => ({ data: {}, error: null })) },
      storage: { from: () => ({ upload: async () => ({ error: null }) }) },
    },
  };
});
const authUser = vi.hoisted(() => ({ id: "u1", email: "u1@example.test", user_metadata: {} }));
const fxState = vi.hoisted(() => ({ table: null as any }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: authUser, loading: false }) }));
vi.mock("@/components/DashboardLayout", () => ({ DashboardLayout: ({ children }: any) => <>{children}</> }));
vi.mock("@/components/SmartSpendPanel", () => ({ default: () => null }));
vi.mock("@/components/TripSavingsCalculator", () => ({ TripSavingsCalculator: () => null }));
vi.mock("@/hooks/useFxTable", () => ({ useFxTable: () => fxState.table }));
vi.mock("@/lib/insights", () => ({ logInsight: vi.fn(async () => {}) }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));

import Gastos from "@/pages/Gastos";

const TOKIO = "44444444-4444-4444-8444-444444444444";

describe("formulario de Gastos", () => {
  beforeEach(() => {
    db.inserts.length = 0;
    db.tables = {
      trips: [{ id: TOKIO, user_id: "u1", destino: "Tokio", pais_destino: "Japón", fecha_salida: "2099-11-01", fecha_regreso: "2099-11-08", created_at: "2026-01-01" }],
      profiles: [{ id: "u1", active_trip_id: TOKIO }],
      expenses: [{ id: "e1", amount: 900, currency: "MXN", category: "Alojamiento", description: "Hotel viejo", expense_date: "2026-10-01", receipt_url: null }],
      trip_collaborators: [],
    };
    fxState.table = LIVE;
    localStorage.clear();
  });

  it("sugiere la moneda del destino, busca monedas y guarda categoría y moneda nuevas", async () => {
    render(<MemoryRouter><Gastos /></MemoryRouter>);
    // Una fila vieja se muestra con su categoría nueva.
    expect(await screen.findByText("Hospedaje")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Nuevo gasto/ }));
    const moneda = screen.getByLabelText("Moneda") as HTMLSelectElement;
    // El viaje activo es Tokio: JPY sale como sugerida (primer grupo) y hay atajo para usarla.
    await waitFor(() => expect(moneda.querySelector("optgroup")?.getAttribute("label")).toBe("Sugerida para tu viaje"));
    expect(moneda.querySelector("optgroup option")?.getAttribute("value")).toBe("JPY");
    fireEvent.click(await screen.findByRole("button", { name: /Usar JPY \(Yen japonés\), la moneda de Tokio/ }));
    expect(moneda.value).toBe("JPY");

    // Buscar "won" deja una sola moneda y la elige.
    fireEvent.change(screen.getByLabelText("Buscar moneda"), { target: { value: "won" } });
    expect(moneda.value).toBe("KRW");
    expect(Array.from(moneda.options).map((o) => o.value)).toEqual(["KRW"]);
    expect(screen.queryByText("No encontramos esa moneda.")).toBeNull();
    fireEvent.change(screen.getByLabelText("Buscar moneda"), { target: { value: "zzz" } });
    expect(screen.getByText("No encontramos esa moneda.")).toBeTruthy();
    // Vuelve a JPY con el selector (como lo haría la persona).
    fireEvent.change(screen.getByLabelText("Buscar moneda"), { target: { value: "" } });
    fireEvent.change(moneda, { target: { value: "JPY" } });

    fireEvent.change(screen.getByLabelText("Categoría"), { target: { value: "Conectividad / eSIM" } });
    fireEvent.change(screen.getByPlaceholderText("0"), { target: { value: "1500" } });
    // Vista previa con la tasa y su fuente.
    expect((await screen.findByRole("status")).textContent).toMatch(/≈ \$180 MXN · Tipo de cambio de ExchangeRate-API/); // R3 P2-17: nombre amigable de la fuente

    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(db.inserts.find((i) => i.table === "expenses")).toBeTruthy());
    expect(db.inserts.find((i) => i.table === "expenses")!.row).toMatchObject({ amount: 1500, currency: "JPY", category: "Conectividad / eSIM", trip_id: TOKIO });
  });

  it("sin tipo de cambio para la moneda: lo dice y no inventa una conversión", async () => {
    fxState.table = FX_FALLBACK_TABLE; // respaldo: no tiene JPY
    render(<MemoryRouter><Gastos /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: /Nuevo gasto/ }));
    fireEvent.change(screen.getByLabelText("Moneda"), { target: { value: "JPY" } });
    fireEvent.change(screen.getByPlaceholderText("0"), { target: { value: "1500" } });
    const status = await screen.findByRole("status");
    expect(status.textContent).toMatch(/Sin tipo de cambio disponible para JPY/);
    expect(status.textContent).not.toMatch(/≈/);
  });
});
