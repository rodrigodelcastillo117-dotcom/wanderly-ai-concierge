// Cliente tipado de IATOS Privé (contrato Privé §3 y §4).
//
// Todo pasa por aquí para que las pantallas no hablen con Supabase directamente y las pruebas
// puedan simular el servidor con un solo vi.mock("@/lib/priveApi"):
//   · estado        → supabase.rpc("prive_status")          (sin secretos, solo datos propios)
//   · acciones      → supabase.functions.invoke("prive-access", { body: { action, … } })
//   · contenido     → supabase.rpc("prive_*", { _ps, … })    (solo con sesión Privé; si no, ni se llama)
//   · foto ilustr.  → supabase.functions.invoke("pexels-image") (Grand Welcome)
// El servidor decide siempre. Un código PRIVE_* en cualquier respuesta significa "esta sesión ya no
// vale": quien llama borra la sesión local y vuelve a la pantalla de candado (usePriveAccess).
import { supabase } from "@/integrations/supabase/client";

export const PRIVE_REQUIRED_DAYS = 90;

/** Códigos de prive_require (SQLSTATE P0001): la sesión Privé no sirve para esta llamada. */
export const PRIVE_SESSION_CODES = [
  "PRIVE_NO_SESSION",
  "PRIVE_NOT_PRO",
  "PRIVE_NOT_ELIGIBLE",
  "PRIVE_NOT_ACTIVATED",
  "PRIVE_REVOKED",
  "PRIVE_SESSION_INVALID",
  "PRIVE_SESSION_EXPIRED",
] as const;
export type PriveSessionCode = (typeof PRIVE_SESSION_CODES)[number];

/** Códigos de negocio de prive-access (HTTP 200, ok:false). */
export const PRIVE_ACCESS_CODES = [
  "NOT_PRO",
  "NOT_ELIGIBLE",
  "NO_INVITATION",
  "INVITATION_OTHER_ACCOUNT",
  "INVITATION_EXPIRED",
  "PASSWORD_WEAK",
  "PASSWORD_BREACHED",
  "PASSWORD_ALREADY_SET",
  "WRONG_PASSWORD",
  "LOCKED",
  "HARD_LOCKED",
  "MUST_RESET",
  "RESET_INVALID",
  // Observados en la implementación de la rama core (no están en la lista del contrato §3):
  "NO_PASSWORD", // restablecer/reportar sin contraseña creada
  "EMAIL_UNAVAILABLE", // no se pudo enviar el correo (Resend apagado o sin correo)
] as const;

/** Códigos que pone este cliente cuando no hay respuesta de negocio. */
export const PRIVE_CLIENT_CODES = [
  "UNAUTHENTICATED", // 401: la sesión de IATOS expiró
  "RATE_LIMITED", // 429
  "INVALID_REQUEST", // 400
  "NETWORK", // sin conexión
  "SERVICE_UNAVAILABLE", // 5xx o respuesta inesperada
  "NOT_AVAILABLE", // la RPC de contenido aún no existe (el catálogo se integra en otra rama)
] as const;

export type PriveErrorCode =
  | PriveSessionCode
  | (typeof PRIVE_ACCESS_CODES)[number]
  | (typeof PRIVE_CLIENT_CODES)[number];

export const isPriveSessionCode = (c: unknown): c is PriveSessionCode =>
  typeof c === "string" && (PRIVE_SESSION_CODES as readonly string[]).includes(c);

const KNOWN_CODES = new Set<string>([...PRIVE_SESSION_CODES, ...PRIVE_ACCESS_CODES, ...PRIVE_CLIENT_CODES]);

export type PriveOnboarding = {
  version?: number;
  step?: number;
  completed_at?: string | null;
  skipped_at?: string | null;
  /** Consentimiento para usar el Travel DNA en Privé (null = aún no decide). */
  dna_consent?: boolean | null;
};

export type MembershipStatus = "none" | "invited" | "active" | "revoked";

export type PriveStatus = {
  is_pro: boolean;
  tenure_days: number;
  required_days: number;
  eligible: boolean;
  basis: "tenure" | "grant" | null;
  membership_status: MembershipStatus;
  has_password: boolean;
  /** El servidor manda 'none' sin contraseña; aquí queda null. */
  password_status: "active" | "must_reset" | "hard_locked" | null;
  locked_until: string | null;
  activated_at: string | null;
  member_code: string | null;
  first_name: string | null;
  welcome_version_seen: number;
  onboarding: PriveOnboarding;
  invitation_pending: boolean;
  members_requires_prive: boolean;
};

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
const int = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : d);

/** Lee prive_status() con tolerancia: un campo faltante nunca abre nada (por omisión, sin acceso). */
export function normalizeStatus(raw: unknown): PriveStatus {
  const d = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const ms = d.membership_status;
  const ps = d.password_status;
  const ob = d.onboarding && typeof d.onboarding === "object" ? (d.onboarding as PriveOnboarding) : {};
  return {
    is_pro: d.is_pro === true,
    tenure_days: int(d.tenure_days),
    required_days: int(d.required_days, PRIVE_REQUIRED_DAYS) || PRIVE_REQUIRED_DAYS,
    eligible: d.eligible === true,
    basis: d.basis === "tenure" || d.basis === "grant" ? d.basis : null,
    membership_status: ms === "invited" || ms === "active" || ms === "revoked" ? ms : "none",
    has_password: d.has_password === true,
    password_status: ps === "active" || ps === "must_reset" || ps === "hard_locked" ? ps : null,
    locked_until: str(d.locked_until),
    activated_at: str(d.activated_at),
    member_code: str(d.member_code),
    first_name: str(d.first_name),
    welcome_version_seen: int(d.welcome_version_seen),
    onboarding: ob,
    invitation_pending: d.invitation_pending === true,
    members_requires_prive: d.members_requires_prive === true,
  };
}

// Las dos ramas declaran los mismos campos para que el código lea r.code / r.data sin depender de
// strictNullChecks (la app compila sin modo estricto).
export type PriveFailure = { ok: false; code: PriveErrorCode; lockedUntil?: string | null; data?: undefined };
export type PriveSuccess<T = Record<string, unknown>> = { ok: true; data: T; code?: undefined; lockedUntil?: undefined };
export type PriveResult<T = Record<string, unknown>> = PriveSuccess<T> | PriveFailure;

export type PriveAction =
  | "status"
  | "accept_invitation"
  | "resend_invitation"
  | "set_password"
  | "unlock"
  | "lock"
  | "change_password"
  | "request_reset"
  | "complete_reset"
  | "report_compromised"
  | "revoke_sessions"
  | "save_progress";

type InvokeClient = {
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
  functions: { invoke: (fn: string, opts: { body: unknown }) => Promise<{ data: unknown; error: unknown }> };
};

type ResponseLike = { status?: number; clone?: () => ResponseLike; text?: () => Promise<string>; json?: () => Promise<unknown> };

async function readErrorBody(ctx: ResponseLike | undefined): Promise<Record<string, unknown> | null> {
  if (!ctx) return null;
  try {
    const res = typeof ctx.clone === "function" ? ctx.clone() : ctx;
    if (typeof res.text === "function") {
      const raw = await res.text();
      const parsed = raw ? JSON.parse(raw) : null;
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
    }
    if (typeof res.json === "function") {
      const parsed = await res.json();
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
    }
  } catch {
    /* cuerpo vacío o no JSON */
  }
  return null;
}

const asCode = (v: unknown): PriveErrorCode | null => (typeof v === "string" && KNOWN_CODES.has(v) ? (v as PriveErrorCode) : null);

/** Código PRIVE_* dentro de un error de PostgREST (RAISE ... USING MESSAGE = 'PRIVE_…'). */
export function priveCodeFromRpcError(error: unknown): PriveErrorCode {
  const e = (error ?? {}) as { message?: unknown; code?: unknown; details?: unknown };
  const msg = typeof e.message === "string" ? e.message : "";
  const m = /PRIVE_[A-Z_]+/.exec(msg);
  if (m && isPriveSessionCode(m[0])) return m[0];
  if (e.code === "PGRST202" || e.code === "42883") return "NOT_AVAILABLE";
  if (/failed to fetch|network/i.test(msg)) return "NETWORK";
  return "SERVICE_UNAVAILABLE";
}

export function createPriveApi(client: InvokeClient) {
  return {
    async status(): Promise<PriveResult<PriveStatus>> {
      try {
        const { data, error } = await client.rpc("prive_status");
        if (error) return { ok: false, code: priveCodeFromRpcError(error) };
        return { ok: true, data: normalizeStatus(data) };
      } catch {
        return { ok: false, code: "NETWORK" };
      }
    },

    async access<T = Record<string, unknown>>(action: PriveAction, body: Record<string, unknown> = {}): Promise<PriveResult<T>> {
      try {
        const { data, error } = await client.functions.invoke("prive-access", { body: { ...body, action } });
        if (error) {
          const e = error as { name?: unknown; context?: ResponseLike };
          if (e.name === "FunctionsFetchError") return { ok: false, code: "NETWORK" };
          const status = typeof e.context?.status === "number" ? e.context.status : null;
          const b = await readErrorBody(e.context);
          const code = asCode(b?.code);
          if (code) return { ok: false, code, lockedUntil: str(b?.locked_until) };
          if (status === 401) return { ok: false, code: "UNAUTHENTICATED" };
          if (status === 429) return { ok: false, code: "RATE_LIMITED", lockedUntil: str(b?.locked_until) };
          if (status === 400) return { ok: false, code: "INVALID_REQUEST" };
          return { ok: false, code: "SERVICE_UNAVAILABLE" };
        }
        const d = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
        if (d.ok === true) return { ok: true, data: d as T };
        return { ok: false, code: asCode(d.code) ?? "SERVICE_UNAVAILABLE", lockedUntil: str(d.locked_until) };
      } catch {
        return { ok: false, code: "NETWORK" };
      }
    },

    /**
     * RPC de contenido Privé (catálogo). Sin token NO se llama al servidor: no se pide contenido
     * reservado sin sesión Privé. El servidor igual lo exige (prive_require).
     */
    async content<T = unknown>(fn: string, ps: string | null | undefined, args: Record<string, unknown> = {}): Promise<PriveResult<T>> {
      if (!ps) return { ok: false, code: "PRIVE_NO_SESSION" };
      if (!/^prive_[a-z_]+$/.test(fn)) return { ok: false, code: "INVALID_REQUEST" };
      try {
        const { data, error } = await client.rpc(fn, { ...args, _ps: ps });
        if (error) return { ok: false, code: priveCodeFromRpcError(error) };
        return { ok: true, data: data as T };
      } catch {
        return { ok: false, code: "NETWORK" };
      }
    },

    /** Foto ilustrativa de Pexels (caché compartida de 7 días en el servidor). Nunca lanza. */
    async illustrativePhoto(query: string): Promise<{ image: string; photographer: string | null } | null> {
      try {
        const { data, error } = await client.functions.invoke("pexels-image", { body: { query } });
        if (error) return null;
        const d = (data ?? {}) as { image?: unknown; photographer?: unknown };
        const image = str(d.image);
        if (!image || !/^https:\/\//.test(image)) return null;
        return { image, photographer: str(d.photographer) };
      } catch {
        return null;
      }
    },
  };
}

export type PriveApi = ReturnType<typeof createPriveApi>;

export const priveApi: PriveApi = createPriveApi(supabase as unknown as InvokeClient);
