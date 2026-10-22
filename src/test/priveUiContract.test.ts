import { describe, expect, it } from "vitest";
import { handlePriveAction, type PriveAccessDeps, type RpcResult } from "../../supabase/functions/prive-access/actions";
import { createPriveApi, normalizeStatus } from "@/lib/priveApi";
import { pickPassphrase } from "@/lib/privePassword";
import { derivePriveView } from "@/lib/priveView";

// La interfaz contra las formas REALES del servidor (rama core ya unida): el manejador de
// prive-access (sin red) se conecta al cliente de la interfaz como si fuera supabase.functions.invoke,
// con la misma regla de supabase-js: 2xx → data; otro estado → error con el Response en context.
const UID = "a0000000-0000-0000-0000-000000000001";
const PS = "Ps3s_abcdefghijklmnopqrstuvwxyzABCDEFG-0123";
const ctx = { user: { id: UID, email: "valentina@example.test" }, ipHash: "abcdef0123456789", authSessionId: "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0" };
const okData = (data: unknown): RpcResult => ({ data, error: null });

function wire(rpcImpl: Record<string, (a: Record<string, unknown>) => RpcResult>, userRpcImpl: Record<string, (a: Record<string, unknown>) => RpcResult> = {}) {
  const deps: PriveAccessDeps = {
    rpc: async (fn, a) => (rpcImpl[fn] ?? (() => okData({ ok: true })))(a),
    userRpc: async (fn, a) => (userRpcImpl[fn] ?? (() => okData(null)))(a),
    hibp: async () => "ok",
    sendNotice: async () => true,
    sendResetEmail: async () => true,
    sendInvitationNow: async () => "sent",
  };
  const client = {
    rpc: async () => ({ data: null, error: null }),
    functions: {
      invoke: async (_fn: string, opts: { body: unknown }) => {
        const out = await handlePriveAction(opts.body, ctx, deps);
        if (out.status >= 200 && out.status < 300) return { data: out.body, error: null };
        const raw = JSON.stringify(out.body);
        return { data: null, error: { name: "FunctionsHttpError", context: { status: out.status, clone: () => ({ text: async () => raw }) } } };
      },
    },
  };
  return createPriveApi(client);
}

const unlockOk = () => okData({ ok: true, token: PS, expires_at: "2026-10-22T22:00:00Z" });

describe("interfaz ↔ prive-access real", () => {
  it("frase generada: la interfaz encuentra generated_password y la sesión que abre el servidor", async () => {
    const api = wire({ prive_set_password: () => okData({ ok: true }), prive_unlock: unlockOk });
    const r = await api.access<{ generated_password?: string; prive_session?: string; expires_at?: string }>("set_password", { generate: true });
    expect(r.ok).toBe(true);
    expect(pickPassphrase(r.data)).toMatch(/^[a-zñáéíóú]+(-[a-zñáéíóú]+){5}-\d{2}$/);
    expect(r.data.prive_session).toBe(PS);
    expect(r.data.expires_at).toBe("2026-10-22T22:00:00Z");
  });

  it("change_password y complete_reset devuelven la sesión nueva (la interfaz la adopta)", async () => {
    const api = wire(
      { prive_change_password: () => okData({ ok: true }), prive_complete_reset: () => okData({ ok: true }), prive_unlock: unlockOk },
      { prive_require: () => okData(UID) },
    );
    const c = await api.access<{ prive_session?: string }>("change_password", { prive_session: PS, old_password: "vieja frase segura 1", new_password: "nueva frase segura 22" });
    expect(c).toMatchObject({ ok: true, data: { prive_session: PS } });
    const t = await api.access<{ prive_session?: string }>("complete_reset", { token: PS, new_password: "nueva frase segura 22" });
    expect(t).toMatchObject({ ok: true, data: { prive_session: PS } });
  });

  it("unlock: incorrecta, bloqueo con hora y bloqueo total llegan como códigos de la interfaz", async () => {
    const replies = [
      okData({ ok: false, reason: "WRONG_PASSWORD" }),
      okData({ ok: false, reason: "LOCKED", locked_until: "2026-10-22T20:05:00Z" }),
      okData({ ok: false, reason: "HARD_LOCKED", notice: "hard_lock" }),
    ];
    const api = wire({ prive_unlock: () => replies.shift()! });
    expect((await api.access("unlock", { password: "otra cosa cualquiera" })).code).toBe("WRONG_PASSWORD");
    expect(await api.access("unlock", { password: "otra cosa cualquiera" })).toEqual({ ok: false, code: "LOCKED", lockedUntil: "2026-10-22T20:05:00Z" });
    expect((await api.access("unlock", { password: "otra cosa cualquiera" })).code).toBe("HARD_LOCKED");
  });

  it("sesión Privé vencida en save_progress → PRIVE_SESSION_EXPIRED (la interfaz vuelve al candado)", async () => {
    const api = wire({}, { prive_require: () => ({ data: null, error: { message: "PRIVE_SESSION_EXPIRED", code: "P0001" } }) });
    expect((await api.access("save_progress", { prive_session: PS, welcome_version: 1 })).code).toBe("PRIVE_SESSION_EXPIRED");
  });

  it("validación (400 INVALID) e interno (500 INTERNAL) tienen mensaje", async () => {
    const api = wire({ prive_accept_invitation: () => ({ data: null, error: { message: "boom" } }) });
    expect((await api.access("unlock", {})).code).toBe("INVALID_REQUEST");
    expect((await api.access("accept_invitation", {})).code).toBe("SERVICE_UNAVAILABLE");
  });

  it("invitación de otra cuenta y vencida", async () => {
    const replies = [okData({ ok: false, code: "INVITATION_OTHER_ACCOUNT" }), okData({ ok: false, code: "INVITATION_EXPIRED" })];
    const api = wire({ prive_accept_invitation: () => replies.shift()! });
    expect((await api.access("accept_invitation", { token: PS })).code).toBe("INVITATION_OTHER_ACCOUNT");
    expect((await api.access("accept_invitation", { token: PS })).code).toBe("INVITATION_EXPIRED");
  });

  it("prive_status de un miembro sin PRO (antigüedad 0) → pausa con 'reactiva PRO'", () => {
    // Forma de prive_status en 20261023090100_prive_core_access.sql para alguien con membresía activa y PRO vencido.
    const s = normalizeStatus({
      is_pro: false, tenure_days: 0, required_days: 90, eligible: false, basis: "tenure", membership_status: "active",
      has_password: true, password_status: "active", locked_until: null, activated_at: "2026-07-01T00:00:00Z",
      member_code: "IP-7KQM-X4TD", first_name: "Valentina", welcome_version_seen: 1, onboarding: {}, invitation_pending: false,
      members_requires_prive: false,
    });
    expect(derivePriveView(s, true)).toBe("paused_pro");
    expect(derivePriveView(normalizeStatus({ is_pro: false, membership_status: "none", password_status: "none" }), false)).toBe("teaser");
  });
});
