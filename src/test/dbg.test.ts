import { describe, it, expect, vi } from "vitest";
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  rpc: async () => ({ data: { is_pro: false }, error: null }),
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
  functions: { invoke: async () => ({ data: null, error: null }) },
}}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u" } }) }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
import { renderHook, waitFor } from "@testing-library/react";
import { useSubscription } from "@/hooks/useSubscription";
describe("d", () => { it("x", async () => {
  const { result } = renderHook(() => useSubscription());
  await new Promise(r => setTimeout(r, 300));
  console.log("STATE", result.current.loading, JSON.stringify(result.current.access));
  expect(1).toBe(1);
});});
