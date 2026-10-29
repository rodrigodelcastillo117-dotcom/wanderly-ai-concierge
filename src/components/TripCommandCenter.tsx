import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, CalendarDays, Users, Receipt, Clock, Plane, CloudSun, Radio, Map as MapIcon, Backpack, Cloud, Eye } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatLocalDate } from "@/lib/localDate";
import { displayedTripTotal } from "@/lib/tripPageTotal";
import { invalidQuoteReason, REQUOTE_LABEL } from "@/lib/budgetSanity";
import { flightStatusLine, nextTripAction, quoteFreshness, tripTiming, type TrackedFlightLike } from "@/lib/tripCommand";
import { fetchWeatherNow, type WeatherNow } from "@/lib/weatherNow";
import { currentTripCity } from "@/lib/cityLocation";
import { SmartImage } from "@/components/media/SmartImage";
import { AirlineLogo } from "@/components/media/AirlineLogo";
import { airlineCode } from "@/lib/airlines";
import { destinationQuery } from "@/lib/categoryImagery";

type TripSummary = {
  id: string;
  destino: string;
  pais_destino?: string | null;
  fecha_salida?: string | null;
  fecha_regreso?: string | null;
  cover_image_url?: string | null;
};

type Props = { trip: TripSummary; today: string };

const fmtMXN = (n: number) => `$${Math.round(n).toLocaleString("es-MX")} MXN`;

/**
 * Centro de mando del viaje activo en Inicio: cuánto falta, estado de la cotización, vuelo
 * seguido y clima (solo con datos reales; si algo no está, no se muestra), UNA acción principal
 * y accesos rápidos. Antes Inicio solo tenía un renglón "Próximo viaje" debajo de un video.
 */
export function TripCommandCenter({ trip, today }: Props) {
  const navigate = useNavigate();
  // Fila completa (total, viajeros, cotización vigente) del viaje activo; la lista de Inicio solo
  // trae columnas ligeras. select("*") porque no todas las columnas nuevas están en producción.
  const [full, setFull] = useState<Record<string, any> | null>(null);
  const [quote, setQuote] = useState<{ created_at?: string; valid_until?: string } | null>(null);
  const [flights, setFlights] = useState<TrackedFlightLike[]>([]);
  const [weather, setWeather] = useState<WeatherNow | null>(null);
  const [loaded, setLoaded] = useState(false);

  const timing = tripTiming(trip, today);

  useEffect(() => {
    let alive = true;
    setFull(null);
    setLoaded(false);
    setQuote(null);
    setFlights([]);
    // Vuelos seguidos en paralelo con la fila completa (antes iban después, en cascada).
    void Promise.resolve(supabase.from("tracked_flights")
      .select("flight, flight_date, last_status, last_checked_at").eq("trip_id", trip.id).eq("active", true))
      .then(({ data: fl }) => { if (alive) setFlights(Array.isArray(fl) ? (fl as TrackedFlightLike[]).slice(0, 2) : []); })
      .catch(() => { /* sin vuelos seguidos */ });
    (async () => {
      try {
        const { data } = await supabase.from("trips").select("*").eq("id", trip.id).maybeSingle();
        if (!alive) return;
        setFull((data as Record<string, any> | null) ?? null);
        const qid = (data as any)?.current_quote_id;
        if (qid) {
          const { data: q } = await supabase.from("trip_quotes").select("id, created_at, valid_until, travelers, date_from, date_to").eq("id", qid).maybeSingle();
          if (alive) setQuote((q as any) ?? null);
        }
      } catch { /* sin detalle: la tarjeta usa lo que ya tiene */ }
      if (alive) setLoaded(true);
    })();
    return () => { alive = false; };
  }, [trip.id]);

  // Clima real solo cerca del viaje (el pronóstico no sirve a meses de distancia).
  // En un viaje multi-destino, la ciudad donde está hoy (no "Roma → Florencia → Venecia").
  const weatherCity = currentTripCity(trip, today) ?? trip.destino;
  const nearTrip = timing.phase === "en_curso" || (timing.phase === "proximo" && (timing.daysToStart ?? 99) <= 7);
  useEffect(() => {
    if (!nearTrip) { setWeather(null); return; }
    let alive = true;
    if (!weatherCity) return;
    fetchWeatherNow(weatherCity).then((w) => alive && setWeather(w)).catch(() => {});
    return () => { alive = false; };
  }, [nearTrip, weatherCity]);

  const merged = { ...trip, ...(full ?? {}) } as any;
  const fresh = quoteFreshness(full ? merged : { total_estimado: null }, quote);
  // La acción que depende de la cotización espera a tener la fila completa (no se muestra "Cotiza
  // tu viaje" un instante a quien ya cotizó). Si la fila no se pudo leer, se ofrece abrir el viaje.
  const quoteIndependent = timing.phase !== "proximo";
  const action = full || quoteIndependent
    ? nextTripAction(merged, { today, quote })
    : loaded
      ? { title: "Abre tu viaje", detail: "Revisa tu itinerario y la cotización guardada.", cta: "Ver viaje", to: `/dashboard/viajes/${trip.id}` }
      : null;
  // El MISMO total que la página del viaje (con lo que eligió en Comprar), no el total_estimado guardado
  // de la cotización (caso E2E 28-oct-2026: $81,273 en el viaje y $81,831 aquí). Se espera a la fila completa.
  const total = full && loaded ? displayedTripTotal(merged, quote as any) : 0;
  const viajeros = Number(merged.num_viajeros) || null;
  const live = timing.phase === "en_curso";

  const quick = [
    { icon: Eye, label: "Ver viaje", to: `/dashboard/viajes/${trip.id}` },
    { icon: Radio, label: "Modo viaje", to: `/dashboard/viajes/${trip.id}/live` },
    { icon: Cloud, label: "Clima", to: `/dashboard/viajes/${trip.id}/clima` },
    { icon: Backpack, label: "Equipaje", to: `/dashboard/viajes/${trip.id}/packing` },
    { icon: MapIcon, label: "Mapa", to: `/dashboard/viajes/${trip.id}/mapa` },
  ];

  return (
    <section
      aria-labelledby="command-center-title"
      className="animate-rise relative overflow-hidden rounded-3xl border border-primary/25 bg-gradient-to-br from-primary/[0.12] via-white/[0.02] to-transparent p-5 md:p-8"
    >
      {/* Portada del destino a sangre completa, oscurecida para que el texto se lea: la foto real
          del viaje si existe; si no, una ilustrativa del destino (marcada). */}
      <SmartImage
        alt=""
        imageUrl={trip.cover_image_url ?? null}
        stockQuery={destinationQuery(trip.destino, trip.pais_destino)}
        size="hero"
        eager
        className="!absolute inset-0"
        imgClassName="scale-[1.02]"
        captionPosition="top-right"
      >
        <div aria-hidden className="absolute inset-0 bg-gradient-to-r from-black/90 via-black/75 to-black/55" />
        <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/30" />
      </SmartImage>
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,hsl(var(--primary)/0.16),transparent_55%)]" />
      <div className="relative grid gap-6 lg:grid-cols-[1.15fr_1fr] lg:gap-10">
        <div className="min-w-0">
          {live ? (
            <p className="text-[11px] uppercase tracking-[0.25em] text-primary font-semibold flex items-center gap-2">
              <span className="relative flex h-2 w-2" aria-hidden>
                <span className="absolute inline-flex h-full w-full rounded-full bg-primary opacity-60 motion-safe:animate-ping" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
              </span>
              <span>En vivo · Tu viaje está en curso</span>
            </p>
          ) : (
            <p className="text-[11px] uppercase tracking-[0.25em] text-primary/90 font-semibold">Próximo viaje</p>
          )}
          <h2 id="command-center-title" className="font-display text-3xl md:text-5xl leading-[1.05] mt-2 break-words">
            {trip.destino}
            {trip.pais_destino ? <span className="text-muted-foreground text-xl md:text-2xl">, {trip.pais_destino}</span> : null}
          </h2>
          <p className="font-display italic gold-text text-2xl md:text-3xl mt-3" aria-live="polite">{timing.label}</p>

          <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-sm text-muted-foreground">
            {trip.fecha_salida && (
              <li className="inline-flex items-center gap-1.5">
                <CalendarDays className="w-4 h-4 text-primary/80" aria-hidden />
                {formatLocalDate(trip.fecha_salida, { day: "numeric", month: "short" })} – {formatLocalDate(trip.fecha_regreso ?? trip.fecha_salida, { day: "numeric", month: "short", year: "numeric" })}
              </li>
            )}
            {viajeros && (
              <li className="inline-flex items-center gap-1.5"><Users className="w-4 h-4 text-primary/80" aria-hidden />{viajeros} {viajeros === 1 ? "viajero" : "viajeros"}</li>
            )}
            {total > 0 && (
              <li className="inline-flex items-center gap-1.5"><Receipt className="w-4 h-4 text-primary/80" aria-hidden />Total cotizado {fmtMXN(total)}</li>
            )}
            {full && loaded && invalidQuoteReason(merged) && (
              <li className="inline-flex items-center gap-1.5 text-amber-400" data-testid="command-recotizar"><Receipt className="w-4 h-4" aria-hidden />{REQUOTE_LABEL}</li>
            )}
          </ul>

          {/* Estado: solo lo que sabemos. */}
          <ul className="mt-4 space-y-2 text-xs" aria-label="Estado del viaje">
            {full && (
              <li className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 ${fresh.status === "vigente" ? "border-primary/30 text-primary" : "border-amber-500/40 text-amber-400"}`}>
                <Clock className="w-3.5 h-3.5 shrink-0" aria-hidden /> {fresh.label}
              </li>
            )}
            {flights.map((f) => (
              <li key={`${f.flight}-${f.flight_date}`} className="flex items-center gap-2 text-muted-foreground">
                {airlineCode(f.flight) ? <AirlineLogo airline={f.flight} size={20} className="!rounded-md" /> : <Plane className="w-3.5 h-3.5 text-primary/80 shrink-0" aria-hidden />} {flightStatusLine(f)}
              </li>
            ))}
            {weather && (
              <li className="flex items-center gap-1.5 text-muted-foreground">
                <CloudSun className="w-3.5 h-3.5 text-primary/80 shrink-0" aria-hidden />
                {/* Un solo bloque de texto: con dos hijos del flex la fuente se partía en otra columna. */}
                <span className="min-w-0">Ahora en {weatherCity}: {weather.tempC}° · {weather.label} <span className="whitespace-nowrap">(Datos: {weather.source})</span></span>
              </li>
            )}
          </ul>
        </div>

        <div className="min-w-0 flex flex-col gap-4">
          <div className="rounded-2xl border border-white/[0.08] bg-black/30 p-4 md:p-5">
            <p className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">Qué sigue</p>
            {!action ? (
              <div aria-busy="true" aria-label="Cargando la siguiente acción" className="mt-2 space-y-2">
                <div className="h-6 w-2/3 rounded-lg bg-white/[0.06] motion-safe:animate-pulse" />
                <div className="h-4 w-full rounded-lg bg-white/[0.04] motion-safe:animate-pulse" />
                <div className="mt-4 h-12 w-full rounded-2xl bg-white/[0.05] motion-safe:animate-pulse" />
              </div>
            ) : (<>
            <p className="font-display text-xl md:text-2xl mt-1">{action.title}</p>
            <p className="text-sm text-muted-foreground mt-1 leading-relaxed">{action.detail}</p>
            <button
              type="button"
              onClick={() => navigate(action.to)}
              className="mt-4 w-full min-h-[48px] inline-flex items-center justify-center gap-2 rounded-2xl bg-gradient-gold text-primary-foreground font-medium text-sm tracking-wide hover:opacity-90 active:scale-[0.99] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              {action.cta} <ArrowRight className="w-4 h-4" aria-hidden />
            </button>
            </>)}
          </div>
          <nav aria-label={`Accesos rápidos de ${trip.destino}`} className="grid grid-cols-5 gap-1.5">
            {quick.map(({ icon: Icon, label, to }) => (
              <Link
                key={label}
                to={to}
                className="flex flex-col items-center justify-center gap-1.5 min-h-[64px] rounded-2xl border border-white/[0.06] bg-white/[0.02] px-1 text-[11px] text-foreground/85 hover:border-primary/40 hover:text-primary transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <Icon className="w-4 h-4 text-primary" aria-hidden />
                <span className="leading-tight text-center">{label}</span>
              </Link>
            ))}
          </nav>
        </div>
      </div>
    </section>
  );
}
