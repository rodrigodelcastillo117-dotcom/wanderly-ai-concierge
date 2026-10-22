import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { logInsight } from "@/lib/insights";
import type { AIRecommendation } from "@/hooks/useAIRecommendations";

/**
 * Destinos guardados en favoritos (tabla recomendaciones, guardado=true). Una sola lógica para
 * Descubre e Inicio: en Inicio el corazón solo cambiaba un estado local que se perdía al
 * recargar y nunca llegaba a Favoritos (E-11 / E-21).
 *
 * Un segundo toque mientras se guarda se ignora: antes creaba dos filas, y TripDetail (que busca
 * una sola) dejaba de reconocer el favorito.
 */
export function useSavedDestinations() {
  const { user } = useAuth();
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!user) return;
    supabase.from("recomendaciones").select("titulo").eq("user_id", user.id).eq("guardado", true)
      .then(({ data }) => setSaved(new Set((data ?? []).map((r: { titulo: string }) => r.titulo))));
  }, [user]);

  const toggleNow = useCallback(async (d: AIRecommendation, isSaved: boolean) => {
    if (!user) return;
    if (isSaved) {
      const { error } = await supabase.from("recomendaciones").update({ guardado: false })
        .eq("user_id", user.id).eq("titulo", d.name);
      if (error) throw error;
      await logInsight("removed", "destination", d.name);
      setSaved((s) => { const n = new Set(s); n.delete(d.name); return n; });
      return;
    }
    const { data: existing } = await supabase.from("recomendaciones").select("id")
      .eq("user_id", user.id).eq("titulo", d.name).limit(1).maybeSingle();
    if (existing) {
      const { error } = await supabase.from("recomendaciones").update({ guardado: true }).eq("id", existing.id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from("recomendaciones").insert([{
        user_id: user.id, titulo: d.name, tipo: "destination_ai",
        descripcion: d.country, match_score: d.score, guardado: true,
        metadata: { reason: d.reason, image_query: d.image_query, trip_type: d.trip_type, best_months: d.best_months },
      }]);
      if (error) throw error;
    }
    await logInsight("saved", "destination", d.name, { country: d.country, score: d.score });
    setSaved((s) => new Set(s).add(d.name));
    toast.success(`${d.name} guardado en favoritos`);
  }, [user]);

  const toggle = useCallback(async (d: AIRecommendation) => {
    if (!user || pending.has(d.name)) return;
    setPending((s) => new Set(s).add(d.name));
    try {
      await toggleNow(d, saved.has(d.name));
    } catch {
      toast.error("No se pudo actualizar tus favoritos. Intenta de nuevo.");
    } finally {
      setPending((s) => { const n = new Set(s); n.delete(d.name); return n; });
    }
  }, [user, pending, saved, toggleNow]);

  return { saved, pending, toggle };
}
