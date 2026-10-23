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

import { asciiHost, registrableDomain as pslRegistrableDomain } from "./psl.ts";

export type ProviderInfo = {
  /** Dominio registrable (sin www) o un subdominio concreto (international.ado.com.mx). */
  domain: string;
  provider: string; // id estable
  label: string; // nombre que ve el usuario
  kind: "ota" | "metasearch" | "airline" | "restaurant_booking" | "tours" | "maps" | "messaging" | "bus" | "affiliate_redirect" | "hotel_chain";
  /** Rutas permitidas (si el dominio aloja otras cosas, p. ej. google.com). */
  paths?: RegExp;
  /**
   * Redirect: "wrapper" lleva el destino a la vista (tp.media?u=…, se desenvuelve y se revisa);
   * "opaque" es un clic de anuncio o de Google cuyo destino final NO se ve (google.com/aclk,
   * /travel/clk): solo vale si lo dio una API del servidor (SerpApi), nunca de la IA ni del cliente.
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
  /** Por qué este dominio es legítimo (AUD-04: ninguna entrada sin justificación). */
  why: string;
};

const P = (domain: string, provider: string, label: string, kind: ProviderInfo["kind"], why: string, extra: { paths?: RegExp; redirector?: ProviderInfo["redirector"]; hosts?: string[]; serverOnly?: boolean } = {}): ProviderInfo =>
  ({ domain, provider, label, kind, why, ...extra });

// Endurecimiento O1 (segunda auditoría): Google solo en sus hosts propios; sites.google.com/maps/… no es Maps.
const GOOGLE_HOSTS = ["www.google.com", "google.com"];
const AIRLINE = (name: string) => `Sitio oficial de ${name}: destino del botón "Sitio de la aerolínea" (EV-AIRLINE-HOME) y de airline_buy_url de flights-search.`;
const OT = "Sitio público de OpenTable para el país (opentable.com/r/<lugar>): enlaces curados del catálogo Privé y de la IA validados por nombre (EV-OPENTABLE-SEARCH).";
const FORK = "Sitio público de TheFork (grupo Tripadvisor) por país, usado por restaurantes del catálogo Privé (EV-PRIVE-CATALOG).";

/**
 * Proveedores permitidos. Cada formato de enlace que IATOS ARMA está documentado en
 * docs/iatos/IATOS_BOOKING_BRIDGE.md §8 (Evidencia); aquí solo se decide a qué dominios se puede salir
 * y, en `why`, por qué cada uno es legítimo. No se agregan dominios "por si acaso".
 */
export const PROVIDERS: ProviderInfo[] = [
  // Vuelos
  P("aviasales.com", "aviasales", "Aviasales", "metasearch", "Buscador de Travelpayouts (marker 533299): formato /search/ documentado en EV-AVIASALES-SEARCH.", { paths: /^\/search\// }),
  P("google.com", "google_flights", "Google Flights", "metasearch", "Búsqueda de Google Flights de SerpApi (EV-GFLIGHTS-SERP-URL); /travel/flights solamente.", { paths: /^\/travel\/flights(\/|\?|$)/, hosts: GOOGLE_HOSTS }),
  P("google.com", "google_flights", "Google Flights", "metasearch", "booking_request de Google Flights vía SerpApi (EV-GFLIGHTS-BOOKING-REQUEST, bandera apagada): redirect opaco.", { paths: /^\/travel\/clk\//, redirector: "opaque", hosts: GOOGLE_HOSTS }),
  P("skyscanner.com.mx", "skyscanner", "Skyscanner", "metasearch", "Buscador que arma src/lib/affiliateLinks.ts (skyscannerLink) para México."),
  P("kayak.com", "kayak", "Kayak", "metasearch", "Buscador que arma src/lib/affiliateLinks.ts (kayakFlightsLink, kayakCarsLink)."),
  P("aeromexico.com", "aeromexico", "Aeroméxico", "airline", AIRLINE("Aeroméxico")),
  P("iberia.com", "iberia", "Iberia", "airline", AIRLINE("Iberia")),
  P("aa.com", "american", "American Airlines", "airline", AIRLINE("American Airlines")),
  P("united.com", "united", "United", "airline", AIRLINE("United Airlines")),
  P("delta.com", "delta", "Delta", "airline", AIRLINE("Delta Air Lines")),
  P("airfrance.com", "airfrance", "Air France", "airline", AIRLINE("Air France")),
  P("klm.com", "klm", "KLM", "airline", AIRLINE("KLM")),
  P("lufthansa.com", "lufthansa", "Lufthansa", "airline", AIRLINE("Lufthansa")),
  P("britishairways.com", "britishairways", "British Airways", "airline", AIRLINE("British Airways")),
  P("latam.com", "latam", "LATAM", "airline", AIRLINE("LATAM Airlines")),
  P("avianca.com", "avianca", "Avianca", "airline", AIRLINE("Avianca")),
  P("volaris.com", "volaris", "Volaris", "airline", AIRLINE("Volaris")),
  P("vivaaerobus.com", "vivaaerobus", "Viva Aerobus", "airline", AIRLINE("Viva Aerobus")),
  P("aircanada.com", "aircanada", "Air Canada", "airline", AIRLINE("Air Canada")),
  P("turkishairlines.com", "turkish", "Turkish Airlines", "airline", AIRLINE("Turkish Airlines")),
  // Hoteles
  P("booking.com", "booking", "Booking.com", "ota", "Búsqueda searchresults.html que arma IATOS (EV-BOOKING-SEARCH) y páginas de hotel; dominio único de Booking.com."),
  P("airbnb.com", "airbnb", "Airbnb", "ota", "Búsqueda /s/<ciudad>/homes que arma src/lib/affiliateLinks.ts (airbnbLink)."),
  // Google Hotels (enlaces de precios que devuelve SerpApi: google.com/aclk) y Maps
  P("google.com", "google_hotels", "Google Hotels", "metasearch", "Enlaces de precio de Google Hotels vía SerpApi (EV-GHOTELS-PRICE-LINK): clic de anuncio, redirect opaco.", { paths: /^\/aclk(\?|$)/, redirector: "opaque", hosts: GOOGLE_HOSTS }),
  P("google.com", "google_hotels", "Google Hotels", "metasearch", "Enlaces por proveedor de Google Hotels Property Details vía SerpApi (featured_prices[].link / prices[].link = /travel/lodging/clk, EV-GHOTELS-PRICE-LINK): redirect opaco.", { paths: /^\/travel\/lodging\/clk(\/|\?|$)/, redirector: "opaque", hosts: GOOGLE_HOSTS }),
  P("google.com", "google_hotels", "Google Hotels", "metasearch", "Ficha de Google Hotels (/travel/hotels) de SerpApi.", { paths: /^\/travel\/hotels(\/|\?|$)/, hosts: GOOGLE_HOSTS }),
  P("google.com", "google_maps", "Google Maps", "maps", "Google Maps URLs oficiales (EV-MAPS-URLS): /maps/search/?api=1 y /maps/dir/?api=1.", { paths: /^\/maps(\/|\?|$)/, hosts: [...GOOGLE_HOSTS, "maps.google.com"] }),
  // Restaurantes: sistemas públicos de reserva (no requieren ser socio para abrir su página pública)
  P("opentable.com", "opentable", "OpenTable", "restaurant_booking", OT),
  P("opentable.com.mx", "opentable", "OpenTable", "restaurant_booking", OT),
  P("opentable.co.uk", "opentable", "OpenTable", "restaurant_booking", OT),
  P("opentable.de", "opentable", "OpenTable", "restaurant_booking", OT),
  P("opentable.es", "opentable", "OpenTable", "restaurant_booking", OT),
  P("opentable.it", "opentable", "OpenTable", "restaurant_booking", OT),
  P("opentable.jp", "opentable", "OpenTable", "restaurant_booking", OT),
  P("opentable.ca", "opentable", "OpenTable", "restaurant_booking", OT),
  P("exploretock.com", "tock", "Tock", "restaurant_booking", "Dominio público de Tock (exploretock.com/<lugar>), usado por restaurantes del catálogo Privé (EV-PRIVE-CATALOG)."),
  P("resy.com", "resy", "Resy", "restaurant_booking", "Dominio público de Resy (resy.com/cities/…), usado por restaurantes del catálogo Privé (EV-PRIVE-CATALOG)."),
  P("sevenrooms.com", "sevenrooms", "SevenRooms", "restaurant_booking", "Widget público de SevenRooms (sevenrooms.com/reservations/<lugar>), detectado por siteScan (EV-SITE-SCAN)."),
  P("thefork.com", "thefork", "TheFork", "restaurant_booking", FORK),
  P("thefork.es", "thefork", "TheFork", "restaurant_booking", FORK),
  P("thefork.it", "thefork", "TheFork", "restaurant_booking", FORK),
  P("thefork.fr", "thefork", "TheFork", "restaurant_booking", FORK),
  P("thefork.pt", "thefork", "TheFork", "restaurant_booking", FORK),
  P("tablecheck.com", "tablecheck", "TableCheck", "restaurant_booking", "Sistema público de reservas (Japón/Asia) detectado por siteScan en sitios oficiales (EV-SITE-SCAN)."),
  P("zenchef.com", "zenchef", "Zenchef", "restaurant_booking", "Sistema público de reservas (Europa) detectado por siteScan en sitios oficiales (EV-SITE-SCAN)."),
  P("covermanager.com", "covermanager", "CoverManager", "restaurant_booking", "Sistema público de reservas (España/LatAm) detectado por siteScan en sitios oficiales (EV-SITE-SCAN)."),
  // Tours y experiencias
  P("getyourguide.com", "getyourguide", "GetYourGuide", "tours", "Búsqueda /s/?q= que arma IATOS (EV-TOURS-SEARCH)."),
  P("viator.com", "viator", "Viator", "tours", "Búsqueda /searchResults/all?text= que arma IATOS (EV-TOURS-SEARCH).", { paths: /^\/searchResults\// }),
  P("viator.com", "viator", "Viator", "tours", "Ficha de producto /tours/… = productUrl de la Partner API v2 de Viator (viator-search, con el afiliado pid P00327354 · mcid 42383); solo del servidor.",
    { paths: /^\/(?:[a-z]{2}(?:-[A-Za-z]{2})?\/)?tours\//, serverOnly: true }),
  // Autobuses y transporte terrestre (docs/iatos/IATOS_PROVEEDORES_AUTOBUSES.md)
  P("omio.com", "omio", "Omio", "bus", "Buscador de autobuses y trenes (groundTransport.ts, omioLink); IATOS_PROVEEDORES_AUTOBUSES.md."),
  P("international.ado.com.mx", "ado", "ADO", "bus", "Búsqueda pública de ADO (IATOS_PROVEEDORES_AUTOBUSES.md §2.2); solo ese subdominio."),
  P("reservamos.mx", "reservamos", "Reservamos", "bus", "Buscador de autobuses en México (IATOS_PROVEEDORES_AUTOBUSES.md §2.1)."),
  // Mensajería oficial (click to chat de WhatsApp)
  P("wa.me", "whatsapp", "WhatsApp", "messaging", "Click to chat oficial de WhatsApp (EV-WA-CLICK)."),
  P("api.whatsapp.com", "whatsapp", "WhatsApp", "messaging", "Forma larga oficial del click to chat (api.whatsapp.com/send), EV-WA-CLICK.", { paths: /^\/send\/?$/ }),
  // Redirect de afiliado ya configurado (Travelpayouts). Su destino `u` también debe estar permitido.
  // Hoy responde 400 (IATOS_BOOKING_BRIDGE_PROVEEDORES.md §3): el resolver abre el destino directo.
  P("tp.media", "travelpayouts", "Travelpayouts", "affiliate_redirect", "Redirect de afiliado de Travelpayouts (marker 533299); se desenvuelve y su destino pasa la misma lista.",
    { paths: /^\/click\/?$/, redirector: "wrapper" }),
];

/**
 * Marcas que un dominio falso podría imitar ("booking-com.reservas.io", "b00king.com"). Es un
 * DETECTOR ADICIONAL, no el control: lo que decide si se puede salir a un dominio fuera de la lista
 * es de dónde vino el dato (solo catálogo curado y escaneo del sitio oficial; ver resolver.ts y
 * booking-bridge), y booking-go firma el destino exacto y su nivel. Las marcas salen de PROVIDERS
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
const TOKEN_ONLY = new Set(["resy", "kayak", "omio", "delta", "united", "latam", "klm", "ado", "iberia", "avianca", "volaris", "stripe", "tock"]);
const PHISHING_WORDS = new Set(["login", "secure", "seguro", "account", "cuenta", "verify", "verifica", "pago", "pagos", "pay", "payment",
  "checkout", "reserva", "reservas", "reservation", "reservations", "booking", "vuelo", "vuelos", "flight", "flights", "airline", "airlines",
  "deal", "deals", "oferta", "ofertas", "promo", "promos", "soporte", "support", "ayuda", "help", "oficial", "official", "app", "online",
  "tickets", "boletos", "mx", "es", "us", "com"]);
/** Dominios reales de esas marcas que no están en PROVIDERS no se tratan como falsos. */
const BRAND_REAL_DOMAINS = ["expedia.com", "expedia.mx", "hotels.com", "tripadvisor.com", "tripadvisor.com.mx", "paypal.com", "stripe.com",
  "googleusercontent.com", "kayak.com.mx", "mercadopago.com.mx"];

let BRANDS: Array<[string, "long" | "token"]> | null = null;
function brands(): Array<[string, "long" | "token"]> {
  if (BRANDS) return BRANDS;
  const m = new Map<string, "long" | "token">();
  for (const p of PROVIDERS) {
    const reg = pslRegistrableDomain(p.domain) ?? p.domain;
    const label = reg.split(".")[0];
    if (label.length >= 3) m.set(label, TOKEN_ONLY.has(label) ? "token" : "long"); // aa, wa, tp: demasiado cortas
    // A2-F2: con etiqueta corta, la marca es el dominio sin puntos ("tp-media.com" imita a tp.media).
    else m.set(reg.replace(/\./g, ""), reg === "tp.media" ? "long" : "token");
  }
  for (const [b, mode] of EXTRA_BRANDS) m.set(b, mode);
  return (BRANDS = [...m.entries()]);
}

export type UrlVerdict =
  // (campos opcionales en ambas ramas: el tsconfig de la app no es strict y no estrecha por `ok`)
  | { ok: true; url: string; host: string; provider: ProviderInfo | null; trust: "allowlist" | "trusted_source"; reason?: undefined }
  | { ok: false; reason: string; url?: undefined; host?: undefined; provider?: undefined; trust?: undefined };

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
const MAX_URL = 4096;

/** Dominio registrable según la Public Suffix List (psl.ts); null para IPs, sufijos públicos y TLDs inexistentes. */
export const registrableDomain = pslRegistrableDomain;

function hostMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/** Proveedor de la lista blanca para un host y ruta, o null. */
export function providerFor(host: string, pathname = "/"): ProviderInfo | null {
  const h = host.toLowerCase();
  for (const p of PROVIDERS) {
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
  if (!pslRegistrableDomain(host)) return { ok: false, reason: "host_no_publico" };
  return { ok: true, u };
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

/** ¿El host imita una marca conocida sin ser su dominio real? (detector adicional; ver EXTRA_BRANDS). */
export function looksLikeBrandImpersonation(host: string): boolean {
  const h = asciiHost(host);
  if (!h) return true;
  if (PROVIDERS.some((p) => hostMatches(h, p.domain)) || BRAND_REAL_DOMAINS.some((d) => hostMatches(h, d))) return false;
  const reg = pslRegistrableDomain(h);
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
 * Barras, barras invertidas o puntos codificados en la ruta (%2F, %5C, %2E), también con doble o triple
 * codificación (%252F, %25252E; endurecimiento O2): para saltar una ruta permitida.
 */
const ENCODED_PATH_TRICK = /%(?:25)*(2f|5c|2e)/i;

/**
 * URL permitida para el nivel ESTRICTO. Un redirect "wrapper" (tp.media) solo si su destino `u`
 * también lo es, y nunca un redirect dentro de otro (tp.media → google.com/aclk → …).
 */
export function checkAllowlisted(raw: unknown, depth = 0): UrlVerdict {
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
 * valen cuando los devuelve una API del servidor (SerpApi).
 */
export function checkUntrusted(raw: unknown): UrlVerdict {
  const v = checkAllowlisted(raw);
  if (v.ok && v.provider?.redirector === "opaque") return { ok: false, reason: "redirect_sin_destino_visible" };
  if (v.ok && v.provider?.serverOnly) return { ok: false, reason: "enlace_solo_del_servidor" };
  return v;
}

/** ¿La URL es un redirect (de afiliado o de anuncio) de la lista? */
export function isRedirector(raw: string): boolean {
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
