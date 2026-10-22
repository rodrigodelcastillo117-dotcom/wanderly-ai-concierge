import { describe, it, expect, vi } from "vitest";
import { runChecks, allOk, needsAttention, SERPAPI_LOW } from "../../supabase/functions/health-check/checks";

const keys = {
  geminiKey: "g", lovableKey: "l", anthropicKey: "a", serpKey: "s", travelpayoutsToken: "t", stripeKey: "sk",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function fakeFetch(over: Record<string, () => Response> = {}) {
  return vi.fn(async (url: string) => {
    for (const [part, make] of Object.entries(over)) if (url.includes(part)) return make();
    if (url.includes("serpapi")) return json({ total_searches_left: 4000 });
    if (url.includes("stripe")) return json({ livemode: true });
    return json({ ok: true });
  }) as unknown as typeof fetch;
}

describe("health checks", () => {
  it("passes when every service answers", async () => {
    const r = await runChecks(keys, fakeFetch());
    expect(r).toHaveLength(6);
    expect(allOk(r)).toBe(true);
    expect(needsAttention(r)).toBe(false);
    expect(r.find((x) => x.name.includes("SerpApi"))?.detail).toMatch(/4,000 búsquedas/);
  });

  it("flags a down service and a missing key as failures", async () => {
    const r = await runChecks({ ...keys, stripeKey: undefined }, fakeFetch({ generativelanguage: () => json({}, 500) }));
    expect(allOk(r)).toBe(false);
    expect(r.find((x) => x.name.includes("Gemini"))).toMatchObject({ ok: false, detail: expect.stringMatching(/^HTTP 500/) });
    expect(r.find((x) => x.name.includes("Stripe"))).toMatchObject({ ok: false, detail: "Falta STRIPE_SECRET_KEY" });
  });

  it("warns, without failing, on test-mode Stripe, low SerpApi quota and no Lovable balance", async () => {
    const r = await runChecks(keys, fakeFetch({
      stripe: () => json({ livemode: false }),
      serpapi: () => json({ total_searches_left: SERPAPI_LOW - 1 }),
      "ai.gateway.lovable": () => json({}, 402),
    }));
    expect(allOk(r)).toBe(true);
    expect(needsAttention(r)).toBe(true);
    expect(r.filter((x) => x.warn).map((x) => x.name)).toHaveLength(3);
  });

  it("fails SerpApi when the plan has no searches left", async () => {
    const r = await runChecks(keys, fakeFetch({ serpapi: () => json({ total_searches_left: 0 }) }));
    expect(r.find((x) => x.name.includes("SerpApi"))?.ok).toBe(false);
  });
});
