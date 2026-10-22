import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { vi, it, expect, beforeEach, describe } from "vitest";

// Privé y la sesión de IATOS: el token del enlace sale de la URL antes que nada, y cerrar sesión
// borra la sesión Privé (y la cierra en el servidor, mejor esfuerzo).
const sb = vi.hoisted(() => ({
  session: null as unknown,
  listener: null as null | ((event: string, session: unknown) => void),
  invoke: vi.fn(async () => ({ data: { ok: true }, error: null })),
  signOut: vi.fn(async () => ({})),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: sb.session }, error: null }),
      onAuthStateChange: (cb: (event: string, session: unknown) => void) => { sb.listener = cb; return { data: { subscription: { unsubscribe: () => {} } } }; },
      signOut: sb.signOut,
    },
    functions: { invoke: sb.invoke },
  },
}));
vi.mock("@/lib/sentry", () => ({ setSentryUser: () => {} }));
vi.mock("@/lib/analytics", () => ({ identifyUser: () => {}, resetAnalytics: () => {}, track: () => {} }));
vi.mock("@/hooks/useOnboardingStatus", () => ({
  useOnboardingStatus: () => ({ status: { completed_onboarding: true }, isLoading: false }),
}));

import { PRIVE_INVITE_TOKEN_KEY, PRIVE_SESSION_KEY } from "@/lib/priveSession";

const TOKEN = "invTOKEN_0123456789abcdefXYZ";
const SESSION = { access_token: "a", refresh_token: "r", user: { id: "u1", email: "ana@example.test" } };
const savePrive = () =>
  sessionStorage.setItem(PRIVE_SESSION_KEY, JSON.stringify({ token: "pv_tok_0123456789", expiresAt: new Date(Date.now() + 3600e3).toISOString(), userId: "u1" }));

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  sb.session = null;
  sb.invoke.mockClear();
  sb.signOut.mockClear();
});

describe("token de la invitación al arrancar la app", () => {
  it("AuthContext lo quita de la URL al cargarse (antes que router, analítica o login)", async () => {
    window.history.replaceState(null, "", `/prive/invitacion#t=${TOKEN}`);
    vi.resetModules();
    await import("@/contexts/AuthContext");
    expect(window.location.hash).toBe("");
    expect(window.location.pathname).toBe("/prive/invitacion");
    expect(sessionStorage.getItem(PRIVE_INVITE_TOKEN_KEY)).toBe(TOKEN);
  });

  it("sin sesión de IATOS va a /auth y el 'from' no lleva el token", async () => {
    window.history.replaceState(null, "", `/prive/invitacion#t=${TOKEN}`);
    vi.resetModules();
    const { AuthProvider } = await import("@/contexts/AuthContext");
    const { ProtectedRoute } = await import("@/components/ProtectedRoute");
    let from: { pathname?: string } | null = null;
    function AuthPage() {
      from = (useLocation().state as { from?: { pathname?: string } } | null)?.from ?? null;
      return <p>LOGIN</p>;
    }
    render(
      <MemoryRouter initialEntries={[window.location.pathname + window.location.hash]}>
        <AuthProvider>
          <Routes>
            <Route path="/auth" element={<AuthPage />} />
            <Route path="/prive/invitacion" element={<ProtectedRoute><p>INVITACION</p></ProtectedRoute>} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByText("LOGIN")).toBeInTheDocument();
    expect(from.pathname).toBe("/prive/invitacion");
    expect(JSON.stringify(from)).not.toContain(TOKEN);
    expect(sessionStorage.getItem(PRIVE_INVITE_TOKEN_KEY)).toBe(TOKEN);
  });
});

describe("cerrar sesión borra la sesión Privé", () => {
  it("signOut(): borra el token local y lo cierra en el servidor", async () => {
    vi.resetModules();
    const { AuthProvider, useAuth } = await import("@/contexts/AuthContext");
    sb.session = SESSION;
    savePrive();
    sessionStorage.setItem(PRIVE_INVITE_TOKEN_KEY, TOKEN);
    function Btn() {
      const { user, signOut } = useAuth();
      return user ? <button onClick={() => void signOut()}>salir</button> : <p>fuera</p>;
    }
    render(<MemoryRouter><AuthProvider><Btn /></AuthProvider></MemoryRouter>);
    fireEvent.click(await screen.findByRole("button", { name: "salir" }));
    await waitFor(() => expect(sb.signOut).toHaveBeenCalled());
    expect(sessionStorage.getItem(PRIVE_SESSION_KEY)).toBeNull();
    expect(sessionStorage.getItem(PRIVE_INVITE_TOKEN_KEY)).toBeNull();
    expect(sb.invoke).toHaveBeenCalledWith("prive-access", { body: { action: "lock", prive_session: "pv_tok_0123456789" } });
  });

  it("SIGNED_OUT desde otra pestaña o por token vencido también la borra", async () => {
    vi.resetModules();
    const { AuthProvider } = await import("@/contexts/AuthContext");
    sb.session = SESSION;
    savePrive();
    render(<MemoryRouter><AuthProvider><p>app</p></AuthProvider></MemoryRouter>);
    await waitFor(() => expect(sb.listener).not.toBeNull());
    sb.listener!("SIGNED_OUT", null);
    expect(sessionStorage.getItem(PRIVE_SESSION_KEY)).toBeNull();
  });
});
