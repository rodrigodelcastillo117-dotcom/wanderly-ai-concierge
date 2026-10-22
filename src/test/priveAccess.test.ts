import { beforeEach, describe, expect, it } from "vitest";
import { handlePriveAction, priveCodeOf, type PriveAccessDeps, type RpcResult } from "../../supabase/functions/prive-access/actions";
import { sha256Hex } from "../../supabase/functions/_shared/prive-core";

// prive-access sin red: la base, HIBP y el correo son dobles. Lo que se prueba aquí es la forma del
// contrato (§3), que la función no decide accesos por su cuenta (siempre pregunta a la base), que no
// filtra secretos y que avisa cuando debe. La lógica de acceso real está en supabase/tests/prive.
const UID = "a0000000-0000-0000-0000-000000000001";
const TOKEN = "Tk3n_abcdefghijklmnopqrstuvwxyzABCDEFG-0123";
const PS = "Ps3s_abcdefghijklmnopqrstuvwxyzABCDEFG-0123";
const ctx = { user: { id: UID, email: "valentina@example.test" }, ipHash: "abcdef0123456789", authSessionId: "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0" };

let calls: Array<[string, Record<string, unknown>]>;
let userCalls: Array<[string, Record<string, unknown>]>;
let notices: string[];
let logs: unknown[][];
let rpcImpl: Record<string, (a: Record<string, unknown>) => RpcResult>;
let userRpcImpl: Record<string, (a: Record<string, unknown>) => RpcResult>;
let breach: "ok" | "breached" | "unavailable";
const okData = (data: unknown): RpcResult => ({ data, error: null });

function deps(): PriveAccessDeps {
  return {
    rpc: async (fn, a) => { calls.push([fn, a]); return (rpcImpl[fn] ?? (() => okData({ ok: true })))(a); },
    userRpc: async (fn, a) => { userCalls.push([fn, a]); return (userRpcImpl[fn] ?? (() => okData(null)))(a); },
    hibp: async () => breach,
    sendNotice: async (kind, _u, extra) => { notices.push(kind + (extra?.resetToken ? `:${extra.resetToken.length}` : "")); return true; },
    sendResetEmail: async () => { notices.push("reset_email"); return true; },
    sendInvitationNow: async () => "sent",
    log: (...a) => logs.push(a),
  };
}
const run = (body: unknown) => handlePriveAction(body, ctx, deps());

beforeEach(() => {
  calls = []; userCalls = []; notices = []; logs = []; rpcImpl = {}; userRpcImpl = {}; breach = "ok";
  rpcImpl.prive_unlock = () => okData({ ok: true, token: PS, expires_at: "2026-10-22T22:00:00Z", session_id: "s1" });
});

describe("forma del contrato", () => {
  it("acción desconocida o cuerpo inválido → 400 INVALID", async () => {
    expect(await run({ action: "hack" })).toMatchObject({ status: 400, body: { ok: false, code: "INVALID" } });
    expect(await run(null)).toMatchObject({ status: 400 });
    expect(await run([])).toMatchObject({ status: 400 });
    expect(calls).toEqual([]);
  });

  it("status usa el JWT de quien llama (prive_status ve solo lo propio)", async () => {
    userRpcImpl.prive_status = () => okData({ is_pro: true, tenure_days: 40 });
    expect(await run({ action: "status" })).toEqual({ status: 200, body: { ok: true, status: { is_pro: true, tenure_days: 40 } } });
    expect(userCalls).toEqual([["prive_status", {}]]);
    expect(calls).toEqual([]);
  });

  it("error interno → 500 INTERNAL sin detalles al cliente", async () => {
    rpcImpl.prive_accept_invitation = () => ({ data: null, error: { message: "connection reset" } });
    const out = await run({ action: "accept_invitation" });
    expect(out).toEqual({ status: 500, body: { ok: false, code: "INTERNAL" } });
  });

  it("códigos PRIVE_* reconocidos en errores de prive_require", () => {
    expect(priveCodeOf({ message: "PRIVE_NOT_PRO" })).toBe("PRIVE_NOT_PRO");
    expect(priveCodeOf({ message: "permission denied" })).toBeNull();
  });
});

describe("invitación", () => {
  it("con token: se manda SOLO su SHA-256 y la cuenta de la sesión", async () => {
    rpcImpl.prive_accept_invitation = () => okData({ ok: true, member_code: "IP-ABCD-EFGH", first_name: "Valentina" });
    const out = await run({ action: "accept_invitation", token: TOKEN });
    expect(out.body).toMatchObject({ ok: true, member_code: "IP-ABCD-EFGH" });
    expect(calls).toEqual([["prive_accept_invitation", { _user: UID, _token_hash: await sha256Hex(TOKEN) }]]);
  });

  it("sin token (desde el aviso de la app) también se acepta", async () => {
    await run({ action: "accept_invitation" });
    expect(calls[0][1]).toEqual({ _user: UID, _token_hash: null });
  });

  it("token con forma rara: NO_INVITATION sin tocar la base", async () => {
    expect((await run({ action: "accept_invitation", token: "x'; drop table" })).body).toEqual({ ok: false, code: "NO_INVITATION" });
    expect(calls).toEqual([]);
  });

  it("invitación de otra cuenta: código genérico y registro sin el token", async () => {
    rpcImpl.prive_accept_invitation = () => okData({ ok: false, code: "INVITATION_OTHER_ACCOUNT" });
    expect((await run({ action: "accept_invitation", token: TOKEN })).body).toEqual({ ok: false, code: "INVITATION_OTHER_ACCOUNT" });
    expect(JSON.stringify(logs)).not.toContain(TOKEN);
  });

  it("reenviar: crea la nueva y la manda ya", async () => {
    rpcImpl.prive_resend_invitation = () => okData({ ok: true, invitation_id: "i2" });
    expect((await run({ action: "resend_invitation" })).body).toEqual({ ok: true, email: "sent" });
    rpcImpl.prive_resend_invitation = () => okData({ ok: false, code: "RATE_LIMITED" });
    expect((await run({ action: "resend_invitation" })).body).toEqual({ ok: false, code: "RATE_LIMITED" });
  });
});

describe("contraseña", () => {
  it("débil o filtrada: se rechaza antes de llegar a la base", async () => {
    expect((await run({ action: "set_password", password: "corta" })).body).toEqual({ ok: false, code: "PASSWORD_WEAK" });
    breach = "breached";
    expect((await run({ action: "set_password", password: "Password123456" })).body).toEqual({ ok: false, code: "PASSWORD_BREACHED" });
    expect(calls).toEqual([]);
  });

  it("HIBP caído: se acepta y se registra breach_check='unavailable'; abre la primera sesión y avisa", async () => {
    breach = "unavailable";
    const out = await run({ action: "set_password", password: "Una-frase-muy-propia-77" });
    expect(out.body).toEqual({ ok: true, breach_check: "unavailable", prive_session: PS, expires_at: "2026-10-22T22:00:00Z" });
    expect(calls[0]).toEqual(["prive_set_password", { _user: UID, _password: "Una-frase-muy-propia-77", _breach_check: "unavailable" }]);
    expect(calls[1][0]).toBe("prive_unlock");
    expect(notices).toEqual(["password_set"]);
  });

  it("frase generada por el servidor: se devuelve UNA vez y se guarda como 'generated'", async () => {
    const out = await run({ action: "set_password", generate: true });
    expect(out.body.generated_password).toMatch(/^([a-z]+-){6}\d{2}$/);
    expect(calls[0][1]).toMatchObject({ _breach_check: "generated", _password: out.body.generated_password });
  });

  it("ya tenía contraseña: PASSWORD_ALREADY_SET", async () => {
    rpcImpl.prive_set_password = () => okData({ ok: false, code: "PASSWORD_ALREADY_SET" });
    expect((await run({ action: "set_password", password: "Una-frase-muy-propia-77" })).body).toEqual({ ok: false, code: "PASSWORD_ALREADY_SET" });
    expect(notices).toEqual([]);
  });
});

describe("contraseña canónica (el dueño quedó fuera con su propia contraseña)", () => {
  it("un espacio al final o un acento compuesto distinto no cambian la contraseña: se guarda y se compara igual", async () => {
    const nfd = "Bahía-de-mi-alma-1987".normalize("NFD");
    await run({ action: "set_password", password: `  ${nfd} ` });
    expect(calls[0]).toEqual(["prive_set_password", { _user: UID, _password: "Bahía-de-mi-alma-1987".normalize("NFC"), _breach_check: "ok" }]);
    calls.length = 0;
    await run({ action: "unlock", password: "Bahía-de-mi-alma-1987 " });
    expect(calls[0][1]).toMatchObject({ _password: "Bahía-de-mi-alma-1987".normalize("NFC") });
  });
});

describe("desbloqueo y sesiones", () => {
  it("desbloquear: pasa ip_hash y session_id de Auth; devuelve la sesión Privé", async () => {
    const out = await run({ action: "unlock", password: "Una-frase-muy-propia-77" });
    expect(out).toEqual({ status: 200, body: { ok: true, prive_session: PS, expires_at: "2026-10-22T22:00:00Z" } });
    expect(calls[0]).toEqual(["prive_unlock", { _user: UID, _password: "Una-frase-muy-propia-77", _ip_hash: ctx.ipHash, _auth_session_id: ctx.authSessionId }]);
  });

  it("contraseña equivocada / bloqueo: resultado de negocio (HTTP 200) con el código", async () => {
    rpcImpl.prive_unlock = () => okData({ ok: false, reason: "WRONG_PASSWORD" });
    expect(await run({ action: "unlock", password: "mala-clave-larga" })).toEqual({ status: 200, body: { ok: false, code: "WRONG_PASSWORD" } });
    rpcImpl.prive_unlock = () => okData({ ok: false, reason: "LOCKED", locked_until: "2026-10-22T10:01:00Z" });
    expect((await run({ action: "unlock", password: "mala-clave-larga" })).body).toEqual({ ok: false, code: "LOCKED", locked_until: "2026-10-22T10:01:00Z" });
    rpcImpl.prive_unlock = () => okData({ ok: false, reason: "PRIVE_NOT_PRO" });
    expect((await run({ action: "unlock", password: "Una-frase-muy-propia-77" })).body).toEqual({ ok: false, code: "PRIVE_NOT_PRO" });
  });

  it("bloqueo total y nuevo acceso tras fallos: se avisa por correo", async () => {
    rpcImpl.prive_unlock = () => okData({ ok: false, reason: "HARD_LOCKED", notice: "hard_lock" });
    await run({ action: "unlock", password: "mala-clave-larga" });
    rpcImpl.prive_unlock = () => okData({ ok: true, token: PS, expires_at: "x", notice: "new_access" });
    await run({ action: "unlock", password: "Una-frase-muy-propia-77" });
    expect(notices).toEqual(["hard_lock", "new_access"]);
  });

  it("sin contraseña en el cuerpo → 400", async () => {
    expect((await run({ action: "unlock" })).status).toBe(400);
    expect((await run({ action: "unlock", password: "x".repeat(2000) })).status).toBe(400);
  });

  it("bloquear esta sesión: solo viaja el hash del token", async () => {
    await run({ action: "lock", prive_session: PS });
    expect(calls).toEqual([["prive_lock_session", { _user: UID, _token_hash: await sha256Hex(PS) }]]);
  });

  it("acciones con sesión Privé la validan con prive_require (JWT de quien llama) antes de todo", async () => {
    userRpcImpl.prive_require = () => ({ data: null, error: { message: "PRIVE_SESSION_INVALID", code: "P0001" } });
    for (const action of ["change_password", "revoke_sessions", "save_progress"]) {
      const out = await run({ action, prive_session: PS, old_password: "Una-frase-muy-propia-77", new_password: "Otra-frase-muy-propia-88" });
      expect(out.body).toEqual({ ok: false, code: "PRIVE_SESSION_INVALID" });
    }
    expect(userCalls.every(([fn, a]) => fn === "prive_require" && a._ps === PS)).toBe(true);
    expect(calls).toEqual([]);
    expect((await run({ action: "revoke_sessions" })).body).toEqual({ ok: false, code: "PRIVE_NO_SESSION" });
  });

  it("cerrar todas las sesiones: avisa", async () => {
    rpcImpl.prive_revoke_sessions = () => okData(3);
    expect((await run({ action: "revoke_sessions", prive_session: PS })).body).toEqual({ ok: true, sessions_closed: 3 });
    expect(calls[0]).toEqual(["prive_revoke_sessions", { _user: UID, _reason: "user_revoke_all" }]);
    expect(notices).toEqual(["sessions_revoked"]);
  });

  it("cambiar contraseña: revisa la nueva, avisa y abre sesión nueva", async () => {
    rpcImpl.prive_change_password = () => okData({ ok: true, notice: "password_changed" });
    const out = await run({ action: "change_password", prive_session: PS, old_password: "Una-frase-muy-propia-77", new_password: "Otra-frase-muy-propia-88" });
    expect(out.body).toEqual({ ok: true, prive_session: PS, expires_at: "2026-10-22T22:00:00Z" });
    expect(calls.map(([fn]) => fn)).toEqual(["prive_change_password", "prive_unlock"]);
    expect(notices).toEqual(["password_changed"]);
    breach = "breached";
    expect((await run({ action: "change_password", prive_session: PS, old_password: "a-b-c-d-e-f-1", new_password: "Password123456" })).body)
      .toEqual({ ok: false, code: "PASSWORD_BREACHED" });
  });

  it("guardar progreso: valida tipos y tamaño", async () => {
    expect((await run({ action: "save_progress", prive_session: PS, welcome_version: -1 })).status).toBe(400);
    expect((await run({ action: "save_progress", prive_session: PS, onboarding: { x: "y".repeat(3000) } })).status).toBe(400);
    rpcImpl.prive_save_progress = () => okData({ ok: true, welcome_version_seen: 1, onboarding: { step: "a" } });
    expect((await run({ action: "save_progress", prive_session: PS, welcome_version: 1, onboarding: { step: "a" } })).body)
      .toEqual({ ok: true, welcome_version_seen: 1, onboarding: { step: "a" } });
  });
});

describe("restablecimiento y contraseña comprometida", () => {
  it("pedir restablecimiento: el token va solo por correo, nunca en la respuesta", async () => {
    rpcImpl.prive_request_reset = () => okData(TOKEN);
    const out = await run({ action: "request_reset" });
    expect(out.body).toEqual({ ok: true, email: "sent" });
    expect(JSON.stringify(out)).not.toContain(TOKEN);
    expect(notices).toEqual(["reset_email"]);
  });

  it("tope de restablecimientos y sin contraseña: códigos", async () => {
    rpcImpl.prive_request_reset = () => ({ data: null, error: { message: "RATE_LIMITED" } });
    expect((await run({ action: "request_reset" })).body).toEqual({ ok: false, code: "RATE_LIMITED" });
    rpcImpl.prive_request_reset = () => ({ data: null, error: { message: "NO_PASSWORD" } });
    expect((await run({ action: "request_reset" })).body).toEqual({ ok: false, code: "NO_PASSWORD" });
  });

  it("completar: token con forma rara → RESET_INVALID sin tocar la base; bien → sesión nueva", async () => {
    expect((await run({ action: "complete_reset", token: "nope", new_password: "Otra-frase-muy-propia-88" })).body).toEqual({ ok: false, code: "RESET_INVALID" });
    expect(calls).toEqual([]);
    rpcImpl.prive_complete_reset = () => okData({ ok: true });
    const out = await run({ action: "complete_reset", token: TOKEN, new_password: "Otra-frase-muy-propia-88" });
    expect(out.body).toMatchObject({ ok: true, prive_session: PS });
    expect(calls[0]).toEqual(["prive_complete_reset", { _user: UID, _token: TOKEN, _new: "Otra-frase-muy-propia-88", _breach_check: "ok" }]);
    expect(notices).toEqual(["password_reset"]);
  });

  it("reportar comprometida: cierra todo y manda el enlace de restablecimiento", async () => {
    rpcImpl.prive_report_compromised = () => okData({ ok: true, sessions_closed: 2 });
    rpcImpl.prive_request_reset = () => okData(TOKEN);
    expect((await run({ action: "report_compromised" })).body).toEqual({ ok: true, sessions_closed: 2, email: "sent" });
    expect(notices).toEqual([`compromised:${TOKEN.length}`]);
  });
});

describe("nunca registra secretos", () => {
  it("las bitácoras no contienen contraseñas ni tokens", async () => {
    rpcImpl.prive_set_password = () => ({ data: null, error: { message: "boom" } });
    await run({ action: "set_password", password: "Una-frase-muy-propia-77" });
    rpcImpl.prive_accept_invitation = () => okData({ ok: false, code: "INVITATION_OTHER_ACCOUNT" });
    await run({ action: "accept_invitation", token: TOKEN });
    const text = JSON.stringify(logs);
    expect(text).not.toContain("Una-frase-muy-propia-77");
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain("valentina@example.test");
  });
});
