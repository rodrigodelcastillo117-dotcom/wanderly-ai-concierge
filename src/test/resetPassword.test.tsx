import React from "react";
import { render, screen, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { vi, beforeEach } from "vitest";

// supabase.auth simulado: guardamos los listeners para poder emitir eventos.
const listeners: Array<(e: string, s: any) => void> = [];
let currentSession: any = null;
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      onAuthStateChange: (cb: any) => {
        listeners.push(cb);
        return { data: { subscription: { unsubscribe: () => listeners.splice(listeners.indexOf(cb), 1) } } };
      },
      getSession: async () => ({ data: { session: currentSession } }),
      updateUser: async () => ({ error: null }),
      resetPasswordForEmail: async () => ({ error: null }),
      signOut: async () => ({}),
    },
  },
}));
vi.mock("@/lib/sentry", () => ({ setSentryUser: () => {} }));
vi.mock("@/lib/analytics", () => ({ identifyUser: () => {}, resetAnalytics: () => {}, track: () => {} }));
vi.mock("framer-motion", () => {
  const strip = (p: any) => { const { initial, animate, exit, transition, ...r } = p; return r; };
  // Cacheamos un componente por etiqueta: si no, cada render crea un tipo nuevo y React remonta el árbol.
  const cache: Record<string, any> = {};
  const motion = new Proxy({}, { get: (_t, tag: string) => (cache[tag] ??= (p: any) => React.createElement(tag, strip(p))) });
  return { motion, AnimatePresence: ({ children }: any) => <>{children}</> };
});

import { AuthProvider } from "@/contexts/AuthContext";
import ResetPassword from "@/pages/ResetPassword";
import { markRecovery, parseRecoveryUrl, sessionIsRecovery } from "@/lib/passwordRecovery";

const b64url = (o: any) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const jwt = (payload: any) => `${b64url({ alg: "HS256" })}.${b64url(payload)}.sig`;
const sessionWith = (amr: any[]) => ({ access_token: jwt({ sub: "u1", amr }), user: { id: "u1", email: "a@b.c" } });

const renderPage = () =>
  render(
    <MemoryRouter>
      <AuthProvider>
        <ResetPassword />
      </AuthProvider>
    </MemoryRouter>,
  );

beforeEach(() => {
  sessionStorage.clear();
  listeners.length = 0;
  currentSession = null;
  window.history.replaceState(null, "", "/reset-password");
});

it("PASSWORD_RECOVERY emitido antes de montar la página (chunk lento) habilita el formulario", async () => {
  currentSession = sessionWith([{ method: "password", timestamp: 1 }]);
  // AuthProvider ya montado (bundle inicial); la página "llega tarde".
  const { rerender } = render(<MemoryRouter><AuthProvider><div /></AuthProvider></MemoryRouter>);
  await act(async () => { listeners.forEach((l) => l("PASSWORD_RECOVERY", currentSession)); });
  rerender(<MemoryRouter><AuthProvider><ResetPassword /></AuthProvider></MemoryRouter>);
  const btn = await screen.findByRole("button", { name: "Actualizar contraseña" });
  expect(btn).toBeEnabled();
  expect(sessionStorage.getItem("iatos_pw_recovery_v1")).not.toBeNull();
});

it("tras recargar (sin hash, sin evento) sigue funcionando si la bandera de la pestaña y la sesión existen", async () => {
  markRecovery();
  currentSession = sessionWith([{ method: "password", timestamp: 1 }]);
  renderPage();
  expect(await screen.findByRole("button", { name: "Actualizar contraseña" })).toBeEnabled();
  expect(screen.getByLabelText("Contraseña")).toHaveAttribute("autocomplete", "new-password");
});

it("reconoce una sesión de recuperación por el claim amr aunque no haya bandera", async () => {
  currentSession = sessionWith([{ method: "recovery", timestamp: 1 }]);
  renderPage();
  expect(await screen.findByRole("button", { name: "Actualizar contraseña" })).toBeEnabled();
});

it("enlace expirado (#error=access_denied&error_code=otp_expired) muestra mensaje claro y botón para pedir otro", async () => {
  window.history.replaceState(null, "", "/reset-password#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid");
  renderPage();
  expect(await screen.findByText(/El enlace expiró o ya se usó; pide uno nuevo/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Pedir un enlace nuevo" })).toBeEnabled();
  expect(screen.queryByRole("button", { name: "Actualizar contraseña" })).toBeNull();
});

it("un usuario con sesión normal (sin enlace de recuperación) no ve el formulario de cambio", async () => {
  currentSession = sessionWith([{ method: "password", timestamp: 1 }]);
  renderPage();
  expect(await screen.findByText(/Abre el enlace que te enviamos/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Actualizar contraseña" })).toBeNull();
});

it("parseRecoveryUrl lee hash y query; sessionIsRecovery decodifica amr", () => {
  expect(parseRecoveryUrl("https://x/reset-password#access_token=a&type=recovery").isRecovery).toBe(true);
  expect(parseRecoveryUrl("https://x/reset-password?error=access_denied&error_code=otp_expired").error?.code).toBe("otp_expired");
  expect(sessionIsRecovery(sessionWith(["recovery"]) as any)).toBe(true);
  expect(sessionIsRecovery(sessionWith([{ method: "otp" }]) as any)).toBe(false);
  expect(sessionIsRecovery(null)).toBe(false);
});
