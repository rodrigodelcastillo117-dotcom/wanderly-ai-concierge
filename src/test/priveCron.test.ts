import { describe, expect, it, vi } from "vitest";
import { runPriveCron, type PriveCronDeps } from "../../supabase/functions/prive-cron/run";
import { redactForLog, sendDueInvitations, type ClaimedInvitation, type InviteSenderDeps } from "../../supabase/functions/_shared/prive-invite-sender";

const TOKEN = "Tk3n_abcdefghijklmnopqrstuvwxyzABCDEFG-0123";
const inv = (n: number, o: Partial<ClaimedInvitation> = {}): ClaimedInvitation => ({
  invitation_id: `inv-${n}`, user_id: `u-${n}`, email: `p${n}@example.test`, first_name: "Valentina", token: TOKEN, attempt: 1, basis: "tenure", ...o,
});

function sender(claimed: ClaimedInvitation[], sendResult: (to: string) => { ok: boolean; id?: string; error?: string }) {
  const marks: Array<[string, boolean, string | null, string | null]> = [];
  const sent: Array<{ to: string; subject: string; html: string; text: string }> = [];
  let pool = [...claimed];
  const d: InviteSenderDeps = {
    // Como la SQL: lo reclamado ya no se vuelve a reclamar.
    claim: async (limit) => { const out = pool.slice(0, limit); pool = pool.slice(limit); return { data: out, error: null }; },
    mark: async (id, ok, providerId, error) => { marks.push([id, ok, providerId, error]); return { data: null, error: null }; },
    send: async (m) => { sent.push(m); return sendResult(m.to); },
    siteUrl: "https://traveliatos.life",
  };
  return { d, marks, sent };
}

describe("correos de invitación", () => {
  it("envía cada invitación reclamada una vez y la marca enviada con el id del proveedor", async () => {
    const { d, marks, sent } = sender([inv(1), inv(2, { basis: "grant" })], () => ({ ok: true, id: "msg_1" }));
    const s = await sendDueInvitations(d, 50);
    expect(s).toEqual({ claimed: 2, sent: 2, failed: 0, mark_errors: 0 });
    expect(marks).toEqual([["inv-1", true, "msg_1", null], ["inv-2", true, "msg_1", null]]);
    expect(sent[0].subject).toBe("Valentina, tu invitación a IATOS Privé");
    expect(sent[0].html).toContain(`/prive/invitacion#t=${TOKEN}`);
    expect(sent[1].html).toContain("el equipo de IATOS te concedió acceso");
    // Segunda corrida: nada pendiente → nada se reenvía.
    expect(await sendDueInvitations(d, 50)).toEqual({ claimed: 0, sent: 0, failed: 0, mark_errors: 0 });
    expect(sent).toHaveLength(2);
  });

  it("fallo del proveedor: se marca 'failed' con el error sin correos ni llaves", async () => {
    const { d, marks } = sender([inv(1)], () => ({ ok: false, error: "You can only send testing emails to dueno@example.test (re_AbCdEf123456)" }));
    const s = await sendDueInvitations(d, 50);
    expect(s.failed).toBe(1);
    expect(marks[0][1]).toBe(false);
    expect(marks[0][3]).not.toMatch(/@|re_AbCd/);
  });

  it("si armar o mandar el correo lanza, se marca fallido y sigue con la siguiente", async () => {
    const { d, marks } = sender([inv(1, { token: "malo" }), inv(2)], () => ({ ok: true, id: "m" }));
    const s = await sendDueInvitations(d, 50);
    expect(s).toMatchObject({ claimed: 2, sent: 1, failed: 1 });
    expect(marks.map((m) => m[1])).toEqual([false, true]);
  });

  it("redacción de errores: correos, tokens en enlaces y llaves", () => {
    expect(redactForLog("x a@b.mx https://t.l/prive/invitacion#t=abcDEF_123 re_123456789")).toBe("x [correo] https://t.l/prive/invitacion#t=[token] [llave]");
  });
});

describe("prive-cron", () => {
  const base = (over: Partial<PriveCronDeps> = {}): PriveCronDeps => ({
    evaluate: async () => ({ data: [{ user_id: "u1", action: "invited" }, { user_id: "u2", action: "already_member" }], error: null }),
    sender: sender([inv(1)], () => ({ ok: true, id: "m" })).d,
    sweep: async () => ({ data: { sessions_not_entitled: 1 }, error: null }),
    ...over,
  });

  it("evalúa → envía → barre y devuelve conteos", async () => {
    const r = await runPriveCron(base());
    expect(r).toEqual({ status: 200, body: { ok: true, invited: 1, already_member: 1, emails: { claimed: 1, sent: 1, failed: 0, mark_errors: 0 }, sweep: { sessions_not_entitled: 1 }, errors: [] } });
  });

  it("sin correo configurado: no reclama invitaciones (no gasta intentos) y la app sigue avisando", async () => {
    const { d, sent } = sender([inv(1)], () => ({ ok: true }));
    const r = await runPriveCron(base({ sender: null }));
    expect(r.body.emails).toBe("not_configured");
    expect(sent).toEqual([]);
    expect((await d.claim(10, null)).data).toHaveLength(1); // sigue pendiente para cuando haya correo
    expect(r.status).toBe(200);
  });

  it("si un paso falla, los demás corren y responde 500 (lo ve el chequeo diario)", async () => {
    const sweep = vi.fn(async () => ({ data: {}, error: null }));
    const r = await runPriveCron(base({ evaluate: async () => ({ data: null, error: { message: "timeout" } }), sweep }));
    expect(r.status).toBe(500);
    expect(r.body.errors).toEqual(["evaluate: timeout"]);
    expect(sweep).toHaveBeenCalledOnce();
  });
});
