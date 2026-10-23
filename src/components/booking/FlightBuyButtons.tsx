// Botones de compra de una opción de "Cómo llegar" (punto 8 del caso Roma → Florencia → Venecia): cada
// vuelo lleva "Ver y comprar en Google Flights" y Kayak con la búsqueda precargada (origen, destino,
// fechas, pasajeros y, si la tarifa es real y la aerolínea opera la ruta, la aerolínea). Si no se puede
// precargar el destino, el botón lo dice. Un coche o un tren no son vuelos: van al road trip, a la
// renta de auto o al buscador de trenes.
import { Link } from "react-router-dom";
import { Car, ExternalLink, Route as RouteIcon, Train } from "lucide-react";
import { offerFromTripFlight, isGroundTripOption, transportModeOf } from "@/lib/booking";
import { prefillMatchesTrip } from "@/lib/purchasePlan";
import { logBookingClick } from "@/lib/trackBooking";
import { trainlineLink } from "@/lib/affiliateLinks";
import { mainAirport } from "../../../supabase/functions/_shared/airports.ts";
import { googleFlightsSearchUrl, kayakFlightsSearchUrl } from "../../../supabase/functions/_shared/booking/links.ts";
import { stayForCity } from "../../../supabase/functions/_shared/booking/tripRoute.ts";
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
 * buscador de trenes. Autobús, taxi, traslado, ferry o un tren desde el aeropuerto: no hay enlace de
 * compra fiable, así que se dice ("Precio y compra con el operador") en vez de inventar uno. Nunca un
 * enlace de vuelos.
 */
export function GroundBuyButtons({ option, trip }: { option: any; trip: any }) {
  const mode = transportModeOf(option?.modo) ?? transportModeOf(option?.mode);
  const rawFrom = String(option?.from ?? "");
  const from = rawFrom.replace(/\(.*?\)/g, "").trim();
  const to = String(option?.to ?? option?.ciudad ?? "").trim();
  const pickup = stayForCity(trip, to)?.checkin ?? trip?.fecha_salida ?? "";
  const fromAirport = /aeropuerto|airport|\([A-Z]{3}\)/i.test(rawFrom);
  if (mode !== "coche" && (mode !== "tren" || fromAirport)) {
    const op = String(option?.aerolinea ?? option?.provider ?? "").trim();
    return (
      <p className="mt-3 text-xs text-muted-foreground" data-testid="ground-buy-operator" onClick={(e) => e.stopPropagation()}>
        Precio y compra con el operador{op ? ` (${op})` : ""}.
      </p>
    );
  }
  if (mode === "tren") {
    const url = trainlineLink(from, to, pickup);
    return (
      <div className="mt-3 space-y-1" onClick={(e) => e.stopPropagation()} data-testid="ground-buy-buttons">
        <a href={url} target="_blank" rel="noopener noreferrer" className={`${btn} border border-border/70 hover:border-primary/50`}>
          <Train className="w-4 h-4" aria-hidden="true" /> Buscar tren en Trainline <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
        </a>
        <p className="text-[11px] text-muted-foreground">Trainline no recibe la ruta por enlace: escribe {from} → {to} y la fecha.</p>
      </div>
    );
  }
  const qs = new URLSearchParams({ city: from || to, ...(to && from ? { dropoff: to } : {}), ...(pickup ? { pickup } : {}), ...(trip?.fecha_regreso ? { return: trip.fecha_regreso } : {}), ...(trip?.id ? { trip: trip.id } : {}) });
  return (
    <div className="mt-3 flex flex-wrap gap-2" onClick={(e) => e.stopPropagation()} data-testid="ground-buy-buttons">
      <button type="button" onClick={() => scrollToSection(ROADTRIP_ANCHOR)} className={`${btn} border border-border/70 hover:border-primary/50`}>
        <RouteIcon className="w-4 h-4" aria-hidden="true" /> Ver el road trip
      </button>
      <Link to={`/dashboard/autos?${qs.toString()}`} className={`${btn} border border-primary/40 text-primary`}>
        <Car className="w-4 h-4" aria-hidden="true" /> Rentar auto
      </Link>
    </div>
  );
}
