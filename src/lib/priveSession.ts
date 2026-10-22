// Sesión de IATOS Privé en el navegador (contrato Privé §4, decisión D7).
//
// El token de sesión Privé lo emite el servidor (prive-access → unlock) y el servidor decide en
// cada llamada si sigue vigente (12 h máximo, cierre por inactividad, revocación al perder PRO).
// Aquí se guarda en localStorage para que una pestaña nueva (abrir un destino aparte, volver desde
// el correo) no pida la contraseña otra vez: antes vivía en sessionStorage y cada pestaña nueva la
// pedía, y ahí el navegador solía autollenar la contraseña de la CUENTA en vez de la Privé
// ("contraseña incorrecta"). Se borra al cerrar sesión, al cambiar de usuario, al bloquear Privé y
// ante cualquier error PRIVE_*. Nunca se usa como autoridad (no hay "unlocked = true" sin servidor).
//
// Cierre de auditoría (grupo prive): localStorage sobrevive al cierre del navegador; sessionStorage no.
// Para no perder esa protección (computadora compartida: quien la abre después no debe entrar a Privé
// sin la contraseña Privé), una sesión NORMAL se acompaña de una cookie de sesión del navegador (sin
// fecha, sin el token; compartida entre pestañas, se borra al cerrar el navegador). Sin esa cookie, la
// sesión guardada se descarta. Solo la sesión que la persona pidió recordar ("mantener mi sesión en
// este dispositivo", 30 días, decidido y vigilado por el servidor) sobrevive al cierre.
//
// Este módulo va en el paquete inicial (lo importa AuthContext para limpiar al cerrar sesión), por
// eso es diminuto y no importa nada.

export const PRIVE_SESSION_KEY = "iatos.prive.session";
export const PRIVE_INVITE_TOKEN_KEY = "iatos.prive.invite_token";
export const PRIVE_RESET_TOKEN_KEY = "iatos.prive.reset_token";

export type StoredPriveSession = {
  token: string;
  /** ISO de vencimiento absoluto que dio el servidor (12 h). */
  expiresAt: string;
  /** Usuario de IATOS dueño de la sesión: otra cuenta en la misma pestaña no la hereda. */
  userId: string;
  /** La persona eligió "mantener mi sesión en este dispositivo" (el servidor la aceptó). */
  remember?: boolean;
};

/** Cookie de sesión del navegador (sin Expires): marca que este navegador no se ha cerrado. */
export const PRIVE_BROWSER_SESSION_COOKIE = "iatos_prive_bs";

function setBrowserSessionMarker() {
  try {
    if (typeof document === "undefined") return;
    const secure = typeof location !== "undefined" && location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${PRIVE_BROWSER_SESSION_COOKIE}=1; Path=/; SameSite=Strict${secure}`;
  } catch {
    /* sin cookies: la sesión normal durará solo hasta que se lea sin la marca */
  }
}

function hasBrowserSessionMarker(): boolean {
  try {
    return typeof document !== "undefined" && document.cookie.split(/;\s*/).includes(`${PRIVE_BROWSER_SESSION_COOKIE}=1`);
  } catch {
    return false;
  }
}

function clearBrowserSessionMarker() {
  try {
    if (typeof document !== "undefined") document.cookie = `${PRIVE_BROWSER_SESSION_COOKIE}=; Path=/; Max-Age=0; SameSite=Strict`;
  } catch {
    /* noop */
  }
}

const ss = (): Storage | null => {
  try {
    return typeof window !== "undefined" ? window.sessionStorage : null;
  } catch {
    return null;
  }
};

/** Almacén de la sesión Privé: compartido entre pestañas del mismo navegador. */
const ls = (): Storage | null => {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
};

export function savePriveSession(s: StoredPriveSession) {
  try {
    if (!s.remember) setBrowserSessionMarker();
    ls()?.setItem(PRIVE_SESSION_KEY, JSON.stringify(s));
  } catch {
    /* almacenamiento lleno o bloqueado: la sesión dura solo en memoria */
  }
}

/** Token vigente del usuario indicado, o null (vencido, de otra cuenta, corrupto). */
export function readPriveSession(userId: string | null | undefined, now = Date.now()): StoredPriveSession | null {
  if (!userId) return null;
  try {
    let raw = ls()?.getItem(PRIVE_SESSION_KEY) ?? null;
    if (!raw) {
      // Sesiones abiertas antes del cambio (vivían solo en esta pestaña): se pasan al almacén compartido.
      raw = ss()?.getItem(PRIVE_SESSION_KEY) ?? null;
      if (!raw) return null;
      ss()?.removeItem(PRIVE_SESSION_KEY);
      ls()?.setItem(PRIVE_SESSION_KEY, raw);
      setBrowserSessionMarker(); // venía de esta pestaña: el navegador sigue abierto
    }
    const s = JSON.parse(raw) as Partial<StoredPriveSession>;
    const exp = typeof s.expiresAt === "string" ? Date.parse(s.expiresAt) : NaN;
    const remember = s.remember === true;
    if (typeof s.token !== "string" || !s.token || s.userId !== userId || !Number.isFinite(exp) || exp <= now
        || (!remember && !hasBrowserSessionMarker())) {
      clearPriveSession();
      return null;
    }
    return { token: s.token, expiresAt: s.expiresAt as string, userId, ...(remember ? { remember: true } : {}) };
  } catch {
    clearPriveSession();
    return null;
  }
}

export function clearPriveSession() {
  clearBrowserSessionMarker();
  try {
    ls()?.removeItem(PRIVE_SESSION_KEY);
    ss()?.removeItem(PRIVE_SESSION_KEY);
  } catch {
    /* noop */
  }
}

/** Al cerrar sesión: la sesión Privé y los enlaces pendientes (invitación, restablecer). */
export function clearAllPriveState() {
  clearPriveSession();
  try {
    ss()?.removeItem(PRIVE_INVITE_TOKEN_KEY);
    ss()?.removeItem(PRIVE_RESET_TOKEN_KEY);
  } catch {
    /* noop */
  }
}

// ── Token del enlace (#t=…) ────────────────────────────────────────────────────────────────
// La invitación y el restablecimiento llegan como /prive/invitacion#t=… y /prive/restablecer#t=…
// (D6): el fragmento no viaja al servidor ni al Referer. En cuanto la app arranca, lo sacamos de
// la URL (history.replaceState) y lo guardamos SOLO en sessionStorage, para que no quede en el
// historial, en capturas de pantalla, en analítica ni en el "from" del inicio de sesión.

const TOKEN_ROUTES: Record<string, string> = {
  "/prive/invitacion": PRIVE_INVITE_TOKEN_KEY,
  "/prive/restablecer": PRIVE_RESET_TOKEN_KEY,
};

// Un token del servidor es base64url; cualquier otra cosa se descarta sin guardarla.
const TOKEN_RE = /^[A-Za-z0-9_-]{16,256}$/;

export function parseFragmentToken(hash: string): string | null {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const t = params.get("t");
  return t && TOKEN_RE.test(t) ? t : null;
}

/**
 * Si la URL actual es una ruta Privé con #t=…, guarda el token en sessionStorage y lo quita de la
 * URL. Devuelve el token (o null). Se llama al evaluar AuthContext y, de respaldo, al montar la
 * página (navegación interna).
 */
export function capturePriveTokenFromUrl(win: Window | undefined = typeof window !== "undefined" ? window : undefined): string | null {
  if (!win) return null;
  try {
    const { pathname, hash, search } = win.location;
    const path = pathname.replace(/\/+$/, "") || "/";
    const key = TOKEN_ROUTES[path];
    if (!key || !hash || !/[#&]t=/.test(hash)) return null;
    const token = parseFragmentToken(hash);
    // Siempre se quita el fragmento, aunque el token sea inválido.
    win.history.replaceState(win.history.state, "", path + search);
    if (!token) return null;
    try {
      win.sessionStorage.setItem(key, token);
    } catch {
      /* sin sessionStorage: la página lo pedirá de nuevo con la notificación en la app */
    }
    return token;
  } catch {
    return null;
  }
}

export function readPendingToken(kind: "invite" | "reset"): string | null {
  try {
    const v = ss()?.getItem(kind === "invite" ? PRIVE_INVITE_TOKEN_KEY : PRIVE_RESET_TOKEN_KEY) ?? null;
    return v && TOKEN_RE.test(v) ? v : null;
  } catch {
    return null;
  }
}

export function clearPendingToken(kind: "invite" | "reset") {
  try {
    ss()?.removeItem(kind === "invite" ? PRIVE_INVITE_TOKEN_KEY : PRIVE_RESET_TOKEN_KEY);
  } catch {
    /* noop */
  }
}
