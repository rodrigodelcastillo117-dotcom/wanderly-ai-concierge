// THE PRIVATE EDITION · comprobación de enlaces de fuentes (lógica pura, probada con vitest).
// Una fuente rota bloquea la aprobación del artículo (edition_article_checks). Un sitio que bloquea robots
// (401/403/429) NO se marca roto: queda "blocked" para revisión humana (nunca se inventa un estado).

export type LinkStatus = "ok" | "broken" | "blocked";

/** Solo https a nombres de host públicos (sin IP literales, localhost ni dominios internos). */
export function isCheckableUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:") return false;
    const h = u.hostname.toLowerCase();
    if (!h.includes(".") || h === "localhost" || h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".invalid")) return false;
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.startsWith("[") || h.includes(":")) return false;
    return true;
  } catch {
    return false;
  }
}

export function classify(status: number | null): LinkStatus {
  if (status === null) return "broken";
  if (status >= 200 && status < 400) return "ok";
  if ([401, 403, 405, 406, 429, 999].includes(status)) return "blocked";
  return "broken";
}

type FetchLike = (url: string, init: RequestInit) => Promise<{ status: number; body?: { cancel?: () => unknown } | null }>;

/** HEAD y, si el servidor no lo acepta, GET de un solo byte. Reintenta una vez ante error de red o 5xx. */
export async function checkLink(url: string, fetchImpl: FetchLike = fetch as unknown as FetchLike, timeoutMs = 8000): Promise<{ status: LinkStatus; http: number | null }> {
  if (!isCheckableUrl(url)) return { status: "broken", http: null };
  const once = async (method: "HEAD" | "GET"): Promise<number | null> => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await fetchImpl(url, {
        method, redirect: "follow", signal: ctrl.signal,
        headers: { "User-Agent": "IATOS-Edition-LinkCheck/1.0 (+https://iatos.mx)", ...(method === "GET" ? { Range: "bytes=0-0" } : {}) },
      });
      try { await r.body?.cancel?.(); } catch { /* noop */ }
      return r.status;
    } catch {
      return null;
    } finally {
      clearTimeout(t);
    }
  };
  let code = await once("HEAD");
  if (code === null || code === 405 || code === 403 || code === 501) code = (await once("GET")) ?? code;
  if (code === null || (code >= 500 && code < 600)) code = (await once("GET")) ?? code;
  return { status: classify(code), http: code };
}
