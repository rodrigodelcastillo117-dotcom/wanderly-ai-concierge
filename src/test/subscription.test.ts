import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

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

import { useSubscription } from "@/hooks/useSubscription";

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
