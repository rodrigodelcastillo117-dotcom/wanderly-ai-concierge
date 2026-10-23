import { lazy, Suspense, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Cloud, CloudRain, Sun, CloudSnow, Wind, Droplets, MapPin, Calendar, Thermometer, Radar, ChevronDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/DashboardLayout";
import { FeatureTooltip } from "@/components/Tooltip";
import { useTooltipShown } from "@/hooks/useTooltipShown";
import { formatDateOnly } from "@/lib/dateUtils";
import { motion } from "framer-motion";
import { buildCityWeather, cityWeatherRanges, rangeDays, type CityBlock } from "@/lib/tripWeather";
import { MET_ATTRIBUTION } from "@/lib/metNorway";
import { POWER_ATTRIBUTION } from "@/lib/nasaPower";

// El radar (mapa, cuadros animados y viento) se descarga solo al abrirlo.
const WeatherRadar = lazy(() => import("@/components/weather/WeatherRadar"));

/** Icono de "Hoy en …" con movimiento sutil (lluvia que cae, nubes que se mueven); quieto con
 *  "reducir movimiento" (motion-safe). */
function AnimatedTodayIcon({ code }: { code: number }) {
  const Icon = codeIcon(code);
  const rain = code >= 51 && !(code >= 71 && code <= 77);
  return (
    <span className="relative inline-flex h-10 w-10 shrink-0 items-center justify-center" data-testid="today-icon" data-anim={rain ? "lluvia" : code === 0 ? "sol" : "nubes"} aria-hidden="true">
      <Icon className={`h-8 w-8 text-primary ${rain || code === 0 ? "" : "motion-safe:animate-cloud-drift"} ${code === 0 ? "motion-safe:animate-[spin_24s_linear_infinite]" : ""}`} />
      {rain && [0, 1, 2].map((i) => (
        <span key={i} className="absolute bottom-0 h-2 w-px rounded bg-sky-300 opacity-0 motion-safe:animate-rain-fall"
          style={{ left: `${12 + i * 7}px`, animationDelay: `${i * 0.35}s` }} />
      ))}
    </span>
  );
}

/** Radar plegado: se abre al tocar (y entonces se descarga). */
function RadarToggle({ city, lat, lng }: { city: string; lat: number; lng: number }) {
  const [open, setOpen] = useState(false);
  const loc = { lat, lng };
  return (
    <div className="mt-3">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} data-testid="radar-toggle"
        className="inline-flex min-h-[44px] w-full items-center justify-between gap-2 rounded-xl border border-primary/30 bg-primary/[0.06] px-3 text-sm text-primary hover:bg-primary/10 sm:w-auto">
        <span className="inline-flex items-center gap-2"><Radar className="h-4 w-4" aria-hidden="true" /> {open ? "Ocultar radar" : `Ver radar de lluvia y viento en ${city}`}</span>
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>
      {open && (
        <Suspense fallback={<div className="mt-3 h-60 animate-pulse rounded-2xl bg-white/[0.04]" aria-label="Cargando radar" />}>
          <WeatherRadar city={city} lat={loc.lat} lng={loc.lng} />
        </Suspense>
      )}
    </div>
  );
}

const codeIcon = (c: number) => {
  if (c === 0) return Sun;
  if (c <= 3) return Cloud;
  if (c >= 71 && c <= 77) return CloudSnow;
  if (c >= 51) return CloudRain;
  return Cloud;
};
const codeLabel = (c: number) => {
  if (c === 0) return "Despejado";
  if (c <= 2) return "P. nublado";
  if (c === 3) return "Nublado";
  if (c <= 48) return "Niebla";
  if (c <= 67) return "Lluvia";
  if (c <= 77) return "Nieve";
  if (c <= 82) return "Chubascos";
  return "Tormenta";
};

const TripWeather = () => {
  const { id } = useParams();
  const [trip, setTrip] = useState<any>(null);
  const [blocks, setBlocks] = useState<CityBlock[]>([]);
  const [loading, setLoading] = useState(true);
  const tipClima = useTooltipShown("clima");

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("trips").select("*").eq("id", id).single();
      const t: any = data;
      setTrip(t);
      if (!t) { setLoading(false); return; }

      // Cada ciudad con SUS días (noches por ciudad de cityStays), no todo el viaje en cada una.
      const ranges = cityWeatherRanges(t);
      const results = await Promise.all(ranges.map((r) => buildCityWeather(r)));
      setBlocks(results.filter(Boolean) as CityBlock[]);
      setLoading(false);
    })();
  }, [id]);

  return (
    <DashboardLayout>
      <FeatureTooltip id="clima" icon="☁️" text="Pronóstico día por día para empacar y planear con tiempo." shouldShow={tipClima.shouldShow} onDismiss={tipClima.dismiss} />
      <div className="px-4 py-6 md:p-10 max-w-5xl mx-auto">
        <div className="mb-8">
          <p className="text-primary text-xs tracking-[0.2em] uppercase mb-2">Clima</p>
          <h1 className="font-display text-3xl md:text-4xl">{trip?.destino || "Cargando..."}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Clima de hoy + el pronóstico de tus días en cada destino (o el clima típico del mes si aún faltan más de ~9 días).
          </p>
        </div>

        {loading && <p className="text-muted-foreground">Cargando pronóstico…</p>}
        {!loading && blocks.length === 0 && (
          <p className="text-muted-foreground">No se pudieron determinar los destinos.</p>
        )}

        <div className="space-y-10">
          {blocks.map((b, idx) => {
            return (
              <motion.section
                key={b.city + idx}
                data-testid={`city-weather-${b.city}`}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.05 }}
              >
                <div className="flex flex-wrap items-center gap-2 mb-3">
                  <div className="w-8 h-8 rounded-full bg-primary/15 flex items-center justify-center">
                    <MapPin className="w-4 h-4 text-primary" />
                  </div>
                  <h2 className="font-display text-xl md:text-2xl uppercase tracking-wide">
                    {b.city} <span className="text-primary">· Clima</span>
                  </h2>
                  <span className="ml-2 text-[10px] uppercase tracking-wide text-muted-foreground flex items-center gap-1" data-testid="city-weather-range">
                    <Calendar className="w-3 h-3" />
                    {b.start === b.end
                      ? formatDateOnly(b.start, { day: "numeric", month: "short" })
                      : `${formatDateOnly(b.start, { day: "numeric", month: "short" })} – ${formatDateOnly(b.end, { day: "numeric", month: "short" })}`}
                    {" · "}{rangeDays(b)} {rangeDays(b) === 1 ? "día" : "días"}
                  </span>
                </div>

                {/* Hoy */}
                {b.today && (
                  <div className="mb-3 flex items-center gap-3 rounded-2xl border border-primary/20 bg-primary/[0.05] p-3">
                    <AnimatedTodayIcon code={b.today.code} />
                    <div className="flex-1 min-w-0">
                      <div className="text-[10px] uppercase tracking-wide text-primary font-semibold">Hoy en {b.city}</div>
                      <div className="text-sm">
                        {codeLabel(b.today.code)} · {b.today.tmax}° / {b.today.tmin}°
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col gap-1 text-[11px] text-muted-foreground sm:flex-row sm:gap-3">
                      <span className="flex items-center gap-1"><Droplets className="w-3 h-3" />{b.today.precip} mm</span>
                      <span className="flex items-center gap-1"><Wind className="w-3 h-3" />{b.today.wind} km/h</span>
                    </div>
                  </div>
                )}

                {/* Días del viaje: pronóstico real (MET Norway, ~9 días) */}
                {b.days.length > 0 && (
                  <>
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5 pl-1">Pronóstico</div>
                    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-7 gap-2">
                      {b.days.map((d) => {
                        const Icon = codeIcon(d.code);
                        return (
                          <div
                            key={d.date}
                            data-testid="weather-day" data-date={d.date}
                            className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-2.5 flex flex-col items-center text-center"
                          >
                            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                              {formatDateOnly(d.date, { weekday: "short", day: "numeric" })}
                            </div>
                            <Icon className="w-6 h-6 text-primary my-1" />
                            <div className="text-sm font-semibold leading-none">
                              {d.tmax}°
                              <span className="text-[10px] font-normal text-muted-foreground ml-0.5">/{d.tmin}°</span>
                            </div>
                            <div className="text-[9px] text-muted-foreground mt-0.5 leading-tight">
                              {codeLabel(d.code)}
                            </div>
                            <div className="flex gap-1.5 mt-0.5 text-[9px] text-muted-foreground">
                              <span className="flex items-center gap-0.5" title="Lluvia del día">
                                <Droplets className="w-2.5 h-2.5" />{d.precip} mm
                              </span>
                              <span className="flex items-center gap-0.5" title="Viento máximo (km/h)">
                                <Wind className="w-2.5 h-2.5" />{d.wind}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    {/* Promedio rápido */}
                    <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground pl-1">
                      <Thermometer className="w-3 h-3 text-primary" />
                      Promedio: {Math.round(b.days.reduce((s, d) => s + d.tmax, 0) / b.days.length)}° /
                      {" "}{Math.round(b.days.reduce((s, d) => s + d.tmin, 0) / b.days.length)}°
                    </div>
                  </>
                )}

                {/* Días que aún no tienen pronóstico: clima típico del mes (NASA POWER), sin inventar días. */}
                {b.typical.map((m) => (
                  <div key={m.month} className="mt-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3" data-testid="weather-typical">
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      {m.days.length === 1
                        ? formatDateOnly(m.days[0], { day: "numeric", month: "short" })
                        : `${formatDateOnly(m.days[0], { day: "numeric", month: "short" })} – ${formatDateOnly(m.days[m.days.length - 1], { day: "numeric", month: "short" })}`}
                      {" · "}Pronóstico disponible ~9 días antes
                    </p>
                    {m.tmax != null && m.tmin != null ? (
                      <p className="mt-1 text-sm">
                        Clima típico de {m.label}: <span className="font-semibold">{m.tmax}° / {m.tmin}°</span>
                        {m.precipMmDay != null && <span className="text-muted-foreground"> · ~{m.precipMmDay} mm de lluvia al día</span>}
                      </p>
                    ) : (
                      <p className="mt-1 text-xs text-muted-foreground">Aún no hay pronóstico para estas fechas.</p>
                    )}
                  </div>
                ))}
                {b.pastDays.length > 0 && (
                  <p className="mt-2 text-[11px] text-muted-foreground pl-1" data-testid="weather-past">
                    {b.pastDays.length === 1
                      ? `${formatDateOnly(b.pastDays[0], { day: "numeric", month: "short" })} ya pasó: no hay pronóstico de días pasados.`
                      : `${formatDateOnly(b.pastDays[0], { day: "numeric", month: "short" })} – ${formatDateOnly(b.pastDays[b.pastDays.length - 1], { day: "numeric", month: "short" })} ya pasaron: no hay pronóstico de días pasados.`}
                  </p>
                )}
                {b.days.length === 0 && b.typical.length === 0 && b.pastDays.length === 0 && (
                  <p className="text-xs text-muted-foreground pl-10">Sin datos para esas fechas.</p>
                )}

                <RadarToggle city={b.city} lat={b.lat} lng={b.lng} />
              </motion.section>
            );
          })}
        </div>

        {blocks.length > 0 && (
          <p className="mt-8 text-[11px] text-muted-foreground" data-testid="weather-attribution">
            <a href={MET_ATTRIBUTION.href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">{MET_ATTRIBUTION.label}</a>
            {blocks.some((b) => b.sources.includes("power")) && (
              <> · <a href={POWER_ATTRIBUTION.href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">{POWER_ATTRIBUTION.label}</a> (NASA Langley Research Center, POWER)</>
            )}
            . Pronóstico de unos 9 días; más adelante, el clima típico del mes.
          </p>
        )}
      </div>
    </DashboardLayout>
  );
};

export default TripWeather;
