import { describe, it, expect, vi } from "vitest";
import { runFlightWatch, parseMaxChecks, DEFAULT_OPTIONS, type RunnerDeps } from "../../supabase/functions/flight-watch-cron/runner";
import type { TrackedFlight } from "../../supabase/functions/flight-watch-cron/rules";
import type { FlightOutcome } from "../../supabase/functions/_shared/flight-serpapi";

const mk = (i: number, over: Partial<TrackedFlight> = {}): TrackedFlight => ({
  id: `f${i}`, user_id: `u${i}`, trip_id: null, flight: `AM${i}`, flight_date: "2026-10-22", route: null,
  last_status: "a tiempo", last_gate: null, last_terminal: null, last_estimated: "19:40",
  last_notified_estimated: "19:40", last_notified_fingerprint: null, consecutive_failures: 0, ...over,
});
const gateB12: FlightOutcome = { kind: "ok", data: {
  status: "a tiempo", scheduled_departure: "19:40", estimated_departure: "19:40", gate: "B12", terminal: undefined,
  origin: "MEX", destination: "CUN", delay_minutes: 0, provider_status: "SCHEDULED", scheduled_arrival: undefined,
  estimated_arrival: undefined, arrival_delay_minutes: undefined, arrival_at: undefined, departure_at: undefined,
} };

function harness(rows: TrackedFlight[], check: (f: string) => Promise<FlightOutcome>, opts: { clockStepMs?: number; notifyInserts?: boolean } = {}) {
  const queue = [...rows];
  let clock = 0;
  let inFlight = 0;
  let maxInFlight = 0;
  const saved: Record<string, Record<string, unknown>> = {};
  const claims: number[] = [];
  const deps: RunnerDeps = {
    claim: vi.fn(async (limit: number) => { claims.push(limit); clock += opts.clockStepMs ?? 0; return queue.splice(0, limit); }),
    check: vi.fn(async (flight: string) => {
      inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
      try { await new Promise((r) => setTimeout(r, 1)); return await check(flight); } finally { inFlight--; }
    }),
    save: vi.fn(async (id: string, u: Record<string, unknown>) => { saved[id] = u; }),
    notify: vi.fn(async () => opts.notifyInserts ?? true),
    push: vi.fn(async () => 1),
    now: () => clock,
  };
  return { deps, saved, claims, queue, maxInFlight: () => maxInFlight };
}

describe("flight-watch runner (C-03, C-06, C-07)", () => {
  it("never marks a provider error as a successful check and never alerts on it", async () => {
    const h = harness([mk(1)], async () => ({ kind: "provider_error", message: "HTTP 500" }));
    const s = await runFlightWatch(h.deps);
    expect(s).toMatchObject({ claimed: 1, provider_errors: 1, with_data: 0, notified: 0 });
    expect(h.saved.f1).toMatchObject({ last_provider_status: "provider_error", consecutive_failures: 1 });
    expect(h.saved.f1).not.toHaveProperty("last_successful_check_at");
    expect(h.deps.notify).not.toHaveBeenCalled();
  });

  it("checks a flight+date once per run even when several users track it", async () => {
    const rows = [mk(1, { flight: "AM58" }), mk(2, { flight: "AM58" }), mk(3, { flight: "am 58" })];
    const h = harness(rows, async () => gateB12);
    const s = await runFlightWatch(h.deps);
    expect(h.deps.check).toHaveBeenCalledTimes(1);
    expect(s).toMatchObject({ provider_calls: 1, cache_hits: 2, notified: 3, pushed: 3 });
  });

  it("only pushes when the in-app notification was actually inserted (dedup_key)", async () => {
    const h = harness([mk(1)], async () => gateB12, { notifyInserts: false });
    const s = await runFlightWatch(h.deps);
    expect(h.deps.notify).toHaveBeenCalledWith(expect.objectContaining({ dedup_key: expect.stringMatching(/^flight:f1:/) }));
    expect(h.deps.push).not.toHaveBeenCalled();
    expect(s.notified).toBe(0);
    // la huella se guarda igual, para no reintentar el mismo aviso
    expect(h.saved.f1.last_notified_fingerprint).toBe("a tiempo|B12||19:40");
  });

  it("processes at most 5 at a time and claims at most maxChecks rows", async () => {
    const rows = Array.from({ length: 80 }, (_, i) => mk(i));
    const h = harness(rows, async () => gateB12);
    const s = await runFlightWatch(h.deps, { ...DEFAULT_OPTIONS, maxChecks: 50 });
    expect(s.claimed).toBe(50);
    expect(h.queue).toHaveLength(30); // sin reclamar: quedan para la siguiente corrida
    expect(Math.max(...h.claims)).toBeLessThanOrEqual(5);
    expect(h.maxInFlight()).toBeLessThanOrEqual(5);
  });

  it("stops claiming before the ~100 s deadline and leaves the rest unclaimed", async () => {
    const rows = Array.from({ length: 50 }, (_, i) => mk(i));
    const h = harness(rows, async () => gateB12, { clockStepMs: 30_000 }); // cada lote "tarda" 30 s
    const s = await runFlightWatch(h.deps);
    expect(s.stopped_by_deadline).toBe(true);
    // lotes a los 0, 30, 60 y 90 s; a los 120 s ya no (se deja de reclamar a 100 s − 10 s por consulta)
    expect(s.claimed).toBe(20);
    expect(h.queue).toHaveLength(30);
  });

  it("stops the run when SerpApi says the quota is exhausted", async () => {
    const rows = Array.from({ length: 20 }, (_, i) => mk(i));
    const h = harness(rows, async () => ({ kind: "quota", message: "Your account has run out of searches." }));
    const s = await runFlightWatch(h.deps);
    expect(s.quota_exhausted).toBe(true);
    expect(s.claimed).toBe(5);
    expect(h.queue).toHaveLength(15);
  });

  it("an exception in the provider call is recorded as a provider error, without the key", async () => {
    const h = harness([mk(1)], async () => { throw new Error("error sending request for url (https://serpapi.com/search.json?api_key=SECRET)"); });
    await runFlightWatch(h.deps);
    expect(String(h.saved.f1.check_error)).not.toContain("SECRET");
    expect(h.saved.f1.last_provider_status).toBe("provider_error");
  });

  it("reads the max checks per run from config (default 50, cap 200)", () => {
    expect(parseMaxChecks(undefined)).toBe(50);
    expect(parseMaxChecks("20")).toBe(20);
    expect(parseMaxChecks("1000")).toBe(200);
    expect(parseMaxChecks("abc")).toBe(50);
  });
});
