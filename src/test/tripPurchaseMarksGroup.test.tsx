// r2 grupo: "Ya lo reservé" compartido en el viaje. Todos los miembros (dueño y colaboradores) ven quién
// marcó cada cosa y cuándo; quitar una marca solo quien la puso o el dueño. La base simulada aplica las
// mismas reglas que la RLS de trip_purchase_marks (las prueba de verdad supabase/tests/grupo). Sin red.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const fake = vi.hoisted(() => {
  type Row = Record<string, any>;
  const S = {
    user: "u-olga" as string | null,
    owner: "u-olga",
    members: new Set<string>(["u-olga", "u-carlos", "u-lia"]),
    names: { "u-olga": "Olga Pérez", "u-carlos": "Carlos Ruiz", "u-lia": "lia.viaja" } as Record<string, string>,
    missing: false,
    marks: [] as Row[],
    bookings: [] as Row[],
    calls: [] as { table: string; op: string; payload?: any; opts?: any }[],
    seq: 0,
  };
  const match = (r: Row, f: [string, any][]) => f.every(([c, v]) => r[c] === v);
  function run(table: string, st: any) {
    S.calls.push({ table, op: st.op, payload: st.payload, opts: st.opts });
    if (table === "trip_purchase_marks") {
      if (S.missing) return { data: null, error: { code: "42P01", message: 'relation "trip_purchase_marks" does not exist' } };
      const member = !!S.user && S.members.has(S.user);
      if (st.op === "select") return { data: member ? S.marks.filter((r) => match(r, st.filters)).map((r) => ({ ...r })) : [], error: null };
      if (st.op === "upsert") {
        const rows = Array.isArray(st.payload) ? st.payload : [st.payload];
        if (!member || rows.some((p: Row) => p.marked_by !== S.user)) return { data: null, error: { code: "42501", message: "new row violates row-level security policy" } };
        for (const p of rows) {
          if (S.marks.some((m) => m.trip_id === p.trip_id && m.item_key === p.item_key)) continue;
          // Como el trigger: el nombre y la fecha los pone la base.
          S.marks.push({ id: `m-${++S.seq}`, trip_id: p.trip_id, item_key: p.item_key, category: p.category ?? null, marked_by: S.user,
            marked_by_name: S.names[S.user!] ?? null, marked_at: "2026-10-22T12:00:00Z" });
        }
        return { data: null, error: null };
      }
      if (st.op === "delete") {
        const gone = S.marks.filter((r) => match(r, st.filters) && member && (r.marked_by === S.user || S.user === S.owner));
        S.marks = S.marks.filter((r) => !gone.includes(r));
        for (const g of gone) S.bookings = S.bookings.filter((b) => !(b.user_id === g.marked_by && b.raw_payload?.compra_item === g.item_key && b.status === "pending"));
        return { data: gone.map((g) => ({ id: g.id })), error: null };
      }
    }
    if (table === "bookings") {
      if (st.op === "insert") {
        const row = { id: `b-${++S.seq}`, created_at: "2026-10-22T12:00:00Z", ...st.payload };
        S.bookings.push(row);
        return { data: st.single ? row : [row], error: null };
      }
      if (st.op === "delete") {
        S.bookings = S.bookings.filter((b) => !(match(b, st.filters) && b.user_id === S.user));
        return { data: null, error: null };
      }
    }
    return { data: null, error: { message: `tabla no simulada: ${table}` } };
  }
  function from(table: string) {
    const st: any = { op: null, filters: [], payload: null, opts: null, single: false };
    const api: any = {
      select: () => { if (!st.op) st.op = "select"; return api; },
      eq: (c: string, v: any) => { st.filters.push([c, v]); return api; },
      insert: (p: any) => { st.op = "insert"; st.payload = p; return api; },
      upsert: (p: any, o: any) => { st.op = "upsert"; st.payload = p; st.opts = o; return api; },
      delete: () => { st.op = "delete"; return api; },
      single: () => { st.single = true; return api; },
      then: (res: any, rej: any) => Promise.resolve().then(() => run(table, st)).then(res, rej),
    };
    return api;
  }
  return { S, from };
});

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: fake.from, auth: { getSession: async () => ({ data: { session: null } }) } } }));

import { buildPurchasePlan } from "@/lib/purchasePlan";
import { canUnmark, markLabel, markerName, marksFromBookings, marksFromGroup, pendingGroupCopies, shortMarkDate } from "@/lib/purchaseMarks";
import { useTripPurchaseMarks } from "@/hooks/useTripPurchaseMarks";
import { TripPurchasePlan } from "@/components/booking/TripPurchasePlan";

const S = fake.S;
const TRIP = {
  id: "22222222-2222-4222-8222-222222222222", user_id: "u-olga", destino: "Lisboa", pais_destino: "Portugal", ciudad_origen: "Ciudad de México",
  fecha_salida: "2026-12-12", fecha_regreso: "2026-12-19", num_viajeros: 3, created_at: "2026-10-20T10:00:00Z",
  vuelos_json: [{ tier: "ahorro", aerolinea: "Iberia", precio_por_persona: 21000, fuente_precio: "travelpayouts", consultado_at: "2026-10-20T10:00:00Z",
    booking_link: "https://www.aviasales.com/search/MEX1212LIS19123?marker=533299" }],
  hospedaje_json: [{ nombre: "Hotel Avenida", precio_por_noche: 3500, fuente_precio: "serpapi", consultado_at: "2026-10-20T10:00:00Z" }],
  tours_json: [],
  restaurantes_json: [],
};
const ITEMS = buildPurchasePlan(TRIP, { selVuelo: 0, selHospedaje: 0, selTours: [] });
const VUELO = ITEMS.find((i) => i.kind === "vuelo")!;
const HOTEL = ITEMS.find((i) => i.kind === "hospedaje")!;
const carlosMark = () => ({ id: "m-carlos", trip_id: TRIP.id, item_key: VUELO.key, category: "flight", marked_by: "u-carlos",
  marked_by_name: "Carlos Ruiz", marked_at: "2026-10-22T12:00:00Z" });

beforeEach(() => {
  S.user = "u-olga"; S.missing = false; S.marks = []; S.bookings = []; S.calls = []; S.seq = 0;
  S.members = new Set(["u-olga", "u-carlos", "u-lia"]);
});

describe("purchaseMarks (lógica pura)", () => {
  it("la etiqueta dice quién y cuándo, en español: 'Ya lo reservé · Carlos Ruiz · 22 oct'", () => {
    const [mk] = marksFromGroup([carlosMark()]).values();
    const now = new Date("2026-10-23T12:00:00Z");
    expect(markLabel(mk, "u-lia", now)).toBe("Ya lo reservé · Carlos Ruiz · 22 oct");
    expect(shortMarkDate("2025-12-03T12:00:00Z", now)).toBe("3 dic 2025");
    expect(shortMarkDate("no es fecha", now)).toBeNull();
    expect(markerName({ ...mk, name: null }, "u-carlos")).toBe("tú");
    expect(markerName({ ...mk, name: "  ", markedBy: null }, "u-lia")).toBe("alguien del viaje");
  });
  it("quitar: quien la puso o el dueño; nadie más", () => {
    const [mk] = marksFromGroup([carlosMark()]).values();
    expect(canUnmark(mk, "u-carlos", "u-olga")).toBe(true);
    expect(canUnmark(mk, "u-olga", "u-olga")).toBe(true);
    expect(canUnmark(mk, "u-lia", "u-olga")).toBe(false);
    expect(canUnmark(mk, null, "u-olga")).toBe(false);
  });
  it("las marcas viejas (solo en bookings) se reconocen y se copian al grupo una vez; las canceladas no", () => {
    const rows = [
      { id: "b1", user_id: "u-lia", category: "hotel", status: "pending", raw_payload: { compra_item: HOTEL.key, marcado_at: "2026-10-01T12:00:00Z" } },
      { id: "b2", user_id: "u-lia", category: "flight", status: "cancelled", raw_payload: { compra_item: VUELO.key } },
    ];
    const own = marksFromBookings(rows, "u-lia");
    expect([...own.keys()]).toEqual([HOTEL.key]);
    expect(own.get(HOTEL.key)).toMatchObject({ source: "propia", at: "2026-10-01T12:00:00Z", markedBy: "u-lia" });
    expect(pendingGroupCopies(rows, new Map(), "u-lia")).toEqual([{ item_key: HOTEL.key, category: "hotel" }]);
    expect(pendingGroupCopies(rows, marksFromGroup([{ ...carlosMark(), item_key: HOTEL.key }]), "u-lia")).toEqual([]);
  });
});

describe("useTripPurchaseMarks", () => {
  const hook = (userId: string, bookings: any[] = []) =>
    renderHook(({ b }) => useTripPurchaseMarks({ trip: TRIP, userId, bookings: b }), { initialProps: { b: bookings } });

  it("un colaborador ve la marca que puso otro miembro, con nombre y fecha", async () => {
    S.marks = [carlosMark()]; S.user = "u-lia";
    const { result } = hook("u-lia");
    await waitFor(() => expect(result.current.mode).toBe("grupo"));
    expect(result.current.marks.get(VUELO.key)).toMatchObject({ markedBy: "u-carlos", name: "Carlos Ruiz", source: "grupo" });
  });

  it("alguien que no es miembro no recibe ninguna marca", async () => {
    S.marks = [carlosMark()]; S.user = "u-extrano";
    const { result } = hook("u-extrano");
    await waitFor(() => expect(result.current.mode).toBe("grupo"));
    expect(result.current.marks.size).toBe(0);
  });

  it("marcar guarda la constancia personal en bookings y la marca del grupo a nombre propio", async () => {
    S.user = "u-lia";
    const { result } = hook("u-lia");
    await waitFor(() => expect(result.current.mode).toBe("grupo"));
    let r: any;
    await act(async () => { r = await result.current.mark(HOTEL); });
    expect(r).toEqual({ ok: true });
    expect(S.bookings).toEqual([expect.objectContaining({ user_id: "u-lia", status: "pending", raw_payload: expect.objectContaining({ compra_item: HOTEL.key }) })]);
    const up = S.calls.find((c) => c.table === "trip_purchase_marks" && c.op === "upsert");
    expect(up?.payload).toEqual({ trip_id: TRIP.id, item_key: HOTEL.key, category: "hotel", marked_by: "u-lia" });
    expect(up?.opts).toEqual({ onConflict: "trip_id,item_key", ignoreDuplicates: true });
    await waitFor(() => expect(result.current.marks.get(HOTEL.key)).toMatchObject({ name: "lia.viaja", markedBy: "u-lia" }));
  });

  it("si la base no deja quitar la marca ajena, lo dice y la marca sigue", async () => {
    S.marks = [carlosMark()]; S.user = "u-lia";
    const { result } = hook("u-lia");
    await waitFor(() => expect(result.current.mode).toBe("grupo"));
    let r: any;
    await act(async () => { r = await result.current.unmark(VUELO); });
    expect(r).toEqual({ ok: false, reason: "no_permitido" });
    expect(S.marks).toHaveLength(1);
  });

  it("copia suave: la marca propia que solo estaba en bookings pasa al grupo sin perderse (una sola vez)", async () => {
    S.user = "u-lia";
    const old = [{ id: "b-old", user_id: "u-lia", trip_id: TRIP.id, category: "hotel", status: "pending", title: "Hospedaje · Hotel Avenida",
      raw_payload: { compra_item: HOTEL.key, marcado_por_usuario: true, marcado_at: "2026-10-01T12:00:00Z" }, created_at: "2026-10-01T12:00:00Z" }];
    const { result, rerender } = hook("u-lia", old);
    await waitFor(() => expect(result.current.marks.get(HOTEL.key)?.source).toBe("grupo"));
    rerender({ b: [...old] });
    await act(async () => { await Promise.resolve(); });
    const ups = S.calls.filter((c) => c.table === "trip_purchase_marks" && c.op === "upsert");
    expect(ups).toHaveLength(1);
    expect(ups[0].payload).toEqual([{ trip_id: TRIP.id, item_key: HOTEL.key, category: "hotel", marked_by: "u-lia" }]);
  });

  it("sin la tabla (migración pendiente) funciona como antes: solo lo propio, guardado en bookings", async () => {
    S.missing = true; S.user = "u-lia";
    const { result } = hook("u-lia");
    await waitFor(() => expect(result.current.mode).toBe("propio"));
    await act(async () => { await result.current.mark(HOTEL); });
    expect(result.current.marks.get(HOTEL.key)).toMatchObject({ source: "propia" });
    expect(S.calls.filter((c) => c.table === "trip_purchase_marks" && c.op === "upsert")).toHaveLength(0);
    expect(S.bookings).toHaveLength(1);
  });
});

describe("TripPurchasePlan con marcas del grupo (render)", () => {
  // Solo se fija la fecha (no los temporizadores): "22 oct" sin año depende del año en curso.
  beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-23T12:00:00Z")); });
  afterEach(() => { vi.useRealTimers(); });
  const ui = (userId: string) => render(
    <MemoryRouter>
      <TripPurchasePlan trip={TRIP} selVuelo={0} selHospedaje={0} selTours={new Set()} bookings={[]} userId={userId} />
    </MemoryRouter>,
  );

  it("una colaboradora ve 'Ya lo reservé · Carlos Ruiz · 22 oct' en la tarjeta y no puede quitarlo", async () => {
    S.marks = [carlosMark()]; S.user = "u-lia";
    ui("u-lia");
    const card = screen.getByTestId("comprar-vuelo");
    await waitFor(() => expect(card).toHaveAttribute("data-state", "marcado"));
    expect(within(card).getByTestId("comprar-vuelo-marca").textContent).toBe("Ya lo reservé · Carlos Ruiz · 22 oct");
    expect(within(card).getByText("Marcado a mano · sin verificar")).toBeInTheDocument();
    expect(within(card).queryByRole("button", { name: /como pendiente/ })).toBeNull();
    expect(screen.getByTestId("trip-comprar-progreso").textContent).toBe("1 de 2 reservados");
    // Nada en inglés en la tarjeta.
    expect(card.textContent).not.toMatch(/\b(booked|marked|by|undo|pending|you)\b/i);
  });

  it("quien lo marcó lo ve como suyo y puede deshacerlo", async () => {
    S.marks = [carlosMark()]; S.user = "u-carlos";
    ui("u-carlos");
    const card = screen.getByTestId("comprar-vuelo");
    await waitFor(() => expect(card).toHaveAttribute("data-state", "marcado"));
    expect(within(card).getByText("Marcado por ti · sin verificar")).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: /como pendiente/ })).toBeInTheDocument();
  });

  it("el dueño puede quitar la marca de un colaborador; se borra la marca del grupo", async () => {
    S.marks = [carlosMark()]; S.user = "u-olga";
    ui("u-olga");
    const card = screen.getByTestId("comprar-vuelo");
    await waitFor(() => expect(card).toHaveAttribute("data-state", "marcado"));
    fireEvent.click(within(card).getByRole("button", { name: /como pendiente/ }));
    await waitFor(() => expect(card).toHaveAttribute("data-state", "pendiente"));
    expect(S.marks).toHaveLength(0);
    expect(S.calls.some((c) => c.table === "bookings" && c.op === "delete")).toBe(false);
  });

  it("al marcar, la tarjeta muestra el nombre de quien marcó", async () => {
    S.user = "u-lia";
    ui("u-lia");
    await waitFor(() => expect(S.calls.some((c) => c.table === "trip_purchase_marks" && c.op === "select")).toBe(true));
    fireEvent.click(screen.getByTestId("comprar-hospedaje-marcar"));
    const card = screen.getByTestId("comprar-hospedaje");
    await waitFor(() => expect(within(card).getByTestId("comprar-hospedaje-marca").textContent).toBe("Ya lo reservé · lia.viaja · 22 oct"));
  });
});
