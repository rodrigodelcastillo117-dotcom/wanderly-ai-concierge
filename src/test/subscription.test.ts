import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

const rpcMock = vi.fn();
const fromMock = vi.fn();
const invokeMock = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...a: unknown[]) => rpcMock(...a),
    from: (...a: unknown[]) => fromMock(...a),
    functions: { invoke: (...a: unknown[]) => invokeMock(...a) },
  },
}));

const TEST_USER = { id: "user-1", email: "a@b.mx" };
const TEST_SESSION = {};
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: TEST_USER, session: TEST_SESSION, loading: false }),
}));

vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

import { useSubscription, SUBSCRIPTION_TIMEOUT_MS } from "@/hooks/useSubscription";

function mockTables(subscription: Record<string, unknown> | null) {
  fromMock.mockImplementation(() => ({
    select: () => ({
      eq: () => ({
        maybeSingle: async () => ({ data: subscription, error: null }),
        order: () => ({ limit: () => ({ maybeSingle: async () => ({ data: subscription, error: null }) }) }),
      }),
    }),
  }));
}

describe("checkout / membresía", () => {
  beforeEach(() => {
    rpcMock.mockReset();
    fromMock.mockReset();
    invokeMock.mockReset();
  });

  it("usuario sin suscripción no es PRO", async () => {
    rpcMock.mockResolvedValue({ data: { is_pro: false, concierge_remaining: 3, trips_remaining: 1 }, error: null });
    mockTables(null);
    const { result } = renderHook(() => useSubscription());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.isPro).toBe(false);
  });

  it("usuario en trial es PRO", async () => {
    rpcMock.mockResolvedValue({ data: { is_pro: true, concierge_remaining: 0, trips_remaining: 0 }, error: null });
    mockTables({ status: "trialing", trial_end: new Date(Date.now() + 86400000 * 10).toISOString() });
    const { result } = renderHook(() => useSubscription());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.isPro).toBe(true);
    expect(result.current.isTrialing).toBe(true);
  });

  it("startCheckout falla claro si el backend no devuelve URL", async () => {
    rpcMock.mockResolvedValue({ data: { is_pro: false }, error: null });
    mockTables(null);
    invokeMock.mockResolvedValue({ data: { message: "Stripe no configurado" }, error: null });
    const { result } = renderHook(() => useSubscription());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await expect(result.current.startCheckout()).rejects.toThrow(/Stripe no configurado/);
  });
});

// N-02: la tarjeta de estado de /dashboard/pro se quedaba girando para siempre.
describe("useSubscription: el 'cargando' siempre termina", () => {
  beforeEach(() => {
    rpcMock.mockReset();
    fromMock.mockReset();
    vi.useRealTimers();
  });

  it("si la consulta falla (rechazo), termina con error y sin adivinar 'gratis'", async () => {
    rpcMock.mockRejectedValue(new Error("Failed to fetch"));
    mockTables(null);
    const { result } = renderHook(() => useSubscription());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toMatch(/No pudimos cargar/);
    expect(result.current.access).toBeNull();
  });

  it("si get_access_state devuelve error, también termina con error", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "boom" } });
    mockTables(null);
    const { result } = renderHook(() => useSubscription());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toMatch(/No pudimos cargar/);
  });

  it("si el servidor no contesta, deja de esperar tras el tiempo límite", async () => {
    vi.useFakeTimers();
    rpcMock.mockReturnValue(new Promise(() => {}));
    mockTables(null);
    const { result } = renderHook(() => useSubscription());
    expect(result.current.loading).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(SUBSCRIPTION_TIMEOUT_MS + 10); });
    expect(result.current.loading).toBe(false);
    expect(result.current.error).not.toBeNull();
    vi.useRealTimers();
  });

  it("Reintentar vuelve a consultar y muestra el estado", async () => {
    rpcMock.mockRejectedValueOnce(new Error("Failed to fetch"));
    rpcMock.mockResolvedValue({ data: { is_pro: true }, error: null });
    mockTables({ status: "comped" });
    const { result } = renderHook(() => useSubscription());
    await waitFor(() => expect(result.current.error).not.toBeNull());
    await act(async () => { await result.current.refresh(); });
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.isComped).toBe(true);
  });

  it("una respuesta vieja que llega tarde no pisa la más reciente ni deja 'cargando'", async () => {
    let resolveOld: (v: unknown) => void = () => {};
    rpcMock.mockReturnValueOnce(new Promise((r) => { resolveOld = r; }));
    rpcMock.mockResolvedValue({ data: { is_pro: true }, error: null });
    mockTables(null);
    const { result } = renderHook(() => useSubscription());
    await act(async () => { await result.current.refresh(); });
    expect(result.current.isPro).toBe(true);
    await act(async () => { resolveOld({ data: { is_pro: false }, error: null }); });
    expect(result.current.isPro).toBe(true);
    expect(result.current.loading).toBe(false);
  });
});
