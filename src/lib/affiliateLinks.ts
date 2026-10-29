// Helpers para construir deep-links de compra/booking a partners reales.
// El script Travelpayouts Drive (en index.html) etiqueta automáticamente
// los enlaces salientes con tu marker para cobrar comisiones.
//
// Regla (cierre 2, grupo enlaces): cada enlace lleva SOLO los datos que el sitio aplica de verdad al
// abrirlo. Se comprobó abriendo cada formato con Chromium el 2026-10-22 (capturas y resultados en
// docs/iatos/evidencia/enlaces/, resumen en docs/iatos/cierre2/ENLACES_COMPRA.md). Si un sitio no
// recibe un dato por URL, el enlace no lo inventa y PREFILL (abajo) dice al usuario qué completar ahí.
import {
  aviasalesSearchUrl, bookingSearchUrl, getYourGuideSearchUrl, googleFlightsSearchUrl, roomsForAdults,
} from "../../supabase/functions/_shared/booking/links.ts";
import { countryIso } from "../../supabase/functions/_shared/booking/channels.ts";
import { mainAirport } from "../../supabase/functions/_shared/airports.ts";

export const TP_MARKER = "533299";

/**
 * Enlace de salida a un partner. Antes envolvía la URL en el redirect tp.media/click, pero ese
 * redirect responde 400 ("source_type is empty") desde 2026-10: el usuario caía en una página de
 * error y no se registraba ninguna comisión. Ahora abre el proveedor directo (el script Drive de
 * Travelpayouts en index.html sigue etiquetando los enlaces salientes que reconoce). Para volver a
 * cobrar por redirect hay que generar los enlaces desde el panel de Travelpayouts (decisión BB-02).
 * `subId` se conserva en la firma para medir verticales cuando haya enlaces válidos.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function tpDeepLink(targetUrl: string, subId?: string): string {
  return targetUrl;
}

/** Agrega el marker de Travelpayouts a una URL de partner. Idempotente. */
export function withMarker(url: string): string {
  if (/[?&]marker=/.test(url)) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}marker=${TP_MARKER}`;
}

// Welcome Pickups (transfers premium) — tracking_id Travelpayouts.
export const WP_AFF_TRACK_ID = "3dc38e66900549469a7f18b5e-733063";

export interface WelcomePickupsTransferInput {
  origen?: string;
  destino?: string;
  fecha?: string;   // YYYY-MM-DD
  hora?: string;    // HH:MM
  pax?: number;
  vuelo?: string;
  ciudad?: string;
}

/**
 * Welcome Pickups: su página NO aplica origen, destino, fecha, hora ni pasajeros por URL (se abrió con
 * pickup_location/pickup_date/… y mostró el formulario vacío, captura A-WELCOME.jpg). Solo se conserva
 * el seguimiento del afiliado; el usuario escribe el traslado ahí (PREFILL.welcome lo dice).
 */
export function welcomePickupsLink(input: WelcomePickupsTransferInput = {}): string {
  const base = "https://www.welcomepickups.com/";
  const params = new URLSearchParams({
    aff_track_id: WP_AFF_TRACK_ID,
    utm_source: "travelpayouts",
    utm_medium: "iatos_concierge",
    utm_campaign: `transfer_${(input.ciudad ?? "general").toLowerCase().replace(/\s+/g, "_")}`,
  });
  return `${base}?${params.toString()}`;
}

export function ensureWelcomePickupsTrack(url: string): string {
  if (!url.includes("welcomepickups.com")) return url;
  if (url.includes("aff_track_id=")) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}aff_track_id=${WP_AFF_TRACK_ID}&utm_source=travelpayouts`;
}

export function ensureAviasalesMarker(url: string) {
  if (!/^https:\/\/(www\.)?aviasales\.com\//i.test(url)) return url;
  if (/[?&]marker=/.test(url)) return url;
  return `${url}${url.includes("?") ? "&" : "?"}marker=${TP_MARKER}`;
}

// Aviasales (vuelos, marca propia Travelpayouts — comisión más alta). Formato DDMM + adultos + niños
// (EV-AVIASALES-SEARCH; niños comprobado en D-AVIA-NINOS.jpg).
export function aviasalesLink(originIata: string, destIata: string, depart: string, ret?: string, adults = 1, children = 0) {
  const built = aviasalesSearchUrl({ origin: originIata, destination: destIata, depart, ret: ret || null, adults, children }, TP_MARKER);
  if (built) return built;
  // Sin IATA o fechas válidas: la página de búsqueda de Aviasales (sin datos, el usuario completa).
  return ensureAviasalesMarker("https://www.aviasales.com/");
}

// Hotellook (hoteles, marca propia Travelpayouts)
export function hotellookLink(city: string, checkin: string, checkout: string, adults = 2) {
  const p = new URLSearchParams({
    destination: city,
    checkIn: checkin,
    checkOut: checkout,
    adults: String(adults),
    marker: TP_MARKER,
  });
  return `https://search.hotellook.com/?${p.toString()}`;
}


/**
 * Google Flights con la búsqueda exacta (EV-GFLIGHTS-TFS): ruta por IATA, fechas, ida y vuelta o solo
 * ida, adultos, niños y, si se da, solo una aerolínea (p. ej. "AM" para Aeroméxico). Comprobado abriendo
 * MEX→CUN 12–19 dic, 2 adultos, Aeroméxico (D-GF-AM.jpg) y MEX→MAD con un niño (D-GF-NINOS.jpg).
 * El formato de texto anterior (?q=flights from … for 2 adults) abría el formulario vacío (F8).
 * Sin códigos IATA no hay búsqueda: abre Google Flights para que el usuario escriba la ruta.
 */
export function googleFlightsLink(origin: string, destination: string, depart: string, ret?: string, adults = 1,
  opts: { children?: number; airline?: string | null; returnFrom?: string | null } = {}) {
  return googleFlightsSearch(origin, destination, depart, ret, adults, opts).url;
}

/**
 * Igual que googleFlightsLink, pero dice si la búsqueda va precargada. Acepta nombres de ciudad o
 * códigos: un código de ciudad (ROM, BUH) se cambia por su aeropuerto principal, porque Google Flights
 * deja vacío el campo con un código de ciudad. Sin aeropuerto reconocido, `prefilled` es false y el
 * botón debe decir "Abre Google Flights y escribe el destino".
 */
export function googleFlightsSearch(origin: string, destination: string, depart: string, ret?: string | null, adults = 1,
  opts: { children?: number; airline?: string | null; returnFrom?: string | null } = {}): { url: string; prefilled: boolean } {
  const o = mainAirport(origin) ?? origin;
  const d = mainAirport(destination) ?? destination;
  const rf = opts.returnFrom ? mainAirport(opts.returnFrom) ?? opts.returnFrom : null;
  const url = googleFlightsSearchUrl({ origin: o, destination: d, depart, ret: ret || null, adults, children: opts.children ?? 0, airline: opts.airline ?? null, returnFrom: rf });
  return url ? { url, prefilled: true } : { url: "https://www.google.com/travel/flights?hl=es-419", prefilled: false };
}

/** Skyscanner (BLOQUEADO: responde captcha a navegadores automáticos; formato sin verificar aquí). */
export function skyscannerLink(originIata: string, destIata: string, depart: string, ret?: string, adults = 1) {
  const d = depart.replace(/-/g, "").slice(2); // YYMMDD
  const r = ret ? ret.replace(/-/g, "").slice(2) : "";
  const path = r
    ? `${originIata}/${destIata}/${d}/${r}`
    : `${originIata}/${destIata}/${d}`;
  const url = `https://www.skyscanner.com.mx/transport/flights/${path}/?adults=${adults}`;
  return tpDeepLink(url, "flights");
}

/**
 * Kayak vuelos: /flights/MEX-MAD/2026-12-12/2026-12-19/2adults[/children-8-5]. Los pasajeros van en la
 * RUTA (con ?adults=2 Kayak mostraba 1 pasajero: A-KAYAK-Q.jpg; con /2adults muestra 2: D-KAYAK.jpg;
 * /children-8 suma un niño de 8 años: D-KAYAK-NINOS.jpg).
 */
export function kayakFlightsLink(originIata: string, destIata: string, depart: string, ret?: string, adults = 1, childAges: number[] = []) {
  // Código de ciudad (ROM) → aeropuerto (FCO), igual que en Google Flights.
  const o = mainAirport(originIata) ?? originIata;
  const dd = mainAirport(destIata) ?? destIata;
  const path = ret ? `${o}-${dd}/${depart}/${ret}` : `${o}-${dd}/${depart}`;
  const a = Math.min(9, Math.max(1, Math.round(adults) || 1));
  const kids = childAges.map((x) => Math.round(Number(x))).filter((x) => Number.isFinite(x) && x >= 0 && x <= 17).slice(0, 8);
  // Kayak México (español y pesos), mismo formato de ruta (comprobado el 28-oct-2026).
  const url = `https://www.kayak.com.mx/flights/${path}/${a}adults${kids.length ? `/children-${kids.join("-")}` : ""}`;
  return tpDeepLink(url, "flights");
}

/**
 * Booking.com: destino (o "hotel + ciudad"), fechas, adultos, habitaciones y niños con su edad
 * (EV-BOOKING-SEARCH; niños en D-BK-NINOS.jpg). Habitaciones: las mismas que supone la cotización
 * (2 adultos por habitación) salvo que se indiquen.
 */
export function bookingLink(city: string, checkin: string, checkout: string, adults = 2, opts: { rooms?: number; childAges?: number[] } = {}) {
  const built = bookingSearchUrl({ query: city, checkin, checkout, adults, rooms: opts.rooms ?? roomsForAdults(adults), childAges: opts.childAges });
  const url = built ?? `https://www.booking.com/searchresults.html?${new URLSearchParams({ ss: city }).toString()}`;
  return tpDeepLink(withMarker(url), "hotels");
}

export function airbnbLink(city: string, checkin: string, checkout: string, adults = 2) {
  const p = new URLSearchParams({
    query: city,
    checkin,
    checkout,
    adults: String(adults),
  });
  const url = `https://www.airbnb.com/s/${encodeURIComponent(city)}/homes?${p.toString()}`;
  return tpDeepLink(url, "hotels");
}

/** GetYourGuide: búsqueda por texto y, con fechas, el filtro date_from/date_to (D-GYG.jpg). */
export function getYourGuideLink(city: string, query?: string, dates?: { from?: string | null; to?: string | null }) {
  const url = getYourGuideSearchUrl(city, query, TP_MARKER, dates ?? undefined)
    ?? `https://www.getyourguide.com/?marker=${TP_MARKER}`;
  return tpDeepLink(url, "tours");
}

/** Afiliado directo de Viator de IATOS (pid P00327354 · mcid 42383 · campaign IATOS): parámetros públicos. */
export const VIATOR_AFFILIATE = { pid: "P00327354", mcid: "42383", medium: "link", medium_version: "selector", campaign: "IATOS" } as const;

export function viatorLink(city: string, query?: string) {
  const q = query ? `${query} ${city}` : city;
  // Directo con el código de afiliado de IATOS (ya no pasa por Travelpayouts).
  return `https://www.viator.com/searchResults/all?${new URLSearchParams({ text: q, ...VIATOR_AFFILIATE }).toString()}`;
}

export function tripadvisorLink(city: string, query?: string) {
  const q = query ? `${query} ${city}` : city;
  const url = `https://www.tripadvisor.com/Search?q=${encodeURIComponent(q)}`;
  return tpDeepLink(url, "tours");
}

// TODO: confirmar programa de afiliado antes de monetizar
export function openTableLink(city: string, query?: string) {
  const q = query ? `${query} ${city}` : city;
  return `https://www.opentable.com/s?term=${encodeURIComponent(q)}`;
}

// TODO: confirmar programa de afiliado antes de monetizar
export function theforkLink(city: string, query?: string) {
  if (query) {
    return `https://www.thefork.com/search?cityName=${encodeURIComponent(city)}&searchText=${encodeURIComponent(query)}`;
  }
  return `https://www.thefork.com/search?cityName=${encodeURIComponent(city)}`;
}

// TODO: confirmar programa de afiliado antes de monetizar
export function yelpLink(city: string, query?: string) {
  const desc = query || "Restaurants";
  return `https://www.yelp.com/search?find_desc=${encodeURIComponent(desc)}&find_loc=${encodeURIComponent(city)}`;
}

// Búsqueda directa en Google Maps — el más confiable para encontrar cualquier
// lugar (restaurante, museo, atracción) en cualquier ciudad del mundo.
export function googleMapsSearchLink(query: string, city?: string) {
  const q = city ? `${query} ${city}` : query;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}


/**
 * Trenes. Ninguno de los tres acepta origen/destino/fecha por URL pública:
 *  - Trainline necesita códigos internos de estación; el "#from=…" que se mandaba lo ignoraba (A-TRAINLINE.jpg).
 *  - Omio: /search?fromCity=… responde 410 "This page doesn't exist" (A-OMIO.jpg): era un botón roto.
 *  - Rail Europe: 403 a navegadores automáticos (BLOQUEADO).
 * Se abre la página de búsqueda de cada uno y PREFILL dice qué escribir. Los argumentos se conservan
 * para no romper a quien llama.
 */
export function trainlineLink(_origin: string, _destination: string, _date: string) {
  return tpDeepLink(`https://www.thetrainline.com/?marker=${TP_MARKER}`, "trains");
}

export function omioLink(_origin: string, _destination: string, _date: string) {
  return tpDeepLink(`https://www.omio.com/?marker=${TP_MARKER}`, "trains");
}

export function raileuropeLink(_origin: string, _destination: string, _date: string) {
  return tpDeepLink(withMarker("https://www.raileurope.com/"), "trains");
}

export function uberLink(pickupLat?: number, pickupLng?: number, dropoffName?: string) {
  const p = new URLSearchParams({ action: "setPickup" });
  if (pickupLat && pickupLng) {
    p.set("pickup[latitude]", String(pickupLat));
    p.set("pickup[longitude]", String(pickupLng));
  } else {
    p.set("pickup", "my_location");
  }
  if (dropoffName) {
    p.set("dropoff[formatted_address]", dropoffName);
    p.set("dropoff[nickname]", dropoffName);
  }
  return `https://m.uber.com/ul/?${p.toString()}`;
}



/**
 * Autos. Kayak aplica ciudad (o aeropuerto IATA) y fechas en la ruta: /cars/Madrid/2026-12-12/2026-12-19
 * (D-KAYAK-AUTOS.jpg). Discover Cars ignora pickup_location/pickup_date (abre con otras fechas,
 * A-DISCOVERCARS.jpg) y la búsqueda vieja de Rentalcars (SearchResults.do?city=…) abre "¡Vaya! Algo no ha
 * salido según lo previsto" (A-RENTALCARS.jpg): ambos abren su buscador y PREFILL dice qué completar.
 */
export function discoverCarsLink(_city: string, _pickup: string, _ret: string) {
  return tpDeepLink(`https://www.discovercars.com/?marker=${TP_MARKER}`, "cars");
}

export function rentalcarsLink(_city: string, _pickup: string, _ret: string) {
  return tpDeepLink(`https://www.rentalcars.com/?marker=${TP_MARKER}`, "cars");
}

export function kayakCarsLink(city: string, pickup: string, ret: string) {
  const url = `https://www.kayak.com.mx/cars/${encodeURIComponent(city)}/${pickup}/${ret}`;
  return tpDeepLink(url, "cars");
}

/**
 * eSIM: la página del país solo existe con el nombre del país EN INGLÉS ("spain-esim"). Antes se armaba
 * con lo que escribía el usuario o el viaje ("España" → /españa-esim → 404, A-AIRALO-ES.jpg). Solo se
 * usan slugs que abrieron la página del país el 2026-10-22; un país fuera de la lista abre la tienda.
 */
const ESIM_SLUGS: Record<string, { airalo: string; holafly: string }> = {
  ES: { airalo: "spain", holafly: "spain" }, JP: { airalo: "japan", holafly: "japan" }, US: { airalo: "united-states", holafly: "usa" },
  MX: { airalo: "mexico", holafly: "mexico" }, GB: { airalo: "united-kingdom", holafly: "united-kingdom" }, FR: { airalo: "france", holafly: "france" },
  IT: { airalo: "italy", holafly: "italy" }, DE: { airalo: "germany", holafly: "germany" }, PT: { airalo: "portugal", holafly: "portugal" },
  GR: { airalo: "greece", holafly: "greece" }, NL: { airalo: "netherlands", holafly: "netherlands" }, CH: { airalo: "switzerland", holafly: "switzerland" },
  CO: { airalo: "colombia", holafly: "colombia" }, AR: { airalo: "argentina", holafly: "argentina" }, PE: { airalo: "peru", holafly: "peru" },
  CL: { airalo: "chile", holafly: "chile" }, BR: { airalo: "brazil", holafly: "brazil" }, CA: { airalo: "canada", holafly: "canada" },
  TH: { airalo: "thailand", holafly: "thailand" }, TR: { airalo: "turkey", holafly: "turkey" }, DO: { airalo: "dominican-republic", holafly: "dominican-republic" },
  CR: { airalo: "costa-rica", holafly: "costa-rica" }, AE: { airalo: "united-arab-emirates", holafly: "dubai" }, GT: { airalo: "guatemala", holafly: "guatemala" },
};
const EXTRA_COUNTRY_NAMES: Record<string, string> = { guatemala: "GT", "united arab emirates": "AE", turkey: "TR", turkiye: "TR", brazil: "BR",
  "estados unidos de america": "US", eeuu: "US", "ee uu": "US", "dominican republic": "DO", netherlands: "NL", switzerland: "CH" };

/** País (nombre en español o inglés, o ISO-2) → slugs verificados de Airalo y Holafly. */
export function esimSlugs(country?: string | null): { iso: string; airalo: string; holafly: string } | null {
  if (!country) return null;
  const key = country.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z ]+/g, " ").replace(/\s+/g, " ").trim();
  const iso = countryIso(country) ?? EXTRA_COUNTRY_NAMES[key] ?? null;
  return iso && ESIM_SLUGS[iso] ? { iso, ...ESIM_SLUGS[iso] } : null;
}

export function airaloLink(country?: string) {
  const s = esimSlugs(country);
  const url = withMarker(s ? `https://www.airalo.com/${s.airalo}-esim` : "https://www.airalo.com/");
  return tpDeepLink(url, "esim");
}

export function holaflyLink(country?: string) {
  const s = esimSlugs(country);
  const url = withMarker(s ? `https://esim.holafly.com/esim-${s.holafly}/` : "https://esim.holafly.com/");
  return tpDeepLink(url, "esim");
}

export function heymondoLink() {
  const url = withMarker("https://www.heymondo.com/?utm_source=iatos");
  return tpDeepLink(url, "insurance");
}

// ============ FERRIES ============
// Ninguno aplicó ruta ni fecha por URL: Ferryhopper redirige /booking?trips=… a su portada, Direct
// Ferries ignora from/to/outdate y AFerry ignora from/to/date (A-FERRYHOPPER/A-DIRECTFERRIES/A-AFERRY.jpg).
// Se abre su buscador sin parámetros inventados y PREFILL dice qué escribir.
export function ferryhopperLink(_origin: string, _destination: string, _date: string, _passengers = 1) {
  return tpDeepLink(withMarker("https://www.ferryhopper.com/es/"), "ferries");
}
export function directFerriesLink(_origin: string, _destination: string, _date: string, _passengers = 1) {
  return tpDeepLink(withMarker("https://www.directferries.com/"), "ferries");
}

export function aferryLink(_origin: string, _destination: string, _date: string) {
  return tpDeepLink(withMarker("https://www.aferry.com/"), "ferries");
}


// ============ CRUCEROS ============
// Vacations To Go: cruisesearch.cfm?destination=… respondía "Page Not Found!" (A-VTG.jpg): era un botón
// roto; su portada tiene el buscador "Find a Bargain". CruiseDirect /search/ abre resultados vacíos
// (A-CRUISEDIRECT.jpg). Cruise Critic: 403 (BLOQUEADO).
export function vacationsToGoLink(_destination?: string, _month?: string) {
  return tpDeepLink(withMarker("https://www.vacationstogo.com/"), "cruises");
}
export function cruiseDirectLink(_destination?: string, _depart?: string, _returnDate?: string) {
  return tpDeepLink(withMarker("https://www.cruisedirect.com/"), "cruises");
}


export function cruiseCriticLink(destination?: string) {
  // /cruiseto/cruisestyles.cfm está descontinuado. Usamos su buscador actual.
  const url = destination
    ? `https://www.cruisecritic.com/find-a-cruise/?destination=${encodeURIComponent(destination)}`
    : `https://www.cruisecritic.com/find-a-cruise/`;
  return tpDeepLink(url, "cruises");
}

// ============ QUÉ LLEVA CADA ENLACE ============
/**
 * Qué datos llegan precargados a cada sitio y qué tiene que completar el usuario ahí. Se muestra junto
 * a cada botón (nunca se promete un dato que el sitio no recibe). `estado`: resultado de abrir el
 * enlace el 2026-10-22 — "ok" (abre la búsqueda con esos datos), "sin_datos" (abre el sitio, sin
 * datos), "bloqueado" (el sitio bloquea navegadores automáticos: no se pudo comprobar).
 */
export type PrefillInfo = { sitio: string; lleva: string; completa: string | null; estado: "ok" | "sin_datos" | "bloqueado" };
export const PREFILL: Record<string, PrefillInfo> = {
  google_flights: { sitio: "Google Flights", lleva: "ruta, fechas, pasajeros (y la aerolínea, si se cotizó)", completa: "Elige el horario y toca Reservar con la aerolínea o agencia.", estado: "ok" },
  aviasales: { sitio: "Aviasales", lleva: "ruta, fechas, adultos y niños", completa: "Elige el vuelo; la compra la cierra la agencia que muestre.", estado: "ok" },
  kayak: { sitio: "Kayak", lleva: "ruta, fechas, adultos y niños", completa: null, estado: "ok" },
  skyscanner: { sitio: "Skyscanner", lleva: "ruta, fechas y adultos", completa: "Revisa en Skyscanner que la ruta, las fechas y los adultos sean los tuyos.", estado: "bloqueado" },
  aeromexico: { sitio: "Aeroméxico", lleva: "nada", completa: "Aeroméxico no recibe ruta ni fechas por enlace: escribe origen, destino, fechas y pasajeros en su sitio.", estado: "bloqueado" },
  booking: { sitio: "Booking.com", lleva: "destino u hotel, fechas, adultos, niños y habitaciones", completa: "Booking busca el hotel por nombre: revisa que sea el cotizado (puede mostrar uno con nombre parecido) y elige habitación y tarifa.", estado: "ok" },
  airbnb: { sitio: "Airbnb", lleva: "ciudad, fechas y huéspedes", completa: null, estado: "ok" },
  getyourguide: { sitio: "GetYourGuide", lleva: "destino o experiencia y tus fechas", completa: "Elige el día, la hora y las personas en la actividad.", estado: "ok" },
  viator: { sitio: "Viator", lleva: "destino o experiencia", completa: "Elige la fecha y las personas en Viator.", estado: "bloqueado" },
  tripadvisor: { sitio: "Tripadvisor", lleva: "destino", completa: "Revisa la búsqueda en Tripadvisor.", estado: "bloqueado" },
  opentable: { sitio: "OpenTable", lleva: "restaurante o ciudad", completa: "Elige fecha, hora y personas en OpenTable (bloquea nuestra verificación: no pudimos comprobar que reciba más datos).", estado: "bloqueado" },
  resy: { sitio: "Resy", lleva: "restaurante, fecha y personas", completa: "Elige la hora en Resy.", estado: "ok" },
  thefork: { sitio: "TheFork", lleva: "ciudad y restaurante", completa: "Elige fecha, hora y personas en TheFork.", estado: "bloqueado" },
  yelp: { sitio: "Yelp", lleva: "ciudad", completa: "Elige la fecha y las personas en Yelp.", estado: "bloqueado" },
  google_maps: { sitio: "Google Maps", lleva: "el lugar", completa: "Si el lugar acepta reservas, toca Reservar en su ficha y elige fecha, hora y personas.", estado: "ok" },
  trainline: { sitio: "Trainline", lleva: "nada", completa: "Trainline no recibe origen, destino ni fecha por enlace: escríbelos en su buscador.", estado: "sin_datos" },
  omio: { sitio: "Omio", lleva: "nada", completa: "Omio no recibe la ruta por enlace: escribe origen, destino y fecha.", estado: "sin_datos" },
  raileurope: { sitio: "Rail Europe", lleva: "nada", completa: "Rail Europe no recibe la ruta por enlace: escribe origen, destino y fecha en su buscador.", estado: "bloqueado" },
  // Grupo terrestre (2026-10-24, groundLinks.ts; capturas en docs/iatos/evidencia/terrestre/).
  renfe: { sitio: "Renfe", lleva: "origen, destino, fecha y pasajeros", completa: "Elige el tren y la tarifa en Renfe.", estado: "ok" },
  db: { sitio: "Deutsche Bahn", lleva: "estaciones, fecha, hora y pasajeros", completa: "Elige el tren y la tarifa en Deutsche Bahn.", estado: "ok" },
  flixbus: { sitio: "FlixBus", lleva: "ruta, fecha y pasajeros", completa: "Elige el horario en FlixBus.", estado: "ok" },
  twelvego: { sitio: "12Go", lleva: "ruta, fecha y pasajeros", completa: "Elige tren, autobús o ferry en 12Go.", estado: "ok" },
  ado: { sitio: "ADO", lleva: "origen y destino", completa: "Elige la fecha y el horario en ADO.", estado: "ok" },
  ferryhopper: { sitio: "Ferryhopper", lleva: "puertos, fecha y pasajeros", completa: "Elige la salida y el asiento o la cabina en Ferryhopper.", estado: "ok" },
  clickandboat: { sitio: "Click&Boat", lleva: "destino, fechas y personas", completa: "Elige el barco; disponibilidad y precio los da cada dueño.", estado: "ok" },
  kayak_cars: { sitio: "Kayak", lleva: "ciudad o aeropuerto y fechas de recogida y devolución", completa: "Elige la hora y el auto en Kayak.", estado: "ok" },
  discovercars: { sitio: "Discover Cars", lleva: "nada", completa: "Discover Cars no recibe ciudad ni fechas por enlace: escríbelas en su buscador.", estado: "sin_datos" },
  rentalcars: { sitio: "Rentalcars.com", lleva: "nada", completa: "Rentalcars no recibe ciudad ni fechas por enlace: escríbelas en su buscador.", estado: "sin_datos" },
  airalo: { sitio: "Airalo", lleva: "el país (si lo reconocemos)", completa: "Elige cuántos días y datos necesitas.", estado: "ok" },
  holafly: { sitio: "Holafly", lleva: "el país (si lo reconocemos)", completa: "Elige cuántos días necesitas.", estado: "ok" },
  nomad: { sitio: "Nomad", lleva: "nada", completa: "Busca tu país y elige el plan.", estado: "sin_datos" },
  seguro: { sitio: "la aseguradora", lleva: "nada", completa: "Escribe destino, fechas y viajeros en el cotizador de la aseguradora.", estado: "sin_datos" },
  ferry: { sitio: "el sitio de ferries", lleva: "nada", completa: "Ningún sitio de ferries recibe ruta ni fecha por enlace: escribe puerto de salida, llegada, fecha y pasajeros.", estado: "sin_datos" },
  crucero: { sitio: "el sitio de cruceros", lleva: "nada", completa: "Elige destino, mes y noches en su buscador.", estado: "sin_datos" },
  welcome: { sitio: "Welcome Pickups", lleva: "nada", completa: "Escribe aeropuerto, hotel, fecha, hora y pasajeros en Welcome.", estado: "sin_datos" },
};

/** Texto corto para debajo del botón: "Llega con: …" o "Escribe …". */
export function prefillLine(key: keyof typeof PREFILL | string): string | null {
  const p = PREFILL[key];
  if (!p) return null;
  return p.lleva === "nada" ? (p.completa ?? `Completa tus datos en ${p.sitio}.`) : `Llega con: ${p.lleva}.${p.completa ? ` ${p.completa}` : ""}`;
}
