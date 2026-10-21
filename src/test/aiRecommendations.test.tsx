import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

const invoke = vi.fn();
const getUser = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    auth: { getUser: () => getUser(), signOut: vi.fn() },
  },
}));
// Objeto nuevo en cada render, como un contexto que se re-crea: el hook no debe re-pedir.
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));

import { useAIRecommendations, __resetRecommendationsCache } from "@/hooks/useAIRecommendations";

const destinations = [{ name: "Hokkaido", country: "Japón", score: 92, reason: "nieve", image_query: "hokkaido" }];

describe("useAIRecommendations", () => {
  beforeEach(() => {
    __resetRecommendationsCache();
    invoke.mockReset();
    getUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
  });

  it("shares one request between pages and reuses it on remount", async () => {
    invoke.mockResolvedValue({ data: { destinations }, error: null });
    const a = renderHook(() => useAIRecommendations());
    const b = renderHook(() => useAIRecommendations());
    await waitFor(() => expect(a.result.current.recos).toEqual(destinations));
    await waitFor(() => expect(b.result.current.recos).toEqual(destinations));
    const c = renderHook(() => useAIRecommendations());
    expect(c.result.current.recos).toEqual(destinations);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("shows a friendly message when rate limited", async () => {
    const err = Object.assign(new Error("Edge Function returned a non-2xx status code"), {
      context: new Response("{}", { status: 429 }),
    });
    invoke.mockResolvedValue({ data: null, error: err });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(() => useAIRecommendations());
    await waitFor(() => expect(result.current.error).toMatch(/Intenta de nuevo en unos minutos/));
    expect(spy).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("refresh bypasses the cache", async () => {
    invoke.mockResolvedValue({ data: { destinations }, error: null });
    const { result } = renderHook(() => useAIRecommendations());
    await waitFor(() => expect(result.current.recos).toEqual(destinations));
    await result.current.refresh();
    expect(invoke).toHaveBeenLastCalledWith("recomendar-destinos", { body: { refresh: true } });
    expect(invoke).toHaveBeenCalledTimes(2);
  });
});
