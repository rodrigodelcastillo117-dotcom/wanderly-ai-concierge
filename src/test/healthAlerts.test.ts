import { describe, it, expect, vi } from "vitest";
import {
  alertEmail, alertRecipients, alertSignature, cronPeriodMinutes, emailOutcome, jobHealth, shouldEmail, EXPECTED_JOBS,
  type CronHealth, type PreviousRun,
} from "../../supabase/functions/health-check/alerts";
import { runChecks, type CheckResult } from "../../supabase/functions/health-check/checks";
import { redactSecrets } from "../../supabase/functions/_shared/redact";
import { isHealthStale } from "@/lib/serviceHealth";

const now = new Date("2026-10-22T13:07:30Z");
const ago = (min: number) => new Date(now.getTime() - min * 60_000).toISOString();
const jobs = (over: Partial<Record<string, Partial<CronHealth["jobs"][number]>>> = {}): CronHealth => ({
  available: true,
  jobs: [
    { jobname: "flight-watch-every-15-min", schedule: "*/15 * * * *", active: true, last_start: ago(7), last_status: "succeeded", ...over["flight-watch-every-15-min"] },
    { jobname: "price-watch-twice-daily", schedule: "17 3,15 * * *", active: true, last_start: ago(590), last_status: "succeeded", ...over["price-watch-twice-daily"] },
    { jobname: "health-check-daily", schedule: "7 13 * * *", active: true, last_start: ago(0), last_status: "running", ...over["health-check-daily"] },
  ],
  http: { window_hours: 6, total: 24, failed: 0, last_failure: null },
});

describe("cron period parsing", () => {
  it.each([
    ["*/15 * * * *", 15], ["17 3,15 * * *", 720], ["7 13 * * *", 1440], ["0 */4 * * *", 240], ["5,35 * * * *", 30], ["0 9 * * 1", 10080],
  ])("%s → %i min", (expr, min) => expect(cronPeriodMinutes(expr)).toBe(min));
});

describe("job health (C-12)", () => {
  it("is green when the three jobs ran within 2× their period and calls answer 2xx", () => {
    const r = jobHealth(jobs(), null, now);
    expect(r.ok).toBe(true);
    expect(r.warn).toBeUndefined();
    expect(r.detail).toBe("3 tareas al día");
  });

  it("fails when a job did not run in 2× its period", () => {
    const r = jobHealth(jobs({ "flight-watch-every-15-min": { last_start: ago(45) } }), null, now);
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/flight-watch-every-15-min no corre desde hace 1 h/);
  });

  it("fails when the last run failed or a job is missing", () => {
    expect(jobHealth(jobs({ "price-watch-twice-daily": { last_status: "failed", last_message: "ERROR: boom" } }), null, now).detail)
      .toMatch(/price-watch-twice-daily falló en su última corrida \(ERROR: boom\)/);
    const missing = { ...jobs(), jobs: jobs().jobs.filter((j) => j.jobname !== "health-check-daily") };
    expect(jobHealth(missing, null, now)).toMatchObject({ ok: false, detail: expect.stringMatching(/health-check-daily/) });
    expect(EXPECTED_JOBS).toHaveLength(3);
  });

  it("fails when every scheduled HTTP call failed (e.g. 401 each run), warns on a few", () => {
    expect(jobHealth({ ...jobs(), http: { window_hours: 6, total: 24, failed: 24, last_failure: "HTTP 401" } }, null, now))
      .toMatchObject({ ok: false, detail: expect.stringMatching(/24 de 24 llamadas .* \(última: HTTP 401\)/) });
    expect(jobHealth({ ...jobs(), http: { window_hours: 6, total: 24, failed: 1, last_failure: "timeout" } }, null, now))
      .toMatchObject({ ok: true, warn: expect.stringMatching(/1 de 24/) });
  });

  it("warns (does not fail) when the RPC is missing or pg_cron is unavailable", () => {
    expect(jobHealth(null, "function public.cron_health() does not exist", now)).toMatchObject({ ok: true, warn: expect.any(String) });
    expect(jobHealth({ available: false, jobs: [], http: null }, null, now)).toMatchObject({ ok: true, warn: expect.any(String) });
  });
});

const fail = (name: string): CheckResult => ({ name, ok: false, detail: "HTTP 500", ms: 1 });
const warn = (name: string, text = "ojo"): CheckResult => ({ name, ok: true, warn: text, ms: 1 });
const good = (name: string): CheckResult => ({ name, ok: true, ms: 1 });
const prev = (daysAgo: number, results: CheckResult[], email_status: string | null): PreviousRun =>
  ({ ran_at: new Date(now.getTime() - daysAgo * 86_400_000).toISOString(), results, email_status });

describe("when to email (C-12: no daily emails for the same warning)", () => {
  const stripeTest = warn("Pagos (Stripe)", "Stripe está en modo de prueba");

  it("does not email when everything is fine", () => {
    expect(shouldEmail([good("A")], [], now)).toEqual({ send: false, status: "not_needed" });
  });

  it("emails the first time something needs attention", () => {
    expect(shouldEmail([stripeTest], [], now)).toEqual({ send: true, reason: "first" });
  });

  it("skips a persistent, unchanged warning until a weekly reminder", () => {
    const history = [prev(1, [stripeTest], "skipped_unchanged"), prev(2, [stripeTest], "sent")];
    expect(shouldEmail([stripeTest], history, now)).toEqual({ send: false, status: "skipped_unchanged" });
    const weekOld = [prev(1, [stripeTest], "skipped_unchanged"), prev(7, [stripeTest], "sent")];
    expect(shouldEmail([stripeTest], weekOld, now)).toEqual({ send: true, reason: "reminder" });
  });

  it("emails when the set of failing/warning checks changes, ignoring detail text that changes daily", () => {
    const history = [prev(1, [stripeTest], "sent")];
    expect(shouldEmail([stripeTest, fail("IA (Gemini)")], history, now)).toEqual({ send: true, reason: "changed" });
    const serp = (n: number) => warn("SerpApi", `Quedan pocas búsquedas: ${n}`);
    expect(shouldEmail([serp(150)], [prev(1, [serp(180)], "sent")], now)).toEqual({ send: false, status: "skipped_unchanged" });
    expect(alertSignature([serp(1), fail("X"), good("Y")])).toBe("SerpApi:warn|X:fail");
  });

  it("retries the next day if the last email failed to send", () => {
    expect(shouldEmail([stripeTest], [prev(1, [stripeTest], "failed")], now)).toEqual({ send: true, reason: "first" });
  });
});

describe("recipients and email content (C-11, C-13)", () => {
  it("uses HEALTH_ALERT_EMAIL when set (the address Resend accepts), else the admins", () => {
    expect(alertRecipients("Dueno@Example.com", ["a@x.com", "b@y.com"])).toEqual(["dueno@example.com"]);
    expect(alertRecipients("uno@x.com, dos@y.com", [])).toEqual(["uno@x.com", "dos@y.com"]);
    expect(alertRecipients(undefined, ["a@x.com", "A@x.com", "no-es-correo"])).toEqual(["a@x.com"]);
    expect(alertRecipients("", [])).toEqual([]);
  });

  it("summarises the send outcome for health_checks.email_status", () => {
    expect(emailOutcome([])).toEqual({ status: "no_recipient", error: null });
    expect(emailOutcome([{ ok: true }])).toEqual({ status: "sent", error: null });
    expect(emailOutcome([{ ok: true }, { ok: false, error: "You can only send testing emails to your own email address" }]))
      .toMatchObject({ status: "partial" });
    expect(emailOutcome([{ ok: false, error: "resend_403" }])).toEqual({ status: "failed", error: "resend_403" });
  });

  it("escapes HTML and strips secrets from the email", () => {
    const { subject, html } = alertEmail([{ name: "<b>X</b>", ok: false, detail: "fallo en https://serpapi.com/account.json?api_key=SECRET", ms: 1 }], "changed");
    expect(subject).toBe("IATOS: un servicio está fallando");
    expect(html).toContain("&lt;b&gt;X&lt;/b&gt;");
    expect(html).not.toContain("SECRET");
    expect(alertEmail([warn("A")], "reminder").subject).toMatch(/^Recordatorio/);
  });
});

describe("secret redaction (C-13)", () => {
  it("removes api keys and tokens from URLs and bearer headers", () => {
    expect(redactSecrets("error sending request for url (https://serpapi.com/account.json?api_key=abc123)"))
      .toBe("error sending request for url (https://serpapi.com/account.json?api_key=***)");
    expect(redactSecrets("GET /v1/prices/cheap?origin=MEX&token=tp_secret&currency=usd")).toBe("GET /v1/prices/cheap?origin=MEX&token=***&currency=usd");
    expect(redactSecrets("Authorization: Bearer sk_live_1234567890abcdef")).not.toContain("1234567890");
    expect(redactSecrets(undefined)).toBeUndefined();
  });

  it("runChecks never stores the key from a network error that includes the URL", async () => {
    const f = vi.fn(async (url: string) => {
      if (url.includes("serpapi")) throw new TypeError(`error sending request for url (${url})`);
      if (url.includes("stripe")) return new Response(JSON.stringify({ livemode: true }));
      return new Response("{}");
    }) as unknown as typeof fetch;
    const r = await runChecks({ geminiKey: "g", lovableKey: "l", anthropicKey: "a", serpKey: "SERP_SECRET_KEY", travelpayoutsToken: "TP_TOKEN", stripeKey: "sk" }, f);
    expect(JSON.stringify(r)).not.toContain("SERP_SECRET_KEY");
    expect(r.find((x) => x.name.includes("SerpApi"))).toMatchObject({ ok: false, detail: expect.stringContaining("api_key=***") });
    // El token de Travelpayouts ya no va en la URL.
    const tpCall = (f as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls.find(([u]) => u.includes("travelpayouts"))!;
    expect(tpCall[0]).not.toContain("TP_TOKEN");
    expect((tpCall[1].headers as Record<string, string>)["X-Access-Token"]).toBe("TP_TOKEN");
  });
});

describe("admin card staleness (C-12)", () => {
  it("flags a last check older than 26 h", () => {
    const t = new Date("2026-10-22T15:00:00Z");
    expect(isHealthStale("2026-10-21T13:07:00Z", t)).toBe(false);
    expect(isHealthStale("2026-10-21T12:59:00Z", t)).toBe(true);
    expect(isHealthStale(null, t)).toBe(false);
  });
});

describe("chequeo de IA en palabras (sin JSON crudo)", () => {
  it("Gemini saturado (503) es AVISO porque Iato usa Claude; nunca pega el JSON del proveedor", async () => {
    const { runChecks } = await import("../../supabase/functions/health-check/checks");
    const f = (async (url: string) => {
      if (url.includes("generativelanguage")) return new Response(JSON.stringify([{ error: { code: 503, message: "This model is currently experiencing high demand." } }]), { status: 503 });
      return new Response(JSON.stringify({ total_searches_left: 5000 }), { status: 200 });
    }) as unknown as typeof fetch;
    const res = await runChecks({ geminiKey: "g", lovableKey: "l", anthropicKey: "a" } as any, f);
    const gem = res.find((r) => r.name === "IA de respaldo (Gemini)")!;
    expect(gem.ok).toBe(true);
    expect(gem.warn).toMatch(/saturado/);
    expect(gem.warn).toMatch(/Claude/);
    expect(JSON.stringify(res)).not.toMatch(/high demand|"code"/);
  });
});
