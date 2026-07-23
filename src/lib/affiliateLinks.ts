// Helpers para construir deep-links de compra/booking a partners reales.
// El script Travelpayouts Drive (en index.html) etiqueta automáticamente
// los enlaces salientes con tu marker para cobrar comisiones.

export const TP_MARKER = "533299";

/**
 * Envuelve una URL de partner en el redirect de Travelpayouts para atribuir
 * la comisión. `subId` permite medir qué vertical convierte mejor.
 */
export function tpDeepLink(targetUrl: string, subId?: string): string {
  const p = new URLSearchParams({
    marker: subId ? `${TP_MARKER}.${subId}` : TP_MARKER,
    u: targetUrl,
  });
  return `https://tp.media/click?${p.toString()}`;
}

/** Añade ?marker= directo para partners que lo aceptan como query param. */
export function withMarker(url: string, param = "marker"): string {
  if (new RegExp(`[?&]${param}=`).test(url)) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}${param}=${TP_MARKER}`;
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

export function welcomePickupsLink(input: WelcomePickupsTransferInput = {}): string {
  const base = "https://www.welcomepickups.com/";
  const params = new URLSearchParams({
    aff_track_id: WP_AFF_TRACK_ID,
    utm_source: "travelpayouts",
    utm_medium: "iatos_concierge",
    utm_campaign: `transfer_${(input.ciudad ?? "general").toLowerCase().replace(/\s+/g, "_")}`,
  });
  if (input.origen) params.set("pickup_location", input.origen);
  if (input.destino) params.set("dropoff_location", input.destino);
  if (input.fecha) params.set("pickup_date", input.fecha);
  if (input.hora) params.set("pickup_time", input.hora);
  if (input.pax) params.set("passengers", String(input.pax));
  if (input.vuelo) params.set("flight_number", input.vuelo);
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

// Aviasales (vuelos, marca propia Travelpayouts — comisión más alta)
export function aviasalesLink(originIata: string, destIata: string, depart: string, ret?: string, adults = 1) {
  const d = depart.replace(/-/g, "").slice(2, 8); // YYMMDD → DDMM
  const dMMDD = d.slice(4, 6) + d.slice(2, 4); // DDMM
  const r = ret ? ret.replace(/-/g, "").slice(2, 8) : "";
  const rMMDD = r ? r.slice(4, 6) + r.slice(2, 4) : "";
  const path = rMMDD
    ? `${originIata}${dMMDD}${destIata}${rMMDD}${adults}`
    : `${originIata}${dMMDD}${destIata}${adults}`;
  return ensureAviasalesMarker(`https://www.aviasales.com/search/${path}`);
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


export function googleFlightsLink(origin: string, destination: string, depart: string, ret?: string, adults = 1) {
  const q = ret
    ? `flights from ${origin} to ${destination} on ${depart} returning ${ret} for ${adults} adults`
    : `flights from ${origin} to ${destination} on ${depart} for ${adults} adults`;
  return `https://www.google.com/travel/flights?q=${encodeURIComponent(q)}`;
}

export function skyscannerLink(originIata: string, destIata: string, depart: string, ret?: string, adults = 1) {
  const d = depart.replace(/-/g, "").slice(2); // YYMMDD
  const r = ret ? ret.replace(/-/g, "").slice(2) : "";
  const path = r
    ? `${originIata}/${destIata}/${d}/${r}`
    : `${originIata}/${destIata}/${d}`;
  const url = `https://www.skyscanner.com.mx/transport/flights/${path}/?adults=${adults}`;
  return tpDeepLink(url, "flights");
}

export function kayakFlightsLink(originIata: string, destIata: string, depart: string, ret?: string, adults = 1) {
  const path = ret ? `${originIata}-${destIata}/${depart}/${ret}` : `${originIata}-${destIata}/${depart}`;
  const url = `https://www.kayak.com/flights/${path}?adults=${adults}`;
  return tpDeepLink(url, "flights");
}

export function bookingLink(city: string, checkin: string, checkout: string, adults = 2) {
  const p = new URLSearchParams({
    ss: city,
    checkin,
    checkout,
    group_adults: String(adults),
    no_rooms: "1",
  });
  const url = `https://www.booking.com/searchresults.html?${p.toString()}`;
  return tpDeepLink(url, "hotels");
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

export function getYourGuideLink(city: string, query?: string) {
  const q = query ? `${query} ${city}` : city;
  const url = `https://www.getyourguide.com/s/?q=${encodeURIComponent(q)}`;
  return tpDeepLink(url, "tours");
}

export function viatorLink(city: string, query?: string) {
  const q = query ? `${query} ${city}` : city;
  const url = `https://www.viator.com/searchResults/all?text=${encodeURIComponent(q)}`;
  return tpDeepLink(url, "tours");
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


export function trainlineLink(origin: string, destination: string, date: string) {
  // Trainline no expone deep-link público con nombres de ciudad (requiere
  // hashes internos de estación). Mandamos a la landing con un hint en hash
  // para que el usuario complete origen/destino en la UI.
  const hint = `#from=${encodeURIComponent(origin)}&to=${encodeURIComponent(destination)}&date=${date}`;
  return `https://www.thetrainline.com/${hint}`;
}


export function omioLink(origin: string, destination: string, date: string) {
  // Omio /search-frontend requiere IDs internos; usamos su buscador público
  // que sí acepta nombres de ciudad.
  const p = new URLSearchParams({
    fromCity: origin,
    toCity: destination,
    outboundDate: date,
    adults: "1",
  });
  return `https://www.omio.com/search?${p.toString()}`;
}

export function raileuropeLink(origin: string, destination: string, date: string) {
  return `https://www.raileurope.com/en/search?origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&outbound_date=${date}&passengers=1`;
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



export function discoverCarsLink(city: string, pickup: string, ret: string) {
  // Discover Cars usa búsqueda con texto libre
  const p = new URLSearchParams({
    pickup_location: city,
    pickup_date: pickup,
    return_date: ret,
  });
  return `https://www.discovercars.com/?${p.toString()}`;
}

export function rentalcarsLink(city: string, pickup: string, ret: string) {
  const p = new URLSearchParams({
    city,
    puDay: pickup.slice(8, 10),
    puMonth: pickup.slice(5, 7),
    puYear: pickup.slice(0, 4),
    doDay: ret.slice(8, 10),
    doMonth: ret.slice(5, 7),
    doYear: ret.slice(0, 4),
  });
  return `https://www.rentalcars.com/SearchResults.do?${p.toString()}`;
}

export function kayakCarsLink(city: string, pickup: string, ret: string) {
  return `https://www.kayak.com/cars/${encodeURIComponent(city)}/${pickup}/${ret}`;
}

export function airaloLink(country?: string) {
  // Airalo no expone búsqueda directa por país en URL — landing global
  return country
    ? `https://www.airalo.com/${encodeURIComponent(country.toLowerCase().replace(/\s+/g, "-"))}-esim`
    : `https://www.airalo.com/`;
}

export function holaflyLink(country?: string) {
  return country
    ? `https://esim.holafly.com/esim-${encodeURIComponent(country.toLowerCase().replace(/\s+/g, "-"))}/`
    : `https://esim.holafly.com/`;
}

export function heymondoLink() {
  return "https://www.heymondo.com/?utm_source=iatos";
}

// ============ FERRIES ============
export function ferryhopperLink(origin: string, destination: string, date: string, passengers = 1) {
  const trip = `${encodeURIComponent(origin)}-${encodeURIComponent(destination)}_${date}`;
  return `https://www.ferryhopper.com/en/booking?trips=${trip}&adults=${passengers}`;
}
export function directFerriesLink(origin: string, destination: string, date: string, passengers = 1) {
  // El buscador con query params (?from=...&to=...) sí carga (200) aunque no
  // resuelva la ruta exacta — siempre el usuario puede afinar en la UI.
  const p = new URLSearchParams({ from: origin, to: destination, outdate: date, adults: String(passengers) });
  return `https://www.directferries.com/?${p.toString()}`;
}

export function aferryLink(origin: string, destination: string, date: string) {
  const p = new URLSearchParams({ from: origin, to: destination, date });
  return `https://www.aferry.com/?${p.toString()}`;
}


// ============ CRUCEROS ============
export function vacationsToGoLink(destination?: string, month?: string) {
  const p = new URLSearchParams();
  if (destination) p.set("destination", destination);
  if (month) p.set("month", month);
  const qs = p.toString();
  return qs ? `https://www.vacationstogo.com/cruisesearch.cfm?${qs}` : `https://www.vacationstogo.com/cruisesearch.cfm`;
}
export function cruiseDirectLink(destination?: string, depart?: string, returnDate?: string) {
  // El buscador real vive en /search/ — los params los lee del estado.
  const p = new URLSearchParams();
  if (destination) p.set("destination", destination);
  if (depart) p.set("departDate", depart);
  if (returnDate) p.set("returnDate", returnDate);
  const qs = p.toString();
  return qs ? `https://www.cruisedirect.com/search/?${qs}` : `https://www.cruisedirect.com/search/`;
}


export function cruiseCriticLink(destination?: string) {
  // /cruiseto/cruisestyles.cfm está descontinuado. Usamos su buscador actual.
  return destination
    ? `https://www.cruisecritic.com/find-a-cruise/?destination=${encodeURIComponent(destination)}`
    : `https://www.cruisecritic.com/find-a-cruise/`;
}


