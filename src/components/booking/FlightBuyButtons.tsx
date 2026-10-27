// Botones de compra de una opción de "Cómo llegar" (punto 8 del caso Roma → Florencia → Venecia): cada
// vuelo lleva "Ver y comprar en Google Flights" y Kayak con la búsqueda precargada (origen, destino,
// fechas, pasajeros y, si la tarifa es real y la aerolínea opera la ruta, la aerolínea). Si no se puede
// precargar el destino, el botón lo dice. Un coche o un tren no son vuelos: van al road trip, a la
// renta de auto o al buscador de trenes.
import { Link } from "react-router-dom";
import { Car, ExternalLink, Route as RouteIcon, Ship, Train } from "lucide-react";
import { offerFromTripFlight, isGroundTripOption, transportModeOf } from "@/lib/booking";
import { prefillMatchesTrip } from "@/lib/purchasePlan";
import { logBookingClick } from "@/lib/trackBooking";
import { trainlineLink } from "@/lib/affiliateLinks";
import { transitScheduleUrl } from "@/lib/takeMeThere";
import { busActions, multimodalAction, noLinkText, operatorAction, PRICE_AT_OPERATOR, routeOperators } from "../../../supabase/functions/_shared/booking/railOperators.ts";
import { mainAirport } from "../../../supabase/functions/_shared/airports.ts";
import { googleFlightsSearchUrl, kayakFlightsSearchUrl } from "../../../supabase/functions/_shared/booking/links.ts";
import { stayForCity } from "../../../supabase/functions/_shared/booking/tripRoute.ts";
import { legCarRentalDates } from "@/lib/multiDestTrip";
import { ROADTRIP_ANCHOR } from "@/components/roadtrip/RoadTripPanel";
import { scrollToSection } from "@/components/TripNextStep";

const PLAIN_GF = "https://www.google.com/travel/flights?hl=es-419";

/** Enlaces de compra de una opción de vuelo del viaje (los mismos constructores que "Comprar mi viaje"). */
export function flightBuyLinks(v: any, trip: any, index = 0): { google: string; prefilled: boolean; kayak: string | null } {
  const offer = offerFromTripFlight(v, { trip, index });
  const ok = (u: string | null | undefined) => !!u && prefillMatchesTrip(u, trip) !== false;
  let google = offer.actions.find((a) => a.processor === "Google Flights" && ok(a.url))?.url ?? null;
  let kayak = offer.actions.find((a) => a.processor === "Kayak")?.url ?? null;
  // Tramo interno (Florencia → Venecia): solo ida, el día que se llega a esa ciudad.
  if (!google && v?.from && v?.to) {
    const from = mainAirport(v.from);
    const to = mainAirport(v.to);
    const date = stayForCity(trip, v.to)?.checkin ?? null;
    const adults = Math.max(1, Math.round(Number(trip?.num_viajeros) || 1));
    if (from && to && date) {
      google = googleFlightsSearchUrl({ origin: from, destination: to, depart: date, adults });
      kayak = kayakFlightsSearchUrl({ origin: from, destination: to, depart: date, adults });
    }
  }
  return { google: google ?? PLAIN_GF, prefilled: !!google, kayak };
}

const btn = "inline-flex min-h-[44px] items-center justify-center gap-1 rounded-lg px-3 py-2 text-sm font-medium transition";

export function FlightBuyButtons({ option, trip, index = 0 }: { option: any; trip: any; index?: number }) {
  if (isGroundTripOption(option)) return <GroundBuyButtons option={option} trip={trip} />;
  const l = flightBuyLinks(option, trip, index);
  const track = (provider: string, url: string) => () => void logBookingClick({ category: "flight", provider, title: String(option?.aerolinea ?? "Vuelo"), bookingUrl: url,
    city: option?.to ?? trip?.destino ?? undefined, tripId: trip?.id, startAt: trip?.fecha_salida ?? undefined });
  return (
    <div className="mt-3 flex flex-wrap gap-2" onClick={(e) => e.stopPropagation()} data-testid="flight-buy-buttons">
      <a href={l.google} target="_blank" rel="noopener noreferrer" onClick={track("Google Flights", l.google)} data-testid="flight-buy-google"
        className={`${btn} bg-primary text-primary-foreground hover:bg-primary/90`}>
        {l.prefilled ? "Ver y comprar en Google Flights" : "Abre Google Flights y escribe el destino"} <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
      </a>
      {l.kayak && (
        <a href={l.kayak} target="_blank" rel="noopener noreferrer" onClick={track("Kayak", l.kayak)} data-testid="flight-buy-kayak"
          className={`${btn} border border-border/70 hover:border-primary/50`}>
          Kayak <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
        </a>
      )}
    </div>
  );
}

/**
 * Coche: al panel del road trip y a la renta de auto (recoger aquí, devolver allá). Tren entre ciudades:
 * el operador oficial con la búsqueda PRECARGADA cuando su formato se comprobó (Renfe, DB; groundLinks.ts)
 * o su portada, Trainline y horarios. Autobús: ADO/FlixBus/12Go precargados o la portada del operador
 * que nombra el plan. Ferry: salidas y precio en vivo de Ferryhopper (pantalla Ferris). Taxi o traslado:
 * se dice que IATOS no lo cotiza. Nunca un precio inventado ni un enlace de vuelos.
 */
export function GroundBuyButtons({ option, trip }: { option: any; trip: any }) {
  const mode = transportModeOf(option?.modo) ?? transportModeOf(option?.mode);
  // Un viaje de un destino por carretera (CDMX → Tepoztlán) no trae from/to en la fila: son los del viaje.
  const single = !option?.from && !option?.to && !option?.ciudad;
  const rawFrom = String(option?.from ?? (single ? trip?.ciudad_origen ?? "" : ""));
  const from = rawFrom.replace(/\(.*?\)/g, "").trim();
  const to = String(option?.to ?? option?.ciudad ?? (single ? trip?.destino ?? "" : "")).trim();
  const pickup = stayForCity(trip, to)?.checkin ?? trip?.fecha_salida ?? "";
  const fromAirport = /aeropuerto|airport|\([A-Z]{3}\)/i.test(rawFrom);
  const op = String(option?.aerolinea ?? option?.provider ?? "").trim();
  const adults = Math.max(1, Math.round(Number(trip?.num_viajeros) || 1));
  const q = { from, to, date: /^\d{4}-\d{2}-\d{2}$/.test(pickup) ? pickup : null, adults };
  // Horarios reales y gratis: Google Maps en transporte público (Maps URLs, travelmode=transit).
  const sched = mode === "tren" || mode === "bus" ? transitScheduleUrl(from, to) : null;
  const schedLink = sched ? (
    <a href={sched} target="_blank" rel="noopener noreferrer" data-testid="ground-schedule" className={`${btn} border border-border/70 hover:border-primary/50`}>
      Ver horarios en Google Maps <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
    </a>
  ) : null;
  if (mode === "ferry" && from && to) {
    const qs = new URLSearchParams({ origin: from, dest: to, ...(q.date ? { date: q.date } : {}), pax: String(adults), ...(trip?.id ? { trip: String(trip.id) } : {}) });
    return (
      <div className="mt-3 space-y-1" onClick={(e) => e.stopPropagation()} data-testid="ground-buy-buttons">
        <Link to={`/dashboard/ferries?${qs.toString()}`} data-testid="ground-ferry-live" className={`${btn} border border-primary/40 text-primary`}>
          <Ship className="w-4 h-4" aria-hidden="true" /> Ver salidas y precio en vivo
        </Link>
        <p className="text-[11px] text-muted-foreground">Consulta Ferryhopper con tu ruta y fecha; el precio se confirma al comprar.</p>
      </div>
    );
  }
  if (mode !== "coche" && (mode !== "tren" || fromAirport)) {
    const acts = mode === "bus" ? busActions({ ...q, provider: op }) : [];
    const main = acts[0] ?? null;
    return (
      <div className="mt-3 space-y-2" onClick={(e) => e.stopPropagation()}>
        <p className="text-xs text-muted-foreground" data-testid="ground-buy-operator">
          {main ? main.hint : noLinkText(mode, op || null)}
        </p>
        {(acts.length > 0 || schedLink) && (
          <div className="flex flex-wrap gap-2">
            {acts.map((a, i) => (
              <a key={a.url} href={a.url} target="_blank" rel="noopener noreferrer" data-testid="ground-operator" data-prefilled={a.prefilled ? "1" : "0"}
                className={`${btn} ${i === 0 ? "border border-primary/40 text-primary" : "border border-border/70 hover:border-primary/50"}`}>
                {a.label} <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
              </a>
            ))}
            {schedLink}
          </div>
        )}
      </div>
    );
  }
  if (mode === "tren") {
    const url = trainlineLink(from, to, pickup);
    const ops = routeOperators({ from, to, provider: op, country: trip?.pais_destino });
    const acts = ops.map((o) => operatorAction(o, q));
    const main = acts.find((a, i) => !ops[i].informativo) ?? multimodalAction(q);
    const all = main && !acts.includes(main) ? [main, ...acts] : acts;
    return (
      <div className="mt-3 space-y-1" onClick={(e) => e.stopPropagation()} data-testid="ground-buy-buttons">
        <div className="flex flex-wrap gap-2">
          {all.map((a) => (
            <a key={a.url} href={a.url} target="_blank" rel="noopener noreferrer" data-testid="ground-operator" data-prefilled={a.prefilled ? "1" : "0"}
              className={`${btn} ${a === main ? "border border-primary/40 text-primary" : "border border-border/70 hover:border-primary/50"}`}>
              <Train className="w-4 h-4" aria-hidden="true" /> {a.label} <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
            </a>
          ))}
          <a href={url} target="_blank" rel="noopener noreferrer" className={`${btn} border border-border/70 hover:border-primary/50`}>
            <Train className="w-4 h-4" aria-hidden="true" /> Buscar tren en Trainline <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
          </a>
          {schedLink}
        </div>
        <p className="text-[11px] text-muted-foreground">
          {main ? main.hint : `Trainline no recibe la ruta por enlace: escribe ${from} → ${to} y la fecha. ${PRICE_AT_OPERATOR}.`}
        </p>
      </div>
    );
  }
  // Fechas del TRAMO (Madrid → Córdoba se devuelve el 7 may en Córdoba), no las del viaje completo.
  const car = legCarRentalDates(trip, from, to);
  const qs = new URLSearchParams({ city: from || to, ...(to && from ? { dropoff: to } : {}), ...(car.pickup ? { pickup: car.pickup } : {}), ...(car.dropoff ? { return: car.dropoff } : {}), ...(trip?.id ? { trip: trip.id } : {}) });
  // Sin plan de road trip (viaje corto de un destino): la ruta en Google Maps, no un road trip que no existe.
  const hasRoadTrip = Array.isArray(trip?.itinerario_json?.logistics?.road_trip?.legs);
  const route = single && !hasRoadTrip && from && to
    ? `https://www.google.com/maps/dir/?${new URLSearchParams({ api: "1", origin: from, destination: to, travelmode: "driving" }).toString()}` : null;
  return (
    <div className="mt-3 flex flex-wrap gap-2" onClick={(e) => e.stopPropagation()} data-testid="ground-buy-buttons">
      {route ? (
        <a href={route} target="_blank" rel="noopener noreferrer" data-testid="ground-route" className={`${btn} border border-border/70 hover:border-primary/50`}>
          <RouteIcon className="w-4 h-4" aria-hidden="true" /> Ver ruta en Google Maps <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
        </a>
      ) : (
      <button type="button" onClick={() => scrollToSection(ROADTRIP_ANCHOR)} className={`${btn} border border-border/70 hover:border-primary/50`}>
        <RouteIcon className="w-4 h-4" aria-hidden="true" /> Ver el road trip
      </button>
      )}
      <Link to={`/dashboard/autos?${qs.toString()}`} className={`${btn} border border-primary/40 text-primary`}>
        <Car className="w-4 h-4" aria-hidden="true" /> Rentar auto
      </Link>
    </div>
  );
}
