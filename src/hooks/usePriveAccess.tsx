// Estado de IATOS Privé compartido por las pantallas /prive/* (contrato Privé §4).
//
// · status   → prive_status() (servidor). Nunca se decide nada en el navegador.
// · session  → token de sesión Privé en sessionStorage (priveSession.ts), solo del usuario actual.
// · unlocked → hay sesión y el servidor dice que la membresía está activa; la siguiente llamada
//              sensible lo vuelve a comprobar (prive_require).
// · Cualquier respuesta con un código PRIVE_* borra la sesión local y regresa a /prive, que muestra
//   el candado o el adelanto según el estado real.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import {
  priveApi,
  isPriveSessionCode,
  type PriveAction,
  type PriveErrorCode,
  type PriveResult,
  type PriveStatus,
} from "@/lib/priveApi";
import { clearPriveSession, readPriveSession, savePriveSession, type StoredPriveSession } from "@/lib/priveSession";
import { derivePriveView, type PriveView } from "@/lib/priveView";
import { messageFor } from "@/lib/priveCopy";

type CallOpts = { withSession?: boolean };

export type PriveAccess = {
  loading: boolean;
  status: PriveStatus | null;
  statusError: PriveErrorCode | null;
  view: PriveView | null;
  session: StoredPriveSession | null;
  unlocked: boolean;
  /** Aviso calmado tras perder la sesión ("Tu sesión Privé venció…"). */
  notice: string | null;
  clearNotice: () => void;
  refresh: () => Promise<PriveStatus | null>;
  unlock: (password: string) => Promise<PriveResult>;
  lock: () => Promise<void>;
  /** Guarda una sesión que el servidor acaba de emitir (p. ej. al terminar la ceremonia). */
  adoptSession: (token: string, expiresAt: string) => void;
  /** Llama a prive-access; con withSession agrega prive_session y maneja los PRIVE_*. */
  call: <T = Record<string, unknown>>(action: PriveAction, body?: Record<string, unknown>, opts?: CallOpts) => Promise<PriveResult<T>>;
  /** RPC de contenido del catálogo; sin sesión no se llama. */
  content: <T = unknown>(fn: string, args?: Record<string, unknown>) => Promise<PriveResult<T>>;
  /** Actualiza el estado local tras un guardado confirmado por el servidor. */
  patchStatus: (patch: Partial<PriveStatus>) => void;
};

const PriveContext = createContext<PriveAccess | undefined>(undefined);

export function PriveProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const uid = user?.id ?? null;
  const navigate = useNavigate();
  const location = useLocation();
  const [status, setStatus] = useState<PriveStatus | null>(null);
  const [statusError, setStatusError] = useState<PriveErrorCode | null>(null);
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<StoredPriveSession | null>(() => readPriveSession(uid));
  const [notice, setNotice] = useState<string | null>(null);
  const reqRef = useRef(0);
  const pathRef = useRef(location.pathname);
  pathRef.current = location.pathname;

  const refresh = useCallback(async () => {
    const req = ++reqRef.current;
    if (!uid) {
      setStatus(null);
      setLoading(false);
      return null;
    }
    setLoading(true);
    const r = await priveApi.status();
    if (req !== reqRef.current) return null;
    setLoading(false);
    if (r.ok) {
      setStatus(r.data);
      setStatusError(null);
      return r.data;
    }
    setStatusError(r.code);
    return null;
  }, [uid]);

  // Otra cuenta en la misma pestaña (o cierre de sesión): nada de la anterior se conserva.
  useEffect(() => {
    setSession(readPriveSession(uid));
    setStatus(null);
    void refresh();
  }, [uid, refresh]);

  // La sesión vence a las 12 h aunque nadie llame al servidor.
  useEffect(() => {
    if (!session) return;
    const ms = Date.parse(session.expiresAt) - Date.now();
    const t = window.setTimeout(() => {
      clearPriveSession();
      setSession(null);
    }, Math.max(0, Math.min(ms, 2 ** 31 - 1)));
    return () => window.clearTimeout(t);
  }, [session]);

  const expire = useCallback(
    (code: PriveErrorCode) => {
      clearPriveSession();
      setSession(null);
      setNotice(messageFor(code));
      void refresh();
      if (pathRef.current !== "/prive") navigate("/prive", { replace: true });
    },
    [navigate, refresh],
  );

  const adoptSession = useCallback(
    (token: string, expiresAt: string) => {
      if (!uid || !token) return;
      const s = { token, expiresAt, userId: uid };
      savePriveSession(s);
      setSession(s);
      setNotice(null);
    },
    [uid],
  );

  const call = useCallback(
    async <T,>(action: PriveAction, body: Record<string, unknown> = {}, opts: CallOpts = {}): Promise<PriveResult<T>> => {
      let payload = body;
      if (opts.withSession) {
        const s = readPriveSession(uid);
        if (!s) {
          expire("PRIVE_NO_SESSION");
          return { ok: false, code: "PRIVE_NO_SESSION" };
        }
        payload = { ...body, prive_session: s.token };
      }
      const r = await priveApi.access<T>(action, payload);
      if (!r.ok && isPriveSessionCode(r.code)) expire(r.code);
      return r;
    },
    [uid, expire],
  );

  const content = useCallback(
    async <T,>(fn: string, args: Record<string, unknown> = {}): Promise<PriveResult<T>> => {
      const s = readPriveSession(uid);
      if (!s) return { ok: false, code: "PRIVE_NO_SESSION" };
      const r = await priveApi.content<T>(fn, s.token, args);
      if (!r.ok && isPriveSessionCode(r.code)) expire(r.code);
      return r;
    },
    [uid, expire],
  );

  const unlock = useCallback(
    async (password: string): Promise<PriveResult> => {
      const r = await priveApi.access<{ prive_session?: string; expires_at?: string }>("unlock", { password });
      if (r.ok) {
        const token = typeof r.data.prive_session === "string" ? r.data.prive_session : "";
        const exp = typeof r.data.expires_at === "string" ? r.data.expires_at : new Date(Date.now() + 12 * 3600e3).toISOString();
        if (!token) return { ok: false, code: "SERVICE_UNAVAILABLE" };
        adoptSession(token, exp);
        return { ok: true, data: {} };
      }
      // Cambió el estado (p. ej. MUST_RESET, PRO terminó): se vuelve a leer.
      if (r.code !== "WRONG_PASSWORD") void refresh();
      return r;
    },
    [adoptSession, refresh],
  );

  const lock = useCallback(async () => {
    const s = readPriveSession(uid);
    clearPriveSession();
    setSession(null);
    if (s) await priveApi.access("lock", { prive_session: s.token });
  }, [uid]);

  const patchStatus = useCallback((patch: Partial<PriveStatus>) => {
    setStatus((prev) => (prev ? { ...prev, ...patch } : prev));
  }, []);

  const view = status ? derivePriveView(status, !!session) : null;
  const value = useMemo<PriveAccess>(
    () => ({
      loading,
      status,
      statusError,
      view,
      session,
      unlocked: view === "unlocked",
      notice,
      clearNotice: () => setNotice(null),
      refresh,
      unlock,
      lock,
      adoptSession,
      call,
      content,
      patchStatus,
    }),
    [loading, status, statusError, view, session, notice, refresh, unlock, lock, adoptSession, call, content, patchStatus],
  );

  return <PriveContext.Provider value={value}>{children}</PriveContext.Provider>;
}

export function usePriveAccess(): PriveAccess {
  const ctx = useContext(PriveContext);
  if (!ctx) throw new Error("usePriveAccess must be used inside PriveProvider");
  return ctx;
}
