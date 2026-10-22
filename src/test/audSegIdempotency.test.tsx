// AUD-SEG-05 (reportado por aud-iato): confirmar una acción de Iato y tocar "Reintentar" tras un
// timeout podía duplicar la solicitud al Fixer o el viaje creado. La clave de idempotencia la genera el
// cliente UNA vez por tarjeta (o por solicitud) y el servidor la respeta (concierge-chat y
// concierge-action, tabla action_idempotency). Ver docs/iatos/cierre/SEGURIDAD.md.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, renderHook, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: { access_token: "t", user: { id: "u1" } } } }) },
    functions: { invoke: (...a: any[]) => invoke(...a) },
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { ActionCard } from "@/components/concierge/ActionCard";
import { useConciergeRequest } from "@/components/concierge/ConciergeCards";
import { executeAction } from "../../supabase/functions/concierge-chat/actionExec";
import { withIdempotency, type IdemStore, type StoredResponse } from "../../supabase/functions/_shared/idempotency";

const KEY_RE = /^[A-Za-z0-9_-]{16,80}$/;
const keyOf = (call: any[]) => call?.[1]?.body?.idempotency_key;

describe("cliente: una clave por confirmación, la misma al reintentar", () => {
  beforeEach(() => invoke.mockReset());
  const action = {
    id: "a1", type: "fixer_request" as const, params: { tipo: "reservation", titulo: "Mesa en Pujol" },
    summary: "Pedirle al Fixer: Mesa en Pujol", confirm_label: "Pedírselo al Fixer", runs: "server" as const,
  };

  it("ActionCard: el reintento tras un timeout manda la MISMA clave; otra tarjeta, otra clave", async () => {
    invoke.mockRejectedValueOnce(new Error("timeout")).mockResolvedValueOnce({ data: { ok: true, message: "Solicitud enviada al Fixer." }, error: null });
    const { unmount } = render(<MemoryRouter><ActionCard action={action} /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: /Pedírselo al Fixer/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Reintentar/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Reintentar/ }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Solicitud enviada al Fixer."));
    expect(invoke).toHaveBeenCalledTimes(2);
    const k1 = keyOf(invoke.mock.calls[0]);
    expect(k1).toMatch(KEY_RE);
    expect(keyOf(invoke.mock.calls[1])).toBe(k1);
    unmount();

    invoke.mockResolvedValueOnce({ data: { ok: true, message: "Listo." }, error: null });
    render(<MemoryRouter><ActionCard action={{ ...action, id: "a2" }} /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: /Pedírselo al Fixer/ }));
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(3));
    expect(keyOf(invoke.mock.calls[2])).toMatch(KEY_RE);
    expect(keyOf(invoke.mock.calls[2])).not.toBe(k1);
  });

  it("botón de solicitud (concierge-action): misma clave al reintentar la misma solicitud; nueva tras el éxito o si cambia", async () => {
    invoke.mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValue({ data: { ok: true, request: { id: "abcdef12-0000-0000-0000-000000000000" } }, error: null });
    const { result } = renderHook(() => useConciergeRequest("t1"));
    const req = { type: "reservation", title: "Mesa en Pujol", payload: { fecha: "2026-11-02" } };
    await act(() => result.current.run(req));
    expect(result.current.state).toBe("error");
    await act(() => result.current.run(req));
    expect(result.current.state).toBe("confirmed");
    const [k1, k2] = invoke.mock.calls.map(keyOf);
    expect(k1).toMatch(KEY_RE);
    expect(k2).toBe(k1);
    await act(() => result.current.run(req));
    expect(keyOf(invoke.mock.calls[2])).not.toBe(k1); // ya confirmada: otra solicitud igual es otra
    await act(() => result.current.run({ ...req, title: "Mesa en Quintonil" }));
    expect(keyOf(invoke.mock.calls[3])).not.toBe(keyOf(invoke.mock.calls[2]));
  });
});

describe("servidor: executeAction reenvía la clave a concierge-action", () => {
  it("fixer_request lleva idempotency_key a concierge-action", async () => {
    const calls: any[] = [];
    const deps = {
      userId: "u1", db: {}, priveSession: "p".repeat(40), idempotencyKey: "k_1234567890abcdef",
      callFunction: async (name: string, body: any) => { calls.push({ name, body }); return { status: 200, json: { ok: true, request: { id: "abcd1234" } } }; },
    };
    const ctx = { todayISO: "2026-10-24", trips: [], activeTripId: null, hasPriveSession: true, priveShownIds: ["11111111-1111-4111-8111-111111111111"] } as any;
    const r = await executeAction("fixer_request", { tipo: "reservation", titulo: "Mesa en Pujol" }, ctx, deps as any);
    expect(r.ok).toBe(true);
    expect(calls[0]).toMatchObject({ name: "concierge-action", body: { idempotency_key: "k_1234567890abcdef" } });
  });
});


// Almacén en memoria con la misma semántica que action_idem_claim/finish (la SQL real se prueba en
// supabase/tests/security/action_idempotency.sql).
function memStore(): IdemStore & { rows: Map<string, { status: string; response?: StoredResponse }> } {
  const rows = new Map<string, { status: string; response?: StoredResponse }>();
  return {
    rows,
    async claim(u, s, k) {
      const id = `${u}|${s}|${k}`;
      const r = rows.get(id);
      if (!r) { rows.set(id, { status: "running" }); return { state: "new" }; }
      return r.status === "done" ? { state: "done", response: r.response! } : { state: "running" };
    },
    async finish(u, s, k, response) {
      const id = `${u}|${s}|${k}`;
      if (response === null) rows.delete(id); else rows.set(id, { status: "done", response });
    },
  };
}

describe("servidor: withIdempotency (AUD-SEG-05)", () => {
  const KEY = "k_1234567890abcdef";
  it("reintento con la misma clave tras un timeout: la solicitud se crea UNA vez y se devuelve el mismo folio", async () => {
    const store = memStore();
    const created: string[] = [];
    const run = async (): Promise<StoredResponse> => { created.push(`req-${created.length + 1}`); return { status: 200, body: { ok: true, request: { id: created.at(-1) } } }; };
    const first = await withIdempotency(store, "u1", "concierge-action", KEY, run);   // el cliente no recibió esta respuesta
    const retry = await withIdempotency(store, "u1", "concierge-action", KEY, run);
    expect(created).toEqual(["req-1"]);
    expect(retry.body).toMatchObject({ ok: true, request: { id: "req-1" }, idempotent_replay: true });
    expect(first.body).not.toHaveProperty("idempotent_replay");
  });
  it("mientras el primer intento sigue en curso, el segundo recibe 409 y no ejecuta", async () => {
    const store = memStore();
    let release!: () => void;
    let runs = 0;
    const slow = () => new Promise<StoredResponse>((res) => { runs++; release = () => res({ status: 200, body: { ok: true } }); });
    const p1 = withIdempotency(store, "u1", "s", KEY, slow);
    await new Promise((r) => setTimeout(r, 0));
    const second = await withIdempotency(store, "u1", "s", KEY, slow);
    expect(second.status).toBe(409);
    expect(second.body.code).toBe("IN_PROGRESS");
    release();
    await p1;
    expect(runs).toBe(1);
  });
  it("si la acción falló (o lanzó), la clave se libera y el reintento sí ejecuta", async () => {
    const store = memStore();
    let n = 0;
    const r1 = await withIdempotency(store, "u1", "s", KEY, async () => { n++; return { status: 422, body: { ok: false } }; });
    expect(r1.status).toBe(422);
    await expect(withIdempotency(store, "u1", "s", KEY, async () => { n++; throw new Error("x"); })).rejects.toThrow("x");
    const r3 = await withIdempotency(store, "u1", "s", KEY, async () => { n++; return { status: 200, body: { ok: true } }; });
    expect(r3.status).toBe(200);
    expect(n).toBe(3);
  });
  it("la clave es por usuario y por función; sin clave o sin almacén se ejecuta como antes", async () => {
    const store = memStore();
    let n = 0;
    const run = async () => { n++; return { status: 200, body: { ok: true } }; };
    await withIdempotency(store, "u1", "s", KEY, run);
    await withIdempotency(store, "u2", "s", KEY, run);
    await withIdempotency(store, "u1", "otra", KEY, run);
    await withIdempotency(store, "u1", "s", null, run);
    await withIdempotency(null, "u1", "s", KEY, run);
    const broken: IdemStore = { claim: async () => { throw new Error("db"); }, finish: async () => {} };
    await withIdempotency(broken, "u1", "s", KEY, run);
    expect(n).toBe(6);
  });
});
