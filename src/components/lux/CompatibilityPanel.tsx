import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Users, Heart } from "lucide-react";

type Amigo = {
  amigo_id: string;
  full_name: string | null;
  avatar_url: string | null;
  score: number | null;
  detalles: string[];
};

export const CompatibilityPanel = () => {
  const [amigos, setAmigos] = useState<Amigo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data: rows } = await supabase.from("mis_amigos" as any).select("amigo_id");
      const ids = ((rows ?? []) as any[]).map(r => r.amigo_id);
      if (!ids.length) { setLoading(false); return; }
      const { data: profs } = await supabase
        .from("profiles").select("id, full_name, avatar_url").in("id", ids);
      const base: Amigo[] = (profs ?? []).map((p: any) => ({
        amigo_id: p.id, full_name: p.full_name, avatar_url: p.avatar_url, score: null, detalles: [],
      }));
      setAmigos(base);
      setLoading(false);
      base.forEach(async (a) => {
        const { data } = await supabase.rpc("compatibilidad_viaje", { p_otro: a.amigo_id });
        const r: any = data;
        if (r?.ok) {
          setAmigos(prev => prev.map(x =>
            x.amigo_id === a.amigo_id ? { ...x, score: r.score ?? 0, detalles: r.detalles ?? [] } : x
          ));
        }
      });
    })();
  }, []);

  if (loading) {
    return <p className="text-xs text-muted-foreground">Calculando compatibilidad…</p>;
  }
  if (!amigos.length) {
    return (
      <p className="text-xs text-muted-foreground">
        Aún no tienes amigos conectados. Comparte tu código en <span className="text-primary">Social</span> para comparar avatares de viaje.
      </p>
    );
  }

  return (
    <div className="space-y-2.5">
      {amigos.slice(0, 6).map(a => {
        const score = a.score ?? null;
        const color = score == null ? "#666" : score >= 75 ? "#7bc97b" : score >= 50 ? "#e8c66c" : "#e87b6c";
        return (
          <div key={a.amigo_id} className="flex items-center gap-3 p-2.5 rounded-xl bg-white/[0.02] border border-white/[0.05]">
            <div className="w-10 h-10 rounded-full bg-gradient-gold flex items-center justify-center text-primary-foreground text-sm font-display shrink-0 overflow-hidden">
              {a.avatar_url ? <img src={a.avatar_url} alt="" className="w-full h-full object-cover" /> : (a.full_name?.[0]?.toUpperCase() ?? "?")}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium truncate">{a.full_name ?? "Amigo"}</p>
              <p className="text-[10px] text-muted-foreground truncate">
                {score == null ? "Calculando…" : (a.detalles[0] ?? "Perfiles aún en construcción")}
              </p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-lg font-display leading-none" style={{ color }}>
                {score == null ? "…" : `${score}%`}
              </p>
              <p className="text-[9px] tracking-wider uppercase text-muted-foreground mt-0.5">match</p>
            </div>
          </div>
        );
      })}
    </div>
  );
};
