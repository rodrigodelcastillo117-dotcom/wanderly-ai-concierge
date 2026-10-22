// A dónde regresar después de iniciar sesión (IATOS-083). ProtectedRoute manda a /auth con
// state.from = la ruta que se pidió; aquí solo se acepta una ruta INTERNA de la app (empieza con
// una sola "/"), nunca una URL externa (//otro.com, https://…, /\otro.com, javascript:…), para que
// nadie pueda usar el inicio de sesión para mandar al usuario a otro sitio.
const BLOCKED = /^\/(auth|reset-password)(\/|\?|#|$)/;

export function safeRedirectPath(from: unknown): string | null {
  let path: string | null = null;
  if (typeof from === "string") path = from;
  else if (from && typeof from === "object") {
    const l = from as { pathname?: unknown; search?: unknown; hash?: unknown };
    if (typeof l.pathname === "string") {
      path = l.pathname + (typeof l.search === "string" ? l.search : "") + (typeof l.hash === "string" ? l.hash : "");
    }
  }
  if (!path) return null;
  path = path.trim();
  // Una sola barra al inicio y sin barras invertidas ni caracteres de control (los navegadores
  // tratan "/\" como "//").
  if (!path.startsWith("/") || path.startsWith("//") || /[\\\u0000-\u001f]/.test(path)) return null;
  try {
    const u = new URL(path, "https://iatos.invalid");
    if (u.origin !== "https://iatos.invalid") return null;
    const out = u.pathname + u.search + u.hash;
    return BLOCKED.test(out) ? null : out;
  } catch {
    return null;
  }
}
