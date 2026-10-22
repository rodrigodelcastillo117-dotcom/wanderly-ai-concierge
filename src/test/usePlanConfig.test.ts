import { describe, it, expect, vi, beforeEach } from "vitest";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));

import { loadTrialMode, __resetTrialMode } from "@/hooks/usePlanConfig";

describe("loadTrialMode", () => {
  beforeEach(() => { __resetTrialMode(); rpc.mockReset(); });

  it("uses the no-card copy only when the server says the flag is on", async () => {
    rpc.mockResolvedValue({ data: { trial_no_card_enabled: true }, error: null });
    expect(await loadTrialMode()).toBe("no_card");
  });

  it("falls back to the card trial when the flag is off, the function is missing or the call fails", async () => {
    rpc.mockResolvedValue({ data: { trial_no_card_enabled: false }, error: null });
    expect(await loadTrialMode()).toBe("card");
    __resetTrialMode();
    rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "function not found" } });
    expect(await loadTrialMode()).toBe("card");
    __resetTrialMode();
    rpc.mockRejectedValue(new Error("network"));
    expect(await loadTrialMode()).toBe("card");
  });

  it("asks the server only once per session", async () => {
    rpc.mockResolvedValue({ data: { trial_no_card_enabled: true }, error: null });
    await Promise.all([loadTrialMode(), loadTrialMode(), loadTrialMode()]);
    await loadTrialMode();
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});

describe("loadTrialMode robustness", () => {
  it("falls back to the card copy when the client throws synchronously", async () => {
    __resetTrialMode();
    rpc.mockImplementation(() => { throw new TypeError("rpc is not a function"); });
    expect(await loadTrialMode()).toBe("card");
  });
});
