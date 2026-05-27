import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Cloud, CloudRain, Sun, CloudSnow, Wind, Droplets, MapPin } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/DashboardLayout";
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

type CityForecast = { city: string; daily: any | null };

const fetchForecast = async (city: string): Promise<any | null> => {
  try {
    const geo = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1`
    ).then((r) => r.json());
    const loc = geo?.results?.[0];
    if (!loc) return null;
    const f = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max&forecast_days=14&timezone=auto`
    ).then((r) => r.json());
    return f?.daily ?? null;
  } catch {
    return null;
  }
};

const TripWeather = () => {
  const { id } = useParams();
  const [trip, setTrip] = useState<any>(null);
  const [cities, setCities] = useState<CityForecast[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("trips").select("*").eq("id", id).single();
      const t: any = data;
      setTrip(t);
      if (!t) { setLoading(false); return; }

      const set = new Set<string>();
      const list: string[] = Array.isArray(t.ciudades) ? t.ciudades : [];
      list.forEach((c: string) => c && set.add(c.trim()));
      const hosp = Array.isArray(t.hospedaje_json) ? t.hospedaje_json : [];
      hosp.forEach((h: any) => {
        const c = h?.ciudad ?? h?.city;
        if (c) set.add(String(c).trim());
      });
      if (set.size === 0 && t.destino) {
        String(t.destino).split(/[,&]| y /).forEach((c) => c.trim() && set.add(c.trim()));
      }

      const arr = Array.from(set);

      const results = await Promise.all(
        arr.map(async (city) => ({ city, daily: await fetchForecast(city) }))
      );
      setCities(results);
      setLoading(false);
    })();
  }, [id]);

  return (
    <DashboardLayout>
      <div className="p-6 md:p-10 max-w-5xl mx-auto">
        <div className="mb-8">
          <p className="text-primary text-xs tracking-[0.2em] uppercase mb-2">Clima</p>
          <h1 className="font-display text-3xl md:text-4xl">{trip?.destino || "Cargando..."}</h1>
          <p className="text-sm text-muted-foreground mt-1">Pronóstico por destino del viaje</p>
        </div>

        {loading && <p className="text-muted-foreground">Cargando pronóstico…</p>}
        {!loading && cities.length === 0 && (
          <p className="text-muted-foreground">No se pudieron determinar los destinos.</p>
        )}

        <div className="space-y-8">
          {cities.map(({ city, daily }, idx) => (
            <motion.section
              key={city}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.05 }}
            >
              <div className="flex items-center gap-2 mb-3">
                <div className="w-8 h-8 rounded-full bg-primary/15 flex items-center justify-center">
                  <MapPin className="w-4 h-4 text-primary" />
                </div>
                <h2 className="font-display text-xl md:text-2xl uppercase tracking-wide">
                  {city} <span className="text-primary">· Clima</span>
                </h2>
              </div>

              {!daily ? (
                <p className="text-xs text-muted-foreground pl-10">Sin datos disponibles.</p>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-2">
                  {daily.time.slice(0, 7).map((d: string, i: number) => {
                    const Icon = codeIcon(daily.weather_code[i]);
                    return (
                      <div
                        key={d}
                        className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 flex flex-col items-center text-center"
                      >
                        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                          {new Date(d).toLocaleDateString("es-MX", { weekday: "short", day: "numeric" })}
                        </div>
                        <Icon className="w-7 h-7 text-primary my-1.5" />
                        <div className="text-base font-semibold leading-none">
                          {Math.round(daily.temperature_2m_max[i])}°
                          <span className="text-[11px] font-normal text-muted-foreground ml-0.5">
                            /{Math.round(daily.temperature_2m_min[i])}°
                          </span>
                        </div>
                        <div className="text-[10px] text-muted-foreground mt-0.5 leading-tight">
                          {codeLabel(daily.weather_code[i])}
                        </div>
                        <div className="flex gap-2 mt-1 text-[10px] text-muted-foreground">
                          <span className="flex items-center gap-0.5">
                            <Droplets className="w-2.5 h-2.5" />{daily.precipitation_probability_max[i]}%
                          </span>
                          <span className="flex items-center gap-0.5">
                            <Wind className="w-2.5 h-2.5" />{Math.round(daily.wind_speed_10m_max[i])}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </motion.section>
          ))}
        </div>
      </div>
    </DashboardLayout>
  );
};

export default TripWeather;
