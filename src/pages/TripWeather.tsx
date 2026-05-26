import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Cloud, CloudRain, Sun, CloudSnow, Wind, Droplets } from "lucide-react";
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
  if (c <= 3) return "Parcialmente nublado";
  if (c <= 48) return "Niebla";
  if (c <= 67) return "Lluvia";
  if (c <= 77) return "Nieve";
  if (c <= 82) return "Chubascos";
  return "Tormenta";
};

const TripWeather = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [trip, setTrip] = useState<any>(null);
  const [forecast, setForecast] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("trips").select("*").eq("id", id).single();
      setTrip(data);
      if (!data) return setLoading(false);
      try {
        const city = (data.destino || "").split(",")[0];
        const geo = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1`).then(r => r.json());
        const loc = geo?.results?.[0];
        if (!loc) return setLoading(false);
        const f = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max&forecast_days=14&timezone=auto`).then(r => r.json());
        setForecast(f?.daily);
      } catch {}
      setLoading(false);
    })();
  }, [id]);

  return (
    <DashboardLayout>
      <div className="p-6 md:p-10 max-w-4xl mx-auto">
        <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-primary mb-6">
          <ArrowLeft className="w-4 h-4" /> Volver
        </button>
        <div className="mb-8">
          <p className="text-primary text-xs tracking-[0.2em] uppercase mb-2">Clima</p>
          <h1 className="font-display text-4xl">{trip?.destino || "Cargando..."}</h1>
        </div>

        {loading && <p className="text-muted-foreground">Cargando pronóstico...</p>}
        {!loading && !forecast && <p className="text-muted-foreground">No se pudo obtener el clima.</p>}

        {forecast && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {forecast.time.map((d: string, i: number) => {
              const Icon = codeIcon(forecast.weather_code[i]);
              return (
                <motion.div
                  key={d}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.03 }}
                  className="glass-card rounded-2xl p-5 flex items-center gap-4"
                >
                  <Icon className="w-10 h-10 text-primary shrink-0" />
                  <div className="flex-1">
                    <div className="text-sm text-muted-foreground">
                      {new Date(d).toLocaleDateString("es-MX", { weekday: "short", day: "numeric", month: "short" })}
                    </div>
                    <div className="font-medium">{codeLabel(forecast.weather_code[i])}</div>
                    <div className="text-xs text-muted-foreground flex gap-3 mt-1">
                      <span className="flex items-center gap-1"><Droplets className="w-3 h-3" /> {forecast.precipitation_probability_max[i]}%</span>
                      <span className="flex items-center gap-1"><Wind className="w-3 h-3" /> {Math.round(forecast.wind_speed_10m_max[i])} km/h</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-display">{Math.round(forecast.temperature_2m_max[i])}°</div>
                    <div className="text-xs text-muted-foreground">{Math.round(forecast.temperature_2m_min[i])}°</div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
};

export default TripWeather;
