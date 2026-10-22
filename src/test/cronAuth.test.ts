import { describe, it, expect, vi } from "vitest";
import { checkCronAuth, looksLikeServiceKey, safeEqual, type CronAuthDeps } from "../../supabase/functions/_shared/cron-auth-core";

const SECRET = "s".repeat(40);
const SERVICE = "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.c2lnbmF0dXJlLXZhbHVl";
const deps = (over: Partial<CronAuthDeps> = {}, env: Record<string, string> = {}): CronAuthDeps => ({
  env: (k) => env[k],
  probeServiceKey: vi.fn(async () => false),
  verifyVaultSecret: vi.fn(async () => false),
  ...over,
});
const req = (h: Record<string, string>) => new Headers(h);

describe("cron auth (C-14): fails closed", () => {
  it("rejects a request with no credentials, even with nothing configured", async () => {
    expect(await checkCronAuth(req({}), deps())).toBe(false);
    expect(await checkCronAuth(req({}), deps({}, { CRON_SECRET: SECRET, SUPABASE_SERVICE_ROLE_KEY: SERVICE }))).toBe(false);
  });

  it("an empty CRON_SECRET never matches an empty header", async () => {
    expect(await checkCronAuth(req({ "x-cron-secret": "" }), deps({}, { CRON_SECRET: "" }))).toBe(false);
  });

  it("rejects a wrong secret and accepts the configured one", async () => {
    const d = deps({}, { CRON_SECRET: SECRET });
    expect(await checkCronAuth(req({ "x-cron-secret": "x".repeat(40) }), d)).toBe(false);
    expect(await checkCronAuth(req({ "x-cron-secret": SECRET }), d)).toBe(true);
    expect(await checkCronAuth(req({ "x-cron-key": SECRET }), d)).toBe(true);
  });

  it("accepts the exact service-role bearer", async () => {
    expect(await checkCronAuth(req({ authorization: `Bearer ${SERVICE}` }), deps({}, { SUPABASE_SERVICE_ROLE_KEY: SERVICE }))).toBe(true);
  });

  it("only probes Auth for bearers shaped like a service key", async () => {
    const probe = vi.fn(async () => true);
    expect(await checkCronAuth(req({ authorization: "Bearer hola" }), deps({ probeServiceKey: probe }))).toBe(false);
    expect(probe).not.toHaveBeenCalled();
    expect(await checkCronAuth(req({ authorization: `Bearer ${SERVICE}` }), deps({ probeServiceKey: probe }))).toBe(true);
  });

  it("a user JWT (probe says no) is rejected; a probe that throws is rejected", async () => {
    expect(await checkCronAuth(req({ authorization: `Bearer ${SERVICE}` }), deps({ probeServiceKey: async () => false }))).toBe(false);
    expect(await checkCronAuth(req({ authorization: `Bearer ${SERVICE}` }), deps({ probeServiceKey: async () => { throw new Error("x"); } }))).toBe(false);
  });

  it("checks the Vault secret in the database: true → ok, false/throws → rejected", async () => {
    const env = { SUPABASE_SERVICE_ROLE_KEY: SERVICE };
    expect(await checkCronAuth(req({ "x-cron-secret": SECRET }), deps({ verifyVaultSecret: async () => true }, env))).toBe(true);
    expect(await checkCronAuth(req({ "x-cron-secret": SECRET }), deps({ verifyVaultSecret: async () => false }, env))).toBe(false);
    expect(await checkCronAuth(req({ "x-cron-secret": SECRET }), deps({ verifyVaultSecret: async () => { throw new Error("rpc"); } }, env))).toBe(false);
  });

  it("does not call the database for short secrets (Vault secrets are 64 chars)", async () => {
    const verify = vi.fn(async () => true);
    expect(await checkCronAuth(req({ "x-cron-secret": "corto" }), deps({ verifyVaultSecret: verify }, { SUPABASE_SERVICE_ROLE_KEY: SERVICE }))).toBe(false);
    expect(verify).not.toHaveBeenCalled();
  });

  it("compares in constant time and recognises key shapes", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(safeEqual("", "")).toBe(false);
    expect(looksLikeServiceKey(SERVICE)).toBe(true);
    expect(looksLikeServiceKey("sb_secret_abcdefghijkl")).toBe(true);
    expect(looksLikeServiceKey("random-token")).toBe(false);
  });
});
