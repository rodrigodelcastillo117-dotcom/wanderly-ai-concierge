import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  runWithReservation, resolveRequestKey, analysisMeetsContract, logisticsMeetsContract,
  type ReservationDeps, type WorkResult,
} from "../../supabase/functions/_shared/reservation";

// Base de datos falsa con las mismas reglas que reserve/commit/release (las reales se prueban en
// supabase/tests/payments/quota_reservations.sql). Límite: 1 análisis.
function fakeDb(limit = 1) {
  const rows = new Map<string, { id: string; status: string; tripId: string | null; result: unknown }>();
  let used = 0;
  let n = 0;
  const deps: ReservationDeps & { used: () => number; rows: typeof rows } = {
    used: () => used,
    rows,
    reserve: vi.fn(async (key: string): Promise<any> => {
      const r = rows.get(key);
      if (r?.status === "COMMITTED") return { allowed: false, reason: "replay", remaining: null, trip_id: r.tripId, result: r.result };
      if (r?.status === "RESERVED") return { allowed: false, reason: "in_progress", remaining: null };
      const live = [...rows.values()].filter((x) => x.status === "RESERVED").length;
      if (used >= limit) return { allowed: false, reason: "quota_exceeded", remaining: 0, limit, used };
      if (used + live >= limit) return { allowed: false, reason: "in_progress", remaining: null };
      const row = r ?? { id: `res-${++n}`, status: "RESERVED", tripId: null, result: null };
      row.status = "RESERVED";
      rows.set(key, row);
      return { allowed: true, reason: "reserved", remaining: null, reservation_id: row.id };
    }),
    commit: vi.fn(async (id: string, tripId: string | null, result: unknown) => {
      const row = [...rows.values()].find((x) => x.id === id)!;
      if (row.status !== "COMMITTED") { row.status = "COMMITTED"; row.tripId = tripId; row.result = result; used++; }
      return { error: null };
    }),
    release: vi.fn(async (id: string) => {
      const row = [...rows.values()].find((x) => x.id === id)!;
      if (row.status === "RESERVED") row.status = "RELEASED";
      return { error: null };
    }),
  };
  return deps;
}

const okWork = (tripId = "trip-1") => vi.fn(async (ctx: { beginPersist(): boolean }): Promise<WorkResult> => {
  if (!ctx.beginPersist()) return { ok: false, reason: "timeout_before_persist" };
  return { ok: true, tripId, response: new Response(JSON.stringify({ trip: { id: tripId } }), { status: 200 }) };
});
const failing = (reason: string): (() => Promise<WorkResult>) => async () => ({ ok: false, reason });

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("IATOS-P1-FREE-02: un análisis fallido NO gasta la oportunidad gratuita", () => {
  it.each([
    ["error 500 / excepción", async () => { throw new Error("500 Internal Server Error"); }],
    ["caída del proveedor de IA", failing("ai_provider_error")],
    ["datos insuficientes", failing("insufficient_data")],
    ["resultado parcial inaceptable", failing("partial_result:itinerario")],
    ["fallo al guardar", failing("persist_failed")],
  ])("%s → libera la reserva y el siguiente intento sí puede analizar", async (_label, work) => {
    const db = fakeDb();
    const out = await runWithReservation(db, "c:k1", work as any);
    expect(out.type).toBe("failed");
    expect(db.release).toHaveBeenCalledTimes(1);
    expect(db.commit).not.toHaveBeenCalled();
    expect(db.used()).toBe(0);
    const again = await runWithReservation(db, "c:k1", okWork());
    expect(again.type).toBe("ok");
    expect(db.used()).toBe(1);
  });

  it("timeout → libera, responde fallo y el trabajo tardío ya no guarda nada", async () => {
    const db = fakeDb();
    let persisted = false;
    let finish!: () => void;
    const slow = (ctx: { beginPersist(): boolean }) => new Promise<WorkResult>((res) => {
      finish = () => {
        if (ctx.beginPersist()) persisted = true;
        res({ ok: true, tripId: "t", response: new Response("{}") });
      };
    });
    const out = await runWithReservation(db, "c:slow", slow, { timeoutMs: 10 });
    expect(out).toMatchObject({ type: "failed", reason: "timeout" });
    expect(db.release).toHaveBeenCalledWith(expect.any(String), "timeout");
    finish();
    await new Promise((r) => setTimeout(r, 0));
    expect(persisted).toBe(false);
    expect(db.used()).toBe(0);
  });

  it("si el timeout llega mientras guarda, espera y confirma (no deja un viaje sin cobrar ni lo libera)", async () => {
    const db = fakeDb();
    const work = async (ctx: { beginPersist(): boolean }): Promise<WorkResult> => {
      ctx.beginPersist();
      await new Promise((r) => setTimeout(r, 30));
      return { ok: true, tripId: "t", response: new Response("{}") };
    };
    const out = await runWithReservation(db, "c:k", work, { timeoutMs: 5 });
    expect(out.type).toBe("ok");
    expect(db.release).not.toHaveBeenCalled();
    expect(db.used()).toBe(1);
  });

  it("éxito: confirma una sola vez con el viaje guardado", async () => {
    const db = fakeDb();
    const out = await runWithReservation(db, "c:k", okWork("trip-9"));
    expect(out.type).toBe("ok");
    expect(db.commit).toHaveBeenCalledWith(expect.any(String), "trip-9", null);
    expect(db.used()).toBe(1);
  });

  it("dos peticiones simultáneas con llaves distintas: una trabaja, la otra recibe in_progress", async () => {
    const db = fakeDb();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const work1 = vi.fn(async (ctx: any): Promise<WorkResult> => { await gate; ctx.beginPersist(); return { ok: true, tripId: "a", response: new Response("{}") }; });
    const work2 = vi.fn(okWork("b"));
    const p1 = runWithReservation(db, "c:tab1", work1);
    const p2 = await runWithReservation(db, "c:tab2", work2);
    expect(p2).toMatchObject({ type: "denied", quota: { reason: "in_progress" } });
    expect(work2).not.toHaveBeenCalled();
    release();
    expect((await p1).type).toBe("ok");
    expect(db.used()).toBe(1);
  });

  it("doble clic (misma llave): el segundo no ejecuta otro análisis", async () => {
    const db = fakeDb();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const p1 = runWithReservation(db, "c:same", async (ctx: any) => { await gate; ctx.beginPersist(); return { ok: true, tripId: "a", response: new Response("{}") }; });
    const second = vi.fn(okWork());
    expect((await runWithReservation(db, "c:same", second)).type).toBe("denied");
    expect(second).not.toHaveBeenCalled();
    release();
    await p1;
  });

  it("reintento tras perder la conexión (o recarga con la misma llave): devuelve el viaje guardado sin cobrar ni re-analizar", async () => {
    const db = fakeDb();
    await runWithReservation(db, "c:lost", okWork("trip-guardado"));
    const work = vi.fn(okWork("otro"));
    const out = await runWithReservation(db, "c:lost", work);
    expect(out).toEqual({ type: "replay", tripId: "trip-guardado", result: null });
    expect(work).not.toHaveBeenCalled();
    expect(db.used()).toBe(1);
  });

  it("error después de completar (p. ej. falla el commit una vez): reintenta y no libera", async () => {
    const db = fakeDb();
    const commit = db.commit;
    let calls = 0;
    db.commit = vi.fn(async (...a: [string, string | null, unknown]) => {
      calls++;
      if (calls === 1) return { error: { message: "timeout" } };
      return commit(...a);
    });
    const out = await runWithReservation(db, "c:k", okWork());
    expect(out.type).toBe("ok");
    expect(db.commit).toHaveBeenCalledTimes(2);
    expect(db.release).not.toHaveBeenCalled();
    expect(db.used()).toBe(1);
  });

  it("abuso con llaves nuevas: un solo análisis confirmado, el resto negado sin trabajar", async () => {
    const db = fakeDb();
    await runWithReservation(db, "c:k0", okWork());
    const work = vi.fn(okWork());
    for (let i = 1; i <= 10; i++) {
      const out = await runWithReservation(db, `c:k${i}`, work);
      expect(out).toMatchObject({ type: "denied", quota: { reason: "quota_exceeded" } });
    }
    expect(work).not.toHaveBeenCalled();
    expect(db.used()).toBe(1);
  });

  it("si la reserva no se puede verificar, se niega (fail-closed) sin trabajar", async () => {
    const db = fakeDb();
    db.reserve = vi.fn(async () => ({ allowed: false, reason: "error" as const, remaining: null }));
    const work = vi.fn(okWork());
    expect((await runWithReservation(db, "c:k", work)).type).toBe("denied");
    expect(work).not.toHaveBeenCalled();
  });
});

describe("llave de idempotencia y contrato mínimo", () => {
  it("usa la llave del cliente si es válida; si no, deriva una de los datos del viaje", () => {
    expect(resolveRequestKey("3f2b9c1e-aaaa-bbbb-cccc-000000000001", [])).toBe("c:3f2b9c1e-aaaa-bbbb-cccc-000000000001");
    expect(resolveRequestKey("x';drop", ["Cancún ", "CDMX", "2026-12-01", "2026-12-08", 2]))
      .toBe("d:cancun|cdmx|2026-12-01|2026-12-08|2");
    expect(resolveRequestKey(undefined, ["cancún", "cdmx", "2026-12-01", "2026-12-08", 2]))
      .toBe(resolveRequestKey(null, ["CANCUN", "  CDMX", "2026-12-01", "2026-12-08", "2"]));
  });

  it("un análisis sin itinerario, total o vuelos/hospedaje es parcial (no se cobra)", () => {
    const good = { itinerario: [{ dia: 1 }], total_estimado: 25000, vuelos: [{}], hospedaje: [] };
    expect(analysisMeetsContract(good).ok).toBe(true);
    expect(analysisMeetsContract({ ...good, itinerario: [] }).missing).toEqual(["itinerario"]);
    expect(analysisMeetsContract({ ...good, total_estimado: 0 }).ok).toBe(false);
    expect(analysisMeetsContract({ ...good, vuelos: [], hospedaje: [] }).ok).toBe(false);
    expect(analysisMeetsContract(null).ok).toBe(false);
  });

  it("un plan multi-ciudad con una ciudad vacía es parcial", () => {
    const pd = (city: string, ok = true) => ({ city, hospedaje: ok ? [{}] : [], arrival_options: [] });
    const good = { days: [{}], total_estimado_mxn: 50000, per_destination: [pd("Madrid"), pd("Barcelona")] };
    expect(logisticsMeetsContract(good).ok).toBe(true);
    expect(logisticsMeetsContract({ ...good, per_destination: [pd("Madrid"), pd("Barcelona", false)] }).missing).toEqual(["ciudad:Barcelona"]);
    expect(logisticsMeetsContract({ ...good, days: [] }).ok).toBe(false);
  });
});
