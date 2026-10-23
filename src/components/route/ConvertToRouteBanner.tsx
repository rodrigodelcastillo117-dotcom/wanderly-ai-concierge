// Viajes ya guardados con varias ciudades en el destino pero cotizados como UN destino (caso del dueño,
// 23-oct-2026: "paris roma y atenas 10 dias" → un vuelo y un hotel de 9 noches en París). No se
// reescribe el viaje ni se inventan vuelos u hoteles: se ofrece armarlo como ruta en "Ruta
// multi-destino", con las ciudades, fechas, viajeros y noches por ciudad precargados.
import { Link } from "react-router-dom";
import { Route as RouteIcon } from "lucide-react";
import { diffLocalDays } from "@/lib/localDate";
import { fitNights, isMultiCity, parseMultiCityText, routePlannerQuery } from "@/lib/multiCityText";

export function convertToRouteHref(trip: any): string | null {
  const itin = trip?.itinerario_json;
  if (!trip || (itin && !Array.isArray(itin) && itin.multi)) return null;
  const p = parseMultiCityText(String(trip.destino ?? ""), { origin: trip.ciudad_origen ?? null });
  if (!isMultiCity(p)) return null;
  const total = trip.fecha_salida && trip.fecha_regreso ? diffLocalDays(trip.fecha_salida, trip.fecha_regreso) : 0;
  const nights = total > 0 ? fitNights(null, p.cities.length, total) : null;
  return `/dashboard/ruta?${routePlannerQuery({
    origin: trip.ciudad_origen, cities: p.cities, nights, fechaSalida: trip.fecha_salida, fechaRegreso: trip.fecha_regreso,
    viajeros: trip.num_viajeros, presupuesto: trip.presupuesto_objetivo ?? null, fromTrip: trip.id,
  })}`;
}

export function ConvertToRouteBanner({ trip }: { trip: any }) {
  const href = convertToRouteHref(trip);
  if (!href) return null;
  const cities = parseMultiCityText(String(trip.destino ?? ""), { origin: trip.ciudad_origen ?? null }).cities;
  return (
    <div role="status" data-testid="convertir-ruta"
      className="flex flex-col gap-3 rounded-2xl border border-primary/35 bg-primary/[0.07] p-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="flex min-w-0 items-start gap-2 text-sm">
        <RouteIcon className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <span>
          Tu destino tiene {cities.length} ciudades: <span className="font-medium">{cities.join(" → ")}</span>.
          <span className="text-muted-foreground"> Este viaje se cotizó como un solo destino (un vuelo y un hotel).</span>
        </span>
      </p>
      <Link to={href} data-testid="convertir-ruta-boton"
        className="inline-flex min-h-[44px] shrink-0 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground transition hover:bg-primary/90">
        Convertir en ruta de varias ciudades
      </Link>
    </div>
  );
}
