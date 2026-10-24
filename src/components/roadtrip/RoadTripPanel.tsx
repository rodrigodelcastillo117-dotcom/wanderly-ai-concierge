// Road trip del viaje (grupo roadtrip): tramos en coche con distancia y tiempo (consultado o
// estimado), paradas sugeridas, costos del coche etiquetados con su fuente, avisos por país y la
// renta del auto con recogida y devolución precargadas por el camino seguro del Booking Bridge.
import { ArrowRight, Car, ExternalLink, KeyRound, MapPin, Navigation, Receipt } from "lucide-react";
import { BookingActions } from "@/components/booking/BookingActions";
import { formatDateOnly } from "@/lib/dateUtils";
import { formatInstant } from "@/lib/localDate";
import { offerFromCarRental, type RoadTripPlan } from "@/lib/roadtrip";
import { CountryNotices } from "./CountryNotices";
import { DataStateBadge } from "./DataStateBadge";
import { TollInfo } from "./TollInfo";

const km = (n: number | null) => (n === null ? "—" : `${n.toLocaleString("es-MX")} km`);
const hours = (min: number | null) => {
  if (min === null) return "—";
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${h} h${m ? ` ${m} min` : ""}` : `${m} min`;
};
const money = (n: number, cur: string) => `${n.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur}`;
const day = (d: string | null) => (d ? formatDateOnly(d, { day: "numeric", month: "short" }) : "sin fecha");

export const ROADTRIP_ANCHOR = "trip-roadtrip";

/**
 * Acceso arriba en el viaje: el panel completo va después del total y de "Comprar mi viaje", y en
 * un viaje largo había que bajar mucho para encontrarlo. Un toque lleva directo a los tramos.
 */
export function RoadTripJump({ plan }: { plan: RoadTripPlan | null | undefined }) {
  if (!plan?.legs?.length) return null;
  const totalKm = plan.legs.reduce((s, l) => s + (l.distance_km ?? 0), 0);
  const totalMin = plan.legs.reduce((s, l) => s + (l.duration_min ?? 0), 0);
  return (
    <button
      type="button"
      data-testid="roadtrip-jump"
      onClick={() => document.getElementById(ROADTRIP_ANCHOR)?.scrollIntoView?.({ behavior: "smooth", block: "start" })}
      className="w-full flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border border-primary/30 bg-primary/5 px-4 py-3 text-left text-sm hover:bg-primary/10 transition"
    >
      <Car className="w-4 h-4 text-primary shrink-0" aria-hidden="true" />
      <span className="font-medium">Road trip en coche</span>
      <span className="text-muted-foreground">{plan.legs.length} {plan.legs.length === 1 ? "tramo" : "tramos"} · {km(totalKm)} · {hours(totalMin)} de manejo</span>
      <span className="ml-auto text-primary">Ver ruta ↓</span>
    </button>
  );
}

export function RoadTripPanel({ plan, tripId, preview = false, returnCity }: {
  plan: RoadTripPlan | null | undefined;
  tripId?: string | null;
  /** Vista previa antes de generar: todo es estimado y no se ofrece reservar. */
  preview?: boolean;
  /** Ciudad del vuelo de regreso (si el auto se devuelve en otra, se avisa del traslado). */
  returnCity?: string | null;
}) {
  if (!plan?.legs?.length) return null;
  const totalKm = plan.legs.reduce((s, l) => s + (l.distance_km ?? 0), 0);
  const totalMin = plan.legs.reduce((s, l) => s + (l.duration_min ?? 0), 0);
  const allLive = plan.legs.every((l) => l.estado === "CONSULTADO");
  const totals = Object.entries(plan.totals_by_currency ?? {});
  const casetasLive = Number(plan.casetas?.mxn_en_vivo) || 0;
  return (
    <section id={preview ? undefined : ROADTRIP_ANCHOR} className="rounded-3xl border border-border bg-card overflow-hidden scroll-mt-20" data-testid="roadtrip-panel" aria-label="Road trip en coche">
      <div className="px-5 md:px-6 py-3 border-b border-border flex flex-wrap items-center gap-2 text-sm">
        <Car className="w-4 h-4 text-primary" aria-hidden="true" />
        <span className="text-primary tracking-[0.25em] uppercase text-xs">Road trip en coche{preview ? " · vista previa" : ""}</span>
        <span className="ml-auto text-xs text-muted-foreground">{km(totalKm)} · {hours(totalMin)} de manejo</span>
        <DataStateBadge state={allLive ? "CONSULTADO" : "ESTIMADO"} title={allLive ? "Todos los tramos con Google Maps" : "Al menos un tramo es estimado"} />
      </div>

      <ol className="divide-y divide-border">
        {plan.legs.map((l) => (
          <li key={l.index} className="p-5 md:p-6 space-y-2" data-leg={l.index}>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-mono text-primary">{String(l.index + 1).padStart(2, "0")}</span>
              <span className="min-w-0 break-words">{l.from}</span>
              <ArrowRight className="w-3.5 h-3.5 text-muted-foreground" aria-hidden="true" />
              <span className="min-w-0 break-words font-medium text-foreground">{l.to}</span>
              {l.date && <span className="text-xs text-muted-foreground">· {day(l.date)}</span>}
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="px-2.5 py-1 rounded-full bg-surface border border-border">{km(l.distance_km)}</span>
              <span className="px-2.5 py-1 rounded-full bg-surface border border-border">{hours(l.duration_min)}</span>
              <DataStateBadge state={l.estado}
                title={l.estado === "CONSULTADO" ? `Google Maps (sin tráfico)${l.consultado_at ? ` · ${formatInstant(l.consultado_at)}` : ""}` : l.estado === "ESTIMADO" ? "Línea recta × 1.3 a 70 km/h: aproximado" : "Sin coordenadas de estas ciudades"} />
              {l.estado === "CONSULTADO" && <span className="text-muted-foreground">Google Maps, sin tráfico</span>}
              {l.estado === "ESTIMADO" && <span className="text-muted-foreground">aprox. (línea recta)</span>}
              {l.crosses_border && <span className="px-2.5 py-1 rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-500">Cruza frontera</span>}
              <a href={l.maps_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                <Navigation className="w-3 h-3" aria-hidden="true" /> Ver ruta
              </a>
            </div>
            {l.suggested_stops.length > 0 && (
              <div className="text-xs text-muted-foreground">
                <p className="flex items-center gap-1.5 mb-1"><MapPin className="w-3 h-3" aria-hidden="true" /> Paradas sugeridas de camino:</p>
                <ul className="pl-5 list-disc space-y-0.5">
                  {l.suggested_stops.map((s) => (
                    <li key={s.name}>
                      <span className="text-foreground">{s.name}</span> — {s.why}{" "}
                      <a href={s.source.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Fuente</a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="text-xs text-muted-foreground flex flex-wrap items-center gap-2" data-testid="combustible-tramo">
              <span>{l.fuel.concepto}: {l.fuel.monto !== null && l.fuel.moneda ? money(l.fuel.monto, l.fuel.moneda) : "—"}</span>
              <DataStateBadge state={l.fuel.estado} title={l.fuel.detalle} />
              {/* Estimado, no real: la fórmula queda a la vista. */}
              <span className="text-[11px] min-w-0 break-words">{l.fuel.estado === "ESTIMADO" ? `Fórmula: ${l.fuel.detalle}` : l.fuel.detalle}</span>
            </p>
            {preview
              ? <p className="text-xs text-muted-foreground" data-testid="casetas" data-estado="SIN_CONSULTAR">Casetas: se consultan a Google Maps al generar el viaje.</p>
              : <TollInfo quote={l.tolls ?? null} from={l.from} to={l.to} consultable={!l.tolls} />}
          </li>
        ))}
      </ol>

      <div className="border-t border-border p-5 md:p-6 space-y-3" data-testid="roadtrip-costs">
        <h4 className="text-xs uppercase tracking-[0.2em] text-primary flex items-center gap-2"><Receipt className="w-3.5 h-3.5" aria-hidden="true" /> Costos del coche</h4>
        <ul className="space-y-2 text-sm">
          {plan.costs.map((c) => (
            <li key={c.id} className="rounded-xl border border-border/60 bg-surface/30 px-3 py-2" data-cost={c.id}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0 break-words">{c.concepto}</span>
                <span className="flex items-center gap-2">
                  <span className="text-foreground">{c.monto !== null && c.moneda ? money(c.monto, c.moneda) : "—"}</span>
                  <DataStateBadge state={c.estado} />
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">
                {c.detalle}
                {c.fuente && (
                  <> {" "}<a href={c.fuente.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-0.5">
                    {c.fuente.label}<ExternalLink className="w-3 h-3" aria-hidden="true" /></a>
                    {" "}· consultado el {formatDateOnly(c.fuente.consulted_at, { day: "numeric", month: "short", year: "numeric" })}</>
                )}
              </p>
            </li>
          ))}
        </ul>
        {totals.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Suma parcial de lo que tiene monto: {totals.map(([cur, n]) => money(n, cur)).join(" + ")}. Faltan renta{plan.casetas?.faltan?.length ? ", casetas sin monto" : ""} y estacionamiento (por cotizar o confirmar). {casetasLive > 0 ? "Solo las casetas en vivo se suman al total del viaje; lo demás no." : "No se suma al total del viaje."}
          </p>
        )}
        {casetasLive > 0 && (
          <p className="text-xs text-foreground flex flex-wrap items-center gap-2" data-testid="casetas-total">
            Casetas en vivo (Google Maps): ${casetasLive.toLocaleString("es-MX")} MXN, sumadas al total del viaje.
            <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] tracking-wide text-primary">en vivo</span>
            {plan.casetas!.faltan.length > 0 && <span className="text-amber-500">Faltan las casetas de {plan.casetas!.faltan.length} {plan.casetas!.faltan.length === 1 ? "tramo" : "tramos"} (sin monto de Google).</span>}
          </p>
        )}
        <ul className="text-[11px] text-muted-foreground list-disc pl-4">
          {plan.assumptions.map((a) => <li key={a}>{a}</li>)}
        </ul>
      </div>

      <div className="border-t border-border p-5 md:p-6 space-y-3" data-testid="roadtrip-rentals">
        <h4 className="text-xs uppercase tracking-[0.2em] text-primary flex items-center gap-2"><KeyRound className="w-3.5 h-3.5" aria-hidden="true" /> Renta del auto</h4>
        {plan.rentals.map((r) => {
          const ready = !!(r.pickup_date && r.dropoff_date);
          const source = { type: "car_rental" as const, pickup_city: r.pickup_city, dropoff_city: r.dropoff_city, pickup_date: r.pickup_date ?? "", dropoff_date: r.dropoff_date ?? "", trip_id: tripId ?? null };
          const qs = new URLSearchParams({ city: r.pickup_city, dropoff: r.dropoff_city, ...(r.pickup_date ? { pickup: r.pickup_date } : {}), ...(r.dropoff_date ? { return: r.dropoff_date } : {}), ...(tripId ? { trip: tripId } : {}) });
          return (
            <div key={r.leg_indexes.join("-")} className="rounded-2xl border border-border bg-surface/30 p-4 space-y-2" data-rental={r.leg_indexes[0]}>
              <p className="text-sm">
                Recoges en <span className="font-medium">{r.pickup_city}</span> ({day(r.pickup_date)}) y devuelves en <span className="font-medium">{r.dropoff_city}</span> ({day(r.dropoff_date)}).
              </p>
              {r.warnings.map((w) => (
                <p key={w} className="text-xs rounded-md border border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400 px-2 py-1.5" data-warning="one-way">{w}</p>
              ))}
              {returnCity && r.dropoff_city.toLowerCase() !== returnCity.toLowerCase() && r === plan.rentals[plan.rentals.length - 1] && (
                <p className="text-xs text-muted-foreground">Tu vuelo de regreso sale de {returnCity}: considera el traslado desde {r.dropoff_city}.</p>
              )}
              {!preview && (ready ? (
                <BookingActions className="max-w-sm" tripId={tripId ?? null} max={1}
                  offer={offerFromCarRental({ pickup_city: r.pickup_city, dropoff_city: r.dropoff_city, pickup_date: r.pickup_date!, dropoff_date: r.dropoff_date!, trip_id: tripId ?? null })}
                  source={source}
                  fallbackInternal={{ label: "Elegir fechas en Renta de auto →", href: `/dashboard/autos?${qs.toString()}` }} />
              ) : (
                <a href={`/dashboard/autos?${qs.toString()}`} className="inline-flex items-center gap-1 text-xs text-primary hover:underline">Elige fechas para buscar el auto →</a>
              ))}
            </div>
          );
        })}
      </div>

      <div className="border-t border-border p-5 md:p-6">
        <CountryNotices notices={plan.notices} />
      </div>
    </section>
  );
}
