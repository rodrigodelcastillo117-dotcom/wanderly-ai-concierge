import { useEffect, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { MapPin, Utensils, Landmark, Phone, Hospital } from "lucide-react";
import { motion } from "framer-motion";

type Poi = { name: string; type: string; distance: string; icon: any };

const SEED: Poi[] = [
  { name: "Restaurante recomendado por el AI", type: "Gastronomía", distance: "320 m", icon: Utensils },
  { name: "Museo destacado", type: "Cultura", distance: "780 m", icon: Landmark },
  { name: "Embajada de México", type: "Servicios", distance: "1.4 km", icon: Phone },
  { name: "Hospital más cercano", type: "Emergencia", distance: "2.1 km", icon: Hospital },
];

const Cercanos = () => {
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {},
    );
  }, []);

  return (
    <DashboardLayout>
      <div className="p-6 md:p-10 max-w-5xl">
        <h1 className="font-display text-4xl md:text-5xl mb-3">Cercanos</h1>
        <p className="text-muted-foreground mb-8">Recomendaciones cerca de ti, filtradas por tu perfil.</p>

        <div className="glass-card rounded-2xl overflow-hidden mb-6">
          <div className="aspect-[16/9] relative bg-gradient-to-br from-surface to-surface-elevated flex items-center justify-center">
            <div className="absolute inset-0 opacity-20" style={{
              backgroundImage: "radial-gradient(circle at 30% 40%, hsl(var(--primary) / 0.4), transparent 40%), radial-gradient(circle at 70% 60%, hsl(var(--primary) / 0.3), transparent 40%)"
            }} />
            <div className="relative text-center">
              <MapPin className="w-10 h-10 text-primary mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">
                {coords ? `${coords.lat.toFixed(3)}, ${coords.lng.toFixed(3)}` : "Activando tu ubicación…"}
              </p>
              <p className="text-xs text-muted-foreground/70 mt-2">Mapa interactivo próximamente</p>
            </div>
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          {SEED.map((p, i) => (
            <motion.div
              key={p.name}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className="glass-card rounded-xl p-4 flex items-center gap-4 hover:gold-border transition"
            >
              <div className="w-10 h-10 rounded-full bg-primary/10 border border-primary/30 flex items-center justify-center text-primary">
                <p.icon className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm">{p.name}</p>
                <p className="text-xs text-muted-foreground">{p.type}</p>
              </div>
              <span className="text-xs text-primary">{p.distance}</span>
            </motion.div>
          ))}
        </div>
      </div>
    </DashboardLayout>
  );
};

export default Cercanos;
