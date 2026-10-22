// Revisión periódica de enlaces oficiales (complemento, punto 7). Sin Deno.serve (se prueba con
// Vitest). Respeta robots.txt, una sola página por URL, 1 MB máximo, sin JavaScript, sin CAPTCHAs,
// máximo `perRun` URLs y un host por corrida. Un 403/429 es "bloqueado" (anti-bots), no "roto": no se
// insiste ni se evade.
import { checkTrustedSource, providerFor, registrableDomain } from "../_shared/booking/allowlist.ts";
import { detectReservationLinks, robotsAllows, SCAN_MAX_BYTES, SCAN_TTL_DAYS, SCAN_USER_AGENT, type ScanFinding } from "../_shared/booking/siteScan.ts";

export type DueLink = { id: string; url: string; host: string; kind: string };
export type LinkVerdict = {
  id: string; status: "ok" | "broken" | "blocked" | "robots_disallowed" | "redirected_offsite" | "unknown";
  http_status: number | null; final_host: string | null; findings: ScanFinding | Record<string, never>; error: string | null;
  checked_at: string; expires_at: string;
};

const SOFT_404 = /page not found|p[aá]gina no encontrada|we can.?t find (that|this) page|no podemos encontrar (esa|la) p[aá]gina|this page (does not|doesn.?t) exist|esta p[aá]gina no existe/i;
/** Texto visible de una página de error que responde 200 (sin ejecutar JavaScript). */
export function isSoft404(html: string): boolean {
  const title = /<title[^>]*>([^<]{0,300})<\/title>/i.exec(html)?.[1] ?? "";
  const body = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").slice(0, 20000);
  return SOFT_404.test(`${title} ${body}`);
}

/** Una URL por host y como máximo perRun (control de tasa por corrida). */
export function pickBatch(rows: DueLink[], perRun = 20): DueLink[] {
  const hosts = new Set<string>();
  const out: DueLink[] = [];
  for (const r of rows) {
    const h = registrableDomain(r.host) ?? r.host;
    if (hosts.has(h)) continue;
    hosts.add(h);
    out.push(r);
    if (out.length >= perRun) break;
  }
  return out;
}

async function readCapped(res: Response, max = SCAN_MAX_BYTES): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < max) {
    const { value, done } = await reader.read();
    if (done || !value) break;
    chunks.push(value);
    total += value.length;
  }
  try { await reader.cancel(); } catch { /* ya terminó */ }
  const all = new Uint8Array(Math.min(total, max));
  let off = 0;
  for (const c of chunks) { const n = Math.min(c.length, all.length - off); all.set(c.subarray(0, n), off); off += n; if (off >= all.length) break; }
  return new TextDecoder().decode(all);
}

export async function checkOne(link: DueLink, doFetch: typeof fetch, now = Date.now()): Promise<LinkVerdict> {
  const base = { id: link.id, http_status: null as number | null, final_host: null as string | null, findings: {} as LinkVerdict["findings"], error: null as string | null,
    checked_at: new Date(now).toISOString(), expires_at: new Date(now + SCAN_TTL_DAYS * 86400_000).toISOString() };
  const safe = checkTrustedSource(link.url);
  if (!safe.ok) return { ...base, status: "unknown", error: `inseguro:${safe.reason}` };
  const u = new URL(safe.url);
  try {
    const robots = await doFetch(`${u.origin}/robots.txt`, { headers: { "User-Agent": SCAN_USER_AGENT }, redirect: "follow", signal: AbortSignal.timeout(8000) })
      .then(async (r) => (r.ok ? await readCapped(r, 200_000) : null)).catch(() => null);
    if (!robotsAllows(robots, u.pathname + u.search)) return { ...base, status: "robots_disallowed" };
    let current = safe.url;
    let res: Response | null = null;
    for (let hop = 0; hop < 5; hop++) {
      res = await doFetch(current, { headers: { "User-Agent": SCAN_USER_AGENT, Accept: "text/html" }, redirect: "manual", signal: AbortSignal.timeout(10000) });
      const loc = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
      if (!loc) break;
      const next = new URL(loc, current).toString();
      const nh = new URL(next).hostname;
      // Una redirección a otro dominio que no es un proveedor conocido = sospechosa (no se sigue). El
      // dominio registrable sale de la Public Suffix List (AUD-07): "chef.wixsite.com" →
      // "pagos.wixsite.com" es OTRO dueño, aunque compartan "wixsite.com".
      const same = registrableDomain(nh) !== null && registrableDomain(nh) === registrableDomain(u.hostname);
      // Tampoco se sigue un salto a http, a una IP o a un host interno (no se pide nada inseguro).
      if (!checkTrustedSource(next).ok || (!same && !providerFor(nh, new URL(next).pathname))) {
        return { ...base, status: "redirected_offsite", http_status: res.status, final_host: nh };
      }
      current = next;
    }
    if (!res) return { ...base, status: "unknown" };
    const fh = new URL(current).hostname;
    if (res.status === 403 || res.status === 429 || res.status === 503) return { ...base, status: "blocked", http_status: res.status, final_host: fh };
    if (res.status >= 400) return { ...base, status: "broken", http_status: res.status, final_host: fh };
    const html = /html/i.test(res.headers.get("content-type") ?? "html") ? await readCapped(res) : "";
    // "Soft 404": responde 200 pero la página dice que no existe (visto en Resy, 2026-10-22).
    if (isSoft404(html)) return { ...base, status: "broken", http_status: res.status, final_host: fh };
    const findings = link.kind === "official_site" && html ? detectReservationLinks(html, current) : {};
    return { ...base, status: "ok", http_status: res.status, final_host: fh, findings };
  } catch (e) {
    return { ...base, status: "unknown", error: String((e as Error)?.message ?? e).slice(0, 200) };
  }
}
