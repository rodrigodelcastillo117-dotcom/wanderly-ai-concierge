import { describe, expect, it, vi } from "vitest";
import { runDeletion, type DeletionDeps, type StepName, type StepResult, type StepState } from "../../supabase/functions/_shared/account-deletion";
import { deletePosthogPerson } from "../../supabase/functions/_shared/posthog-delete";
import { detachAllPaymentMethods, stripeFetchDeps } from "../../supabase/functions/_shared/stripe-billing";

// Solicitud en memoria: guarda los pasos como lo haría deletion_request_steps.
function world(behaviour: Partial<Record<StepName, () => Promise<StepResult>>> = {}) {
  const steps = new Map<StepName, StepState>(
    (["stripe_cancel", "storage", "db_purge", "stripe_customer_redact", "posthog_delete"] as StepName[])
      .map((s) => [s, { step: s, status: "pending", attempts: 0, last_error: null }]),
  );
  const ran: StepName[] = [];
  const state = { identity: false, request: "pending", identityCalls: 0 };
  const run = (s: StepName) => async () => { ran.push(s); return behaviour[s] ? behaviour[s]!() : "done"; };
  const deps: DeletionDeps = {
    loadSteps: async () => [...steps.values()].map((x) => ({ ...x })),
    saveStep: async (s, p) => { steps.set(s, { step: s, status: p.status, attempts: p.attempts, last_error: p.last_error }); },
    steps: {
      stripe_cancel: run("stripe_cancel"), storage: run("storage"), db_purge: run("db_purge"),
      stripe_customer_redact: run("stripe_customer_redact"), posthog_delete: run("posthog_delete"),
    },
    identityDeleted: async () => state.identity,
    deleteIdentity: async () => { state.identityCalls++; state.identity = true; },
    markRequest: async (st) => { state.request = st; },
    redact: (e) => String((e as Error).message).replace(/[\w.]+@[\w.]+/g, "[correo]"),
  };
  return { deps, steps, ran, state };
}

describe("borrado de cuenta por pasos (sec2-b)", () => {
  it("todo bien: 5 pasos, identidad borrada al final de los bloqueantes, solicitud completa", async () => {
    const w = world();
    const out = await runDeletion(w.deps);
    expect(out).toEqual({ identityDeleted: true, completed: true, blockedAt: null, pending: [] });
    expect(w.ran).toEqual(["stripe_cancel", "storage", "db_purge", "stripe_customer_redact", "posthog_delete"]);
    expect(w.state.request).toBe("completed");
  });

  it("si cancelar en Stripe falla: no se borra nada más ni la identidad; el error queda redactado", async () => {
    const w = world({ stripe_cancel: async () => { throw new Error("stripe 500 para ana@x.mx"); } });
    const out = await runDeletion(w.deps);
    expect(out.blockedAt).toBe("stripe_cancel");
    expect(out.identityDeleted).toBe(false);
    expect(w.ran).toEqual(["stripe_cancel"]);
    expect(w.steps.get("stripe_cancel")).toMatchObject({ status: "failed", attempts: 1, last_error: "stripe 500 para [correo]" });
  });

  it("reanudar: el reintento sigue donde quedó y no repite lo hecho", async () => {
    let fail = true;
    const w = world({ storage: async () => { if (fail) throw new Error("storage caído"); return "done"; } });
    expect((await runDeletion(w.deps)).blockedAt).toBe("storage");
    fail = false;
    const out = await runDeletion(w.deps);
    expect(out.completed).toBe(true);
    expect(w.ran.filter((s) => s === "stripe_cancel")).toHaveLength(1);
    expect(w.steps.get("storage")).toMatchObject({ status: "done", attempts: 2 });
    expect(w.state.identityCalls).toBe(1);
  });

  it("PostHog sin llave: la identidad se borra igual y el paso queda pending_key para reintentar", async () => {
    let key = false;
    const w = world({ posthog_delete: async () => (key ? "done" : "pending_key") });
    const first = await runDeletion(w.deps);
    expect(first).toMatchObject({ identityDeleted: true, completed: false, pending: ["posthog_delete"] });
    expect(w.state.request).toBe("identity_deleted");
    key = true;
    const second = await runDeletion(w.deps);
    expect(second.completed).toBe(true);
    expect(w.ran.filter((s) => s === "db_purge")).toHaveLength(1);
  });

  it("falla parcial no bloqueante (redactar el cliente de Stripe) y tope de intentos", async () => {
    const w = world({ stripe_customer_redact: async () => { throw new Error("stripe 502"); } });
    await runDeletion(w.deps, { maxAttempts: 2 });
    await runDeletion(w.deps, { maxAttempts: 2 });
    await runDeletion(w.deps, { maxAttempts: 2 });
    expect(w.steps.get("stripe_customer_redact")).toMatchObject({ status: "failed", attempts: 2 });
    expect(w.state.identity).toBe(true);
  });

  it("si borrar la identidad falla, queda pendiente (no se marca completa)", async () => {
    const w = world();
    w.deps.deleteIdentity = async () => { throw new Error("auth 500"); };
    const out = await runDeletion(w.deps);
    expect(out).toMatchObject({ identityDeleted: false, completed: false, blockedAt: "identity" });
  });
});

describe("PostHog y Stripe del borrado (fetch inyectado, sin red)", () => {
  it("PostHog: sin llave o proyecto → pending_key; con llave → bulk_delete por distinct_id", async () => {
    expect(await deletePosthogPerson({ personalApiKey: "", projectId: "1" }, "u1")).toBe("pending_key");
    const f = vi.fn(async () => new Response("{}", { status: 202 }));
    expect(await deletePosthogPerson({ personalApiKey: "phx_k", projectId: "42" }, "u1", f as unknown as typeof fetch)).toBe("done");
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://us.posthog.com/api/projects/42/persons/bulk_delete/");
    expect(JSON.parse(String(init.body))).toEqual({ distinct_ids: ["u1"], delete_events: true, delete_recordings: true });
    const bad = vi.fn(async () => new Response("{}", { status: 500 }));
    await expect(deletePosthogPerson({ personalApiKey: "k", projectId: "42" }, "u1", bad as unknown as typeof fetch)).rejects.toThrow("posthog_500");
  });

  it("Stripe: quita todos los métodos de pago y redacta el cliente (sin borrar facturas)", async () => {
    const seen: string[] = [];
    const f = (async (url: string, init?: RequestInit) => {
      seen.push(`${init?.method ?? "GET"} ${url.replace("https://api.stripe.com/v1", "")}${init?.body ? ` ${String(init.body)}` : ""}`);
      if (url.includes("/payment_methods?")) return new Response(JSON.stringify({ data: [{ id: "pm_1" }, { id: "pm_2" }], has_more: false }));
      return new Response("{}");
    }) as unknown as typeof fetch;
    const deps = stripeFetchDeps("sk_test_x", f);
    expect(await detachAllPaymentMethods(deps, "cus_1")).toEqual({ ok: true, detached: 2 });
    expect((await deps.redactCustomer!("cus_1")).ok).toBe(true);
    expect(seen).toContain("POST /payment_methods/pm_1/detach");
    const redact = seen.find((s) => s.startsWith("POST /customers/cus_1 "))!;
    expect(redact).toContain("email=&");
    expect(redact).toContain("metadata%5Biatos_deleted%5D=true");
    expect(seen.some((s) => s.startsWith("DELETE /customers"))).toBe(false);
  });
});
