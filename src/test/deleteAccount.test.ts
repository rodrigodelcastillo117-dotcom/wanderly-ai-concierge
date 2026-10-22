import { describe, expect, it } from "vitest";
import { confirmedDeletion } from "../../supabase/functions/delete-account/validation";
import {
  cancelAllSubscriptions,
  isAlreadyGone,
  stripeFetchDeps,
  type BillingDeps,
  type StripeCallResult,
  type StripeSub,
} from "../../supabase/functions/_shared/stripe-billing";

describe("account deletion confirmation", () => {
  it("requires both explicit confirmations", () => {
    expect(confirmedDeletion({ confirm: true, confirmation: "ELIMINAR" })).toBe(true);
    expect(confirmedDeletion({ confirm: true })).toBe(false);
    expect(confirmedDeletion({ confirmation: "ELIMINAR" })).toBe(false);
    expect(confirmedDeletion({ confirm: false, confirmation: "ELIMINAR" })).toBe(false);
  });
  it("rejects attempts to target another user's account", () => {
    expect(confirmedDeletion({ confirm: true, confirmation: "ELIMINAR", user_id: "other-user" })).toBe(false);
  });
});

// Stripe en memoria: sin red. Cada suscripción tiene su estado y la respuesta de cancelarla.
function fakeStripe(subs: StripeSub[], cancelReplies: Record<string, StripeCallResult> = {}) {
  const cancelCalls: string[] = [];
  const deps: BillingDeps = {
    listSubscriptions: async (customer) => subs.filter((s) => s.customer === customer),
    retrieveSubscription: async (id) => subs.find((s) => s.id === id) ?? null,
    cancelSubscription: async (id) => {
      cancelCalls.push(id);
      return cancelReplies[id] ?? { ok: true, status: "canceled" };
    },
  };
  return { deps, cancelCalls };
}

describe("delete-account: cancelación en Stripe (A-16)", () => {
  it("cancela TODAS las suscripciones vivas del cliente, no solo la guardada", async () => {
    const { deps, cancelCalls } = fakeStripe([
      { id: "sub_guardada", status: "active", customer: "cus_1" },
      { id: "sub_duplicada", status: "trialing", customer: "cus_1" },
      { id: "sub_vieja", status: "canceled", customer: "cus_1" },
      { id: "sub_otro_cliente", status: "active", customer: "cus_2" },
    ]);
    const out = await cancelAllSubscriptions(deps, { customerId: "cus_1", subscriptionId: "sub_guardada" });
    expect(out.ok).toBe(true);
    expect(cancelCalls.sort()).toEqual(["sub_duplicada", "sub_guardada"]);
  });

  it("encuentra al cliente desde el id de suscripción si no se guardó el customer", async () => {
    const { deps, cancelCalls } = fakeStripe([
      { id: "sub_a", status: "past_due", customer: "cus_9" },
      { id: "sub_b", status: "active", customer: "cus_9" },
    ]);
    expect((await cancelAllSubscriptions(deps, { subscriptionId: "sub_a" })).ok).toBe(true);
    expect(cancelCalls.sort()).toEqual(["sub_a", "sub_b"]);
  });

  it("'ya cancelada' o 'no existe' en Stripe no aborta el borrado", async () => {
    const { deps } = fakeStripe(
      [{ id: "sub_x", status: "active", customer: "cus_1" }, { id: "sub_y", status: "active", customer: "cus_1" }],
      {
        sub_x: { ok: false, httpStatus: 400, code: null, message: "This subscription has already been canceled." },
        sub_y: { ok: false, httpStatus: 404, code: "resource_missing", message: "No such subscription: 'sub_y'" },
      },
    );
    const out = await cancelAllSubscriptions(deps, { customerId: "cus_1" });
    expect(out).toEqual({ ok: true, canceled: [], alreadyGone: ["sub_x", "sub_y"] });
  });

  it("una suscripción guardada que Stripe ya no tiene no bloquea (fila 'incomplete' expirada)", async () => {
    const { deps, cancelCalls } = fakeStripe([]);
    expect((await cancelAllSubscriptions(deps, { subscriptionId: "sub_expirada" })).ok).toBe(true);
    expect(cancelCalls).toEqual([]);
  });

  it("un error real de Stripe (5xx) sí detiene el borrado para no seguir cobrando", async () => {
    const { deps } = fakeStripe([{ id: "sub_z", status: "active", customer: "cus_1" }], {
      sub_z: { ok: false, httpStatus: 500, code: "api_error", message: "Something went wrong" },
    });
    expect(await cancelAllSubscriptions(deps, { customerId: "cus_1" })).toEqual({ ok: false, failed: "sub_z" });
    expect(isAlreadyGone({ ok: false, httpStatus: 401, message: "Invalid API Key provided" })).toBe(false);
  });

  it("stripeFetchDeps pagina y usa DELETE, con fetch inyectado (sin red)", async () => {
    const seen: string[] = [];
    const fakeFetch = (async (url: string, init?: RequestInit) => {
      seen.push(`${init?.method ?? "GET"} ${url.replace("https://api.stripe.com/v1", "")}`);
      if (url.includes("starting_after=sub_1")) return new Response(JSON.stringify({ data: [{ id: "sub_2", status: "active", customer: "cus_1" }], has_more: false }));
      if (url.includes("/subscriptions?")) return new Response(JSON.stringify({ data: [{ id: "sub_1", status: "active", customer: "cus_1" }], has_more: true }));
      return new Response(JSON.stringify({ id: "sub", status: "canceled" }));
    }) as unknown as typeof fetch;
    const out = await cancelAllSubscriptions(stripeFetchDeps("sk_test_x", fakeFetch), { customerId: "cus_1" });
    expect(out).toEqual({ ok: true, canceled: ["sub_1", "sub_2"], alreadyGone: [] });
    expect(seen.filter((s) => s.startsWith("DELETE"))).toEqual(["DELETE /subscriptions/sub_1", "DELETE /subscriptions/sub_2"]);
  });
});
