import { describe, it, expect, vi } from "vitest";
import { runQuota, quotaDeniedResponse, paywallResponse } from "../../supabase/functions/_shared/quota";

const ok = (data: unknown) => vi.fn(async () => ({ data, error: null }));
const fail = () => vi.fn(async () => ({ data: null, error: { message: "function consume_free_quota does not exist" } }));

describe("cuota gratuita (consume_free_quota)", () => {
  it("devuelve lo que responde la base", async () => {
    const rpc = ok({ allowed: false, reason: "quota_exceeded", remaining: 0 });
    expect(await runQuota(rpc, "u1", "trip_analysis")).toEqual({ allowed: false, reason: "quota_exceeded", remaining: 0 });
    expect(rpc).toHaveBeenCalledWith("u1", "trip_analysis");
  });

  it("trip_analysis falla CERRADO si la verificación truena (antes regalaba análisis)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await runQuota(fail(), "u1", "trip_analysis")).toEqual({ allowed: false, reason: "error", remaining: null });
    const throws = vi.fn(async () => { throw new Error("network"); });
    expect((await runQuota(throws, "u1", "trip_analysis")).allowed).toBe(false);
    expect((await runQuota(ok(null), "u1", "trip_analysis")).allowed).toBe(false);
  });

  it("concierge sigue abierto por omisión pero se puede cerrar con failClosed", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await runQuota(fail(), "u1", "concierge")).allowed).toBe(true);
    expect((await runQuota(fail(), "u1", "concierge", { failClosed: true })).allowed).toBe(false);
  });

  it("negada por error de verificación responde 503 con mensaje claro, no el paywall", async () => {
    const r = quotaDeniedResponse({ allowed: false, reason: "error", remaining: null }, "trip_analysis");
    expect(r.status).toBe(503);
    const body = await r.json();
    expect(body.error).toBe("quota_check_failed");
    expect(body.message).toMatch(/No pudimos verificar tu plan/);
  });

  it("cuota agotada responde 402 con upgrade_url", async () => {
    const r = quotaDeniedResponse({ allowed: false, reason: "quota_exceeded", remaining: 0 }, "trip_analysis");
    expect(r.status).toBe(402);
    expect(await r.json()).toMatchObject({ error: "upgrade_required", kind: "trip_analysis", upgrade_url: "/dashboard/pro" });
    expect((await paywallResponse("concierge").json()).message).toMatch(/3 mensajes gratis/);
  });
});
