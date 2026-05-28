import { useState } from "react";
import { Crown, RefreshCw, TrendingUp, Sparkles } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { TravelAvatarCinematic } from "@/components/lux/TravelAvatarCinematic";
import { useTravelDNA, TravelDNAStats } from "@/components/lux/TravelDNAStats";
import { CompatibilityPanel } from "@/components/lux/CompatibilityPanel";
import { BestMomentsPanel } from "@/components/lux/BestMomentsPanel";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const Concierge = () => {
  const { dna, loading, reload } = useTravelDNA();
  const [evolving, setEvolving] = useState(false);

  const evolucionar = async () => {
    setEvolving(true);
    try {
      const { data, error } = await supabase.functions.invoke("evolucionar-dna", { body: {} });
      if (error) throw error;
      toast.success("Travel DNA actualizado");
      reload();
    } catch (e: any) {
      toast.error(e?.message ?? "No se pudo evolucionar");
    } finally {
      setEvolving(false);
    }
  };

  const divergencias: string[] = dna?.perfil?.divergencias_detectadas ?? [];
  const evolucionMsg = divergencias[0] ?? (dna && dna.tripCount > 0
    ? `Tu estilo dominante es ${dna.dominant}. Sigue viajando para refinar tu Travel DNA.`
    : "Crea tu primer viaje para activar la evolución de tu avatar.");

  return (
    <DashboardLayout>
      <div className="px-4 md:px-8 py-6 max-w-7xl mx-auto">
        {/* HEADER */}
        <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="text-[10px] tracking-[0.3em] text-primary uppercase mb-1 flex items-center gap-2">
              <Crown className="w-3 h-3" /> CONCIERGE PRO
            </p>
            <h1 className="font-display text-3xl md:text-4xl leading-tight">Tu Travel DNA</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Tu identidad de viaje, compatibilidades y mejores momentos. Tu avatar vive en Social.
            </p>
          </div>
          <button
            onClick={evolucionar}
            disabled={evolving}
            className="text-[11px] px-3 py-1.5 rounded-full border border-primary/40 text-primary hover:bg-primary/10 transition flex items-center gap-1.5 disabled:opacity-50"
          >
            <RefreshCw className={`w-3 h-3 ${evolving ? "animate-spin" : ""}`} />
            {evolving ? "Recalculando DNA..." : "Recalcular Travel DNA"}
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

            <p className="text-[10px] tracking-[0.3em] text-primary uppercase mb-3 flex items-center gap-1.5">
              <Sparkles className="w-3 h-3" /> Travel DNA
            </p>
            {dna ? <TravelDNAStats stats={dna.stats} /> : <p className="text-xs text-muted-foreground">Cargando…</p>}
          </section>

          {/* EVOLUTION */}
          <section className="glass-card rounded-3xl p-5 lg:col-span-2 border border-primary/15">
            <p className="text-[10px] tracking-[0.3em] text-primary uppercase mb-2 flex items-center gap-1.5">
              <TrendingUp className="w-3 h-3" /> Evolución detectada
            </p>
            <p className="text-sm md:text-base leading-relaxed text-foreground/90">{evolucionMsg}</p>
            {divergencias.length > 1 && (
              <ul className="mt-3 text-xs text-muted-foreground list-disc pl-4 space-y-1">
                {divergencias.slice(1, 4).map((d, i) => <li key={i}>{d}</li>)}
              </ul>
            )}
          </section>

          {/* COMPATIBILITY */}
          <section className="glass-card rounded-3xl p-5">
            <p className="text-[10px] tracking-[0.3em] text-primary uppercase mb-3">Compatibilidad de viaje</p>
            <CompatibilityPanel />
          </section>

          {/* BEST MOMENTS */}
          <section className="glass-card rounded-3xl p-5 lg:col-span-3">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <p className="text-[10px] tracking-[0.3em] text-primary uppercase">Mejores momentos</p>
              <p className="text-[10px] text-muted-foreground">Sube fotos de tus mejores viajes — IATOS construirá tu galería</p>
            </div>
            <BestMomentsPanel />
          </section>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default Concierge;
