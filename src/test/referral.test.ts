import { describe, it, expect, beforeEach, vi } from "vitest";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));

import { captureReferral, pendingReferral, claimPendingReferral } from "@/lib/referral";

describe("referral attribution", () => {
  beforeEach(() => { localStorage.clear(); rpc.mockReset(); });

  it("stores a valid invite code from ?ref=, uppercased", () => {
    captureReferral("?ref=ab12cd34");
    expect(pendingReferral()).toBe("AB12CD34");
  });

  it("ignores missing or malformed codes", () => {
    captureReferral("?utm=x");
    captureReferral("?ref=<script>");
    expect(pendingReferral()).toBeNull();
  });

  it("expires codes older than 30 days", () => {
    localStorage.setItem("iatos_ref", JSON.stringify({ code: "AB12CD34", at: Date.now() - 31 * 86_400_000 }));
    expect(pendingReferral()).toBeNull();
  });

  it("claims once and clears the stored code on success", async () => {
    captureReferral("?ref=AB12CD34");
    rpc.mockResolvedValue({ data: true, error: null });
    await claimPendingReferral();
    expect(rpc).toHaveBeenCalledWith("claim_referral", { p_code: "AB12CD34" });
    expect(pendingReferral()).toBeNull();
  });

  it("T-P2-1: el enlace manda una solicitud de amistad (agregar_amigo_por_codigo), no crea la amistad", async () => {
    captureReferral("?ref=AB12CD34");
    rpc.mockResolvedValue({ data: { ok: true, estado: "pendiente" }, error: null });
    await claimPendingReferral();
    expect(rpc).toHaveBeenCalledWith("agregar_amigo_por_codigo", { p_codigo: "AB12CD34" });
    // Ninguna escritura directa a friendships: solo RPC.
    expect(rpc.mock.calls.map((c) => c[0])).toEqual(["claim_referral", "agregar_amigo_por_codigo"]);
  });

  it("si la atribución falla no se manda la solicitud (se reintenta después)", async () => {
    captureReferral("?ref=AB12CD34");
    rpc.mockResolvedValue({ data: null, error: { message: "network" } });
    await claimPendingReferral();
    expect(rpc).not.toHaveBeenCalledWith("agregar_amigo_por_codigo", expect.anything());
  });

  it("keeps the code to retry when the request fails", async () => {
    captureReferral("?ref=AB12CD34");
    rpc.mockResolvedValue({ data: null, error: { message: "network" } });
    await claimPendingReferral();
    expect(pendingReferral()).toBe("AB12CD34");
  });

  it("does nothing without a pending code", async () => {
    await claimPendingReferral();
    expect(rpc).not.toHaveBeenCalled();
  });
});
