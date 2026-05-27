import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { MapPin, Calendar, Hotel, Utensils, Activity, ExternalLink } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { BackButton } from "@/components/BackButton";

const BROWSER_KEY = import.meta.env.VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY;

const TripMap = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [trip, setTrip] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  // -1 = "Todos" (vista global con todos los hoteles/puertos del viaje)
  const [selectedDay, setSelectedDay] = useState<number>(-1);

  useEffect(() => {
    if (!id) return;
    (async () => {
      const { data } = await supabase.from("trips").select("*").eq("id", id).maybeSingle();
      setTrip(data);
      setLoading(false);
    })();
  }, [id]);

  const days = useMemo(() => {
    if (!trip) return [];
    const itin = trip.itinerario_json;
    return Array.isArray(itin) ? itin : Array.isArray(itin?.days) ? itin.days : [];
  }, [trip]);

  const dayPlan = days[selectedDay] ?? null;
  const acts: any[] = dayPlan?.actividades ?? dayPlan?.plan ?? [];

  // Lugares clave del viaje completo (hoteles + puertos del crucero)
  const allStops = useMemo(() => {
    if (!trip) return [] as string[];
    const stops: string[] = [];
    const hosp = Array.isArray(trip.hospedaje_json) ? trip.hospedaje_json : [];
    hosp.forEach((h: any) => {
      const name = h?.nombre ?? h?.hotel ?? h?.titulo;
      const city = h?.ciudad ?? h?.city ?? "";
      if (name) stops.push(`${name}${city ? `, ${city}` : ""}`);
      else if (city) stops.push(city);
    });
    const cru = Array.isArray(trip.cruceros_json) ? trip.cruceros_json : [];
    cru.forEach((c: any) => {
      const ports = c?.itinerario ?? c?.puertos ?? [];
      if (Array.isArray(ports)) ports.forEach((p: any) => {
        const port = typeof p === "string" ? p : (p?.puerto ?? p?.ciudad);
        if (port) stops.push(`Puerto ${port}`);
      });
    });
    const cities = Array.isArray(trip.ciudades) ? trip.ciudades : [];
    cities.forEach((c: string) => { if (c && !stops.some(s => s.includes(c))) stops.push(c); });
    return stops;
  }, [trip]);

  const showAll = selectedDay < 0;

  // Build embed src
  const embedSrc = useMemo(() => {
    if (!trip) return "";
    if (showAll && allStops.length >= 2 && BROWSER_KEY) {
      // Directions traza una ruta y MUESTRA TODOS los marcadores (hoteles/puertos)
      const origin = allStops[0];
      const destination = allStops[allStops.length - 1];
      const waypoints = allStops.slice(1, -1).slice(0, 8); // máx 9 en embed
      const wp = waypoints.length ? `&waypoints=${encodeURIComponent(waypoints.join("|"))}` : "";
      return `https://www.google.com/maps/embed/v1/directions?key=${BROWSER_KEY}&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}${wp}&mode=driving`;
    }
    let q = trip.destino;
    if (!showAll) {
      const firstAct = acts[0];
      const placeName = typeof firstAct === "string" ? firstAct : (firstAct?.lugar ?? firstAct?.actividad ?? firstAct?.titulo ?? "");
      if (placeName) q = `${placeName} ${trip.destino}`;
    } else if (allStops.length) {
      q = allStops[0];
    }
    return BROWSER_KEY
      ? `https://www.google.com/maps/embed/v1/search?key=${BROWSER_KEY}&q=${encodeURIComponent(q)}&zoom=12`
      : `https://maps.google.com/maps?q=${encodeURIComponent(q)}&output=embed`;
  }, [trip, showAll, allStops, acts]);

  if (loading) {
    return <div className="min-h-screen bg-background flex items-center justify-center text-foreground/60">Cargando mapa…</div>;
  }
  if (!trip) {
    return <div className="min-h-screen bg-background flex items-center justify-center text-foreground/60">Viaje no encontrado</div>;
  }

  return (
    <div className="min-h-screen bg-background text-foreground pb-24">
      <BackButton floating />
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute -top-40 -right-40 w-[520px] h-[520px] rounded-full bg-primary/[0.06] blur-[140px]" />
      </div>

      <div className="px-4 md:px-8 pt-14 md:pt-16 max-w-[1400px] mx-auto">

        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-full bg-primary/15 flex items-center justify-center">
            <MapPin className="w-5 h-5 text-primary" />
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-[0.2em] text-primary font-semibold">Mapa del viaje</div>
            <h1 className="text-2xl md:text-3xl font-serif">{trip.destino}</h1>
          </div>
        </div>

        {/* Day selector */}
        {days.length > 0 && (
          <div className="flex gap-2 overflow-x-auto pb-2 mb-4 -mx-1 px-1 scrollbar-hide">
            <button
              onClick={() => setSelectedDay(-1)}
              className={`shrink-0 px-3.5 py-2 rounded-full text-xs font-semibold border transition ${
                showAll
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-white/[0.02] border-white/[0.08] text-foreground/70 hover:border-white/[0.16]"
              }`}
            >
              Todos
            </button>
            {days.map((d: any, i: number) => (
              <button
                key={i}
                onClick={() => setSelectedDay(i)}
                className={`shrink-0 px-3.5 py-2 rounded-full text-xs font-semibold border transition ${
                  i === selectedDay
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-white/[0.02] border-white/[0.08] text-foreground/70 hover:border-white/[0.16]"
                }`}
              >
                Día {i + 1}
              </button>
            ))}
          </div>
        )}

        {/* Map */}
        <div className="rounded-3xl overflow-hidden border border-white/[0.08] bg-black/30 mb-5 h-[420px] md:h-[520px]">
          <iframe
            key={embedSrc}
            title={`Mapa de ${trip.destino}`}
            src={embedSrc}
            className="w-full h-full"
            style={{ border: 0 }}
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            allowFullScreen
          />
        </div>


        {/* Day plan */}
        {dayPlan && (
          <section className="rounded-3xl border border-white/[0.06] bg-white/[0.02] backdrop-blur-xl p-5 md:p-6 mb-5">
            <div className="flex items-center gap-2 mb-4">
              <Calendar className="w-4 h-4 text-primary" />
              <h2 className="text-lg font-semibold">Día {selectedDay + 1}{dayPlan.titulo ? ` · ${dayPlan.titulo}` : ""}</h2>
            </div>
            {acts.length > 0 ? (
              <ul className="space-y-2">
                {acts.map((a: any, i: number) => {
                  const text = typeof a === "string" ? a : (a.actividad ?? a.titulo ?? a.descripcion ?? a.lugar ?? "");
                  const place = typeof a === "object" ? (a.lugar ?? text) : text;
                  return (
                    <li key={i} className="flex items-center justify-between gap-3 p-3 rounded-xl bg-black/30 border border-white/[0.04]">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-7 h-7 rounded-full bg-primary/15 text-primary flex items-center justify-center text-xs font-bold shrink-0">
                          {i + 1}
                        </div>
                        <span className="text-sm text-foreground/90 truncate">{text}</span>
                      </div>
                      <a
                        href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${place} ${trip.destino}`)}`}
                        target="_blank" rel="noreferrer"
                        className="shrink-0 text-primary hover:text-primary/80"
                        title="Abrir en Google Maps"
                      >
                        <ExternalLink className="w-4 h-4" />
                      </a>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm text-foreground/60">Día libre.</p>
            )}
          </section>
        )}

        {/* Lugares clave */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <PlaceList icon={Hotel} label="Hospedajes" items={trip.hospedaje_json ?? []} destino={trip.destino} />
          <PlaceList icon={Utensils} label="Restaurantes" items={trip.restaurantes_json ?? []} destino={trip.destino} />
          <PlaceList icon={Activity} label="Tours" items={trip.tours_json ?? []} destino={trip.destino} />
        </div>
      </div>
    </div>
  );
};

const PlaceList = ({ icon: Icon, label, items, destino }: any) => (
  <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
    <div className="flex items-center gap-2 mb-3">
      <Icon className="w-4 h-4 text-primary" />
      <h3 className="text-sm font-semibold">{label}</h3>
      <span className="text-[10px] text-foreground/50 ml-auto">{items.length}</span>
    </div>
    <ul className="space-y-1.5">
      {items.slice(0, 5).map((it: any, i: number) => {
        const name = it?.nombre ?? it?.titulo ?? it?.hotel ?? `Opción ${i + 1}`;
        return (
          <li key={i}>
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${name} ${it?.ciudad ?? destino}`)}`}
              target="_blank" rel="noreferrer"
              className="text-xs text-foreground/70 hover:text-primary truncate block"
            >
              · {name}
            </a>
          </li>
        );
      })}
      {items.length === 0 && <li className="text-xs text-foreground/40">Sin elementos</li>}
    </ul>
  </div>
);

export default TripMap;
