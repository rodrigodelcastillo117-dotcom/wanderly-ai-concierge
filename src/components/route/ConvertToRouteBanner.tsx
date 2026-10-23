// Viajes ya guardados como UN destino aunque no lo son:
//  - varias ciudades en el texto ("paris roma y atenas 10 dias" → un vuelo y un hotel de 9 noches en París);
//  - un país ("india" → un vuelo "Ciudad de México → india" y un hotel "india · 14 noches").
// No se reescribe el viaje ni se inventan vuelos u hoteles: se ofrece armarlo como ruta en "Ruta
// multi-destino" con las ciudades, fechas, viajeros y noches por ciudad precargados. En un país, la ruta
// propuesta se queda con las ciudades donde el propio análisis ya puso experiencias o restaurantes.
import { Link } from "react-router-dom";
import { Route as RouteIcon } from "lucide-react";
import { diffLocalDays } from "@/lib/localDate";
import { countryOnly, fitNights, isMultiCity, parseMultiCityText, routePlannerQuery } from "@/lib/multiCityText";
import { cityReasons, describeProposal, proposeCountryRoute } from "@/lib/countryRoutes";

export type RouteConversion = { kind: "ciudades" | "pais"; country: string | null; cities: string[]; nights: number[] | null; why: string[] | null; href: string };

export function routeConversion(trip: any): RouteConversion | null {
  const itin = trip?.itinerario_json;
  if (!trip || (itin && !Array.isArray(itin) && itin.multi)) return null;
  const p = parseMultiCityText(String(trip.destino ?? ""), { origin: trip.ciudad_origen ?? null });
  const total = trip.fecha_salida && trip.fecha_regreso ? diffLocalDays(trip.fecha_salida, trip.fecha_regreso) : 0;
  let out: Omit<RouteConversion, "href"> | null = null;
  if (isMultiCity(p)) {
    out = { kind: "ciudades", country: null, cities: p.cities, nights: total > 0 ? fitNights(null, p.cities.length, total) : null, why: null };
  } else {
    const country = countryOnly(p);
    const analysisCities = [...(trip.tours_json ?? []), ...(trip.restaurantes_json ?? []), ...(trip.hospedaje_json ?? [])].map((x: any) => x?.ciudad).filter(Boolean);
    const prop = country ? proposeCountryRoute(country, total > 0 ? total : null, analysisCities) : null;
    if (prop) out = { kind: "pais", country: prop.country, cities: prop.cities, nights: prop.nights, why: cityReasons(prop, { tours: trip.tours_json ?? [] }) };
  }
  if (!out) return null;
  const href = `/dashboard/ruta?${routePlannerQuery({
    origin: trip.ciudad_origen, cities: out.cities, nights: out.nights, fechaSalida: trip.fecha_salida, fechaRegreso: trip.fecha_regreso,
    viajeros: trip.num_viajeros, presupuesto: trip.presupuesto_objetivo ?? null, fromTrip: trip.id,
  })}`;
  return { ...out, href };
}

/** Solo el enlace (null si el viaje no es de este tipo). */
export const convertToRouteHref = (trip: any): string | null => routeConversion(trip)?.href ?? null;

export function ConvertToRouteBanner({ trip }: { trip: any }) {
  const c = routeConversion(trip);
  if (!c) return null;
  const distinct = new Set(c.cities).size;
  return (
    <div role="status" data-testid="convertir-ruta" data-kind={c.kind}
      className="flex flex-col gap-3 rounded-2xl border border-primary/35 bg-primary/[0.07] p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-start gap-2 text-sm">
        <RouteIcon className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <div className="min-w-0">
          {c.kind === "pais" ? (
            <p>Tu destino es un país ({c.country}). Te proponemos: <span className="font-medium">{describeProposal(c.cities, c.nights)}</span>.
              <span className="text-muted-foreground"> Este viaje se cotizó como un solo destino (un vuelo y un hotel).</span></p>
          ) : (
            <p>Tu destino tiene {distinct} ciudades: <span className="font-medium">{c.cities.join(" → ")}</span>.
              <span className="text-muted-foreground"> Este viaje se cotizó como un solo destino (un vuelo y un hotel).</span></p>
          )}
          {c.why && (
            <details className="mt-1 text-xs text-muted-foreground">
              <summary className="cursor-pointer list-none text-primary">Por qué estas ciudades</summary>
              <ul className="mt-1 space-y-0.5" data-testid="convertir-ruta-porque">
                {c.cities.map((city, i) => c.why![i] ? <li key={`${city}-${i}`}><span className="text-foreground/90">{city}:</span> {c.why![i]}</li> : null)}
              </ul>
            </details>
          )}
        </div>
      </div>
      <Link to={c.href} data-testid="convertir-ruta-boton"
        className="inline-flex min-h-[44px] shrink-0 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground transition hover:bg-primary/90">
        Convertir en ruta de varias ciudades
      </Link>
    </div>
  );
}
