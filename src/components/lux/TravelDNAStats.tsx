import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { AvatarStyle } from "./TravelAvatar3D";

export type DNAStat = { key: string; label: string; value: number; color: string };

export type DNAResult = {
  stats: DNAStat[];
  dominant: AvatarStyle;
  tripCount: number;
  visitCount: number;
  perfil: any;
};

const CATEGORY_MAP: Record<string, keyof typeof STAT_TEMPLATE> = {
  restaurant: "food", food: "food", cafe: "food", bakery: "food", bar: "nightlife",
  night_club: "nightlife", lounge: "nightlife",
  park: "adventure", hiking: "adventure", nature: "adventure", beach: "relax",
  spa: "relax", wellness: "relax",
  museum: "cultural", art_gallery: "cultural", landmark: "cultural", historic: "cultural",
  hotel: "luxury", lodging: "luxury", resort: "luxury",
};

const STAT_TEMPLATE = {
  food:      { label: "Food Explorer",      color: "#f5c16c" },
  adventure: { label: "Adventure Energy",   color: "#7bc97b" },
  cultural:  { label: "Cultural Seeker",    color: "#a8a0e8" },
  luxury:    { label: "Luxury Balance",     color: "#e8c66c" },
  relax:     { label: "Comfort Traveler",   color: "#8edada" },
  nightlife: { label: "Nightlife Lover",    color: "#e84393" },
  hidden:    { label: "Hidden Gem Hunter",  color: "#c9a861" },
};

export function useTravelDNA(): { dna: DNAResult | null; loading: boolean; reload: () => void } {
  const { user } = useAuth();
  const [dna, setDna] = useState<DNAResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [{ data: prefs }, { data: tp }, { data: visits }, { count: tripCount }] = await Promise.all([
        supabase.from("ai_user_preferences").select("perfil_ia, dna_signal, visit_count, trip_count, nivel_presupuesto, estilo_comida, actividades_tarde").eq("user_id", user.id).maybeSingle(),
        supabase.from("travel_profiles").select("perfil_ia, estilo_viaje, intereses").eq("user_id", user.id).maybeSingle(),
        supabase.from("user_visits").select("category").eq("user_id", user.id),
        supabase.from("trips").select("id", { count: "exact", head: true }).eq("user_id", user.id),
      ]);

      // Tally categories from visits + dna_signal
      const tally: Record<string, number> = { food: 0, adventure: 0, cultural: 0, luxury: 0, relax: 0, nightlife: 0 };
      for (const v of visits ?? []) {
        const k = CATEGORY_MAP[(v as any).category as string];
        if (k && k !== "hidden") tally[k] += 1;
      }
      const sig = (prefs?.dna_signal as any)?.categories ?? {};
      for (const [c, n] of Object.entries(sig)) {
        const k = CATEGORY_MAP[c as string];
        if (k && k !== "hidden") tally[k] += Number(n) || 0;
      }
      // Hidden gem proxy: diversity of unique categories visited
      const uniqueCats = new Set([
        ...((visits ?? []).map((v: any) => v.category).filter(Boolean) as string[]),
        ...Object.keys(sig),
      ]).size;

      // Soft seeds from declared prefs
      if ((prefs as any)?.nivel_presupuesto === "alto" || (prefs as any)?.nivel_presupuesto === "premium") tally.luxury += 3;
      if (((tp as any)?.estilo_viaje ?? []).some((s: string) => /lujo|premium/i.test(s))) tally.luxury += 3;
      if (((prefs as any)?.actividades_tarde ?? []).some((s: string) => /noche|night/i.test(s))) tally.nightlife += 2;
      if (((tp as any)?.intereses ?? []).some((s: string) => /cultura|museo|arte/i.test(s))) tally.cultural += 2;
      if (((tp as any)?.intereses ?? []).some((s: string) => /aventura|natur/i.test(s))) tally.adventure += 2;
      if (((tp as any)?.intereses ?? []).some((s: string) => /gastro|comida|food/i.test(s))) tally.food += 2;
      if (((tp as any)?.intereses ?? []).some((s: string) => /spa|wellness|playa|relax/i.test(s))) tally.relax += 2;

      const total = Object.values(tally).reduce((s, n) => s + n, 0) || 1;
      const pct = (n: number) => Math.round((n / total) * 100);

      const stats: DNAStat[] = [
        { key: "food", ...STAT_TEMPLATE.food, value: pct(tally.food) },
        { key: "adventure", ...STAT_TEMPLATE.adventure, value: pct(tally.adventure) },
        { key: "cultural", ...STAT_TEMPLATE.cultural, value: pct(tally.cultural) },
        { key: "luxury", ...STAT_TEMPLATE.luxury, value: pct(tally.luxury) },
        { key: "relax", ...STAT_TEMPLATE.relax, value: pct(tally.relax) },
        { key: "nightlife", ...STAT_TEMPLATE.nightlife, value: pct(tally.nightlife) },
        { key: "hidden", ...STAT_TEMPLATE.hidden, value: Math.min(100, uniqueCats * 12) },
      ];

      // dominant style
      const top = [...stats].filter(s => s.key !== "hidden").sort((a, b) => b.value - a.value)[0];
      const dominant = (top?.key ?? "cultural") as AvatarStyle;

      if (!cancelled) {
        setDna({
          stats,
          dominant,
          tripCount: tripCount ?? 0,
          visitCount: (prefs as any)?.visit_count ?? (visits?.length ?? 0),
          perfil: (prefs?.perfil_ia as any) ?? (tp?.perfil_ia as any) ?? null,
        });
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user, tick]);

  return { dna, loading, reload: () => setTick(t => t + 1) };
}

export const TravelDNAStats = ({ stats }: { stats: DNAStat[] }) => {
  return (
    <div className="space-y-3">
      {stats.map(s => (
        <div key={s.key}>
          <div className="flex justify-between text-[11px] mb-1">
            <span className="text-foreground/90">{s.label}</span>
            <span className="text-primary font-medium">{s.value}%</span>
          </div>
          <div className="h-2 rounded-full bg-white/[0.04] overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{ width: `${s.value}%`, background: `linear-gradient(90deg, ${s.color}, ${s.color}cc)` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
};
