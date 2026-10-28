import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { vi, it, expect, beforeEach } from "vitest";
import { readFileSync } from "fs";
import path from "path";

const analytics = vi.hoisted(() => ({ initAnalytics: vi.fn(), optOutAnalytics: vi.fn() }));
vi.mock("@/lib/analytics", () => analytics);

import { CookieBanner } from "@/components/CookieBanner";
import { applyConsent } from "@/lib/consent";

const tpScript = () => document.head.querySelector('script[data-iatos="travelpayouts"]');

beforeEach(() => {
  localStorage.clear();
  analytics.initAnalytics.mockClear();
  analytics.optOutAnalytics.mockClear();
  tpScript()?.remove();
});

it("sin elección: al arrancar no se inicia PostHog ni se carga Travelpayouts", () => {
  applyConsent();
  expect(analytics.initAnalytics).not.toHaveBeenCalled();
  expect(tpScript()).toBeNull();
});

it("index.html ya no carga Travelpayouts antes del consentimiento ni bloquea el zoom", () => {
  const html = readFileSync(path.resolve(__dirname, "../../index.html"), "utf8");
  expect(html).not.toMatch(/<script>[\s\S]*tp-em\.com/);
  expect(html).not.toMatch(/user-scalable\s*=\s*no/);
  expect(html).not.toMatch(/maximum-scale\s*=\s*1/);
});

it("'Solo esenciales' no carga nada; 'Aceptar' carga PostHog y Travelpayouts", () => {
  // Con Travelpayouts Drive activado por el dueño (VITE_TRAVELPAYOUTS_DRIVE_ENABLED=true, ver consent.ts).
  vi.stubEnv("VITE_TRAVELPAYOUTS_DRIVE_ENABLED", "true");
  const { unmount } = render(<MemoryRouter><CookieBanner /></MemoryRouter>);
  fireEvent.click(screen.getByRole("button", { name: "Solo esenciales" }));
  expect(analytics.initAnalytics).not.toHaveBeenCalled();
  expect(tpScript()).toBeNull();
  expect(screen.queryByRole("button", { name: "Aceptar" })).toBeNull();
  unmount();

  localStorage.clear();
  render(<MemoryRouter><CookieBanner /></MemoryRouter>);
  fireEvent.click(screen.getByRole("button", { name: "Aceptar" }));
  expect(analytics.initAnalytics).toHaveBeenCalledTimes(1);
  expect(tpScript()).not.toBeNull();
  // En la siguiente visita se respeta la elección sin volver a mostrar el aviso.
  applyConsent();
  expect(analytics.initAnalytics).toHaveBeenCalledTimes(2);
  expect(document.head.querySelectorAll('script[data-iatos="travelpayouts"]').length).toBe(1);
  vi.unstubAllEnvs();
});
