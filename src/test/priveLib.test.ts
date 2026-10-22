import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  capturePriveTokenFromUrl,
  clearAllPriveState,
  readPendingToken,
  readPriveSession,
  savePriveSession,
  PRIVE_SESSION_KEY,
  PRIVE_INVITE_TOKEN_KEY,
} from "@/lib/priveSession";
import { checkPrivePassword, byteLength } from "@/lib/privePassword";
import { derivePriveView, invitationStart, tenureFraction } from "@/lib/priveView";
import { createPriveApi, normalizeStatus, priveCodeFromRpcError } from "@/lib/priveApi";
import { onboardingResumeStep, shouldAutoPlayWelcome, onboardingCompleted, onboardingSkipped } from "@/lib/priveOnboarding";
import { ceremonialCode, tenureLine, CODE_MESSAGES, maskEmail } from "@/lib/priveCopy";
import { activeStatus, baseStatus } from "./helpers/priveTestKit";

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  window.history.replaceState(null, "", "/");
});

describe("priveSession: token del enlace (#t=…)", () => {
  it("lo quita de la URL al instante y lo guarda solo en sessionStorage", () => {
    window.history.replaceState(null, "", "/prive/invitacion#t=abcDEF0123456789_-xyz");
    const t = capturePriveTokenFromUrl(window);
    expect(t).toBe("abcDEF0123456789_-xyz");
    expect(window.location.hash).toBe("");
    expect(window.location.href).not.toContain("abcDEF");
    expect(window.location.pathname).toBe("/prive/invitacion");
    expect(sessionStorage.getItem(PRIVE_INVITE_TOKEN_KEY)).toBe(t);
    expect(JSON.stringify({ ...localStorage })).not.toContain("abcDEF");
    expect(readPendingToken("invite")).toBe(t);
  });

  it("un token mal formado no se guarda, pero igual se borra de la URL", () => {
    window.history.replaceState(null, "", "/prive/restablecer#t=<script>");
    expect(capturePriveTokenFromUrl(window)).toBeNull();
    expect(window.location.hash).toBe("");
    expect(readPendingToken("reset")).toBeNull();
  });

  it("solo actúa en las rutas Privé con token", () => {
    window.history.replaceState(null, "", "/dashboard#t=abcDEF0123456789xyz");
    expect(capturePriveTokenFromUrl(window)).toBeNull();
    expect(window.location.hash).toBe("#t=abcDEF0123456789xyz");
  });
});

describe("priveSession: sesión Privé", () => {
  it("pertenece a un usuario: otra cuenta en la pestaña no la hereda", () => {
    savePriveSession({ token: "tok_1234567890", expiresAt: new Date(Date.now() + 3600e3).toISOString(), userId: "u1" });
    expect(readPriveSession("u1")?.token).toBe("tok_1234567890");
    expect(readPriveSession("u2")).toBeNull();
    // Leerla con otra cuenta la borra.
    expect(sessionStorage.getItem(PRIVE_SESSION_KEY)).toBeNull();
  });

  it("vencida no sirve y se borra; nunca va a localStorage", () => {
    savePriveSession({ token: "tok_1234567890", expiresAt: new Date(Date.now() - 1000).toISOString(), userId: "u1" });
    expect(localStorage.length).toBe(0);
    expect(readPriveSession("u1")).toBeNull();
    expect(sessionStorage.getItem(PRIVE_SESSION_KEY)).toBeNull();
  });

  it("clearAllPriveState borra sesión y enlaces pendientes (cierre de sesión)", () => {
    savePriveSession({ token: "tok_1234567890", expiresAt: new Date(Date.now() + 3600e3).toISOString(), userId: "u1" });
    sessionStorage.setItem(PRIVE_INVITE_TOKEN_KEY, "abcDEF0123456789xyz");
    clearAllPriveState();
    expect(sessionStorage.length).toBe(0);
  });
});

describe("privePassword: guía de fuerza", () => {
  it("exige 12–72 bytes", () => {
    expect(checkPrivePassword("corta").acceptable).toBe(false);
    expect(checkPrivePassword("a".repeat(5) + "b".repeat(80)).rules.find((r) => r.id === "length")!.ok).toBe(false);
    expect(byteLength("ñ")).toBe(2);
    // 36 "ñ" = 72 bytes (límite de bcrypt); 37 ya no.
    expect(checkPrivePassword("ñ".repeat(37)).rules.find((r) => r.id === "length")!.ok).toBe(false);
  });

  it("rechaza repeticiones, secuencias y palabras obvias", () => {
    expect(checkPrivePassword("aaaaaaaaaaaaaaaa").acceptable).toBe(false);
    expect(checkPrivePassword("Abcdefghijkl99").acceptable).toBe(false);
    expect(checkPrivePassword("qwertyuiop2026!").acceptable).toBe(false);
    expect(checkPrivePassword("password12345").acceptable).toBe(false);
    expect(checkPrivePassword("Privé2026!xyz").acceptable).toBe(false);
  });

  it("una frase de varias palabras es fuerte o excelente", () => {
    const c = checkPrivePassword("faro lento sobre bahía 1987", "faro lento sobre bahía 1987");
    expect(c.acceptable).toBe(true);
    expect(c.score).toBeGreaterThanOrEqual(3);
  });

  it("la confirmación debe coincidir", () => {
    const c = checkPrivePassword("faro lento sobre bahía 1987", "faro lento sobre bahia 1987");
    expect(c.rules.find((r) => r.id === "match")!.ok).toBe(false);
    expect(c.acceptable).toBe(false);
  });
});

describe("priveView: un estado del servidor → una pantalla", () => {
  it.each([
    ["sin PRO", baseStatus({ is_pro: false }), false, "teaser"],
    ["PRO < 90", baseStatus({ tenure_days: 47 }), false, "progress"],
    ["cumple, sin invitación aún", baseStatus({ tenure_days: 92, eligible: true }), false, "preparing"],
    ["invitación lista", baseStatus({ tenure_days: 92, eligible: true, membership_status: "invited", invitation_pending: true }), false, "invitation"],
    ["invitada pero sin PRO", baseStatus({ is_pro: false, membership_status: "invited" }), false, "paused_pro"],
    ["activa sin contraseña", activeStatus({ has_password: false, password_status: null }), false, "set_password"],
    ["activa, PRO terminó", activeStatus({ is_pro: false, eligible: false }), true, "paused_pro"],
    ["activa, antigüedad bajo 90 por reembolso", activeStatus({ eligible: false, tenure_days: 61 }), true, "paused_tenure"],
    ["revocada", activeStatus({ membership_status: "revoked" }), true, "revoked"],
    ["debe restablecer", activeStatus({ password_status: "must_reset" }), true, "must_reset"],
    ["bloqueo total", activeStatus({ password_status: "hard_locked" }), true, "must_reset"],
    ["activa sin sesión", activeStatus(), false, "locked"],
    ["activa con sesión", activeStatus(), true, "unlocked"],
  ])("%s", (_n, s, session, view) => {
    expect(derivePriveView(s, session)).toBe(view);
  });

  it("invitationStart reanuda en el paso 4 o explica por qué no", () => {
    expect(invitationStart(activeStatus({ has_password: false })).scene).toBe("access");
    expect(invitationStart(activeStatus()).message?.kind).toBe("ALREADY_ACTIVE");
    expect(invitationStart(baseStatus({ is_pro: false })).message?.kind).toBe("NOT_PRO");
    expect(invitationStart(baseStatus({ tenure_days: 10 })).message?.kind).toBe("NOT_ELIGIBLE");
    expect(invitationStart(baseStatus({ eligible: true, membership_status: "invited" })).scene).toBe("arrival");
  });

  it("progreso honesto: nunca más de 90 ni más del 100%", () => {
    expect(tenureLine(47)).toBe("Llevas 47 de 90 días de PRO pagado");
    expect(tenureLine(120)).toBe("Llevas 90 de 90 días de PRO pagado");
    expect(tenureFraction({ tenure_days: 200, required_days: 90 })).toBe(1);
  });
});

describe("priveOnboarding: estado en el servidor", () => {
  it("la bienvenida se reproduce sola solo si la versión vista es menor", () => {
    expect(shouldAutoPlayWelcome({ welcome_version_seen: 0 })).toBe(true);
    expect(shouldAutoPlayWelcome({ welcome_version_seen: 1 })).toBe(false);
  });
  it("reanuda en el paso guardado; terminada u omitida, no vuelve", () => {
    expect(onboardingResumeStep({})).toBe(0);
    expect(onboardingResumeStep({ version: 1, step: 3 })).toBe(3);
    expect(onboardingResumeStep({ version: 1, step: 99 })).toBe(5);
    expect(onboardingResumeStep(onboardingCompleted({}))).toBeNull();
    expect(onboardingResumeStep(onboardingSkipped({ version: 1 }, 2))).toBeNull();
    // Una versión nueva de la guía se muestra otra vez desde el inicio.
    expect(onboardingResumeStep({ version: 0, step: 4, completed_at: "2026-01-01" })).toBe(0);
  });
});

describe("priveCopy", () => {
  it("el código ceremonial es decorativo: la fecha en romanos, sin datos secretos", () => {
    expect(ceremonialCode("2026-10-22T18:30:00Z")).toBe("XXII · X · MMXXVI");
  });
  it("hay mensaje para cada código del contrato", () => {
    for (const c of ["NOT_PRO", "NOT_ELIGIBLE", "NO_INVITATION", "INVITATION_OTHER_ACCOUNT", "INVITATION_EXPIRED", "PASSWORD_WEAK", "PASSWORD_BREACHED", "PASSWORD_ALREADY_SET", "WRONG_PASSWORD", "LOCKED", "HARD_LOCKED", "MUST_RESET", "RESET_INVALID", "PRIVE_NO_SESSION", "PRIVE_NOT_PRO", "PRIVE_NOT_ELIGIBLE", "PRIVE_NOT_ACTIVATED", "PRIVE_REVOKED", "PRIVE_SESSION_INVALID", "PRIVE_SESSION_EXPIRED"]) {
      expect(CODE_MESSAGES[c as keyof typeof CODE_MESSAGES]).toBeTruthy();
    }
    // La invitación de otra cuenta no revela nada de esa cuenta.
    expect(CODE_MESSAGES.INVITATION_OTHER_ACCOUNT).not.toMatch(/@|nombre|correo de/i);
  });
  it("maskEmail", () => {
    expect(maskEmail("rodrigo@ejemplo.mx")).toBe("r••••••@ejemplo.mx");
  });
});

describe("priveApi (cliente tipado)", () => {
  const mkClient = (over: Partial<{ rpc: ReturnType<typeof vi.fn>; invoke: ReturnType<typeof vi.fn> }> = {}) => ({
    rpc: over.rpc ?? vi.fn(async () => ({ data: null, error: null })),
    functions: { invoke: over.invoke ?? vi.fn(async () => ({ data: { ok: true }, error: null })) },
  });

  it("normaliza prive_status sin abrir nada por omisión", () => {
    const s = normalizeStatus({ is_pro: "yes", membership_status: "weird", password_status: "none" });
    expect(s.is_pro).toBe(false);
    expect(s.membership_status).toBe("none");
    expect(s.password_status).toBeNull();
    expect(s.required_days).toBe(90);
  });

  it("contenido sin sesión Privé: NO llama al servidor", async () => {
    const client = mkClient();
    const api = createPriveApi(client);
    const r = await api.content("prive_for_you", null);
    expect(r).toEqual({ ok: false, code: "PRIVE_NO_SESSION" });
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("contenido con sesión manda _ps y traduce PRIVE_* del servidor", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { code: "P0001", message: "PRIVE_SESSION_EXPIRED" } }));
    const api = createPriveApi(mkClient({ rpc }));
    const r = await api.content("prive_for_you", "tok_abc", { p_limit: 8 });
    expect(rpc).toHaveBeenCalledWith("prive_for_you", { p_limit: 8, _ps: "tok_abc" });
    expect(r).toEqual({ ok: false, code: "PRIVE_SESSION_EXPIRED" });
    expect(priveCodeFromRpcError({ code: "PGRST202", message: "Could not find the function" })).toBe("NOT_AVAILABLE");
  });

  it("prive-access: negocio con ok:false, 401, 429 y códigos en el cuerpo de un error HTTP", async () => {
    const ctx = (status: number, body: unknown) => ({ status, clone: () => ({ text: async () => JSON.stringify(body) }) });
    const invoke = vi
      .fn()
      .mockResolvedValueOnce({ data: { ok: false, code: "WRONG_PASSWORD" }, error: null })
      .mockResolvedValueOnce({ data: null, error: { name: "FunctionsHttpError", context: ctx(401, {}) } })
      .mockResolvedValueOnce({ data: null, error: { name: "FunctionsHttpError", context: ctx(429, { code: "LOCKED", locked_until: "2026-10-22T20:00:00Z" }) } })
      .mockResolvedValueOnce({ data: null, error: { name: "FunctionsHttpError", context: ctx(401, { code: "PRIVE_SESSION_INVALID" }) } })
      .mockResolvedValueOnce({ data: null, error: { name: "FunctionsFetchError" } });
    const api = createPriveApi(mkClient({ invoke }));
    expect(await api.access("unlock", { password: "x" })).toEqual({ ok: false, code: "WRONG_PASSWORD", lockedUntil: null });
    expect((await api.access("unlock")).code).toBe("UNAUTHENTICATED");
    expect(await api.access("unlock")).toEqual({ ok: false, code: "LOCKED", lockedUntil: "2026-10-22T20:00:00Z" });
    expect((await api.access("save_progress")).code).toBe("PRIVE_SESSION_INVALID");
    expect((await api.access("status")).code).toBe("NETWORK");
    // La acción no se puede sobrescribir desde el cuerpo.
    await api.access("lock", { action: "unlock" } as never);
    expect(invoke).toHaveBeenLastCalledWith("prive-access", { body: { action: "lock" } });
  });

  it("foto ilustrativa: solo https, nunca lanza", async () => {
    const invoke = vi
      .fn()
      .mockResolvedValueOnce({ data: { image: "https://images.pexels.com/x.jpg", photographer: "Ana" }, error: null })
      .mockResolvedValueOnce({ data: { image: "javascript:alert(1)" }, error: null })
      .mockRejectedValueOnce(new Error("boom"));
    const api = createPriveApi(mkClient({ invoke }));
    expect(await api.illustrativePhoto("Paris")).toEqual({ image: "https://images.pexels.com/x.jpg", photographer: "Ana" });
    expect(await api.illustrativePhoto("Paris")).toBeNull();
    expect(await api.illustrativePhoto("Paris")).toBeNull();
  });
});
