import { describe, it, expect, vi } from "vitest";
import { createPushSender, FLIGHT_PUSH_OPTIONS, vapidSubject, type PushDeps } from "../../supabase/functions/_shared/push-core";

const subs = [{ endpoint: "https://push/1", p256dh: "p", auth: "a" }, { endpoint: "https://push/2", p256dh: "p", auth: "a" }];
const deps = (env: Record<string, string>, over: Partial<PushDeps> = {}): PushDeps => ({
  env: (k) => env[k],
  setVapid: vi.fn(),
  send: vi.fn(async () => ({})),
  listSubscriptions: vi.fn(async () => subs),
  deleteSubscription: vi.fn(async () => {}),
  ...over,
});
const keys = { VAPID_PUBLIC_KEY: "pub", VAPID_PRIVATE_KEY: "priv" };
const payload = { title: "Vuelo AM58 actualizado", body: "Puerta asignada: B12", url: "/dashboard/viajes/t1" };

describe("web push (C-08)", () => {
  it("without VAPID keys it sends nothing and does not throw (in-app notifications still happen)", async () => {
    const d = deps({});
    const push = createPushSender(d);
    await expect(push("u1", payload)).resolves.toBe(0);
    expect(d.setVapid).not.toHaveBeenCalled();
    expect(d.send).not.toHaveBeenCalled();
  });

  it("invalid VAPID keys disable push instead of crashing", async () => {
    const d = deps(keys, { setVapid: vi.fn(() => { throw new Error("Vapid public key should be 65 bytes"); }) });
    await expect(createPushSender(d)("u1", payload)).resolves.toBe(0);
  });

  it("configures VAPID lazily, once, and passes the TTL/urgency", async () => {
    const d = deps(keys);
    const push = createPushSender(d);
    expect(d.setVapid).not.toHaveBeenCalled();
    expect(await push("u1", payload, FLIGHT_PUSH_OPTIONS)).toBe(2);
    await push("u1", payload, FLIGHT_PUSH_OPTIONS);
    expect(d.setVapid).toHaveBeenCalledTimes(1);
    expect(d.send).toHaveBeenCalledWith(expect.objectContaining({ endpoint: "https://push/1" }), expect.any(String), { TTL: 21600, urgency: "high" });
  });

  it("prunes expired subscriptions (404/410) and keeps going", async () => {
    const send = vi.fn().mockRejectedValueOnce(Object.assign(new Error("gone"), { statusCode: 410 })).mockResolvedValueOnce({});
    const d = deps(keys, { send });
    expect(await createPushSender(d)("u1", payload)).toBe(1);
    expect(d.deleteSubscription).toHaveBeenCalledWith("https://push/1");
  });

  it("normalises the VAPID subject", () => {
    expect(vapidSubject("ops@iatos.ai")).toBe("mailto:ops@iatos.ai");
    expect(vapidSubject("https://traveliatos.life")).toBe("https://traveliatos.life");
  });
});
