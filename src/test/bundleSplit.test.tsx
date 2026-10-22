import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// E-23 / IATOS-103: lo pesado y opcional no va en el paquete inicial.
const root = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("paquete inicial", () => {
  it("PostHog y Sentry se cargan con import() (no con import estático)", () => {
    expect(read("src/lib/analytics.ts")).not.toMatch(/^import\s+posthog/m);
    expect(read("src/lib/analytics.ts")).toMatch(/import\("posthog-js"\)/);
    expect(read("src/lib/sentry.ts")).not.toMatch(/^import\s+\*\s+as\s+Sentry/m);
    expect(read("src/lib/sentry.ts")).toMatch(/import\("@sentry\/react"\)/);
    expect(read("src/components/AppErrorBoundary.tsx")).not.toMatch(/from "@sentry\/react"/);
  });
  it("la landing y el inicio no usan framer-motion; el PDF y Smart Spend se cargan al usarse", () => {
    expect(read("src/pages/Landing.tsx")).not.toMatch(/from "framer-motion"/);
    expect(read("src/pages/DashboardHome.tsx")).not.toMatch(/from "framer-motion"/);
    expect(read("src/pages/TripDetail.tsx")).not.toMatch(/^import .*lib\/tripPdf/m);
    expect(read("src/pages/Gastos.tsx")).not.toMatch(/^import SmartSpendPanel/m);
  });
  it("index.html abre la conexión con Supabase desde el inicio", () => {
    expect(read("index.html")).toMatch(/<link rel="preconnect" href="%VITE_SUPABASE_URL%" crossorigin/);
  });
});

describe("analytics perezoso", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

  it("los eventos que llegan mientras PostHog se descarga se envían al cargar; sin consentimiento, nada", async () => {
    vi.stubEnv("VITE_POSTHOG_KEY", "phc_test");
    vi.resetModules();
    const a = await import("@/lib/analytics");
    const ph = { init: vi.fn(), capture: vi.fn(), identify: vi.fn(), reset: vi.fn(), opt_in_capturing: vi.fn(), opt_out_capturing: vi.fn() };
    a.track("login"); // antes de aceptar: se descarta
    let resolve!: (m: any) => void;
    a.initAnalytics(() => new Promise((r) => { resolve = r; }));
    a.identifyUser("u1");
    a.track("signup", { method: "password" });
    expect(ph.capture).not.toHaveBeenCalled();
    resolve({ default: ph });
    await new Promise((r) => setTimeout(r, 0));
    expect(ph.init).toHaveBeenCalledTimes(1);
    expect(ph.identify).toHaveBeenCalledWith("u1", undefined);
    expect(ph.capture).toHaveBeenCalledTimes(1);
    expect(ph.capture).toHaveBeenCalledWith("signup", { method: "password" });
  });

  it("si rechaza mientras se descarga, PostHog no se inicia", async () => {
    vi.stubEnv("VITE_POSTHOG_KEY", "phc_test");
    vi.resetModules();
    const a = await import("@/lib/analytics");
    const ph = { init: vi.fn(), capture: vi.fn() };
    let resolve!: (m: any) => void;
    a.initAnalytics(() => new Promise((r) => { resolve = r; }));
    a.optOutAnalytics();
    resolve({ default: ph });
    await new Promise((r) => setTimeout(r, 0));
    expect(ph.init).not.toHaveBeenCalled();
  });
});

describe("AppErrorBoundary (sin Sentry en el paquete inicial)", () => {
  it("un error de render muestra la pantalla de recuperación", async () => {
    const { AppErrorBoundary } = await import("@/components/AppErrorBoundary");
    const Boom = () => { throw new Error("boom"); };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<AppErrorBoundary><Boom /></AppErrorBoundary>);
    expect(screen.getByRole("heading", { name: "Algo no cargó bien" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Recargar" })).toBeInTheDocument();
    spy.mockRestore();
  });
});
