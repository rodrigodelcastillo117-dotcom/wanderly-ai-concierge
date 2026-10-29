// Dominios de salida del Booking Bridge (Fase 12): lista blanca, protección contra open redirects y
// dominios falsos. Sin Deno: lo usan booking-bridge (antes de guardar el destino de una intención),
// booking-go (antes de redirigir) y las demás funciones. El navegador usa la versión sin notas
// (src/lib/bookingAllowlist.ts) para pintar los botones al instante.
//
// Dos niveles de confianza:
//  * ESTRICTO (allowlist): para URLs que escribió la IA o que manda el cliente. Solo dominios de
//    proveedores conocidos, con rutas acotadas cuando el dominio es genérico (google.com).
//  * FUENTE CONFIABLE (trusted): sitios oficiales que vienen de una fuente estructurada del servidor
//    (catálogo Privé curado por el equipo, Google Places, Google Hotels vía SerpApi). Pueden ser de
//    cualquier dominio, pero deben pasar las reglas de seguridad y no imitar una marca conocida.

import { registrableDomain as pslRegistrableDomain } from "./psl.ts";
import { CRUISE_DOMAINS } from "./cruiseDomains.ts";
import { TM_DOMAINS } from "./tmDomains.ts";
import { createAllowlist, type ProviderRule, type UrlVerdict as CoreVerdict } from "./allowlistCore.ts";

// Las reglas (open redirects, dominios falsos, URLs inseguras) viven en ./allowlistCore.ts, sin datos: el
// navegador las arma con los mismos dominios sin estas notas y con una lista de sufijos reducida
// (src/lib/bookingAllowlist.ts + bookingAllowlist.data.ts, generado con `npx tsx scripts/booking/clientAllowlistGen.ts`;
// ronda 2 P2-5). Si cambias PROVIDERS, regenera el archivo del navegador (una prueba lo exige).

/** Dominios oficiales de Ticketmaster por país (en ./tmDomains.ts, módulo chico que también usa la app). */
export { TM_DOMAINS } from "./tmDomains.ts";

export type ProviderInfo = ProviderRule & {
  /** Por qué este dominio es legítimo (AUD-04: ninguna entrada sin justificación). */
  why: string;
};
export type UrlVerdict = CoreVerdict<ProviderInfo>;

// Navieras con sitio oficial: en ./cruiseDomains.ts (módulo chico que también usa la app, sin cargar
// esta lista completa ni la lista de sufijos públicos en el paquete del navegador).
export { CRUISE_DOMAINS } from "./cruiseDomains.ts";

const P = (domain: string, provider: string, label: string, kind: ProviderInfo["kind"], why: string, extra: { paths?: RegExp; redirector?: ProviderInfo["redirector"]; hosts?: string[]; serverOnly?: boolean; noBrand?: true } = {}): ProviderInfo =>
  ({ domain, provider, label, kind, why, ...extra });

// Endurecimiento O1 (segunda auditoría): Google solo en sus hosts propios; sites.google.com/maps/… no es Maps.
const GOOGLE_HOSTS = ["www.google.com", "google.com"];
const AIRLINE = (name: string) => `Sitio oficial de ${name}: destino del botón "Sitio de la aerolínea" (EV-AIRLINE-HOME) y de airline_buy_url de flights-search.`;
const OT = "Sitio público de OpenTable para el país (opentable.com/r/<lugar>): enlaces curados del catálogo Privé y de la IA validados por nombre (EV-OPENTABLE-SEARCH).";
const FORK = "Sitio público de TheFork (grupo Tripadvisor) por país, usado por restaurantes del catálogo Privé (EV-PRIVE-CATALOG) y por \"Reservar en TheFork\": búsqueda /search?cityName=…&searchText=… que arma _shared/restaurantBooking.ts (EV-THEFORK-SEARCH; TheFork bloquea la verificación automática).";
/** Taquillas oficiales de museos (_shared/officialTickets.ts, comprobadas el 2026-10-27). */
const MUSEO = (name: string) => `Taquilla o sitio oficial de ${name}: botón "Boletos oficiales" (_shared/officialTickets.ts, EV-OFFICIAL-TICKETS 2026-10-27).`;

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
  P("kayak.com.mx", "kayak", "Kayak", "metasearch", "Kayak México (español): mismas rutas /flights/… y /cars/… que arman links.ts, carRental.ts y affiliateLinks.ts (GET 28-oct-2026)."),
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
  // Trenes, autobuses, ferris y barcos con búsqueda PRECARGADA (groundLinks.ts; evidencia en
  // docs/iatos/PROVEEDORES_TERRESTRES.md y docs/iatos/evidencia/terrestre/, 2026-10-24).
  P("venta.renfe.com", "renfe", "Renfe", "rail", "Venta oficial de Renfe: búsqueda buscarTren.do con estaciones, fecha y adultos (EV-RENFE-BUSCAR).", { paths: /^\/vol\// }),
  P("int.bahn.de", "db", "Deutsche Bahn", "rail", "Venta oficial de Deutsche Bahn: buscador /en/buchung/fahrplan/suche con estaciones (EVA), fecha y viajeros (EV-DB-SUCHE).", { paths: /^\/en\/buchung\// }),
  P("shop.flixbus.com", "flixbus", "FlixBus", "bus", "Tienda oficial de FlixBus: /search con ciudades, fecha y adultos (EV-FLIXBUS-SEARCH).", { paths: /^\/search\/?$/ }),
  P("12go.asia", "12go", "12Go", "bus", "Buscador multimodal de Asia (programa de Travelpayouts): /en/travel/<origen>/<destino>?date&people (EV-12GO-TRAVEL).", { paths: /^\/[a-z]{2}\/travel\// }),
  P("ferryhopper.com", "ferryhopper", "Ferryhopper", "ferry", "Resultados de Ferryhopper con puertos, fecha y pasajeros; enlace del widget de su servidor MCP (EV-FERRYHOPPER-RESULTS).", { paths: /^\/[a-z]{2}\/booking\/results\/?$/ }),
  P("clickandboat.com", "clickandboat", "Click&Boat", "boat_rental", "Búsqueda de renta de barcos /es/alquiler con lugar, fechas y personas (EV-CLICKANDBOAT-ALQUILER).", { paths: /^\/[a-z]{2}\/alquiler\/?$/ }),
  // Museos y monumentos: taquillas OFICIALES de la tabla curada (_shared/officialTickets.ts). Hosts exactos
  // cuando el dominio es de un vendedor que aloja a otros (vivaticket.it) o un sufijo geográfico.
  P("museivaticani.va", "museo_oficial", "Museos Vaticanos", "tickets", MUSEO("los Museos Vaticanos"), { noBrand: true }),
  P("colosseo.it", "museo_oficial", "Parco archeologico del Colosseo", "tickets", MUSEO("el Parco archeologico del Colosseo"), { noBrand: true }),
  P("galleriaborghese.cultura.gov.it", "museo_oficial", "Galleria Borghese", "tickets", MUSEO("la Galleria Borghese (Ministero della Cultura)"), { noBrand: true }),
  P("basilicasanpietro.va", "museo_oficial", "Basílica de San Pedro", "tickets", MUSEO("la Basílica de San Pedro (cúpula)"), { noBrand: true }),
  P("uffizi.it", "museo_oficial", "Gallerie degli Uffizi", "tickets", MUSEO("las Gallerie degli Uffizi y el Palacio Pitti"), { noBrand: true }),
  P("galleriaaccademiafirenze.it", "museo_oficial", "Galleria dell'Accademia", "tickets", MUSEO("la Galleria dell'Accademia di Firenze"), { noBrand: true }),
  P("duomo.firenze.it", "museo_oficial", "Opera di Santa Maria del Fiore", "tickets", MUSEO("el Duomo de Florencia (Opera di Santa Maria del Fiore)"), { noBrand: true }),
  P("visitmuve.it", "museo_oficial", "Musei Civici di Venezia", "tickets", MUSEO("el Palacio Ducal (Fondazione Musei Civici di Venezia)"), { noBrand: true }),
  P("vivaticket.it", "museo_oficial", "Musei Civici di Venezia (Vivaticket)", "tickets", MUSEO("el Palacio Ducal: venta en Vivaticket enlazada desde palazzoducale.visitmuve.it"),
    { hosts: ["muve.vivaticket.it"], paths: /^\/[a-z]{2}\/tour\//, noBrand: true }),
  P("basilicasanmarco.it", "museo_oficial", "Basílica de San Marcos", "tickets", MUSEO("la Basílica de San Marcos"), { noBrand: true }),
  P("opapisa.it", "museo_oficial", "Opera della Primaziale Pisana", "tickets", MUSEO("la Torre de Pisa (Opera della Primaziale Pisana)"), { noBrand: true }),
  P("louvre.fr", "museo_oficial", "Musée du Louvre", "tickets", MUSEO("el Museo del Louvre"), { noBrand: true }),
  P("sagradafamilia.org", "museo_oficial", "Sagrada Família", "tickets", MUSEO("la Sagrada Familia"), { noBrand: true }),
  P("alhambra-patronato.es", "museo_oficial", "Patronato de la Alhambra", "tickets", MUSEO("la Alhambra"), { noBrand: true }),
  P("museodelprado.es", "museo_oficial", "Museo del Prado", "tickets", MUSEO("el Museo del Prado"), { noBrand: true }),
  // Boletos de eventos: SOLO el campo `url` que devuelve la Discovery API v2 de Ticketmaster (servidor,
  // _shared/ticketmaster.ts); la página oficial de compra del evento, nunca una compra hecha.
  ...TM_DOMAINS.map((d) => P(d, "ticketmaster", "Ticketmaster", "tickets", "Página oficial del evento: campo `url` de la Discovery API v2 de Ticketmaster (EV-TICKETMASTER-URL).")),
  // Mensajería oficial (click to chat de WhatsApp)
  P("wa.me", "whatsapp", "WhatsApp", "messaging", "Click to chat oficial de WhatsApp (EV-WA-CLICK)."),
  P("api.whatsapp.com", "whatsapp", "WhatsApp", "messaging", "Forma larga oficial del click to chat (api.whatsapp.com/send), EV-WA-CLICK.", { paths: /^\/send\/?$/ }),
  // Redirect de afiliado ya configurado (Travelpayouts). Su destino `u` también debe estar permitido.
  // Hoy responde 400 (IATOS_BOOKING_BRIDGE_PROVEEDORES.md §3): el resolver abre el destino directo.
  P("tp.media", "travelpayouts", "Travelpayouts", "affiliate_redirect", "Redirect de afiliado de Travelpayouts (marker 533299); se desenvuelve y su destino pasa la misma lista.",
    { paths: /^\/click\/?$/, redirector: "wrapper" }),
  // Cruceros (intérprete de viaje completo, 28-oct-2026): el tramo crucero enlaza a la naviera que dijo la
  // persona (portada oficial: ninguna acepta puertos/fechas por URL) o a buscadores conocidos de cruceros.
  // (Google /search sigue fuera de la lista: AUD-04.) El precio se cotiza ahí: IATOS no lo inventa.
  // noBrand: nombres comunes (princess, viking, costa) no deben marcar sitios reales como imitaciones.
  ...CRUISE_DOMAINS.map(([domain, label]) => P(domain, "naviera", label, "cruise", `Sitio oficial de ${label}: botón del tramo crucero (src/lib/cruiseLinks.ts).`, { noBrand: true })),
  P("vacationstogo.com", "vacationstogo", "Vacations To Go", "cruise", "Buscador de cruceros (portada con «Find a Bargain»), ya usado en Cruceros (affiliateLinks.ts).", { noBrand: true }),
  P("cruisedirect.com", "cruisedirect", "CruiseDirect", "cruise", "Buscador de cruceros ya usado en Cruceros (affiliateLinks.ts).", { noBrand: true }),
  P("cruisecritic.com", "cruisecritic", "Cruise Critic", "cruise", "Buscador /find-a-cruise/ ya usado en Cruceros (affiliateLinks.ts).", { noBrand: true }),
];

const AL = createAllowlist(PROVIDERS, pslRegistrableDomain);

/** Dominio registrable según la Public Suffix List (psl.ts); null para IPs, sufijos públicos y TLDs inexistentes. */
export const registrableDomain = pslRegistrableDomain;

export const {
  /** Proveedor de la lista blanca para un host y ruta, o null. */
  providerFor,
  /** ¿El host imita una marca conocida sin ser su dominio real? (detector adicional). */
  looksLikeBrandImpersonation,
  /** URL permitida para el nivel ESTRICTO (un redirect "wrapper" solo si su destino también lo es). */
  checkAllowlisted,
  /** URL que escribió la IA o mandó el cliente: lista estricta, sin redirects opacos ni enlaces solo del servidor. */
  checkUntrusted,
  /** ¿La URL es un redirect (de afiliado o de anuncio) de la lista? */
  isRedirector,
  /** Sitio oficial que vino de una fuente estructurada del servidor: fuera de la lista, pero sin imitar marcas. */
  checkTrustedSource,
  /** Destino real de un enlace (desenvuelve tp.media/click?u=…). */
  unwrapAffiliate,
  /** Nombre del proveedor que procesará la compra, para el aviso "quién procesa". */
  processorLabel,
} = AL;
