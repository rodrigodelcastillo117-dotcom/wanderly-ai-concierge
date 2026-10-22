import { describe, it, expect, vi } from "vitest";
import {
  evaluate, failureUpdate, fingerprint, flightCacheKey, minutesBetween, successUpdate, type TrackedFlight,
} from "../../supabase/functions/flight-watch-cron/rules";
import { classifyFlightWidget, fetchFlightStatus, type FlightData } from "../../supabase/functions/_shared/flight-serpapi";

const row = (over: Partial<TrackedFlight> = {}): TrackedFlight => ({
  id: "f1", user_id: "u1", trip_id: "t1", flight: "AM58", flight_date: "2026-10-22", route: null,
  last_status: null, last_gate: null, last_terminal: null, last_estimated: null,
  last_notified_estimated: null, last_notified_fingerprint: null, consecutive_failures: 0, ...over,
});
const data = (over: Partial<FlightData> = {}): FlightData => ({
  status: "a tiempo", scheduled_departure: "19:40", estimated_departure: "19:40", gate: undefined, terminal: "1",
  origin: "MEX", destination: "CUN", delay_minutes: 0, provider_status: "SCHEDULED",
  scheduled_arrival: "22:00", estimated_arrival: "22:00", arrival_delay_minutes: undefined, arrival_at: undefined, departure_at: undefined, ...over,
});

describe("flight-watch alert rules (C-05)", () => {
  it("first reading on time is stored silently", () => {
    const ev = evaluate(row(), data());
    expect(ev.changes).toEqual([]);
    expect(ev.state).toMatchObject({ status: "a tiempo", terminal: "1", notifiedEstimated: "19:40" });
  });

  it("alerts a cancellation or a delay seen on the very first check", () => {
    expect(evaluate(row(), data({ status: "cancelado" })).changes).toEqual(["Vuelo cancelado"]);
    expect(evaluate(row(), data({ status: "retrasado", delay_minutes: 40, estimated_departure: "20:20" })).changes)
      .toEqual(["Vuelo retrasado 40 min, sale a las 20:20"]);
  });

  it("alerts the first gate assignment and later gate changes", () => {
    expect(evaluate(row({ last_status: "a tiempo" }), data({ gate: "B12" })).changes).toEqual(["Puerta asignada: B12"]);
    expect(evaluate(row({ last_status: "a tiempo", last_gate: "B12" }), data({ gate: "C3" })).changes).toEqual(["Puerta: B12 → C3"]);
  });

  it("treats 'desconocido' as no data: no alert and the known status is kept", () => {
    const prev = row({ last_status: "a tiempo", last_estimated: "19:40", last_notified_estimated: "19:40" });
    const ev = evaluate(prev, data({ status: "desconocido" }));
    expect(ev.changes).toEqual([]);
    expect(ev.state.status).toBe("a tiempo");
    // y al volver a "a tiempo" no hay falsa alarma "desconocido → a tiempo"
    expect(evaluate({ ...prev, last_status: ev.state.status }, data()).changes).toEqual([]);
    // un 'desconocido' guardado por la versión anterior tampoco cuenta como estado
    expect(evaluate(row({ last_status: "desconocido" }), data()).changes).toEqual([]);
  });

  it("alerts real status transitions", () => {
    expect(evaluate(row({ last_status: "a tiempo" }), data({ status: "abordando" })).changes).toEqual(["Estado: a tiempo → abordando"]);
  });

  it("ignores delays under 15 min (not stored as 'retrasado' either)", () => {
    const ev = evaluate(row({ last_status: "a tiempo" }), data({ status: "retrasado", delay_minutes: 5, estimated_departure: "19:45" }));
    expect(ev.changes).toEqual([]);
    expect(ev.state.status).toBe("a tiempo");
  });

  it("debounces estimated-time flapping: only a move of 15+ min vs the last notified time alerts", () => {
    const prev = row({ last_status: "a tiempo", last_estimated: "19:40", last_notified_estimated: "19:40" });
    const wobble = evaluate(prev, data({ estimated_departure: "19:50" }));
    expect(wobble.changes).toEqual([]);
    expect(wobble.state.notifiedEstimated).toBe("19:40");
    // vuelve a 19:40 → nada; deriva hasta 19:55 (15 min vs lo avisado) → avisa
    expect(evaluate({ ...prev, last_estimated: "19:50" }, data({ estimated_departure: "19:40" })).changes).toEqual([]);
    const moved = evaluate({ ...prev, last_estimated: "19:50" }, data({ estimated_departure: "19:55" }));
    expect(moved.changes).toEqual(["Hora estimada de salida: 19:40 → 19:55"]);
    expect(moved.state.notifiedEstimated).toBe("19:55");
  });

  it("measures time differences across midnight", () => {
    expect(minutesBetween("23:50", "00:10")).toBe(20);
    expect(minutesBetween("19:40", "nope")).toBeNull();
  });

  it("does not notify the same change twice (fingerprint)", () => {
    const first = evaluate(row({ last_status: "a tiempo" }), data({ gate: "B12" }));
    const again = evaluate(row({ last_status: "a tiempo", last_notified_fingerprint: first.fingerprint }), data({ gate: "B12" }));
    expect(again.changes).toEqual([]);
    expect(first.fingerprint).toBe(fingerprint({ status: "a tiempo", gate: "B12", terminal: "1", estimated: "19:40" }));
  });

  it("stops watching a flight once it landed or was cancelled", () => {
    const ev = evaluate(row({ last_status: "en vuelo" }), data({ status: "aterrizado" }));
    expect(ev.finished).toBe(true);
    expect(successUpdate(row(), data({ status: "aterrizado" }), ev, true, new Date())).toMatchObject({ active: false });
  });

  it("caches by flight number and date only", () => {
    expect(flightCacheKey({ flight: "am 58", flight_date: "2026-10-22" })).toBe(flightCacheKey({ flight: "AM58", flight_date: "2026-10-22" }));
  });
});

describe("flight-watch check outcome (C-03)", () => {
  const now = new Date("2026-10-22T18:00:00Z");

  it("a successful check stamps success and resets failures", () => {
    const prev = row({ consecutive_failures: 4 });
    const ev = evaluate(prev, data());
    expect(successUpdate(prev, data(), ev, false, now)).toMatchObject({
      last_successful_check_at: now.toISOString(), last_checked_at: now.toISOString(), last_provider_status: "ok",
      check_error: null, consecutive_failures: 0,
    });
  });

  it.each([
    [{ kind: "provider_error", message: "HTTP 500" }, "provider_error"],
    [{ kind: "quota", message: "Your account has run out of searches." }, "quota"],
    [{ kind: "no_data" }, "no_data"],
    [{ kind: "date_mismatch" }, "date_mismatch"],
  ] as const)("%o is never stamped as a successful check", (outcome, status) => {
    const u = failureUpdate(row({ consecutive_failures: 2 }), outcome);
    expect(u).toMatchObject({ last_provider_status: status, consecutive_failures: 3 });
    expect(u).not.toHaveProperty("last_successful_check_at");
    expect(u).not.toHaveProperty("last_checked_at");
    expect(u).not.toHaveProperty("last_status");
  });

  it("never stores an API key from an error message", () => {
    const u = failureUpdate(row(), { kind: "provider_error", message: "error sending request for url (https://serpapi.com/search.json?engine=google&api_key=SECRET123&q=x)" });
    expect(u.check_error).not.toContain("SECRET123");
    expect(u.check_error).toContain("api_key=***");
  });
});

describe("SerpApi outcome classification", () => {
  const widget = { dates: [{ date: "2026-10-22", metadata: { status: "SCHEDULED" }, departure_airport: { scheduled_time: "2026-10-22T19:40:00-06:00", time: "2026-10-22T19:40:00-06:00" },
    arrival_airport: { scheduled_time: "2026-10-22T22:05:00-05:00", time: "2026-10-22T22:15:00-05:00" } }] };
  const res = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as unknown as Response;

  it("distinguishes ok, no widget and another day's widget", () => {
    expect(classifyFlightWidget(widget, "2026-10-22")).toMatchObject({ kind: "ok", data: { status: "a tiempo", departure_at: "2026-10-23T01:40:00.000Z", arrival_at: "2026-10-23T03:15:00.000Z" } });
    expect(classifyFlightWidget(undefined, "2026-10-22")).toEqual({ kind: "no_data" });
    expect(classifyFlightWidget(widget, "2026-10-23")).toEqual({ kind: "date_mismatch" });
  });

  it("classifies quota exhaustion and provider errors without leaking the key", async () => {
    const quota = await fetchFlightStatus("KEY", "AM58", "2026-10-22", undefined, { fetch: vi.fn().mockResolvedValue(res({ error: "Your account has run out of searches." })) });
    expect(quota).toEqual({ kind: "quota", message: "Your account has run out of searches." });
    const down = await fetchFlightStatus("KEY", "AM58", "2026-10-22", undefined, { fetch: vi.fn().mockResolvedValue(res({}, 502)) });
    expect(down).toEqual({ kind: "provider_error", message: "HTTP 502" });
    const net = await fetchFlightStatus("KEY", "AM58", "2026-10-22", undefined, {
      fetch: vi.fn().mockRejectedValue(new TypeError("error sending request for url (https://serpapi.com/search.json?api_key=KEY&q=AM58)")),
    });
    expect(net.kind).toBe("provider_error");
    expect(JSON.stringify(net)).not.toContain("=KEY");
  });
});
