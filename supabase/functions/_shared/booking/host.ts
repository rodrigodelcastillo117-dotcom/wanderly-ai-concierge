// Normalización de host (sin datos ni Deno). Vive aparte de psl.ts para que la lista blanca del navegador
// (src/lib/bookingAllowlist.ts) no cargue la lista de sufijos públicos completa (~150 KB).

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
