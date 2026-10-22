import { describe, expect, it, vi } from "vitest";
import { scrubCapture, scrubSentryEvent, scrubText, stripPii } from "@/lib/piiScrub";

describe("telemetría sin PII (F-18)", () => {
  it("quita correo, nombre, teléfono y tokens de las propiedades", () => {
    expect(stripPii({ email: "a@b.mx", full_name: "Ana", phone: "555", provider: "aviasales", nested: { token: "x", ok: 1 } }))
      .toEqual({ provider: "aviasales", nested: { ok: 1 } });
  });

  it("tapa correos y tokens dentro de textos (incluido el hash de Supabase)", () => {
    expect(scrubText("fallo para ana@gmail.com")).toBe("fallo para [correo]");
    expect(scrubText("https://app/#access_token=eyJabc.def.ghi&refresh_token=r1")).toBe("https://app/#access_token=[oculto]&refresh_token=[oculto]");
  });

  it("Sentry: solo id del usuario, sin headers/cookies/cuerpo, mensajes limpios", () => {
    const out = scrubSentryEvent({
      user: { id: "u1", email: "a@b.mx", ip_address: "1.2.3.4" },
      request: { url: "https://x/?token=abc", headers: { Authorization: "Bearer zzz" }, cookies: "sb=1", data: { password: "x" } },
      message: "No se pudo con a@b.mx",
      exception: { values: [{ value: "Error para a@b.mx" }] },
      breadcrumbs: [{ message: "login a@b.mx", data: { email: "a@b.mx", page: "/auth" } }],
    });
    expect(out.user).toEqual({ id: "u1" });
    expect(out.request).toEqual({ url: "https://x/?token=[oculto]" });
    expect(JSON.stringify(out)).not.toContain("a@b.mx");
    expect(out.breadcrumbs?.[0].data).toEqual({ page: "/auth" });
  });

  it("PostHog before_send limpia propiedades y $set", () => {
    const out = scrubCapture({ properties: { email: "a@b.mx", $current_url: "https://x/#access_token=t" }, $set: { email: "a@b.mx", plan: "pro" } });
    expect(out.properties).toEqual({ $current_url: "https://x/#access_token=[oculto]" });
    expect(out.$set).toEqual({ plan: "pro" });
  });
});

describe("AuthContext / analytics no mandan el correo", () => {
  it("identifyUser recibe solo el id y quita PII si alguien pasa props", async () => {
    vi.resetModules();
    const identify = vi.fn();
    vi.doMock("posthog-js", () => ({ default: { init: vi.fn(), identify, capture: vi.fn(), opt_in_capturing: vi.fn() } }));
    vi.stubEnv("VITE_POSTHOG_KEY", "phc_test");
    const a = await import("@/lib/analytics");
    a.initAnalytics();
    a.identifyUser("u1", { email: "a@b.mx", plan: "pro" });
    expect(identify).toHaveBeenCalledWith("u1", { plan: "pro" });
    vi.unstubAllEnvs();
    vi.doUnmock("posthog-js");
  });

  it("el código de AuthContext ya no pasa email a Sentry ni PostHog", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/contexts/AuthContext.tsx", "utf8");
    expect(src).not.toMatch(/identifyUser\([^)]*email/);
    expect(src).not.toMatch(/setSentryUser\([^)]*email/);
  });
});
