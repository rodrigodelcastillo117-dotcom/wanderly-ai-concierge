import { describe, expect, it } from "vitest";
import {
  clientIp,
  evaluateRateLimit,
  isPaidBucket,
  rateLimitBody,
  type HitFn,
} from "../../supabase/functions/_shared/rate-limit-core";

const headers = (h: Record<string, string>) => ({ get: (k: string) => h[k.toLowerCase()] ?? null });

describe("clientIp (F-07)", () => {
  it("no usa el primer X-Forwarded-For, que lo escribe el cliente", () => {
    expect(clientIp(headers({ "x-forwarded-for": "1.2.3.4, 198.51.100.7" }))).toBe("198.51.100.7");
  });
  it("prefiere cf-connecting-ip y luego x-real-ip", () => {
    expect(clientIp(headers({ "cf-connecting-ip": "203.0.113.5", "x-real-ip": "198.51.100.1", "x-forwarded-for": "1.2.3.4" })))
      .toBe("203.0.113.5");
    expect(clientIp(headers({ "x-real-ip": "198.51.100.1", "x-forwarded-for": "1.2.3.4" }))).toBe("198.51.100.1");
  });
  it("acepta IPv6 y descarta basura", () => {
    expect(clientIp(headers({ "cf-connecting-ip": "2001:db8::1" }))).toBe("2001:db8::1");
    expect(clientIp(headers({ "cf-connecting-ip": "<script>", "x-forwarded-for": "no-es-ip" }))).toBe("unknown");
    expect(clientIp(headers({}))).toBe("unknown");
  });
});

describe("evaluateRateLimit", () => {
  const calls: string[] = [];
  const always = (v: boolean | null): HitFn => async (subject, bucket) => { calls.push(`${subject}|${bucket}`); return v; };

  it("permite cuando todo cabe y revisa usuario (minuto, hora) e IP", async () => {
    calls.length = 0;
    const v = await evaluateRateLimit(always(true), "flights-search", "u1", "203.0.113.5");
    expect(v.allowed).toBe(true);
    expect(calls).toEqual(["user:u1|flights-search:m", "user:u1|flights-search:h", "ip:203.0.113.5|flights-search:m"]);
  });

  it("niega con 429 cuando se pasa del límite", async () => {
    const v = await evaluateRateLimit(always(false), "pexels-image", "u1", "unknown");
    expect(v).toMatchObject({ allowed: false, scope: "user", retryAfter: 60 });
    expect(rateLimitBody(v).status).toBe(429);
  });

  it("falla CERRADO en cubetas de pago si la base no responde", async () => {
    expect(isPaidBucket("concierge-chat")).toBe(true);
    const v = await evaluateRateLimit(always(null), "concierge-chat", "u1", "203.0.113.5");
    expect(v).toMatchObject({ allowed: false, scope: "unavailable" });
    const r = rateLimitBody(v);
    expect(r.status).toBe(503);
    expect(r.body.code).toBe("SERVICE_UNAVAILABLE");
  });

  it("falla ABIERTO en cubetas baratas si la base no responde", async () => {
    expect(isPaidBucket("pexels-image")).toBe(false);
    expect(isPaidBucket("delete-account")).toBe(false);
    expect((await evaluateRateLimit(always(null), "pexels-image", "u1", "203.0.113.5")).allowed).toBe(true);
    expect((await evaluateRateLimit(always(null), "delete-account", "u1", "unknown")).allowed).toBe(true);
  });

  it("todas las funciones con SerpApi, IA, Google o correo están en la lista de pago", () => {
    for (const b of ["analizar-viaje", "serpapi-quote", "hotels-search", "logistics-plan", "generate-avatar",
      "places-search", "place-photo", "get-routes", "send-email", "enviar-email-fixer", "share-trip-notify"]) {
      expect(isPaidBucket(b), b).toBe(true);
    }
  });
});
