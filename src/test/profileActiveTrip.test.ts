// N-03: sin la migración de profiles.active_trip_id, el Concierge recibía 400 en cada carga y cada
// minuto. Tras el primer error se deja de consultar y se usa la elección local, sin avisos.
import { describe, it, expect, vi, beforeEach } from "vitest";

const calls: string[] = [];
let readResult: any = { data: null, error: { code: "42703", message: "column profiles.active_trip_id does not exist" } };
let updateResult: any = { error: { code: "PGRST204", message: "Could not find the 'active_trip_id' column" } };
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => {
      const api: any = {
        select: () => { calls.push("select"); return api; },
        update: () => { calls.push("update"); return { eq: async () => updateResult }; },
        eq: () => api,
        maybeSingle: async () => readResult,
      };
      return api;
    },
  },
}));

import { readPinnedTrip, savePinnedTrip, activeTripColumnUnavailable, __resetActiveTripColumn } from "@/lib/profileActiveTrip";

beforeEach(() => {
  calls.length = 0;
  __resetActiveTripColumn();
});

describe("profiles.active_trip_id tolerante", () => {
  it("sin la columna: el primer error se calla y ya no se vuelve a consultar en la sesión", async () => {
    readResult = { data: null, error: { code: "42703", message: "no existe" } };
    expect(await readPinnedTrip("u1")).toBeUndefined();
    expect(activeTripColumnUnavailable()).toBe(true);
    // Auto-refresh cada minuto y cambio de viaje: cero peticiones nuevas.
    expect(await readPinnedTrip("u1")).toBeUndefined();
    expect(await readPinnedTrip("u1")).toBeUndefined();
    expect(await savePinnedTrip("u1", "t1")).toBeNull();
    expect(calls).toEqual(["select"]);
  });

  it("con la columna: lee el viaje fijado (o null = Iato decide)", async () => {
    readResult = { data: { active_trip_id: "t9" }, error: null };
    expect(await readPinnedTrip("u1")).toBe("t9");
    readResult = { data: { active_trip_id: null }, error: null };
    expect(await readPinnedTrip("u1")).toBeNull();
    expect(activeTripColumnUnavailable()).toBe(false);
  });

  it("al guardar: columna ausente es silencioso; viaje ajeno (42501) se reporta", async () => {
    updateResult = { error: { code: "PGRST204", message: "x" } };
    expect(await savePinnedTrip("u1", "t1")).toBeNull();
    expect(activeTripColumnUnavailable()).toBe(true);
    __resetActiveTripColumn();
    updateResult = { error: { code: "42501", message: "no autorizado" } };
    expect(await savePinnedTrip("u1", "t1")).toBe("42501");
    expect(activeTripColumnUnavailable()).toBe(false);
    updateResult = { error: null };
    expect(await savePinnedTrip("u1", null)).toBeNull();
  });
});
