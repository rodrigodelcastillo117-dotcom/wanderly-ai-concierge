import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { FileUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { localISODate } from "@/lib/localDate";
import { computeTravelDna, dnaBasisText, type DnaInputs, type DnaKey, type DnaResultCore, type DnaStat } from "@/lib/travelDna";

export type { DnaStat as DNAStat } from "@/lib/travelDna";

export type DNAResult = DnaResultCore & {
  dominant: DnaKey | null;
  tripCount: number;
  visitCount: number;
  perfil: any;
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
      const [{ data: prefs }, { data: tp }, { data: visits }, { data: trips }] = await Promise.all([
        supabase.from("ai_user_preferences").select("perfil_ia, dna_signal, visit_count, nivel_presupuesto, actividades_tarde").eq("user_id", user.id).maybeSingle(),
        supabase.from("travel_profiles").select("perfil_ia, estilo_viaje, intereses").eq("user_id", user.id).maybeSingle(),
        supabase.from("user_visits").select("category").eq("user_id", user.id),
        supabase.from("trips")
          .select("destino, pais_destino, fecha_salida, fecha_regreso, num_viajeros, total_estimado, itinerario_json, hospedaje_json")
          .eq("user_id", user.id).limit(100),
      ]);
      const core = computeTravelDna({
        today: localISODate(),
        trips: (trips ?? []) as DnaInputs["trips"],
        visits: (visits ?? []) as DnaInputs["visits"],
        signalCategories: ((prefs as any)?.dna_signal?.categories ?? null) as Record<string, unknown> | null,
        declared: {
          presupuesto: (prefs as any)?.nivel_presupuesto ?? null,
          estilo: (tp as any)?.estilo_viaje ?? null,
          intereses: (tp as any)?.intereses ?? null,
          actividades: (prefs as any)?.actividades_tarde ?? null,
        },
      });
      if (!cancelled) {
        setDna({
          ...core,
          tripCount: core.viajesHechos + core.viajesPlaneados,
          visitCount: (prefs as any)?.visit_count ?? core.lugares,
          perfil: (prefs?.perfil_ia as any) ?? (tp?.perfil_ia as any) ?? null,
        });
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user, tick]);

  return { dna, loading, reload: () => setTick((t) => t + 1) };
}

/** Barras del Travel DNA en español. Sin datos lo dice, en lugar de mostrar 0 % por todos lados. */
export const TravelDNAStats = ({ dna }: { dna: Pick<DNAResult, "stats" | "fuente" | "viajesHechos" | "viajesPlaneados" | "lugares"> }) => {
  if (dna.fuente === "ninguna") {
    return (
      <div className="rounded-2xl border border-dashed border-primary/30 p-4 space-y-2" data-testid="dna-sin-datos">
        <p className="font-display text-lg text-foreground">Aún no hay datos</p>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Tu perfil de viajero se llena con tus viajes: los que haces con IATOS y los que ya hiciste. Sube los boletos o reservas de un viaje pasado y lo calculamos.
        </p>
        <Link to="/dashboard/viajes/importar" className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline">
          <FileUp className="w-3.5 h-3.5" aria-hidden="true" /> Sube un viaje que ya hiciste
        </Link>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {dna.stats.map((s: DnaStat) => (
        <div key={s.key}>
          <div className="flex justify-between gap-2 text-[11px] mb-1">
            <span className="text-foreground/90">{s.label}</span>
            {s.value === null
              ? <span className="text-muted-foreground">Sin datos aún</span>
              : <span className="text-primary font-medium">{s.value}%</span>}
          </div>
          <div className={`h-2 rounded-full overflow-hidden ${s.value === null ? "border border-dashed border-white/10 bg-transparent" : "bg-white/[0.04]"}`}>
            {s.value !== null && (
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{ width: `${s.value}%`, background: `linear-gradient(90deg, ${s.color}, ${s.color}cc)` }}
              />
            )}
          </div>
        </div>
      ))}
      <p className="text-[10px] text-muted-foreground pt-1" data-testid="dna-base">{dnaBasisText(dna)}</p>
    </div>
  );
};
