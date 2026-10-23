// Gastos del viaje estilo Splitwise (oct 2026): división igual/exacta/porcentaje al centavo, mínimo de
// transferencias, escaneo de tickets con la IA simulada (incluido uno ilegible), las dos pestañas,
// la migración de nombres escritos a mano y Gastos del dashboard sumando mi parte.
import React from "react";
import { readFileSync } from "node:fs";
import { render, screen, fireEvent, waitFor, within, act } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { vi, it, expect, beforeEach, afterEach, describe } from "vitest";
import { buildShares, computeBalances, myLines, simplifyDebts, splitEqualCents } from "@/lib/split";
import { tripSpendSummary, tripBudget } from "@/lib/tripSpend";
import { parseReceipt, readNumber, receiptBody, receiptPathOk } from "../../supabase/functions/scan-receipt/receipt";
import { splitErrorMessage } from "@/lib/tripExpensesApi";
import { FX_FALLBACK_TABLE } from "@/lib/fx";

const TRIP = "11111111-1111-4111-8111-111111111111";
const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ANA = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const db = vi.hoisted(() => ({
  tables: {} as Record<string, any[]>,
  inserts: [] as { table: string; row: any }[],
  rpc: [] as { fn: string; args: any }[],
  rpcData: {} as Record<string, any>,
  uploads: [] as { bucket: string; path: string }[],
  removed: [] as { bucket: string; paths: string[] }[],
  invoke: null as null | ((name: string, opts: any) => any),
}));
vi.mock("@/integrations/supabase/client", () => {
  const from = (table: string) => {
    const f: Record<string, unknown> = {};
    let ins: any = null;
    const rows = () => (db.tables[table] ?? []).filter((r) => Object.entries(f).every(([k, v]) => r[k] === v));
    const api: any = {
      select: () => api, order: () => api, limit: () => api, in: () => api, is: () => api, gte: () => api, update: () => api,
      eq: (k: string, v: unknown) => { f[k] = v; return api; },
      delete: () => api,
      insert: (row: any) => { ins = row; db.inserts.push({ table, row }); return api; },
      single: async () => ({ data: ins ? { id: `new-${db.inserts.length}`, ...ins } : rows()[0] ?? null, error: null }),
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      then: (res: any, rej: any) => Promise.resolve({ data: ins ? null : rows(), error: null }).then(res, rej),
    };
    return api;
  };
  return {
    supabase: {
      from,
      rpc: async (fn: string, args: any) => {
        db.rpc.push({ fn, args });
        return fn in db.rpcData ? { data: db.rpcData[fn], error: null } : { data: null, error: { message: "sin datos" } };
      },
      storage: {
        from: (bucket: string) => ({
          upload: async (path: string) => { db.uploads.push({ bucket, path }); return { error: null }; },
          remove: async (paths: string[]) => { db.removed.push({ bucket, paths }); return { error: null }; },
          createSignedUrl: async () => ({ data: { signedUrl: "https://x.test/t.jpg" } }),
        }),
      },
      functions: { invoke: vi.fn(async (name: string, opts: any) => (db.invoke ? db.invoke(name, opts) : { data: null, error: null })) },
      auth: { getSession: async () => ({ data: { session: null } }) },
    },
  };
});
// Como en la app, el usuario es el mismo objeto entre renders (Gastos recarga cuando cambia).
const auth = vi.hoisted(() => ({ user: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }, loading: false }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth }));
vi.mock("@/components/DashboardLayout", () => ({ DashboardLayout: ({ children }: any) => <div>{children}</div> }));
vi.mock("@/components/Tooltip", () => ({ FeatureTooltip: () => null }));
vi.mock("@/hooks/useTooltipShown", () => ({ useTooltipShown: () => ({ shouldShow: false, dismiss: () => {} }) }));
vi.mock("@/hooks/useFxTable", async () => {
  const fx: any = await vi.importActual("@/lib/fx");
  return { useFxTable: () => fx.FX_FALLBACK_TABLE };
});
vi.mock("@/lib/insights", () => ({ logInsight: vi.fn(async () => {}) }));
const toastSpy = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastSpy }));

import TripSplit from "@/pages/TripSplit";
import Gastos from "@/pages/Gastos";

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
}

const people = [
  { id: "me", trip_id: TRIP, name: "Rodrigo", member_id: ME, linked_by_name: true, created_at: "2026-10-01T10:00:00Z" },
  { id: "ana", trip_id: TRIP, name: "Ana López", member_id: ANA, linked_by_name: false, created_at: "2026-10-01T10:01:00Z" },
  { id: "memo", trip_id: TRIP, name: "Memo", member_id: null, linked_by_name: false, created_at: "2026-10-01T10:02:00Z" },
];
const seed = () => {
  db.tables = {
    trips: [{ id: TRIP, user_id: ME, destino: "Roma → Florencia → Venecia", pais_destino: "Italia", fecha_salida: "2026-11-01", fecha_regreso: "2026-11-05",
      num_viajeros: 2, presupuesto_objetivo: 40000, moneda: "MXN" }],
    trip_split_people: people.map((p) => ({ ...p })),
    trip_split_expenses: [
      { id: "e1", trip_id: TRIP, payer_id: "ana", amount: 90, currency: "EUR", description: "Cena en Trastevere", category: "Restaurantes",
        expense_date: "2026-11-02", city: "Roma", split_mode: "equal", created_by: ANA, created_at: "2026-11-02T20:00:00Z" },
    ],
    trip_split_shares: [
      { id: "s1", expense_id: "e1", trip_id: TRIP, person_id: "me", amount: 45 },
      { id: "s2", expense_id: "e1", trip_id: TRIP, person_id: "ana", amount: 45 },
    ],
    trip_split_payments: [],
    expenses: [
      { id: "x1", user_id: ME, trip_id: TRIP, amount: 500, currency: "MXN", category: "Transporte local", description: "Taxi al aeropuerto", expense_date: "2026-11-01", city: null },
    ],
    profiles: [{ id: ME, active_trip_id: null }],
    trip_collaborators: [],
  };
  db.rpcData = {
    trip_split_sync_members: 0,
    trip_split_members: [
      { user_id: ME, name: "Rodrigo del Castillo", avatar_url: null, is_owner: true },
      { user_id: ANA, name: "Ana López", avatar_url: null, is_owner: false },
    ],
  };
};

const renderTrip = (q = "") =>
  render(
    <MemoryRouter initialEntries={[`/dashboard/viajes/${TRIP}/split${q}`]}>
      <Routes><Route path="/dashboard/viajes/:id/split" element={<TripSplit />} /></Routes>
    </MemoryRouter>,
  );

const confirmSpy = vi.spyOn(window, "confirm");
beforeEach(() => {
  seed();
  db.inserts.length = 0; db.rpc.length = 0; db.uploads.length = 0; db.removed.length = 0; db.invoke = null;
  Object.values(toastSpy).forEach((f) => f.mockClear());
  confirmSpy.mockReturnValue(true);
  localStorage.clear();
});
afterEach(() => confirmSpy.mockReset());

// ───── División al centavo ─────
describe("dividir un gasto (al centavo, la suma es el total)", () => {
  it("partes iguales: $100 entre 3 → 33.34 / 33.33 / 33.33; un centavo entre 3 no inventa partes", () => {
    const r = buildShares(100, "equal", ["a", "b", "c"]);
    expect(r).toEqual({ ok: true, shares: [{ person_id: "a", amount: 33.34 }, { person_id: "b", amount: 33.33 }, { person_id: "c", amount: 33.33 }] });
    expect(buildShares(0.01, "equal", ["a", "b", "c"])).toEqual({ ok: true, shares: [{ person_id: "a", amount: 0.01 }] });
    expect(Object.values(splitEqualCents(1001, ["a", "b", "c"])).reduce((s, x) => s + x, 0)).toBe(1001);
  });
  it("montos exactos: deben sumar el total; dice cuánto falta o sobra; sin negativos", () => {
    expect(buildShares(75.5, "exact", ["a", "b"], { a: "50.25", b: "25.25" })).toEqual({ ok: true, shares: [{ person_id: "a", amount: 50.25 }, { person_id: "b", amount: 25.25 }] });
    expect(buildShares(100, "exact", ["a", "b"], { a: 60, b: 30 })).toMatchObject({ ok: false, remaining: 10 });
    expect(buildShares(100, "exact", ["a", "b"], { a: 60, b: 50 })).toMatchObject({ ok: false, remaining: -10 });
    expect(buildShares(100, "exact", ["a", "b"], { a: 120, b: -20 })).toMatchObject({ ok: false, error: "Los montos no pueden ser negativos" });
    // Quien queda en 0 no lleva parte.
    expect(buildShares(10, "exact", ["a", "b"], { a: 10, b: 0 })).toEqual({ ok: true, shares: [{ person_id: "a", amount: 10 }] });
  });
  it("porcentajes: suman 100 y el redondeo (mayor residuo) deja exactamente el total", () => {
    const r = buildShares(10, "percent", ["a", "b", "c"], { a: 33.333, b: 33.333, c: 33.334 });
    expect(r.ok).toBe(true);
    const shares = (r as any).shares as { amount: number }[];
    expect(shares.map((s) => s.amount)).toEqual([3.33, 3.33, 3.34]);
    expect(Math.round(shares.reduce((s, x) => s + x.amount, 0) * 100)).toBe(1000);
    const r2 = buildShares(0.1, "percent", ["a", "b", "c"], { a: 50, b: 25, c: 25 });
    expect((r2 as any).shares.map((s: any) => s.amount)).toEqual([0.05, 0.03, 0.02]);
    expect(buildShares(100, "percent", ["a", "b"], { a: 50, b: 40 })).toMatchObject({ ok: false, remaining: 10 });
    expect(buildShares(100, "percent", ["a"], { a: 120 })).toMatchObject({ ok: false });
    expect(buildShares(-5, "equal", ["a"])).toMatchObject({ ok: false, error: "El monto debe ser mayor a 0" });
  });
});

// ───── Quién debe a quién ─────
describe("simplificar deudas (mínimo de transferencias)", () => {
  it("encuentra el mínimo aunque el reparto 'el que más debe al que más le deben' necesitaría 4", () => {
    // b y d se saldan entre sí; a, c y e también: 3 transferencias (no 4).
    const t = simplifyDebts({ a: 500, b: 400, c: 100, d: -400, e: -600 });
    expect(t).toHaveLength(3);
    const net: Record<string, number> = { a: 500, b: 400, c: 100, d: -400, e: -600 };
    for (const x of t) { net[x.from] += x.cents; net[x.to] -= x.cents; }
    expect(Object.values(net).every((v) => v === 0)).toBe(true);
    expect(t).toContainEqual({ from: "d", to: "b", cents: 400 });
  });
  it("saldos con partes y pagos: por moneda, y mi línea dice a quién le debo", () => {
    const ppl = [{ id: "me", name: "Yo" }, { id: "ana", name: "Ana" }, { id: "memo", name: "Memo" }];
    const r = computeBalances(ppl, [
      { payer_id: "ana", amount: 90, currency: "EUR", shares: [{ person_id: "me", amount: 45 }, { person_id: "ana", amount: 45 }] },
      { payer_id: "me", amount: 300, currency: "MXN", shares: [{ person_id: "me", amount: 100 }, { person_id: "memo", amount: 200 }] },
    ], [{ from_person: "me", to_person: "ana", amount: 15, currency: "EUR" }]);
    expect(r.balances.EUR).toEqual({ me: -30, ana: 30, memo: 0 });
    expect(r.balances.MXN).toEqual({ me: 200, ana: 0, memo: -200 });
    expect(r.totals).toEqual({ EUR: 90, MXN: 300 });
    expect(myLines(r, "me")).toEqual([
      { kind: "debes", other: "ana", amount: 30, currency: "EUR" },
      { kind: "te_debe", other: "memo", amount: 200, currency: "MXN" },
    ]);
    // Liquidado por completo: a mano.
    const r2 = computeBalances(ppl, [{ payer_id: "ana", amount: 10, currency: "EUR", shares: [{ person_id: "me", amount: 10 }] }],
      [{ from_person: "me", to_person: "ana", amount: 10, currency: "EUR" }]);
    expect(r2.transfers).toEqual([]);
  });
  it("mensajes claros para los rechazos de la base", () => {
    expect(splitErrorMessage({ message: "split_payer_not_you: x" })).toMatch(/que lo registre esa persona/);
    expect(splitErrorMessage({ message: "split_sum_mismatch: x" })).toBe("La división no suma el total del gasto.");
    expect(splitErrorMessage({ message: "new row violates row-level security policy" })).toMatch(/No tienes permiso/);
  });
});

// ───── Lectura del ticket (respuesta de la IA simulada) ─────
describe("scan-receipt: validar lo que lee la IA", () => {
  const TODAY = "2026-11-03";
  it("ticket claro: comercio, fecha, total, moneda, propina, IVA y conceptos → confianza alta", () => {
    const r = parseReceipt(JSON.stringify({
      legible: true, comercio: "Trattoria Da Enzo", fecha: "2026-11-02", total: 86.5, moneda: "EUR", subtotal: 70.9, propina: 8, iva: 7.6,
      conceptos: [{ nombre: "Cacio e pepe", cantidad: 2, importe: 28 }, { nombre: "Vino della casa", cantidad: 1, importe: 42.9 }],
      confianza: 0.93, dudas: [],
    }), TODAY);
    expect(r).toMatchObject({ ok: true, receipt: { merchant: "Trattoria Da Enzo", date: "2026-11-02", total: 86.5, currency: "EUR", tip: 8, tax: 7.6, confidence: "alta", warnings: [] } });
    expect((r as any).receipt.items).toHaveLength(2);
  });
  it("ticket dudoso: sin moneda, fecha imposible y conceptos que no suman → confianza baja y dice qué revisar", () => {
    const r = parseReceipt("```json\n" + JSON.stringify({
      legible: true, comercio: "Bar", fecha: "2026-02-30", total: "1.234,50", moneda: "$",
      conceptos: [{ nombre: "A", importe: 100 }, { nombre: "B", importe: 50 }], confianza: 0.7, dudas: ["el total está borroso"],
    }) + "\n```", TODAY);
    expect(r.ok).toBe(true);
    const rec = (r as any).receipt;
    expect(rec.total).toBe(1234.5);
    expect(rec.currency).toBeNull();
    expect(rec.date).toBeNull();
    expect(rec.confidence).toBe("baja");
    expect(rec.warnings).toEqual(expect.arrayContaining(["No se ve la moneda: revísala.", "La fecha no parece correcta: revísala.",
      "Los conceptos no suman el total: revisa el monto.", "el total está borroso."]));
  });
  it("ticket ilegible, sin total o respuesta rota: no propone ningún gasto", () => {
    expect(parseReceipt(JSON.stringify({ legible: false }), TODAY)).toMatchObject({ ok: false, code: "ilegible" });
    expect(parseReceipt(JSON.stringify({ legible: true, total: null, comercio: "x" }), TODAY)).toMatchObject({ ok: false, code: "sin_total" });
    expect(parseReceipt(JSON.stringify({ legible: true, total: -20 }), TODAY)).toMatchObject({ ok: false, code: "sin_total" });
    expect(parseReceipt("lo siento, no puedo", TODAY)).toMatchObject({ ok: false, code: "respuesta_invalida" });
  });
  it("solo lee la carpeta de la persona en ese viaje; números en formatos locales", () => {
    expect(receiptPathOk(`${TRIP}/${ME}/1-ab.jpg`, TRIP, ME)).toBe(true);
    expect(receiptPathOk(`${TRIP}/${ANA}/1-ab.jpg`, TRIP, ME)).toBe(false);
    expect(receiptPathOk(`${TRIP}/${ME}/../x.jpg`, TRIP, ME)).toBe(false);
    expect(receiptPathOk(`otro/${ME}/x.jpg`, TRIP, ME)).toBe(false);
    expect(readNumber("1,234.56")).toBe(1234.56);
    expect(readNumber("12,5")).toBe(12.5);
    expect(readNumber("€ 30")).toBe(30);
    const body = receiptBody("data:image/jpeg;base64,AAA", { currency: "eur", destination: "Roma, Italia" });
    expect(body.model).toBe("google/gemini-flash-latest");
    expect(JSON.stringify(body)).toMatch(/Moneda local probable: EUR/);
  });
});

// ───── Lo que llevo gastado ─────
describe("pestaña Gastos: mis gastos + mi parte de lo compartido", () => {
  it("total en pesos, por categoría y por día, contra el presupuesto por persona; sin tasa no se suma", () => {
    const fx = FX_FALLBACK_TABLE;
    const s = tripSpendSummary([
      { id: "1", kind: "personal", amount: 500, currency: "MXN", category: "Transporte local", date: "2026-11-01" },
      { id: "2", kind: "compartido", amount: 45, currency: "EUR", category: "Restaurantes", date: "2026-11-02" },
      { id: "3", kind: "personal", amount: 1000, currency: "JPY", category: "Compras", date: "2026-11-02" },
    ], fx, { presupuesto_objetivo: 40000, num_viajeros: 2 });
    expect(Math.round(s.sharedMxn)).toBe(990); // €45 × 22
    expect(Math.round(s.totalMxn)).toBe(1490);
    expect(s.unconverted).toEqual({ JPY: 1000 });
    expect(s.byCategory.map((c) => c.name)).toEqual(["Restaurantes", "Transporte local"]);
    expect(s.byDay.map((d) => d.date)).toEqual(["2026-11-02", "2026-11-01"]);
    expect(s.budget).toMatchObject({ total: 40000, travelers: 2, perPerson: 20000, source: "presupuesto" });
    expect(tripBudget({ total_estimado: 1000, moneda: "EUR", num_viajeros: 1 }, fx)).toMatchObject({ source: "cotizacion", perPerson: 22000 });
    expect(tripBudget({}, fx)).toBeNull();
  });
});

// ───── Pantalla del viaje: dos pestañas ─────
describe("Gastos del viaje: dos pestañas", () => {
  it("'Gastos' muestra lo que llevo (mi taxi + mi parte de la cena) en pesos con la fuente del tipo de cambio", async () => {
    renderTrip();
    expect(await screen.findByRole("tab", { name: /^Gastos$/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getAllByRole("tab").map((t) => t.textContent?.trim())).toEqual(["Gastos", "Gastos compartidos"]);
    // $500 + €45 × 22 = $1,490 MXN (tabla de respaldo).
    await waitFor(() => expect(screen.getByTestId("trip-spent-total")).toHaveTextContent("$1,490 MXN"));
    expect(screen.getByTestId("trip-spent-split")).toHaveTextContent(/Tus gastos \$500 MXN \+ tu parte de lo compartido \$990 MXN/);
    expect(screen.getByText(/Tipo de cambio de respaldo aproximado/)).toBeInTheDocument();
    expect(screen.getByText("Tu parte de €90 · pagó Ana López")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Presupuesto usado" })).toBeInTheDocument();
    expect(screen.getByText(/por persona \(\$40,000 MXN entre 2\)/)).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Por categoría" })).toHaveTextContent("Restaurantes");
    expect(screen.getByRole("region", { name: "Por día" })).toBeInTheDocument();
  });

  it("'Gastos compartidos': miembros reales primero, mi saldo ('Debes €45 a Ana López') y Liquidar registra el pago", async () => {
    renderTrip("?tab=compartidos");
    const saldo = await screen.findByRole("region", { name: "Tu saldo" });
    expect(saldo).toHaveTextContent("Debes €45 a Ana López");
    const personas = screen.getByRole("region", { name: "Personas del viaje" });
    const names = within(personas).getAllByRole("listitem").map((li) => li.textContent);
    expect(names[0]).toMatch(/Rodrigo del Castillo\(tú\)/);
    expect(names[1]).toMatch(/Ana López.*Miembro del viaje/);
    expect(names[2]).toMatch(/Memo.*Sin la app/);
    fireEvent.click(screen.getByRole("button", { name: /Liquidar: Tú paga €45 a Ana López/ }));
    fireEvent.change(screen.getByLabelText("Monto del pago"), { target: { value: "45" } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar pago" }));
    await waitFor(() => expect(db.inserts.find((i) => i.table === "trip_split_payments")).toBeTruthy());
    expect(db.inserts.find((i) => i.table === "trip_split_payments")!.row).toEqual({ trip_id: TRIP, from_person: "me", to_person: "ana", amount: 45, currency: "EUR" });
  });

  it("los nombres escritos a mano se conservan: 'antes «Rodrigo»', Memo sin app con 'Soy yo' y se puede agregar a alguien sin app", async () => {
    renderTrip("?tab=compartidos");
    const personas = await screen.findByRole("region", { name: "Personas del viaje" });
    expect(personas).toHaveTextContent("antes «Rodrigo»");
    expect(within(personas).getByRole("button", { name: "No soy yo" })).toBeInTheDocument();
    fireEvent.click(within(personas).getByRole("button", { name: "Soy Memo" }));
    await waitFor(() => expect(db.rpc.some((c) => c.fn === "trip_split_claim_guest" && c.args.p_guest === "memo")).toBe(true));
    fireEvent.change(screen.getByLabelText("Nombre de la persona"), { target: { value: "Tía Lupe" } });
    fireEvent.click(screen.getByRole("button", { name: "Agregar persona" }));
    await waitFor(() => expect(db.inserts).toContainEqual({ table: "trip_split_people", row: { trip_id: TRIP, name: "Tía Lupe" } }));
    // Al abrir, cada miembro del viaje queda con su persona.
    expect(db.rpc[0]).toEqual({ fn: "trip_split_sync_members", args: { p_trip: TRIP } });
  });

  it("registrar: por defecto solo mío; al marcar a Ana se vuelve compartido y se divide en partes iguales", async () => {
    renderTrip();
    fireEvent.click(await screen.findByRole("button", { name: /Nuevo gasto/ }));
    const form = screen.getByRole("region", { name: "Nuevo gasto" });
    expect(form).toHaveTextContent("Solo tuyo: no lo ve nadie más.");
    fireEvent.change(within(form).getByLabelText("Monto del gasto"), { target: { value: "120" } });
    fireEvent.click(within(form).getByRole("button", { name: /Ana López/, pressed: false }));
    expect(form).toHaveTextContent("Compartido: lo ven los miembros del viaje.");
    expect(within(form).getByTestId("split-preview")).toHaveTextContent(/Tú .*60.*Ana López .*60/);
    // Montos exactos que no suman: dice cuánto falta y no guarda.
    fireEvent.click(within(form).getByRole("radio", { name: "Montos exactos" }));
    fireEvent.change(within(form).getByLabelText("Monto de Yo"), { target: { value: "100" } });
    expect(form).toHaveTextContent(/Faltan .*20.* por repartir/);
    fireEvent.click(within(form).getByRole("button", { name: "Guardar gasto" }));
    expect(db.rpc.some((c) => c.fn === "trip_split_save_expense")).toBe(false);
    fireEvent.change(within(form).getByLabelText("Monto de Ana López"), { target: { value: "20" } });
    db.rpcData.trip_split_save_expense = "e-nuevo";
    fireEvent.click(within(form).getByRole("button", { name: "Guardar gasto" }));
    await waitFor(() => expect(db.rpc.some((c) => c.fn === "trip_split_save_expense")).toBe(true));
    const call = db.rpc.find((c) => c.fn === "trip_split_save_expense")!;
    expect(call.args.p_expense).toMatchObject({ payer_id: "me", amount: 120, split_mode: "exact" });
    expect(call.args.p_shares).toEqual([{ person_id: "me", amount: 100, percent: null }, { person_id: "ana", amount: 20, percent: null }]);
  });
});

// ───── Escanear ticket (IA simulada) ─────
describe("Escanear ticket", () => {
  const pick = async (file: File) => {
    const input = await screen.findByLabelText("Elegir foto del ticket");
    await act(async () => { fireEvent.change(input, { target: { files: [file] } }); });
  };
  const photo = () => new File(["x"], "ticket.jpg", { type: "image/jpeg" });

  it("la IA llena el formulario; nada se guarda hasta confirmar; la foto va al bucket privado del viaje", async () => {
    db.invoke = (name, opts) => {
      expect(name).toBe("scan-receipt");
      expect(opts.body).toMatchObject({ trip_id: TRIP, currency_hint: "EUR" });
      expect(opts.body.path).toMatch(new RegExp(`^${TRIP}/${ME}/`));
      return { data: { ok: true, receipt: { merchant: "Gelateria La Romana", date: "2026-11-03", total: 18.4, currency: "EUR", subtotal: null, tip: 1.5, tax: 1.67,
        items: [{ name: "Gelato", quantity: 2, amount: 16.9 }], confidenceScore: 0.9, confidence: "alta", warnings: [] } }, error: null };
    };
    renderTrip();
    await screen.findByRole("tab", { name: /^Gastos$/ });
    await pick(photo());
    const form = await screen.findByRole("region", { name: "Nuevo gasto" });
    await waitFor(() => expect(within(form).getByLabelText("Monto del gasto")).toHaveValue(18.4));
    expect(within(form).getByLabelText("Descripción del gasto")).toHaveValue("Gelateria La Romana");
    expect(within(form).getByLabelText("Fecha")).toHaveValue("2026-11-03");
    expect(form).toHaveTextContent("Leímos tu ticket. Revisa y confirma.");
    expect(form).toHaveTextContent(/Propina en el ticket: €1.5/);
    expect(db.uploads).toEqual([{ bucket: "trip-receipts", path: expect.stringMatching(new RegExp(`^${TRIP}/${ME}/\\d+-\\w+\\.jpg$`)) }]);
    expect(db.inserts).toHaveLength(0);
    expect(db.rpc.some((c) => c.fn === "trip_split_save_expense")).toBe(false);
    // Es compartido con Ana: se guarda con la foto y lo leído.
    fireEvent.click(within(form).getByRole("button", { name: /Ana López/, pressed: false }));
    db.rpcData.trip_split_save_expense = "e-ticket";
    fireEvent.click(within(form).getByRole("button", { name: "Guardar gasto" }));
    await waitFor(() => expect(db.rpc.some((c) => c.fn === "trip_split_save_expense")).toBe(true));
    const call = db.rpc.find((c) => c.fn === "trip_split_save_expense")!;
    expect(call.args.p_expense).toMatchObject({ amount: 18.4, currency: "EUR", merchant: "Gelateria La Romana", tip: 1.5, tax: 1.67,
      receipt_path: db.uploads[0].path, scan: expect.objectContaining({ confianza: "alta" }) });
    expect(db.removed).toEqual([]);
  });

  it("lectura con poca confianza: lo dice y pide revisar", async () => {
    db.invoke = () => ({ data: { ok: true, receipt: { merchant: null, date: null, total: 230, currency: null, subtotal: null, tip: null, tax: null, items: [],
      confidenceScore: 0.4, confidence: "baja", warnings: ["No se ve la moneda: revísala."] } }, error: null });
    renderTrip();
    await screen.findByRole("tab", { name: /^Gastos$/ });
    await pick(photo());
    const form = await screen.findByRole("region", { name: "Nuevo gasto" });
    await waitFor(() => expect(form).toHaveTextContent(/poca confianza/));
    expect(form).toHaveTextContent("No se ve la moneda: revísala.");
    expect(within(form).getByLabelText("Monto del gasto")).toHaveValue(230);
  });

  it("ticket ilegible: lo explica, deja capturar a mano y, si se cancela, borra la foto", async () => {
    db.invoke = () => ({ data: null, error: { context: { json: async () => ({ ok: false, code: "ilegible", message: "No se alcanza a leer el ticket. Toma la foto de frente, con luz y sin cortar el total, o captúralo a mano." }) } } });
    renderTrip();
    await screen.findByRole("tab", { name: /^Gastos$/ });
    await pick(photo());
    const form = await screen.findByRole("region", { name: "Nuevo gasto" });
    await waitFor(() => expect(form).toHaveTextContent("No se alcanza a leer el ticket"));
    expect(within(form).getByLabelText("Monto del gasto")).toHaveValue(null);
    expect(db.inserts).toHaveLength(0);
    fireEvent.click(within(form).getAllByRole("button", { name: "Cancelar" })[0]);
    await waitFor(() => expect(db.removed).toEqual([{ bucket: "trip-receipts", paths: [db.uploads[0].path] }]));
  });

  it("si el ticket es solo mío, se guarda en mis gastos con la foto en mis recibos y la copia del viaje se borra", async () => {
    db.invoke = () => ({ data: { ok: true, receipt: { merchant: "Farmacia", date: "2026-11-03", total: 12, currency: "EUR", subtotal: null, tip: null, tax: null, items: [],
      confidenceScore: 0.85, confidence: "alta", warnings: [] } }, error: null });
    renderTrip();
    await screen.findByRole("tab", { name: /^Gastos$/ });
    await pick(photo());
    const form = await screen.findByRole("region", { name: "Nuevo gasto" });
    await waitFor(() => expect(within(form).getByLabelText("Monto del gasto")).toHaveValue(12));
    fireEvent.click(within(form).getByRole("button", { name: "Guardar gasto" }));
    await waitFor(() => expect(db.inserts.some((i) => i.table === "expenses")).toBe(true));
    expect(db.inserts.find((i) => i.table === "expenses")!.row).toMatchObject({ user_id: ME, trip_id: TRIP, amount: 12, currency: "EUR", description: "Farmacia" });
    expect(db.uploads.map((u) => u.bucket)).toEqual(["trip-receipts", "recibos"]);
    await waitFor(() => expect(db.removed).toEqual([{ bucket: "trip-receipts", paths: [db.uploads[0].path] }]));
  });
});

// ───── Dashboard ─────
describe("Gastos del dashboard suma coherente", () => {
  it("incluye mi parte de los gastos compartidos (sin poder borrarla desde ahí)", async () => {
    db.tables.expenses = [{ id: "x1", user_id: ME, trip_id: null, amount: 100, currency: "MXN", category: "Otros", description: "Café", expense_date: "2026-10-20", receipt_url: null }];
    db.rpcData.my_split_shares = [{ share_id: "s1", expense_id: "e1", trip_id: TRIP, amount: 200, currency: "MXN", category: "Restaurantes",
      description: "Cena compartida", expense_date: "2026-10-21", city: null, total: 600, payer_name: "Ana López", paid_by_me: false }];
    render(<MemoryRouter><Gastos /></MemoryRouter>);
    expect(await screen.findByText("Cena compartida")).toBeInTheDocument();
    expect(screen.getByText("Tu parte de $600 MXN compartido · pagó Ana López")).toBeInTheDocument();
    expect(screen.getByText("$300 MXN")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Eliminar gasto Cena compartida" })).toBeNull();
    expect(screen.getByRole("link", { name: "Ver gasto compartido Cena compartida" })).toHaveAttribute("href", `/dashboard/viajes/${TRIP}/split?tab=compartidos`);
  });
});

// ───── Migración ─────
describe("migración 20261027020000_gastos_split.sql", () => {
  const sql = readFileSync("supabase/migrations/20261027020000_gastos_split.sql", "utf8");
  it("los gastos viejos reciben sus partes ANTES de agregar a los miembros, y ningún nombre se borra", () => {
    const backfill = sql.indexOf("FOR e IN SELECT x.id, x.trip_id FROM public.trip_split_expenses x");
    const sync = sql.indexOf("SELECT public._split_sync_trip(t.trip_id, NULL)");
    expect(backfill).toBeGreaterThan(0);
    expect(sync).toBeGreaterThan(backfill);
    const datos = sql.slice(sql.indexOf("Datos que ya existían"));
    expect(datos).not.toMatch(/DELETE FROM public\.trip_split_people/);
  });
  it("RLS estricto: anon sin permisos, y el bucket de tickets privado y en la purga del viaje", () => {
    expect(sql).toMatch(/REVOKE ALL ON public\.trip_split_shares FROM PUBLIC, anon, authenticated/);
    expect(sql).toMatch(/REVOKE ALL ON public\.trip_split_payments FROM PUBLIC, anon, authenticated/);
    expect(sql).toMatch(/VALUES \('trip-receipts', 'trip-receipts', false/);
    expect(sql).toMatch(/o\.bucket_id = 'trip-receipts' AND split_part\(o\.name, '\/', 1\) = OLD\.id::text/);
    const purge = readFileSync("supabase/functions/trip-files-purge/purge.ts", "utf8");
    expect(purge).toMatch(/"trip-receipts"/);
  });
});
