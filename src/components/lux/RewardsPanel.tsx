import { MapPin, Award, Shirt, Sparkles, Map, Camera, Lock } from "lucide-react";
import type { LucideIcon } from "lucide-react";

type Reward = { key: string; label: string; icon: LucideIcon; threshold: number; metric: "trips" | "visits"; type: string };

const REWARDS: Reward[] = [
  { key: "pin1",    label: "Pin Explorador",        icon: MapPin,   threshold: 1,  metric: "trips",  type: "Pin" },
  { key: "outfit1", label: "Outfit Casual",         icon: Shirt,    threshold: 2,  metric: "trips",  type: "Outfit" },
  { key: "badge1",  label: "Badge Primer Vuelo",    icon: Award,    threshold: 1,  metric: "trips",  type: "Badge" },
  { key: "acc1",    label: "Accesorio · Cámara",    icon: Camera,   threshold: 5,  metric: "visits", type: "Accesorio" },
  { key: "map1",    label: "Mapa · Asia",           icon: Map,      threshold: 3,  metric: "trips",  type: "Mapa" },
  { key: "outfit2", label: "Outfit Premium",        icon: Shirt,    threshold: 5,  metric: "trips",  type: "Outfit" },
  { key: "acc2",    label: "Corona Dorada",         icon: Sparkles,  threshold: 10, metric: "trips",  type: "Accesorio" },
  { key: "rec1",    label: "Recuerdo · Postal",     icon: Camera,   threshold: 15, metric: "visits", type: "Recuerdo" },
  { key: "map2",    label: "Mapa · Mundial",        icon: Map,      threshold: 8,  metric: "trips",  type: "Mapa" },
];

export const RewardsPanel = ({ trips, visits }: { trips: number; visits: number }) => {
  return (
    <div className="grid grid-cols-3 gap-2">
      {REWARDS.map(r => {
        const have = r.metric === "trips" ? trips : visits;
        const unlocked = have >= r.threshold;
        const Icon = unlocked ? r.icon : Lock;
        return (
          <div
            key={r.key}
            className={`aspect-square rounded-xl border flex flex-col items-center justify-center p-2 text-center transition ${
              unlocked
                ? "border-primary/40 bg-primary/[0.06] hover:bg-primary/[0.12]"
                : "border-white/[0.06] bg-white/[0.02] opacity-60"
            }`}
            title={unlocked ? r.label : `Desbloquea con ${r.threshold} ${r.metric === "trips" ? "viajes" : "visitas"}`}
          >
            <Icon className={`w-5 h-5 mb-1 ${unlocked ? "text-primary" : "text-muted-foreground"}`} />
            <p className="text-[9px] leading-tight text-foreground/80 line-clamp-2">{r.label}</p>
            <p className="text-[8px] text-muted-foreground mt-0.5">{r.type}</p>
          </div>
        );
      })}
    </div>
  );
};
