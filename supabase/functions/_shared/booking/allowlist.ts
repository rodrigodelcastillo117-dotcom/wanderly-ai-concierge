// Dominios de salida del Booking Bridge (Fase 12): lista blanca, protección contra open redirects y
// dominios falsos. Sin Deno: lo usan el cliente (antes de pintar un enlace), booking-bridge (antes de
// guardar el destino de una intención) y booking-go (antes de redirigir).
//
// Dos niveles de confianza:
//  * ESTRICTO (allowlist): para URLs que escribió la IA o que manda el cliente. Solo dominios de
//    proveedores conocidos, con rutas acotadas cuando el dominio es genérico (google.com).
//  * FUENTE CONFIABLE (trusted): sitios oficiales que vienen de una fuente estructurada del servidor
//    (catálogo Privé curado por el equipo, Google Places, Google Hotels vía SerpApi). Pueden ser de
//    cualquier dominio, pero deben pasar las reglas de seguridad y no imitar una marca conocida.

export type ProviderInfo = {
  /** Dominio registrable (sin www). */
  domain: string;
  provider: string; // id estable
  label: string; // nombre que ve el usuario
  kind: "ota" | "metasearch" | "airline" | "restaurant_booking" | "tours" | "maps" | "messaging" | "bus" | "affiliate_redirect" | "hotel_chain";
  /** Rutas permitidas (si el dominio aloja otras cosas, p. ej. google.com). */
  paths?: RegExp;
};

const P = (domain: string, provider: string, label: string, kind: ProviderInfo["kind"], paths?: RegExp): ProviderInfo =>
  ({ domain, provider, label, kind, paths });

/**
 * Proveedores permitidos. Cada formato de enlace que IATOS ARMA está documentado en
 * docs/iatos/IATOS_BOOKING_BRIDGE.md §Evidencia; aquí solo se decide a qué dominios se puede salir.
 */
export const PROVIDERS: ProviderInfo[] = [
  // Vuelos
  P("aviasales.com", "aviasales", "Aviasales", "metasearch", /^\/search\//),
  P("google.com", "google_flights", "Google Flights", "metasearch", /^\/travel\/flights(\/|\?|$)|^\/travel\/clk\//),
  P("skyscanner.com.mx", "skyscanner", "Skyscanner", "metasearch"),
  P("kayak.com", "kayak", "Kayak", "metasearch"),
  P("aeromexico.com", "aeromexico", "Aeroméxico", "airline"),
  P("iberia.com", "iberia", "Iberia", "airline"),
  P("aa.com", "american", "American Airlines", "airline"),
  P("united.com", "united", "United", "airline"),
  P("delta.com", "delta", "Delta", "airline"),
  P("airfrance.com", "airfrance", "Air France", "airline"),
  P("klm.com", "klm", "KLM", "airline"),
  P("lufthansa.com", "lufthansa", "Lufthansa", "airline"),
  P("britishairways.com", "britishairways", "British Airways", "airline"),
  P("latam.com", "latam", "LATAM", "airline"),
  P("avianca.com", "avianca", "Avianca", "airline"),
  P("volaris.com", "volaris", "Volaris", "airline"),
  P("vivaaerobus.com", "vivaaerobus", "Viva Aerobus", "airline"),
  P("aircanada.com", "aircanada", "Air Canada", "airline"),
  P("turkishairlines.com", "turkish", "Turkish Airlines", "airline"),
  // Hoteles
  P("booking.com", "booking", "Booking.com", "ota"),
  P("airbnb.com", "airbnb", "Airbnb", "ota"),
  // Google Hotels (enlaces de precios que devuelve SerpApi: google.com/aclk) y Maps
  P("google.com", "google_hotels", "Google Hotels", "metasearch", /^\/aclk(\?|$)|^\/travel\/hotels(\/|\?|$)/),
  P("google.com", "google_maps", "Google Maps", "maps", /^\/maps(\/|\?|$)/),
  // Restaurantes: sistemas públicos de reserva (no requieren ser socio para abrir su página pública)
  P("opentable.com", "opentable", "OpenTable", "restaurant_booking"),
  P("opentable.com.mx", "opentable", "OpenTable", "restaurant_booking"),
  P("opentable.co.uk", "opentable", "OpenTable", "restaurant_booking"),
  P("opentable.de", "opentable", "OpenTable", "restaurant_booking"),
  P("opentable.es", "opentable", "OpenTable", "restaurant_booking"),
  P("opentable.it", "opentable", "OpenTable", "restaurant_booking"),
  P("opentable.jp", "opentable", "OpenTable", "restaurant_booking"),
  P("opentable.ca", "opentable", "OpenTable", "restaurant_booking"),
  P("exploretock.com", "tock", "Tock", "restaurant_booking"),
  P("resy.com", "resy", "Resy", "restaurant_booking"),
  P("sevenrooms.com", "sevenrooms", "SevenRooms", "restaurant_booking"),
  P("thefork.com", "thefork", "TheFork", "restaurant_booking"),
  P("thefork.es", "thefork", "TheFork", "restaurant_booking"),
  P("thefork.it", "thefork", "TheFork", "restaurant_booking"),
  P("thefork.fr", "thefork", "TheFork", "restaurant_booking"),
  P("thefork.pt", "thefork", "TheFork", "restaurant_booking"),
  P("tablecheck.com", "tablecheck", "TableCheck", "restaurant_booking"),
  P("zenchef.com", "zenchef", "Zenchef", "restaurant_booking"),
  P("covermanager.com", "covermanager", "CoverManager", "restaurant_booking"),
  // Tours y experiencias
  P("getyourguide.com", "getyourguide", "GetYourGuide", "tours"),
  P("viator.com", "viator", "Viator", "tours"),
  // Autobuses y transporte terrestre (docs/iatos/IATOS_PROVEEDORES_AUTOBUSES.md)
  P("omio.com", "omio", "Omio", "bus"),
  P("international.ado.com.mx", "ado", "ADO", "bus"),
  P("reservamos.mx", "reservamos", "Reservamos", "bus"),
  // Mensajería oficial (click to chat de WhatsApp)
  P("wa.me", "whatsapp", "WhatsApp", "messaging"),
  P("api.whatsapp.com", "whatsapp", "WhatsApp", "messaging", /^\/send\/?$/),
  // Redirect de afiliado ya configurado (Travelpayouts). Su destino `u` también debe estar permitido.
  P("tp.media", "travelpayouts", "Travelpayouts", "affiliate_redirect", /^\/click\/?$/),
];

/** Marcas que un dominio falso podría imitar ("booking-com.reservas.io", "opentable-mx.com"). */
const BRAND_TOKENS = ["booking", "opentable", "aviasales", "google", "resy", "viator", "getyourguide", "airbnb", "whatsapp",
  "exploretock", "sevenrooms", "thefork", "expedia", "skyscanner", "kayak", "aeromexico", "volaris", "tripadvisor", "paypal", "stripe"];
/** Dominios reales de esas marcas que no están en PROVIDERS (p. ej. hoteles.com) no se tratan como falsos. */
const BRAND_REAL_DOMAINS = ["expedia.com", "expedia.mx", "hotels.com", "tripadvisor.com", "tripadvisor.com.mx", "paypal.com", "stripe.com",
  "googleusercontent.com", "kayak.com.mx"];

export type UrlVerdict =
  // (campos opcionales en ambas ramas: el tsconfig de la app no es strict y no estrecha por `ok`)
  | { ok: true; url: string; host: string; provider: ProviderInfo | null; trust: "allowlist" | "trusted_source"; reason?: undefined }
  | { ok: false; reason: string; url?: undefined; host?: undefined; provider?: undefined; trust?: undefined };

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
const MAX_URL = 4096;

/** Dominio registrable aproximado (últimas 2 etiquetas; 3 si es un ccTLD de segundo nivel como com.mx). */
export function registrableDomain(host: string): string {
  const parts = host.toLowerCase().replace(/\.$/, "").split(".");
  if (parts.length <= 2) return parts.join(".");
  const sld = parts[parts.length - 2];
  const second = ["com", "co", "org", "net", "gob", "edu", "ac", "or", "ne", "go"];
  return (second.includes(sld) && parts[parts.length - 1].length === 2 ? parts.slice(-3) : parts.slice(-2)).join(".");
}

function hostMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/** Proveedor de la lista blanca para un host y ruta, o null. */
export function providerFor(host: string, pathname = "/"): ProviderInfo | null {
  const h = host.toLowerCase();
  for (const p of PROVIDERS) {
    if (!hostMatches(h, p.domain)) continue;
    if (p.paths && !p.paths.test(pathname)) continue;
    return p;
  }
  return null;
}

/** Reglas comunes de seguridad de una URL de salida (https, sin credenciales, sin IP, puerto 443). */
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
  if (!host.includes(".") || IPV4.test(host) || host.startsWith("[") || /(^|\.)(localhost|local|internal|lan|home|corp)$/.test(host)) {
    return { ok: false, reason: "host_no_publico" };
  }
  return { ok: true, u };
}

/** ¿El host imita una marca conocida sin ser su dominio real? */
export function looksLikeBrandImpersonation(host: string): boolean {
  const h = host.toLowerCase();
  const reg = registrableDomain(h);
  if (PROVIDERS.some((p) => hostMatches(h, p.domain)) || BRAND_REAL_DOMAINS.some((d) => hostMatches(h, d))) return false;
  const label = reg.split(".")[0];
  // Punycode en el dominio registrable: no se puede saber a simple vista qué marca imita.
  if (reg.startsWith("xn--") || reg.includes(".xn--")) return true;
  return BRAND_TOKENS.some((t) => label.includes(t) || h.split(".").some((part) => part === t));
}

/**
 * URL permitida para el nivel ESTRICTO (IA o cliente). tp.media solo si su destino `u` también lo es.
 */
export function checkAllowlisted(raw: unknown, depth = 0): UrlVerdict {
  const b = basicCheck(raw);
  if (!b.ok) return { ok: false, reason: b.reason };
  const host = b.u.hostname.toLowerCase();
  const prov = providerFor(host, b.u.pathname);
  if (!prov) return { ok: false, reason: "dominio_no_permitido" };
  if (prov.provider === "travelpayouts") {
    if (depth > 0) return { ok: false, reason: "redirect_anidado" };
    const inner = b.u.searchParams.get("u");
    const v = checkAllowlisted(inner, depth + 1);
    if (!v.ok) return { ok: false, reason: `destino_afiliado_${v.reason}` };
  }
  return { ok: true, url: b.u.toString(), host, provider: prov, trust: "allowlist" };
}

/**
 * URL de un sitio oficial que vino de una fuente estructurada del servidor. Acepta dominios fuera de
 * la lista blanca, pero nunca uno que imite una marca ni uno inseguro.
 */
export function checkTrustedSource(raw: unknown): UrlVerdict {
  const strict = checkAllowlisted(raw);
  if (strict.ok) return strict;
  const b = basicCheck(raw);
  if (!b.ok) return { ok: false, reason: b.reason };
  const host = b.u.hostname.toLowerCase();
  // Un dominio de proveedor conocido (google.com, tp.media, booking.com…) solo vale con sus reglas
  // estrictas: así google.com/url?q=… o tp.media con destino falso no entran como "fuente confiable".
  if (PROVIDERS.some((p) => hostMatches(host, p.domain))) return { ok: false, reason: strict.reason ?? "ruta_no_permitida" };
  if (looksLikeBrandImpersonation(host)) return { ok: false, reason: "dominio_sospechoso" };
  return { ok: true, url: b.u.toString(), host, provider: null, trust: "trusted_source" };
}

/** Destino real de un enlace (desenvuelve tp.media/click?u=…), para comparar fechas y producto. */
export function unwrapAffiliate(url: string): string {
  try {
    const u = new URL(url);
    if (hostMatches(u.hostname.toLowerCase(), "tp.media")) return u.searchParams.get("u") ?? url;
  } catch { /* no es URL */ }
  return url;
}

/** Nombre del proveedor que procesará la compra, para el aviso "quién procesa". */
export function processorLabel(url: string): string {
  try {
    const u = new URL(unwrapAffiliate(url));
    return providerFor(u.hostname, u.pathname)?.label ?? u.hostname.replace(/^www\./, "");
  } catch {
    return "el proveedor";
  }
}
