// Acciones de prive-access sin Deno ni SDK (probadas en src/test/priveAccess.test.ts). index.ts
// valida la sesión de IATOS (getUser), calcula ip_hash y session_id y pasa las dependencias reales.
//
// Contrato §3: cuerpo {action, ...}; respuesta JSON {ok, code?, ...}; HTTP 200 para resultados de
// negocio (contraseña equivocada, bloqueo, sin derecho…) y 400/401/429/500 para validación, sesión,
// límite de peticiones o error interno. Las decisiones de acceso las toma SIEMPRE la base
// (prive_require / prive_access_code); aquí solo se valida forma, se revisa HIBP y se avisa.
// Nunca se registran contraseñas, tokens ni correos.
import { type BreachCheck, generatePassphrase, isToken, passwordShapeProblem, sha256Hex } from "../_shared/prive-core.ts";
import type { NoticeKind } from "../_shared/prive-email.ts";

export type RpcResult = { data: unknown; error: { message: string; code?: string } | null };

export type PriveUser = { id: string; email?: string | null };

export type PriveRequestCtx = {
  user: PriveUser;
  /** sha256(ip || PRIVE_IP_SALT || día) recortado; null si no hay sal configurada. */
  ipHash: string | null;
  /** Claim session_id del JWT de Auth (ya validado). */
  authSessionId: string | null;
};

export interface PriveAccessDeps {
  /** RPC con service_role (las funciones prive_* de servidor). */
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<RpcResult>;
  /** RPC con el JWT de quien llama (prive_status, prive_require: usan auth.uid() y auth.jwt()). */
  userRpc(fn: string, args: Record<string, unknown>): PromiseLike<RpcResult>;
  hibp(password: string): Promise<BreachCheck>;
  /** Avisos de seguridad por correo (best effort; nunca lanza). */
  sendNotice(kind: NoticeKind, user: PriveUser, extra?: { resetToken?: string }): Promise<boolean>;
  sendResetEmail(user: PriveUser, token: string): Promise<boolean>;
  /** Envía ya la invitación pendiente de esta persona (resend). */
  sendInvitationNow(userId: string): Promise<"sent" | "failed" | "none" | "not_configured">;
  random?(n: number): Uint8Array;
  log?(...args: unknown[]): void;
}

export type ActionOutcome = { status: number; body: Record<string, unknown> };

const ok = (body: Record<string, unknown> = {}): ActionOutcome => ({ status: 200, body: { ok: true, ...body } });
const fail = (code: string, extra: Record<string, unknown> = {}, status = 200): ActionOutcome => ({ status, body: { ok: false, code, ...extra } });
const invalid = (detail: string) => fail("INVALID", { detail }, 400);

export const ACTIONS = [
  "status", "accept_invitation", "resend_invitation", "set_password", "unlock", "lock", "change_password",
  "request_reset", "complete_reset", "report_compromised", "revoke_sessions", "save_progress",
] as const;
export type PriveAction = typeof ACTIONS[number];

const PRIVE_CODES = new Set([
  "PRIVE_NO_SESSION", "PRIVE_NOT_PRO", "PRIVE_NOT_ELIGIBLE", "PRIVE_NOT_ACTIVATED", "PRIVE_REVOKED",
  "PRIVE_SESSION_INVALID", "PRIVE_SESSION_EXPIRED",
]);

/** Código PRIVE_* de un error de prive_require (PostgREST lo trae en message), o null. */
export function priveCodeOf(err: { message?: string } | null | undefined): string | null {
  const m = (err?.message ?? "").trim();
  return PRIVE_CODES.has(m) ? m : null;
}

const str = (v: unknown, max = 1024): string | null => (typeof v === "string" && v.length > 0 && v.length <= max ? v : null);

class Internal extends Error {}

async function call(deps: PriveAccessDeps, fn: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data, error } = await deps.rpc(fn, args);
  if (error) throw new Internal(`${fn}: ${error.message}`);
  return (data ?? {}) as Record<string, unknown>;
}

/** Valida la sesión Privé con el JWT de quien llama (misma función que usan las RPC de contenido). */
async function requireSession(deps: PriveAccessDeps, ps: unknown): Promise<string | null> {
  if (!isToken(ps)) return "PRIVE_NO_SESSION";
  const { error } = await deps.userRpc("prive_require", { _ps: ps });
  if (!error) return null;
  const code = priveCodeOf(error);
  if (code) return code;
  throw new Internal(`prive_require: ${error.message}`);
}

/** Revisa forma + HIBP. Devuelve el código del problema o el resultado de la revisión. */
async function checkNewPassword(deps: PriveAccessDeps, pw: unknown): Promise<{ problem: string } | { breach: BreachCheck }> {
  const shape = passwordShapeProblem(pw);
  if (shape) return { problem: shape };
  const breach = await deps.hibp(pw as string);
  if (breach === "breached") return { problem: "PASSWORD_BREACHED" };
  return { breach };
}

/** Sin sesión de Auth comprobable no hay sesión Privé (AUD-01): "vuelve a iniciar sesión". */
const authSessionInvalid = () => fail("UNAUTHENTICATED", {}, 401);

/** Abre una sesión Privé (después de fijar, cambiar o restablecer la contraseña). */
async function openSession(deps: PriveAccessDeps, ctx: PriveRequestCtx, password: string, remember = false): Promise<ActionOutcome> {
  // AUD-01: una sesión Privé siempre queda ligada al session_id del JWT. Sin él (JWT raro, de servicio
  // o manipulado) no se emite; la base lo vuelve a comprobar contra auth.sessions.
  if (!ctx.authSessionId) return authSessionInvalid();
  const r = await call(deps, "prive_unlock", { _user: ctx.user.id, _password: password, _ip_hash: ctx.ipHash, _auth_session_id: ctx.authSessionId });
  if (r.reason === "AUTH_SESSION_INVALID") return authSessionInvalid();
  if (r.ok === true) {
    if (r.notice === "new_access") await deps.sendNotice("new_access", ctx.user);
    if (remember && typeof r.session_id === "string") {
      // "Mantener mi sesión en este dispositivo (30 días)": la base decide; si no se puede, queda la
      // sesión normal de 12 h (nunca al revés).
      const { data, error } = await deps.rpc("prive_remember_session", { _user: ctx.user.id, _session_id: r.session_id });
      const m = (data ?? {}) as Record<string, unknown>;
      if (!error && m.ok === true && typeof m.expires_at === "string") {
        return ok({ prive_session: r.token, expires_at: m.expires_at, remember: true });
      }
      deps.log?.("prive-access: no se pudo recordar la sesión", error ? error.message : String(m.code ?? ""));
    }
    return ok({ prive_session: r.token, expires_at: r.expires_at });
  }
  if (r.notice === "hard_lock") await deps.sendNotice("hard_lock", ctx.user);
  return fail(String(r.reason ?? "WRONG_PASSWORD"), r.locked_until ? { locked_until: r.locked_until } : {});
}

/**
 * Forma canónica de una contraseña Privé: Unicode NFC y sin espacios al inicio ni al final.
 * El dueño quedó fuera de Privé con su propia contraseña: lo más probable es un espacio que el
 * teclado agregó al final o un acento compuesto distinto (iPhone vs Mac). Para el servidor eran
 * contraseñas distintas. Se aplica igual al crear, cambiar, restablecer y entrar.
 */
export function canonicalPassword(v: unknown): unknown {
  return typeof v === "string" ? v.normalize("NFC").trim() : v;
}

export async function handlePriveAction(body: unknown, ctx: PriveRequestCtx, deps: PriveAccessDeps): Promise<ActionOutcome> {
  if (!body || typeof body !== "object" || Array.isArray(body)) return invalid("body");
  const b = { ...(body as Record<string, unknown>) };
  for (const k of ["password", "new_password", "old_password"]) if (k in b) b[k] = canonicalPassword(b[k]);
  const action = b.action;
  if (typeof action !== "string" || !(ACTIONS as readonly string[]).includes(action)) return invalid("action");
  const uid = ctx.user.id;

  try {
    switch (action as PriveAction) {
      case "status": {
        const { data, error } = await deps.userRpc("prive_status", {});
        if (error) throw new Internal(`prive_status: ${error.message}`);
        return ok({ status: data });
      }

      case "accept_invitation": {
        let tokenHash: string | null = null;
        if (b.token !== undefined && b.token !== null && b.token !== "") {
          if (!isToken(b.token)) return fail("NO_INVITATION");
          tokenHash = await sha256Hex(b.token);
        }
        const r = await call(deps, "prive_accept_invitation", { _user: uid, _token_hash: tokenHash });
        if (r.ok !== true) {
          // INVITATION_OTHER_ACCOUNT: el texto al usuario es genérico (lo decide la interfaz); aquí solo el código.
          if (r.code === "INVITATION_OTHER_ACCOUNT") deps.log?.("prive-access: invitación de otra cuenta", uid);
          return fail(String(r.code ?? "NO_INVITATION"));
        }
        return ok({ already: r.already === true, member_code: r.member_code ?? null, activated_at: r.activated_at ?? null, first_name: r.first_name ?? null });
      }

      case "resend_invitation": {
        const r = await call(deps, "prive_resend_invitation", { _user: uid });
        if (r.ok !== true) return fail(String(r.code ?? "NO_INVITATION"));
        if (r.already === true) return ok({ already: true });
        const email = await deps.sendInvitationNow(uid);
        return ok({ email });
      }

      case "set_password": {
        let password: string;
        let breach: BreachCheck | "generated";
        let generated: string | null = null;
        if (b.generate === true) {
          generated = generatePassphrase(deps.random);
          password = generated;
          breach = "generated";
        } else {
          const chk = await checkNewPassword(deps, b.password);
          if ("problem" in chk) return fail(chk.problem);
          password = b.password as string;
          breach = chk.breach;
        }
        const r = await call(deps, "prive_set_password", { _user: uid, _password: password, _breach_check: breach });
        if (r.ok !== true) return fail(String(r.code ?? "PASSWORD_WEAK"));
        await deps.sendNotice("password_set", ctx.user);
        // Se abre la primera sesión para no pedir la contraseña dos veces seguidas.
        const s = await openSession(deps, ctx, password);
        return ok({
          breach_check: breach,
          ...(generated ? { generated_password: generated } : {}),
          ...(s.body.ok ? { prive_session: s.body.prive_session, expires_at: s.body.expires_at } : {}),
        });
      }

      case "unlock": {
        const password = str(b.password);
        if (!password) return invalid("password");
        if (b.remember !== undefined && typeof b.remember !== "boolean") return invalid("remember");
        return await openSession(deps, ctx, password, b.remember === true);
      }

      case "lock": {
        if (!isToken(b.prive_session)) return invalid("prive_session");
        await call(deps, "prive_lock_session", { _user: uid, _token_hash: await sha256Hex(b.prive_session) });
        return ok();
      }

      case "change_password": {
        const oldPw = str(b.old_password);
        if (!oldPw) return invalid("old_password");
        const code = await requireSession(deps, b.prive_session);
        if (code) return fail(code);
        const chk = await checkNewPassword(deps, b.new_password);
        if ("problem" in chk) return fail(chk.problem);
        const r = await call(deps, "prive_change_password", { _user: uid, _old: oldPw, _new: b.new_password, _breach_check: chk.breach });
        if (r.ok !== true) {
          if (r.notice === "hard_lock") await deps.sendNotice("hard_lock", ctx.user);
          return fail(String(r.code ?? r.reason ?? "WRONG_PASSWORD"), r.locked_until ? { locked_until: r.locked_until } : {});
        }
        await deps.sendNotice("password_changed", ctx.user);
        const s = await openSession(deps, ctx, b.new_password as string);
        return ok(s.body.ok ? { prive_session: s.body.prive_session, expires_at: s.body.expires_at } : {});
      }

      case "request_reset": {
        const { data, error } = await deps.rpc("prive_request_reset", { _user: uid });
        if (error) {
          const m = error.message.trim();
          if (m === "RATE_LIMITED") return fail("RATE_LIMITED");
          if (m === "NO_PASSWORD") return fail("NO_PASSWORD");
          throw new Internal(`prive_request_reset: ${m}`);
        }
        if (!ctx.user.email) return fail("EMAIL_UNAVAILABLE");
        const sent = await deps.sendResetEmail(ctx.user, String(data));
        // El token nunca vuelve al navegador: solo viaja por correo.
        return sent ? ok({ email: "sent" }) : fail("EMAIL_UNAVAILABLE");
      }

      case "complete_reset": {
        if (!isToken(b.token)) return fail("RESET_INVALID");
        const chk = await checkNewPassword(deps, b.new_password);
        if ("problem" in chk) return fail(chk.problem);
        const r = await call(deps, "prive_complete_reset", { _user: uid, _token: b.token, _new: b.new_password, _breach_check: chk.breach });
        if (r.ok !== true) return fail(String(r.code ?? "RESET_INVALID"));
        await deps.sendNotice("password_reset", ctx.user);
        const s = await openSession(deps, ctx, b.new_password as string);
        return ok(s.body.ok ? { prive_session: s.body.prive_session, expires_at: s.body.expires_at } : {});
      }

      case "report_compromised": {
        const r = await call(deps, "prive_report_compromised", { _user: uid });
        if (r.ok !== true) return fail(String(r.code ?? "NO_PASSWORD"));
        // Se manda de una vez el enlace para crear la nueva (si se puede).
        const { data, error } = await deps.rpc("prive_request_reset", { _user: uid });
        const token = !error && typeof data === "string" ? data : null;
        const emailed = token ? await deps.sendNotice("compromised", ctx.user, { resetToken: token }) : false;
        return ok({ sessions_closed: r.sessions_closed ?? 0, email: emailed ? "sent" : "unavailable" });
      }

      case "revoke_sessions": {
        const code = await requireSession(deps, b.prive_session);
        if (code) return fail(code);
        const { data, error } = await deps.rpc("prive_revoke_sessions", { _user: uid, _reason: "user_revoke_all" });
        if (error) throw new Internal(`prive_revoke_sessions: ${error.message}`);
        await deps.sendNotice("sessions_revoked", ctx.user);
        return ok({ sessions_closed: Number(data ?? 0) });
      }

      case "save_progress": {
        const code = await requireSession(deps, b.prive_session);
        if (code) return fail(code);
        const wv = b.welcome_version;
        if (wv !== undefined && wv !== null && !(Number.isInteger(wv) && (wv as number) >= 0 && (wv as number) <= 1000)) return invalid("welcome_version");
        const ob = b.onboarding;
        if (ob !== undefined && ob !== null && (typeof ob !== "object" || Array.isArray(ob) || JSON.stringify(ob).length > 2048)) return invalid("onboarding");
        const r = await call(deps, "prive_save_progress", { _user: uid, _welcome_version: wv ?? null, _onboarding: ob ?? null });
        if (r.ok !== true) return fail(String(r.code ?? "INVALID"));
        return ok({ welcome_version_seen: r.welcome_version_seen, onboarding: r.onboarding });
      }
    }
  } catch (e) {
    // Solo el nombre de la acción y el error de la base (sin contraseñas, tokens ni correos).
    deps.log?.("prive-access: error interno", action, e instanceof Internal ? e.message : "excepción");
    return fail("INTERNAL", {}, 500);
  }
  return invalid("action");
}
