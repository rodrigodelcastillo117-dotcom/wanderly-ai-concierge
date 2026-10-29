// Reglas de la lista blanca del Booking Bridge SIN datos: protección contra open redirects, dominios
// falsos y URLs inseguras. Las mismas funciones las arman dos listas:
//  * allowlist.ts (servidor: booking-bridge, booking-go…): proveedores con su justificación (`why`) y la
//    Public Suffix List completa (psl.ts).
//  * src/lib/bookingAllowlist.ts (navegador): los mismos dominios y rutas sin notas internas y una lista
//    de sufijos reducida (ronda 2 de la auditoría técnica, P2-5: el paquete público llevaba 169 KB del
//    archivo del servidor). El cliente solo decide qué botón pintar; booking-bridge y booking-go vuelven a
//    revisar con la lista completa antes de guardar o redirigir.
// Sin Deno: se prueba con Vitest.
import { asciiHost } from "./host.ts";

export type ProviderKind = "ota" | "metasearch" | "airline" | "restaurant_booking" | "tours" | "maps" | "messaging" | "bus" | "rail" | "ferry" | "cruise" | "boat_rental" | "affiliate_redirect" | "hotel_chain" | "tickets";

/** Regla de un proveedor permitido (sin la justificación, que solo vive en el servidor). */
export type ProviderRule = {
  /** Dominio registrable (sin www) o un subdominio concreto (international.ado.com.mx). */
  domain: string;
  provider: string; // id estable
  label: string; // nombre que ve el usuario
  kind: ProviderKind;
  /** Rutas permitidas (si el dominio aloja otras cosas, p. ej. google.com). */
  paths?: RegExp;
  /**
   * Redirect: "wrapper" lleva el destino a la vista (tp.media?u=…, se desenvuelve y se revisa);
   * "opaque" es un clic de anuncio o de Google cuyo destino final NO se ve (google.com/aclk,
   * /travel/clk): solo vale si lo dio una API del servidor, nunca de la IA ni del cliente.
   */
  redirector?: "wrapper" | "opaque";
  /**
   * Solo si lo dio una API del servidor (p. ej. productUrl de la Partner API de Viator): la IA o el
   * cliente no pueden escribir un enlace así (checkUntrusted lo rechaza).
   */
  serverOnly?: boolean;
  /**
   * Hosts exactos permitidos cuando el dominio aloja servicios de terceros (google.com: sites.google.com
   * y docs.google.com publican páginas de cualquiera). Sin esto vale cualquier subdominio.
   */
  hosts?: string[];
  /**
   * No cuenta como marca para el detector de dominios falsos: taquillas de museos cuyo nombre es una
   * palabra común en sitios reales de restaurantes y hoteles ("trattoriadelduomo.it", "hotelcolosseo.it").
   */
  noBrand?: true;
  /** Por qué este dominio es legítimo (solo en la lista del servidor; AUD-04). */
  why?: string;
};

export type UrlVerdict<P extends ProviderRule = ProviderRule> =
  // (campos opcionales en ambas ramas: el tsconfig de la app no es strict y no estrecha por `ok`)
  | { ok: true; url: string; host: string; provider: P | null; trust: "allowlist" | "trusted_source"; reason?: undefined }
  | { ok: false; reason: string; url?: undefined; host?: undefined; provider?: undefined; trust?: undefined };

/**
 * Marcas que un dominio falso podría imitar ("booking-com.reservas.io", "b00king.com"). Es un
 * DETECTOR ADICIONAL, no el control: lo que decide si se puede salir a un dominio fuera de la lista
 * es de dónde vino el dato (solo catálogo curado y escaneo del sitio oficial; ver resolver.ts y
 * booking-bridge), y booking-go firma el destino exacto y su nivel. Las marcas salen de los proveedores
 * (la etiqueta de su dominio) más las de EXTRA_BRANDS.
 *  * "long": basta con que aparezca dentro de la etiqueta, o a una letra de diferencia (≥ 7 letras).
 *  * "token": marcas cortas o palabras comunes (resy, kayak, delta, united…): solo si la etiqueta ES
 *    la marca (otro TLD: "delta.mx") o la marca va junto a una palabra típica de phishing
 *    ("kayak-ofertas", "iberia-vuelos"). Así no se marca "fresyogurt.com" ni "hotel-delta.com".
 */
const EXTRA_BRANDS: Array<[string, "long" | "token"]> = [
  ["expedia", "long"], ["tripadvisor", "long"], ["paypal", "long"], ["google", "long"], ["whatsapp", "long"], ["mercadopago", "long"],
  ["stripe", "token"], ["tock", "token"],
];
const TOKEN_ONLY = new Set(["resy", "kayak", "omio", "delta", "united", "latam", "klm", "ado", "iberia", "avianca", "volaris", "stripe", "tock", "bahn", "renfe"]);
const PHISHING_WORDS = new Set(["login", "secure", "seguro", "account", "cuenta", "verify", "verifica", "pago", "pagos", "pay", "payment",
  "checkout", "reserva", "reservas", "reservation", "reservations", "booking", "vuelo", "vuelos", "flight", "flights", "airline", "airlines",
  "deal", "deals", "oferta", "ofertas", "promo", "promos", "soporte", "support", "ayuda", "help", "oficial", "official", "app", "online",
  "tickets", "boletos", "mx", "es", "us", "com"]);
/** Dominios reales de esas marcas que no están en la lista de proveedores no se tratan como falsos. */
const BRAND_REAL_DOMAINS = ["expedia.com", "expedia.mx", "hotels.com", "tripadvisor.com", "tripadvisor.com.mx", "paypal.com", "stripe.com",
  "googleusercontent.com", "mercadopago.com.mx"];

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
const MAX_URL = 4096;

/**
 * Barras, barras invertidas o puntos codificados en la ruta (%2F, %5C, %2E), también con doble o triple
 * codificación (%252F, %25252E; endurecimiento O2): para saltar una ruta permitida.
 */
const ENCODED_PATH_TRICK = /%(?:25)*(2f|5c|2e)/i;

function hostMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/**
 * Variantes de la etiqueta con las sustituciones típicas de phishing (0→o, 1→l/i, rn→m, vv→w…).
 * A2-F2: también l↔i ("vlator" → viator, "googIe" → google) y sin guiones ("air-bnb" → airbnb).
 */
function skeletons(label: string): string[] {
  const base = label.replace(/0/g, "o").replace(/3/g, "e").replace(/5/g, "s").replace(/4/g, "a").replace(/7/g, "t").replace(/rn/g, "m").replace(/vv/g, "w");
  const v = [label, base.replace(/1/g, "l"), base.replace(/1/g, "i")];
  const li = v.flatMap((x) => [x.replace(/l/g, "i"), x.replace(/i/g, "l")]);
  return [...new Set([...v, ...li].flatMap((x) => [x, x.replace(/-/g, "")]))];
}

/** Distancia de edición ≤ 1 (sustitución, inserción, borrado o transposición de dos letras). */
function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) {
    if (a.slice(i + 1) === b.slice(i + 1)) return true; // sustitución
    return a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2); // transposición
  }
  const [lng, sht] = a.length > b.length ? [a, b] : [b, a];
  return lng.slice(i + 1) === sht.slice(i);
}

/**
 * Arma las funciones de la lista blanca sobre una lista de proveedores y una forma de calcular el
 * dominio registrable (null para IPs, sufijos públicos y TLDs inexistentes).
 */
export function createAllowlist<P extends ProviderRule>(providers: readonly P[], registrableDomain: (host: string) => string | null) {
  type Verdict = UrlVerdict<P>;

  let BRANDS: Array<[string, "long" | "token"]> | null = null;
  function brands(): Array<[string, "long" | "token"]> {
    if (BRANDS) return BRANDS;
    const m = new Map<string, "long" | "token">();
    for (const p of providers) {
      if (p.noBrand) continue;
      const reg = registrableDomain(p.domain) ?? p.domain;
      const label = reg.split(".")[0];
      if (label.length >= 3) m.set(label, TOKEN_ONLY.has(label) ? "token" : "long"); // aa, wa, tp: demasiado cortas
      // A2-F2: con etiqueta corta, la marca es el dominio sin puntos ("tp-media.com" imita a tp.media).
      else m.set(reg.replace(/\./g, ""), reg === "tp.media" ? "long" : "token");
    }
    for (const [b, mode] of EXTRA_BRANDS) m.set(b, mode);
    return (BRANDS = [...m.entries()]);
  }

  /** Proveedor de la lista blanca para un host y ruta, o null. */
  function providerFor(host: string, pathname = "/"): P | null {
    const h = host.toLowerCase();
    for (const p of providers) {
      if (!hostMatches(h, p.domain)) continue;
      if (p.hosts && !p.hosts.includes(h)) continue;
      if (p.paths && !p.paths.test(pathname)) continue;
      return p;
    }
    return null;
  }

  /** Reglas comunes de seguridad de una URL de salida (https, sin credenciales, sin IP, puerto 443, TLD real). */
  function basicCheck(raw: unknown): { ok: true; u: URL; reason?: undefined } | { ok: false; reason: string; u?: undefined } {
    if (typeof raw !== "string") return { ok: false, reason: "no_es_texto" };
    const s = raw.trim();
    if (!s || s.length > MAX_URL) return { ok: false, reason: "longitud" };
    // Caracteres de control o espacios internos: típico de intentos de inyección.
    if (/[\u0000-\u001f\u007f\s\\]/.test(s)) return { ok: false, reason: "caracteres_invalidos" };
    let u: URL;
    try {
      u = new URL(s);
    } catch {
      return { ok: false, reason: "url_invalida" };
    }
    if (u.protocol !== "https:") return { ok: false, reason: "no_https" };
    if (u.username || u.password) return { ok: false, reason: "credenciales_en_url" };
    if (u.port && u.port !== "443") return { ok: false, reason: "puerto" };
    const host = u.hostname.toLowerCase();
    // A2: un FQDN con punto final ("www.google.com.") no coincide con la lista y saltaba la regla de proveedores.
    if (host.endsWith(".")) return { ok: false, reason: "host_no_publico" };
    if (!host.includes(".") || IPV4.test(host) || host.startsWith("[") || /(^|\.)(localhost|local|internal|lan|home|corp)\.?$/.test(host)) {
      return { ok: false, reason: "host_no_publico" };
    }
    // Un nombre que no cuelga de un sufijo público real (TLD inexistente, "localhost.", "github.io" solo).
    if (!registrableDomain(host)) return { ok: false, reason: "host_no_publico" };
    return { ok: true, u };
  }

  /** ¿El host imita una marca conocida sin ser su dominio real? (detector adicional; ver EXTRA_BRANDS). */
  function looksLikeBrandImpersonation(host: string): boolean {
    const h = asciiHost(host);
    if (!h) return true;
    if (providers.some((p) => hostMatches(h, p.domain)) || BRAND_REAL_DOMAINS.some((d) => hostMatches(h, d))) return false;
    const reg = registrableDomain(h);
    if (!reg) return true;
    // Punycode en el dominio registrable: no se puede saber a simple vista qué marca imita.
    if (reg.split(".").some((l) => l.startsWith("xn--"))) return true;
    const label = reg.split(".")[0];
    // Subdominios con el nombre de una marca: "booking.com.evil.io", "secure-opentable.evil.io".
    const sub = h.slice(0, h.length - reg.length).split(/[.-]/).filter(Boolean);
    for (const sk of skeletons(label)) {
      const words = sk.split(/[-\d]+/).filter(Boolean);
      const hasBait = words.some((w) => PHISHING_WORDS.has(w));
      for (const [b, mode] of brands()) {
        if (sk === b || sub.includes(b)) return true;
        if (mode === "token") {
          if (words.includes(b) && (hasBait || words.length === 1)) return true;
          // A2-F2: marca pegada a una palabra de phishing ("deltaairlines", "vuelosdelta").
          if (words.some((w) => (w.startsWith(b) && PHISHING_WORDS.has(w.slice(b.length))) || (w.endsWith(b) && PHISHING_WORDS.has(w.slice(0, -b.length))))) return true;
          // A2-F2: una letra de más o de menos ("reesy", "resyy"), misma inicial; no sustituciones
          // ("rosy", "della" son nombres reales).
          if (b.length >= 4 && (hasBait || words.length === 1) && words.some((w) => w[0] === b[0] && w.length !== b.length && withinOneEdit(w, b))) return true;
          continue;
        }
        if (sk.includes(b)) return true;
        // A2-F2: a una letra de diferencia desde 5 letras (antes 7: "googie", "vlator" no se veían).
        if (b.length >= 5 && words.some((w) => w[0] === b[0] && withinOneEdit(w, b))) return true;
      }
    }
    return false;
  }

  /**
   * URL permitida para el nivel ESTRICTO. Un redirect "wrapper" (tp.media) solo si su destino `u`
   * también lo es, y nunca un redirect dentro de otro (tp.media → google.com/aclk → …).
   */
  function checkAllowlisted(raw: unknown, depth = 0): Verdict {
    const b = basicCheck(raw);
    if (!b.ok) return { ok: false, reason: b.reason };
    const host = b.u.hostname.toLowerCase();
    const prov = providerFor(host, b.u.pathname);
    if (!prov) return { ok: false, reason: "dominio_no_permitido" };
    if (prov.paths && ENCODED_PATH_TRICK.test(b.u.pathname)) return { ok: false, reason: "ruta_codificada" };
    if (prov.redirector && depth > 0) return { ok: false, reason: "redirect_anidado" };
    if (prov.redirector === "wrapper") {
      const inner = b.u.searchParams.get("u");
      const v = checkAllowlisted(inner, depth + 1);
      if (!v.ok) return { ok: false, reason: `destino_afiliado_${v.reason}` };
    }
    return { ok: true, url: b.u.toString(), host, provider: prov, trust: "allowlist" };
  }

  /**
   * URL que escribió la IA o mandó el cliente: lista estricta y, además, sin redirects opacos
   * (google.com/aclk, /travel/clk), porque su destino final no se puede revisar. Esos enlaces solo
   * valen cuando los devuelve una API del servidor.
   */
  function checkUntrusted(raw: unknown): Verdict {
    const v = checkAllowlisted(raw);
    if (v.ok && v.provider?.redirector === "opaque") return { ok: false, reason: "redirect_sin_destino_visible" };
    if (v.ok && v.provider?.serverOnly) return { ok: false, reason: "enlace_solo_del_servidor" };
    return v;
  }

  /** ¿La URL es un redirect (de afiliado o de anuncio) de la lista? */
  function isRedirector(raw: string): boolean {
    try {
      const u = new URL(raw);
      return !!providerFor(u.hostname, u.pathname)?.redirector;
    } catch {
      return false;
    }
  }

  /**
   * URL de un sitio oficial que vino de una fuente estructurada del servidor. Acepta dominios fuera de
   * la lista blanca, pero nunca uno que imite una marca ni uno inseguro.
   */
  function checkTrustedSource(raw: unknown): Verdict {
    const strict = checkAllowlisted(raw);
    if (strict.ok) return strict;
    const b = basicCheck(raw);
    if (!b.ok) return { ok: false, reason: b.reason };
    const host = b.u.hostname.toLowerCase();
    // Un dominio de proveedor conocido (google.com, tp.media, booking.com…) solo vale con sus reglas
    // estrictas: así google.com/url?q=… o tp.media con destino falso no entran como "fuente confiable".
    if (providers.some((p) => hostMatches(host, p.domain))) return { ok: false, reason: strict.reason ?? "ruta_no_permitida" };
    if (looksLikeBrandImpersonation(host)) return { ok: false, reason: "dominio_sospechoso" };
    return { ok: true, url: b.u.toString(), host, provider: null, trust: "trusted_source" };
  }

  /** Destino real de un enlace (desenvuelve tp.media/click?u=…), para comparar fechas y producto. */
  function unwrapAffiliate(url: string): string {
    try {
      const u = new URL(url);
      if (hostMatches(u.hostname.toLowerCase(), "tp.media")) return u.searchParams.get("u") ?? url;
    } catch { /* no es URL */ }
    return url;
  }

  /** Nombre del proveedor que procesará la compra, para el aviso "quién procesa". */
  function processorLabel(url: string): string {
    try {
      const u = new URL(unwrapAffiliate(url));
      return providerFor(u.hostname, u.pathname)?.label ?? u.hostname.replace(/^www\./, "");
    } catch {
      return "el proveedor";
    }
  }

  return { providerFor, looksLikeBrandImpersonation, checkAllowlisted, checkUntrusted, isRedirector, checkTrustedSource, unwrapAffiliate, processorLabel };
}
