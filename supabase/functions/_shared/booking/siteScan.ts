// Verificación sin scraping abusivo (complemento, punto 7). Sin Deno.
//
// Se lee UNA página pública (la portada del sitio oficial que ya tenemos de una fuente confiable),
// solo si robots.txt lo permite, con límite de tamaño y de frecuencia, y se buscan enlaces públicos
// legítimos: el botón de reservas (OpenTable, Resy, SevenRooms, Tock, TheFork, TableCheck, Zenchef,
// CoverManager, Google "Reservar"), WhatsApp click-to-chat, mailto: y tel:. No se navega más allá,
// no se ejecuta JavaScript, no se evaden CAPTCHAs ni se automatiza ninguna compra.
import { checkAllowlisted } from "./allowlist.ts";
import { emailFromMailto, whatsappNumberFromUrl } from "./channels.ts";

export const SCAN_USER_AGENT = "IATOSLinkCheck/1.0 (+https://traveliatos.life/privacidad)";
export const SCAN_MAX_BYTES = 1_000_000;
/** Una verificación guardada vale 30 días; después se vuelve a revisar (cron con límite por host). */
export const SCAN_TTL_DAYS = 30;

export type ScanFinding = {
  booking: Array<{ provider: string; url: string }>;
  whatsapp: string[]; // dígitos E.164
  emails: string[];
  phones: string[]; // tal como aparecen en tel:
};

const RESERVATION_PROVIDERS = new Set(["opentable", "resy", "sevenrooms", "tock", "thefork", "tablecheck", "zenchef", "covermanager"]);

/** Atributos href de la página (sin ejecutar nada). */
export function extractHrefs(html: string): string[] {
  const out: string[] = [];
  const re = /<a\b[^>]*?\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi;
  let m: RegExpExecArray | null;
  let guard = 0;
  while ((m = re.exec(html)) && guard++ < 5000) out.push((m[2] ?? m[3] ?? m[4] ?? "").replace(/&amp;/g, "&").trim());
  return out;
}

export function detectReservationLinks(html: string, baseUrl: string): ScanFinding {
  const f: ScanFinding = { booking: [], whatsapp: [], emails: [], phones: [] };
  const seen = new Set<string>();
  for (const raw of extractHrefs(String(html ?? "").slice(0, SCAN_MAX_BYTES))) {
    if (!raw || seen.has(raw)) continue;
    seen.add(raw);
    if (/^mailto:/i.test(raw)) {
      const e = emailFromMailto(raw);
      if (e && !f.emails.includes(e)) f.emails.push(e);
      continue;
    }
    if (/^tel:/i.test(raw)) {
      const t = decodeURIComponent(raw.slice(4)).trim();
      if (/^[+\d][\d\s().-]{6,24}$/.test(t) && !f.phones.includes(t)) f.phones.push(t);
      continue;
    }
    let abs: string;
    try { abs = new URL(raw, baseUrl).toString(); } catch { continue; }
    const wa = whatsappNumberFromUrl(abs);
    if (wa) { if (!f.whatsapp.includes(wa)) f.whatsapp.push(wa); continue; }
    const v = checkAllowlisted(abs);
    if (v.ok && v.provider && RESERVATION_PROVIDERS.has(v.provider.provider) && !f.booking.some((b) => b.url === v.url)) {
      f.booking.push({ provider: v.provider.provider, url: v.url });
    } else if (v.ok && v.provider?.provider === "google_maps" && /\/maps\/reserve\//.test(new URL(abs).pathname)) {
      f.booking.push({ provider: "google_reserve", url: v.url });
    }
  }
  return f;
}

/** Patrón de robots.txt → RegExp (solo * y $ final tienen significado). */
function robotsPattern(p: string): RegExp {
  const end = p.endsWith("$");
  const body = (end ? p.slice(0, -1) : p).split("*").map((x) => x.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*");
  return new RegExp("^" + body + (end ? "$" : ""));
}

/**
 * ¿robots.txt permite leer esta ruta a nuestro agente (o a "*")? Implementa lo básico de RFC 9309:
 * grupos por user-agent, Allow/Disallow con la regla más larga; comodín * y $ al final.
 */
export function robotsAllows(robotsTxt: string | null | undefined, path: string, agent = "IATOSLinkCheck"): boolean {
  if (!robotsTxt) return true;
  type Rule = { allow: boolean; pattern: string };
  const groups: Array<{ agents: string[]; rules: Rule[] }> = [];
  let current: { agents: string[]; rules: Rule[] } | null = null;
  let lastWasAgent = false;
  for (const line of robotsTxt.split(/\r?\n/)) {
    const l = line.replace(/#.*/, "").trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(l);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (key === "user-agent") {
      if (!current || !lastWasAgent) { current = { agents: [], rules: [] }; groups.push(current); }
      current.agents.push(val.toLowerCase());
      lastWasAgent = true;
    } else if ((key === "allow" || key === "disallow") && current) {
      lastWasAgent = false;
      if (key === "disallow" && !val) continue; // "Disallow:" vacío = todo permitido
      current.rules.push({ allow: key === "allow", pattern: val });
    } else {
      lastWasAgent = false;
    }
  }
  const a = agent.toLowerCase();
  const mine = groups.filter((g) => g.agents.some((x) => x !== "*" && a.includes(x)));
  const use = mine.length ? mine : groups.filter((g) => g.agents.includes("*"));
  let best: Rule | null = null;
  for (const g of use) {
    for (const r of g.rules) {
      if (robotsPattern(r.pattern).test(path) && (!best || r.pattern.length > best.pattern.length || (r.pattern.length === best.pattern.length && r.allow))) best = r;
    }
  }
  return best ? best.allow : true;
}
