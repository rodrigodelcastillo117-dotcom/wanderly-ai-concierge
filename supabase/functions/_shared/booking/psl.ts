// Dominio registrable con la Public Suffix List (AUD-07). Sin Deno ni red: la lista es una copia
// fijada (psl_data.ts, regenerada con scripts/booking/update_psl.mjs). Algoritmo oficial
// (https://github.com/publicsuffix/list/wiki/Format#formal-algorithm): gana la regla que coincide con
// más etiquetas; una excepción ("!") gana siempre y su sufijo es la regla sin su primera etiqueta; si
// ninguna coincide, la regla por omisión es "*" (el TLD). Se usan las dos secciones (ICANN y
// privada): para seguridad, "chef.wixsite.com" y "pagos.wixsite.com" son dueños distintos.
import { PSL_ICANN, PSL_PRIVATE } from "./psl_data.ts";

let RULES: Set<string> | null = null;
let WILD: Set<string>;
let EXC: Set<string>;

function load(): void {
  if (RULES) return;
  RULES = new Set();
  WILD = new Set();
  EXC = new Set();
  for (const r of `${PSL_ICANN},${PSL_PRIVATE}`.split(",")) {
    if (!r) continue;
    if (r.startsWith("!")) EXC.add(r.slice(1));
    else if (r.startsWith("*.")) WILD.add(r.slice(2));
    else RULES.add(r);
  }
}

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/** Host en minúsculas y punycode (como lo deja el parser de URL), sin punto final; null si no es un nombre DNS. */
export function asciiHost(host: string): string | null {
  if (typeof host !== "string" || !host || host.length > 253 || /[\s/\\@:?#[\]%]/.test(host)) return null;
  let h: string;
  try {
    h = new URL(`https://${host}/`).hostname;
  } catch {
    return null;
  }
  h = h.toLowerCase().replace(/\.$/, "");
  if (!h || IPV4.test(h) || h.startsWith("[") || h.split(".").some((l) => !l || l.length > 63)) return null;
  return h;
}

/** Sufijo público de un host ("co.uk", "github.io", "kawasaki.jp"…) o null si el TLD no existe en la PSL. */
export function publicSuffix(host: string): string | null {
  const h = asciiHost(host);
  if (!h) return null;
  load();
  const labels = h.split(".");
  const tld = labels[labels.length - 1];
  // Un TLD que la PSL no conoce (".local", ".corp", ".internal", errores de dedo) no es un host público.
  if (!RULES!.has(tld) && !WILD.has(tld)) return null;
  for (let i = 0; i < labels.length; i++) {
    const cand = labels.slice(i).join(".");
    if (EXC.has(cand)) return labels.slice(i + 1).join(".");
    if (RULES!.has(cand) || (i + 1 < labels.length && WILD.has(labels.slice(i + 1).join(".")))) return cand;
  }
  return tld;
}

/** Dominio registrable (sufijo público + una etiqueta) o null si el host es una IP, un sufijo público o un TLD inexistente. */
export function registrableDomain(host: string): string | null {
  const h = asciiHost(host);
  const ps = h ? publicSuffix(h) : null;
  if (!h || !ps || h === ps) return null;
  const rest = h.slice(0, h.length - ps.length - 1).split(".");
  return `${rest[rest.length - 1]}.${ps}`;
}
