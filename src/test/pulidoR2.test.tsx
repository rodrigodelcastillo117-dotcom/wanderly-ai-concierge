// Ronda 2 de la auditoría de cuenta y técnica en producción (29-oct-2026), sección 3 (P2). Cada prueba
// nombra el número del defecto y falla con el código anterior a esta rama (claude/fix-pulido-r2).
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/integrations/supabase/client", () => {
  const api: any = { select: () => api, eq: () => api, maybeSingle: async () => ({ data: null, error: null }) };
  return {
    supabase: {
      from: () => api, rpc: async () => ({ data: null, error: null }),
      functions: { invoke: vi.fn(async () => ({ data: null, error: null })) },
      auth: { signInWithOAuth: vi.fn(async () => ({ error: null })), resetPasswordForEmail: async () => ({ error: null }) },
    },
  };
});
const auth = vi.hoisted(() => ({ value: { user: null as any, signIn: vi.fn(async () => ({ error: { message: "Invalid login credentials" } })), signUp: vi.fn(async () => ({ error: null as any })), signOut: vi.fn() } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth.value }));
vi.mock("@/lib/referral", () => ({ claimPendingReferral: async () => {} }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
vi.mock("@/lib/analytics", () => ({ track: () => {}, initAnalytics: vi.fn(), optOutAnalytics: vi.fn() }));

import Auth from "@/pages/Auth";
import { CookieBanner, bottomBarOffset } from "@/components/CookieBanner";
import { Ayuda, Terminos } from "@/pages/Legal";
import { DNA_LABELS } from "@/lib/social";
import { iatoMarkHtml, shell, para, SERIF } from "../../supabase/functions/_shared/email-kit";
import { userConfirmedEmail } from "../../supabase/functions/_shared/ai-reservations/templates";

const src = (p: string) => readFileSync(p, "utf8");

beforeEach(() => {
  localStorage.clear();
  toast.error.mockClear();
  auth.value.signUp.mockClear();
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("P2-1 · el aviso de cookies no tapa 'Empezar gratis' ni la barra inferior", () => {
  it("se coloca encima de la barra inferior fija (el relleno del body no mueve elementos fijos)", () => {
    vi.stubGlobal("innerHeight", 844);
    const nav = document.createElement("nav");
    nav.setAttribute("data-bottom-nav", "");
    document.body.appendChild(nav);
    vi.spyOn(nav, "getBoundingClientRect").mockReturnValue({ top: 766, bottom: 844, height: 78, width: 390, left: 0, right: 390, x: 0, y: 766, toJSON: () => ({}) } as DOMRect);
    expect(bottomBarOffset()).toBe(78);
    render(<MemoryRouter><CookieBanner /></MemoryRouter>);
    const box = screen.getByTestId("cookie-banner");
    expect(box.style.bottom).toBe("78px");
    // Sin barra (landing, escritorio): pegado abajo y respetando la zona segura del iPhone.
    nav.remove();
    expect(bottomBarOffset()).toBe(0);
  });

  it("una barra oculta (lg:hidden en escritorio) no cuenta", () => {
    const nav = document.createElement("nav");
    nav.setAttribute("data-bottom-nav", "");
    document.body.appendChild(nav);
    vi.spyOn(nav, "getBoundingClientRect").mockReturnValue({ top: 0, bottom: 0, height: 0, width: 0, left: 0, right: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
    expect(bottomBarOffset()).toBe(0);
    nav.remove();
  });

  it("en el celular usa un texto corto y la barra del panel está marcada para medirla", () => {
    render(<MemoryRouter><CookieBanner /></MemoryRouter>);
    const short = screen.getByTestId("cookie-text-short").textContent ?? "";
    expect(short.length).toBeLessThan(170);
    expect(short).toMatch(/PostHog/);
    expect(src("src/components/DashboardLayout.tsx")).toMatch(/aria-label="Navegación principal" data-bottom-nav=""/);
  });

  it("P2-4 · el enlace del aviso es descriptivo y subrayado (no 'Más información')", () => {
    render(<MemoryRouter><CookieBanner /></MemoryRouter>);
    const link = screen.getByRole("link", { name: "Política de Cookies" });
    expect(link).toHaveAttribute("href", "/cookies");
    expect(link.className).toMatch(/\bunderline\b/);
    expect(screen.queryByText("Más información")).toBeNull();
  });
});

describe("P2-2 · /auth y registro: un solo mensaje por error", () => {
  it("contraseña incorrecta: el mensaje sale en línea y NO también como aviso", async () => {
    render(<MemoryRouter initialEntries={["/auth"]}><Auth /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText(/correo/i), { target: { value: "ana@example.test" } });
    fireEvent.change(screen.getByLabelText(/contraseña/i), { target: { value: "malamala1" } });
    fireEvent.click(screen.getByRole("button", { name: "Iniciar sesión" }));
    expect(await screen.findByTestId("auth-login-error")).toHaveTextContent("Correo o contraseña incorrectos");
    expect(toast.error).not.toHaveBeenCalled();
    expect(screen.getAllByText(/Correo o contraseña incorrectos/)).toHaveLength(1);
  });

  it("registro sin casilla: un solo mensaje (en línea), sin aviso emergente", async () => {
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    render(<MemoryRouter initialEntries={["/auth?mode=signup"]}><Auth /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText("Nombre completo"), { target: { value: "Ana" } });
    fireEvent.change(screen.getByLabelText(/correo/i), { target: { value: "ana@example.test" } });
    fireEvent.change(screen.getByLabelText(/^contraseña/i), { target: { value: "unaclave-larga-2026" } });
    fireEvent.click(screen.getByRole("button", { name: "Crear cuenta" }));
    expect(await screen.findByText(/marca la casilla de Términos/)).toBeInTheDocument();
    expect(toast.error).not.toHaveBeenCalled();
    expect(auth.value.signUp).not.toHaveBeenCalled();
  });

  it("registro: contraseña corta y error del servidor también salen una sola vez, en línea", async () => {
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    render(<MemoryRouter initialEntries={["/auth?mode=signup"]}><Auth /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText("Nombre completo"), { target: { value: "Ana" } });
    fireEvent.change(screen.getByLabelText(/correo/i), { target: { value: "ana@example.test" } });
    fireEvent.change(screen.getByLabelText(/^contraseña/i), { target: { value: "corta" } });
    fireEvent.click(screen.getByRole("button", { name: "Crear cuenta" }));
    expect(await screen.findByTestId("auth-signup-error")).toHaveTextContent("al menos 8 caracteres");
    expect(toast.error).not.toHaveBeenCalled();

    auth.value.signUp.mockResolvedValueOnce({ error: "User already registered" });
    fireEvent.change(screen.getByLabelText(/^contraseña/i), { target: { value: "unaclave-larga-2026" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Crear cuenta" }));
    await waitFor(() => expect(auth.value.signUp).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId("auth-signup-error")).not.toHaveTextContent("al menos 8 caracteres"));
    expect(toast.error).not.toHaveBeenCalled();
  });
});

/** Cada "Iato" visible está dentro de la marca con serifa (data-iato-mark), nunca suelto en la sans. */
function bareIato(root: HTMLElement): string[] {
  const out: string[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!/\bIato\b/.test(n.textContent ?? "")) continue;
    if (!(n.parentElement?.closest("[data-iato-mark]"))) out.push((n.textContent ?? "").trim().slice(0, 60));
  }
  return out;
}

describe("P2-3 · \"Iato\" ya no se lee \"lato\"", () => {
  it("/ayuda y Términos: todos los \"Iato\" van con la serifa de marca", () => {
    const { container, unmount } = render(<MemoryRouter initialEntries={["/ayuda"]}><Ayuda /></MemoryRouter>);
    expect(container.querySelectorAll("[data-iato-mark]").length).toBeGreaterThanOrEqual(3);
    expect(bareIato(container)).toEqual([]);
    expect(container.textContent).toMatch(/Le dices a Iato, tu concierge/);
    unmount();
    const t = render(<MemoryRouter><Terminos /></MemoryRouter>);
    expect(bareIato(t.container)).toEqual([]);
  });

  it("Equipaje en español y con la marca; landing y pantallas de alto tráfico con la marca", () => {
    const packing = src("src/pages/TripPacking.tsx");
    expect(packing).not.toMatch(/Iato Packing/i);
    expect(packing).toMatch(/Equipaje con Iato/);
    expect(packing).toMatch(/Generar lista con <IatoName \/>/);
    expect(src("src/pages/Landing.tsx")).toMatch(/\{withIatoMark\(f\)\}/);
    for (const f of ["src/pages/Onboarding.tsx", "src/components/plan/PlanTripDialog.tsx", "src/components/reservas/AskIatoTable.tsx", "src/pages/Favoritos.tsx", "src/pages/Benefits.tsx"]) {
      expect(src(f), f).toMatch(/<IatoName \/>/);
    }
  });

  it("correos: \"Iato\" del pie y de los párrafos sans va en la serifa; el texto plano no cambia", () => {
    expect(iatoMarkHtml('Pediste a Iato. <a href="https://x.test/Iato">ver</a>')).toBe(
      `Pediste a <span style="font-family:${SERIF};font-size:1.15em;">Iato</span>. <a href="https://x.test/Iato">ver</a>`);
    expect(iatoMarkHtml("Iatos e Iatomar no se tocan")).toBe("Iatos e Iatomar no se tocan");
    const html = shell({ title: "t", preheader: "p", body: [para("Hola, soy Iato.")], reason: "Recibes este correo porque pediste a Iato que escribiera a un restaurante." });
    expect(html).toContain(`pediste a <span style="font-family:${SERIF};font-size:1.15em;">Iato</span> que escribiera`);
    expect(html).toContain(`soy <span style="font-family:${SERIF};font-size:1.15em;">Iato</span>.`);
    // Un correo real (reserva confirmada): el pie lleva la marca y el texto plano sigue igual.
    const m = userConfirmedEmail({ ref_code: "R-ABC234", venue_name: "Casa Oaxaca", requested_local: "2026-11-03T20:30", party_size: 2, customer_name: "Ana López",
      venue_address: "Constitución 104", venue_city: "Oaxaca", venue_place_id: "ChIJ_x", requested_for: "2026-11-04T02:30:00Z", confirmation_code: "MX-4821",
      quote: "Confirmado", receivedAt: "2 nov", icsUrl: null, appUrl: "https://app.test" } as any);
    expect(m.html).toMatch(/pediste a <span style="font-family:[^"]+;font-size:1\.15em;">Iato<\/span> que escribiera/);
    expect(m.text).toMatch(/pediste a Iato que escribiera/);
  });
});

describe("P2-6 · Beneficios sin \"(JSON)\" · P2-7 · /onboarding/deep en español", () => {
  it("el botón de descarga no muestra el formato técnico", () => {
    const b = src("src/pages/Benefits.tsx");
    expect(b).not.toMatch(/\(JSON\)/);
    expect(b).toMatch(/Descargar una copia de mis documentos y tarjetas/);
  });
  it("\"Slow Travel\" ahora es \"Viaje pausado\" (también en la etiqueta que ven tus amigos)", () => {
    const d = src("src/pages/OnboardingDeep.tsx");
    expect(d).not.toMatch(/Slow Travel/i);
    expect(d).toMatch(/\{ id: "slow", label: "Viaje pausado"/);
    expect(DNA_LABELS.ritmo.slow.label).toBe("Viaje pausado");
  });
});

void act;
