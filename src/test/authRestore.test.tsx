import { render, screen, act, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { vi, it, expect, beforeEach, afterEach, describe } from "vitest";

// E-09: una sesión que tarda en recuperarse no debe verse como "sesión cerrada".
type GetSessionResult = { data: { session: any }; error: any };
const auth = vi.hoisted(() => ({
  getSession: vi.fn<() => Promise<GetSessionResult>>(),
  listener: null as null | ((event: string, session: any) => void),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: () => auth.getSession(),
      onAuthStateChange: (cb: any) => { auth.listener = cb; return { data: { subscription: { unsubscribe: () => {} } } }; },
      signOut: async () => ({}),
    },
  },
}));
vi.mock("@/lib/sentry", () => ({ setSentryUser: () => {} }));
vi.mock("@/lib/analytics", () => ({ identifyUser: () => {}, resetAnalytics: () => {}, track: () => {} }));
vi.mock("@/hooks/useOnboardingStatus", () => ({
  useOnboardingStatus: () => ({ status: { completed_onboarding: true }, isLoading: false }),
}));

import { AuthProvider } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { hasStoredSession, isRetryableAuthError, restoreOutcome } from "@/lib/authRestore";

const SESSION = { access_token: "a", refresh_token: "r", user: { id: "u1", email: "ana@example.test" } };
const storeSession = () => localStorage.setItem("sb-proj-auth-token", JSON.stringify({ access_token: "a", refresh_token: "r" }));

function deferred<T>() {
  let resolve!: (v: T) => void; let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const renderApp = () =>
  render(
    <MemoryRouter initialEntries={["/dashboard/viajes/123"]}>
      <AuthProvider>
        <Routes>
          <Route path="/auth" element={<p>PANTALLA LOGIN</p>} />
          <Route path="/dashboard/viajes/:id" element={<ProtectedRoute><p>DETALLE DEL VIAJE</p></ProtectedRoute>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  auth.getSession.mockReset();
  auth.listener = null;
});
afterEach(() => vi.useRealTimers());

it("sesión guardada + getSession lento (8 s): muestra 'Recuperando tu sesión…' y NO manda a /auth", async () => {
  storeSession();
  const slow = deferred<GetSessionResult>();
  auth.getSession.mockReturnValue(slow.promise);
  renderApp();

  await act(async () => { vi.advanceTimersByTime(5000); });
  expect(screen.queryByText("PANTALLA LOGIN")).toBeNull();
  expect(screen.getByText("Recuperando tu sesión…")).toBeInTheDocument();

  await act(async () => { vi.advanceTimersByTime(3000); slow.resolve({ data: { session: SESSION }, error: null }); });
  expect(screen.getByText("DETALLE DEL VIAJE")).toBeInTheDocument();
  expect(screen.queryByText("PANTALLA LOGIN")).toBeNull();
});

it("error de red con sesión guardada: reintenta (botón 'Reintentar ahora') y entra al responder", async () => {
  storeSession();
  const netErr = { name: "AuthRetryableFetchError", status: 0, message: "Failed to fetch" };
  auth.getSession
    .mockResolvedValueOnce({ data: { session: null }, error: netErr })
    .mockResolvedValueOnce({ data: { session: SESSION }, error: null });
  renderApp();
  await act(async () => { await Promise.resolve(); });
  expect(screen.getByText("Recuperando tu sesión…")).toBeInTheDocument();
  expect(screen.queryByText("PANTALLA LOGIN")).toBeNull();

  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Reintentar ahora" })); });
  expect(auth.getSession).toHaveBeenCalledTimes(2);
  expect(screen.getByText("DETALLE DEL VIAJE")).toBeInTheDocument();
});

it("INITIAL_SESSION vacío por la red no cierra la sesión guardada", async () => {
  storeSession();
  const slow = deferred<GetSessionResult>();
  auth.getSession.mockReturnValue(slow.promise);
  renderApp();
  await act(async () => { auth.listener?.("INITIAL_SESSION", null); });
  await act(async () => { vi.advanceTimersByTime(5000); });
  expect(screen.queryByText("PANTALLA LOGIN")).toBeNull();
  await act(async () => { slow.resolve({ data: { session: SESSION }, error: null }); });
  expect(screen.getByText("DETALLE DEL VIAJE")).toBeInTheDocument();
});

it("sin sesión guardada: a los 4.5 s sigue yendo a /auth (sin cambios)", async () => {
  auth.getSession.mockReturnValue(new Promise(() => {}));
  renderApp();
  await act(async () => { vi.advanceTimersByTime(4600); });
  expect(screen.getByText("PANTALLA LOGIN")).toBeInTheDocument();
});

it("Supabase confirma que la sesión ya no vale (SIGNED_OUT): sí va a /auth", async () => {
  storeSession();
  auth.getSession.mockReturnValue(new Promise(() => {}));
  renderApp();
  await act(async () => { vi.advanceTimersByTime(5000); });
  expect(screen.getByText("Recuperando tu sesión…")).toBeInTheDocument();
  await act(async () => { localStorage.clear(); auth.listener?.("SIGNED_OUT", null); });
  expect(screen.getByText("PANTALLA LOGIN")).toBeInTheDocument();
});

describe("authRestore (lógica pura)", () => {
  it("restoreOutcome", () => {
    expect(restoreOutcome({ hasSession: true, stored: false })).toBe("signed_in");
    expect(restoreOutcome({ hasSession: false, stored: false, thrown: true })).toBe("signed_out");
    expect(restoreOutcome({ hasSession: false, stored: true, thrown: true })).toBe("retry");
    expect(restoreOutcome({ hasSession: false, stored: true, error: { name: "AuthRetryableFetchError" } })).toBe("retry");
    // Error real de auth (refresh token inválido): sesión cerrada.
    expect(restoreOutcome({ hasSession: false, stored: true, error: { name: "AuthApiError", status: 400, message: "Invalid Refresh Token" } })).toBe("signed_out");
    expect(restoreOutcome({ hasSession: false, stored: true })).toBe("signed_out");
  });
  it("hasStoredSession / isRetryableAuthError", () => {
    expect(hasStoredSession()).toBe(false);
    storeSession();
    expect(hasStoredSession()).toBe(true);
    localStorage.setItem("sb-proj-auth-token", "{roto");
    expect(hasStoredSession()).toBe(false);
    expect(isRetryableAuthError({ message: "Failed to fetch" })).toBe(true);
    expect(isRetryableAuthError({ status: 400, message: "Invalid Refresh Token" })).toBe(false);
  });
});
