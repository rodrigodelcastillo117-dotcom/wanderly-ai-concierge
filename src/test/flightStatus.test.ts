import { describe, it, expect, vi, afterEach } from "vitest";
import { normalizeFlightWidget, querySerpApi } from "../../supabase/functions/flight-status/serpapi";

const widget = (status = "SCHEDULED", delay = 0) => ({ dates: [{ date: "2026-10-17",
  metadata: { status, departure_delay: delay, origin: "MEX", destination: "CDG" },
  departure_airport: { scheduled_time: "2026-10-17T19:40:00-06:00", time: "2026-10-17T20:05:00-06:00", gate: "-", terminal: "1" },
}] });

describe("Google flight status", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("maps the requested date, local departure times and terminal without inventing a gate", () => {
    expect(normalizeFlightWidget(widget(), "2026-10-17")).toMatchObject({ status: "a tiempo", scheduled_departure: "19:40", estimated_departure: "20:05", terminal: "1", gate: undefined, origin: "MEX", destination: "CDG" });
  });
  it("never returns another day's status", () => {
    expect(normalizeFlightWidget(widget(), "2026-10-18")).toBeNull();
  });
  it("maps positive departure delays to retrasado", () => {
    expect(normalizeFlightWidget(widget("SCHEDULED", 25), "2026-10-17")).toMatchObject({ status: "retrasado", delay_minutes: 25 });
  });
  it.each([["ARRIVED_DELAYED", "aterrizado"], ["DEPARTED_DELAYED", "en vuelo"], ["CANCELLED", "cancelado"], ["BOARDING", "abordando"]])("maps %s to %s", (code, status) => {
    expect(normalizeFlightWidget(widget(code, 15), "2026-10-17")?.status).toBe(status);
  });
  it("does not treat early departure as a delay", () => {
    expect(normalizeFlightWidget(widget("SCHEDULED", -3), "2026-10-17")?.delay_minutes).toBe(0);
  });
  it("handles date-keyed widgets and missing widgets", () => {
    expect(normalizeFlightWidget({ dates: { "2026-10-17": widget().dates[0] } }, "2026-10-17")?.status).toBe("a tiempo");
    expect(normalizeFlightWidget(undefined, "2026-10-17")).toBeNull();
  });
  it("uses the generic Google engine and marks structured results as SerpApi", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ flight_result: widget() }) });
    vi.stubGlobal("fetch", fetchMock);
    const result = await querySerpApi("test-key", "AF179", "2026-10-17");
    expect(new URL(fetchMock.mock.calls[0][0]).searchParams.get("engine")).toBe("google");
    expect(result?.data.fuente).toBe("serpapi");
  });
});