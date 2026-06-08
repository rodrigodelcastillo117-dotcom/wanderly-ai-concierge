import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Cloud, CloudRain, Sun, CloudSnow, Wind, Droplets, MapPin, Calendar, Thermometer } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/DashboardLayout";
import { FeatureTooltip } from "@/components/Tooltip";
import { useTooltipShown } from "@/hooks/useTooltipShown";
import { formatDateOnly } from "@/lib/dateUtils";
import { motion } from "framer-motion";

const codeIcon = (c: number) => {
  if (c === 0) return Sun;
  if (c <= 3) return Cloud;
  if (c >= 71 && c <= 77) return CloudSnow;
  if (c >= 51) return CloudRain;
  return Cloud;
};
const codeLabel = (c: number) => {
  if (c === 0) return "Despejado";
  if (c <= 3) return "P. nublado";
  if (c <= 48) return "Niebla";
  if (c <= 67) return "Lluvia";
  if (c <= 77) return "Nieve";
  if (c <= 82) return "Chubascos";
  return "Tormenta";
};

type DayData = {
  date: string;
  tmax: number;
  tmin: number;
  code: number;
  precip: number;     // mm o % según source
  wind: number;
  source: "forecast" | "historical";
};

type CityBlock = {
  city: string;
  start: string;
  end: string;
  today: { tmax: number; tmin: number; code: number; wind: number; precip: number } | null;
  days: DayData[];
};

const toISO = (d: Date) => d.toISOString().slice(0, 10);
const daysBetween = (a: Date, b: Date) =>
  Math.round((b.getTime() - a.getTime()) / 86400000);

async function geocode(city: string) {
  try {
    const g = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1`
    ).then((r) => r.json());
    return g?.results?.[0] ?? null;
  } catch { return null; }
}

async function buildCity(city: string, tripStart: string, tripEnd: string): Promise<CityBlock | null> {
  const loc = await geocode(city);
  if (!loc) return null;

  // Clima de hoy
  const todayRes = await fetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}&current=temperature_2m,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&forecast_days=1&timezone=auto`
  ).then((r) => r.json()).catch(() => null);

  const today = todayRes?.current
    ? {
        tmax: Math.round(todayRes.daily?.temperature_2m_max?.[0] ?? todayRes.current.temperature_2m),
        tmin: Math.round(todayRes.daily?.temperature_2m_min?.[0] ?? todayRes.current.temperature_2m),
        code: todayRes.current.weather_code ?? 0,
        wind: Math.round(todayRes.current.wind_speed_10m ?? 0),
        precip: todayRes.daily?.precipitation_probability_max?.[0] ?? 0,
      }
    : null;

  // Días del viaje en esta ciudad
  const start = new Date(tripStart);
  const end = new Date(tripEnd);
  const today0 = new Date(); today0.setHours(0, 0, 0, 0);
  const daysUntilStart = daysBetween(today0, start);

  const days: DayData[] = [];
  if (daysUntilStart <= 16 && daysBetween(today0, end) <= 16) {
    // Pronóstico real (dentro de la ventana de 16 días)
    const fStart = toISO(start);
    const fEnd = toISO(end);
    const f = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max&start_date=${fStart}&end_date=${fEnd}&timezone=auto`
    ).then((r) => r.json()).catch(() => null);
    if (f?.daily?.time) {
      f.daily.time.forEach((d: string, i: number) => {
        days.push({
          date: d,
          tmax: Math.round(f.daily.temperature_2m_max[i]),
          tmin: Math.round(f.daily.temperature_2m_min[i]),
          code: f.daily.weather_code[i],
          precip: f.daily.precipitation_probability_max[i] ?? 0,
          wind: Math.round(f.daily.wind_speed_10m_max[i] ?? 0),
          source: "forecast",
        });
      });
    }
  } else {
    // Históricos: mismas fechas hace 1 año (clima esperado)
    const lastYearStart = new Date(start); lastYearStart.setFullYear(start.getFullYear() - 1);
    const lastYearEnd = new Date(end); lastYearEnd.setFullYear(end.getFullYear() - 1);
    const h = await fetch(
      `https://archive-api.open-meteo.com/v1/archive?latitude=${loc.latitude}&longitude=${loc.longitude}&start_date=${toISO(lastYearStart)}&end_date=${toISO(lastYearEnd)}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max&timezone=auto`
    ).then((r) => r.json()).catch(() => null);
    if (h?.daily?.time) {
      h.daily.time.forEach((d: string, i: number) => {
        // Re-mapeamos al año del viaje para que se vea correcto
        const realDate = new Date(d);
        realDate.setFullYear(start.getFullYear());
        days.push({
          date: toISO(realDate),
          tmax: Math.round(h.daily.temperature_2m_max[i]),
          tmin: Math.round(h.daily.temperature_2m_min[i]),
          code: h.daily.weather_code[i] ?? 0,
          precip: Math.round(h.daily.precipitation_sum[i] ?? 0),
          wind: Math.round(h.daily.wind_speed_10m_max[i] ?? 0),
          source: "historical",
        });
      });
    }
  }

  return { city, start: tripStart, end: tripEnd, today, days };
}

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

      // Reúne ciudades con sus rangos de fechas (desde hospedaje_json si está)
      const map = new Map<string, { start: string; end: string }>();
      const hosp = Array.isArray(t.hospedaje_json) ? t.hospedaje_json : [];
      hosp.forEach((h: any) => {
        const c = (h?.ciudad ?? h?.city ?? "").toString().trim();
        if (!c) return;
        const ci = h?.check_in ?? h?.entrada ?? h?.fecha_entrada ?? t.fecha_salida;
        const co = h?.check_out ?? h?.salida ?? h?.fecha_salida ?? t.fecha_regreso;
        if (!ci || !co) return;
        const cur = map.get(c);
        if (!cur) map.set(c, { start: ci, end: co });
        else map.set(c, {
          start: ci < cur.start ? ci : cur.start,
          end: co > cur.end ? co : cur.end,
        });
      });

      // Fallback: ciudades[] sin fechas → usa rango total del viaje
      if (map.size === 0) {
        const list: string[] = Array.isArray(t.ciudades) ? t.ciudades : [];
        list.forEach((c) => {
          if (c && t.fecha_salida && t.fecha_regreso) {
            map.set(c.trim(), { start: t.fecha_salida, end: t.fecha_regreso });
          }
        });
      }
      if (map.size === 0 && t.destino && t.fecha_salida && t.fecha_regreso) {
        String(t.destino).split(/[,&]| y /).forEach((c) => {
          const cc = c.trim();
          if (cc) map.set(cc, { start: t.fecha_salida, end: t.fecha_regreso });
        });
      }

      const arr = Array.from(map.entries());
      const results = await Promise.all(
        arr.map(([city, r]) => buildCity(city, r.start, r.end))
      );
      setBlocks(results.filter(Boolean) as CityBlock[]);
      setLoading(false);
    })();
  }, [id]);

  return (
    <DashboardLayout>
      <FeatureTooltip id="clima" icon="☁️" text="Pronóstico día por día para empacar y planear con tiempo." shouldShow={tipClima.shouldShow} onDismiss={tipClima.dismiss} />
      <div className="p-6 md:p-10 max-w-5xl mx-auto">
        <div className="mb-8">
          <p className="text-primary text-xs tracking-[0.2em] uppercase mb-2">Clima</p>
          <h1 className="font-display text-3xl md:text-4xl">{trip?.destino || "Cargando..."}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Clima de hoy + el esperado durante tus días en cada destino.
          </p>
        </div>

        {loading && <p className="text-muted-foreground">Cargando pronóstico…</p>}
        {!loading && blocks.length === 0 && (
          <p className="text-muted-foreground">No se pudieron determinar los destinos.</p>
        )}

        <div className="space-y-10">
          {blocks.map((b, idx) => {
            const TodayIcon = b.today ? codeIcon(b.today.code) : Cloud;
            return (
              <motion.section
                key={b.city + idx}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.05 }}
              >
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-8 h-8 rounded-full bg-primary/15 flex items-center justify-center">
                    <MapPin className="w-4 h-4 text-primary" />
                  </div>
                  <h2 className="font-display text-xl md:text-2xl uppercase tracking-wide">
                    {b.city} <span className="text-primary">· Clima</span>
                  </h2>
                  <span className="ml-2 text-[10px] uppercase tracking-wide text-muted-foreground flex items-center gap-1">
                    <Calendar className="w-3 h-3" />
                    {formatDateOnly(b.start, { day: "numeric", month: "short" })} –{" "}
                    {formatDateOnly(b.end, { day: "numeric", month: "short" })}
                  </span>
                </div>

                {/* Hoy */}
                {b.today && (
                  <div className="mb-3 flex items-center gap-3 rounded-2xl border border-primary/20 bg-primary/[0.05] p-3">
                    <TodayIcon className="w-8 h-8 text-primary" />
                    <div className="flex-1 min-w-0">
                      <div className="text-[10px] uppercase tracking-wide text-primary font-semibold">Hoy en {b.city}</div>
                      <div className="text-sm">
                        {codeLabel(b.today.code)} · {b.today.tmax}° / {b.today.tmin}°
                      </div>
                    </div>
                    <div className="flex gap-3 text-[11px] text-muted-foreground">
                      <span className="flex items-center gap-1"><Droplets className="w-3 h-3" />{b.today.precip}%</span>
                      <span className="flex items-center gap-1"><Wind className="w-3 h-3" />{b.today.wind} km/h</span>
                    </div>
                  </div>
                )}

                {/* Días del viaje */}
                {b.days.length === 0 ? (
                  <p className="text-xs text-muted-foreground pl-10">Sin datos para esas fechas.</p>
                ) : (
                  <>
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5 pl-1">
                      {b.days[0]?.source === "forecast" ? "Pronóstico" : "Clima esperado (histórico)"}
                    </div>
                    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-7 gap-2">
                      {b.days.map((d) => {
                        const Icon = codeIcon(d.code);
                        return (
                          <div
                            key={d.date}
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
                              <span className="flex items-center gap-0.5">
                                <Droplets className="w-2.5 h-2.5" />{d.precip}{d.source === "forecast" ? "%" : "mm"}
                              </span>
                              <span className="flex items-center gap-0.5">
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
              </motion.section>
            );
          })}
        </div>
      </div>
    </DashboardLayout>
  );
};

export default TripWeather;
