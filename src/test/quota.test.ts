import { describe, it, expect, vi } from "vitest";
import {
  runQuota, quotaDeniedResponse, paywallResponse, freeLimitBody, unauthenticatedResponse, nextMonthStartIso,
} from "../../supabase/functions/_shared/quota";

const ok = (data: unknown) => vi.fn(async () => ({ data, error: null }));
const fail = () => vi.fn(async () => ({ data: null, error: { message: "function consume_free_quota does not exist" } }));

describe("verificación de cuota (consume_free_quota / reserve_quota)", () => {
  it("devuelve lo que responde la base, con los datos del límite", async () => {
    const rpc = ok({ allowed: false, reason: "quota_exceeded", remaining: 0, limit: 3, used: 3, renews_at: "2026-11-01T00:00:00+00:00", quota: "concierge_monthly" });
    expect(await runQuota(rpc, "u1", "concierge")).toMatchObject({ allowed: false, reason: "quota_exceeded", limit: 3, used: 3 });
  });

  it("trip_analysis falla CERRADO si la verificación truena", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await runQuota(fail(), "u1", "trip_analysis")).toEqual({ allowed: false, reason: "error", remaining: null });
    expect((await runQuota(vi.fn(async () => { throw new Error("network"); }), "u1", "trip_analysis")).allowed).toBe(false);
    expect((await runQuota(ok(null), "u1", "trip_analysis")).allowed).toBe(false);
    expect((await runQuota(fail(), "u1", "concierge", { failClosed: true })).allowed).toBe(false);
  });
});

describe("IATOS-P1-FREE-01: contrato FREE_LIMIT_REACHED", () => {
  const NOW = new Date("2026-10-22T15:00:00Z");

  it("(3) primer mensaje tras el límite: 402 con solo campos seguros y fecha de renovación", async () => {
    const r = quotaDeniedResponse({ allowed: false, reason: "quota_exceeded", remaining: 0, limit: 3, used: 3,
      renews_at: "2026-11-01T00:00:00+00:00", quota: "concierge_monthly", upgrade_available: true }, "concierge");
    expect(r.status).toBe(402);
    const body = await r.json();
    expect(Object.keys(body).sort()).toEqual(["code", "limit", "message", "quota", "renews_at", "upgrade_available", "used"]);
    expect(body).toMatchObject({ code: "FREE_LIMIT_REACHED", quota: "concierge_monthly", limit: 3, used: 3, upgrade_available: true });
    expect(body.message).toBe("Has utilizado tus mensajes gratuitos de Iato de este mes. Se renuevan el 1 de noviembre de 2026. " +
      "Puedes seguir usando las funciones gratuitas o activar IATOS PRO por $99 MXN al mes, sujeto a las condiciones vigentes.");
  });

  it("(4) análisis de una sola vez: renews_at null y nunca promete renovación", () => {
    const b = freeLimitBody("trip_analysis", { limit: 1, used: 1, renews_at: "2026-11-01T00:00:00Z" }, NOW);
    expect(b).toMatchObject({ quota: "trip_analysis_once", renews_at: null, limit: 1, used: 1, upgrade_available: true });
    expect(b.message).toMatch(/^Ya usaste tu análisis gratuito de viaje \(es de una sola vez\)/);
    expect(b.message).not.toMatch(/renuev/i);
  });

  it("sin datos de la base (migración pendiente) usa los límites gratuitos y el próximo mes", () => {
    expect(freeLimitBody("concierge", {}, NOW)).toMatchObject({ limit: 3, used: 3, renews_at: nextMonthStartIso(NOW) });
    expect(nextMonthStartIso(new Date("2026-12-31T23:00:00Z"))).toBe("2027-01-01T00:00:00.000Z");
  });

  it("límite de un plan de pago: sin oferta de PRO", () => {
    const b = freeLimitBody("concierge", { quota: "concierge_monthly", limit: 100, used: 100, renews_at: "2026-11-01T00:00:00Z", upgrade_available: false });
    expect(b.upgrade_available).toBe(false);
    expect(b.message).toBe("Llegaste al límite mensual de tu plan; se renueva el 1 de noviembre de 2026.");
    expect(b.message).not.toMatch(/IATOS PRO/);
  });

  it("límite mensual de análisis de PRO (pro_limits_enforced): conserva la renovación y no ofrece PRO", () => {
    const b = freeLimitBody("trip_analysis", { quota: "trip_analysis_monthly", limit: 10, used: 10, renews_at: "2026-11-01T00:00:00Z", upgrade_available: false });
    expect(b).toMatchObject({ quota: "trip_analysis_monthly", renews_at: "2026-11-01T00:00:00Z", upgrade_available: false });
    expect(b.message).toBe("Llegaste al límite mensual de tu plan; se renueva el 1 de noviembre de 2026.");
  });

  it("(9) fallo técnico al verificar: 503 SERVICE_UNAVAILABLE, sin campos de upgrade", async () => {
    const r = quotaDeniedResponse({ allowed: false, reason: "error", remaining: null }, "trip_analysis");
    expect(r.status).toBe(503);
    const body = await r.json();
    expect(body.code).toBe("SERVICE_UNAVAILABLE");
    expect(body).not.toHaveProperty("upgrade_available");
    expect(body.message).not.toMatch(/PRO/);
  });

  it("petición repetida en curso: 409 ANALYSIS_IN_PROGRESS; sesión inválida: 401 UNAUTHENTICATED", async () => {
    const r = quotaDeniedResponse({ allowed: false, reason: "in_progress", remaining: null }, "trip_analysis");
    expect(r.status).toBe(409);
    expect((await r.json()).code).toBe("ANALYSIS_IN_PROGRESS");
    const u = unauthenticatedResponse();
    expect(u.status).toBe(401);
    expect((await u.json()).code).toBe("UNAUTHENTICATED");
  });

  it("paywallResponse (compatibilidad) ya responde con el contrato nuevo", async () => {
    expect(await paywallResponse("trip_analysis").json()).toMatchObject({ code: "FREE_LIMIT_REACHED", quota: "trip_analysis_once" });
  });
});
