// Helpers para construir deep-links de compra/booking a partners reales.
// No requieren API keys: redirigen al sitio del partner con filtros aplicados.

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
  return `https://www.skyscanner.com.mx/transport/flights/${path}/?adults=${adults}`;
}

export function kayakFlightsLink(originIata: string, destIata: string, depart: string, ret?: string, adults = 1) {
  const path = ret ? `${originIata}-${destIata}/${depart}/${ret}` : `${originIata}-${destIata}/${depart}`;
  return `https://www.kayak.com/flights/${path}?adults=${adults}`;
}

export function bookingLink(city: string, checkin: string, checkout: string, adults = 2) {
  const p = new URLSearchParams({
    ss: city,
    checkin,
    checkout,
    group_adults: String(adults),
    no_rooms: "1",
  });
  return `https://www.booking.com/searchresults.html?${p.toString()}`;
}

export function airbnbLink(city: string, checkin: string, checkout: string, adults = 2) {
  const p = new URLSearchParams({
    query: city,
    checkin,
    checkout,
    adults: String(adults),
  });
  return `https://www.airbnb.com/s/${encodeURIComponent(city)}/homes?${p.toString()}`;
}

export function getYourGuideLink(city: string) {
  return `https://www.getyourguide.com/s/?q=${encodeURIComponent(city)}`;
}

export function viatorLink(city: string) {
  return `https://www.viator.com/searchResults/all?text=${encodeURIComponent(city)}`;
}

export function tripadvisorLink(city: string) {
  return `https://www.tripadvisor.com/Search?q=${encodeURIComponent(city)}`;
}

export function openTableLink(city: string) {
  return `https://www.opentable.com/s?term=${encodeURIComponent(city)}`;
}

export function theforkLink(city: string) {
  return `https://www.thefork.com/search/?cityName=${encodeURIComponent(city)}`;
}

export function yelpLink(city: string) {
  return `https://www.yelp.com/search?find_desc=Restaurants&find_loc=${encodeURIComponent(city)}`;
}

export function trainlineLink(origin: string, destination: string, date: string) {
  const p = new URLSearchParams({ origin, destination, outwardDate: date, passengers: "1" });
  return `https://www.thetrainline.com/book/results?${p.toString()}`;
}

export function omioLink(origin: string, destination: string, date: string) {
  return `https://www.omio.com/search-frontend/?departureId=${encodeURIComponent(origin)}&arrivalId=${encodeURIComponent(destination)}&departureDate=${date}&passengers=adults%3D1`;
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

