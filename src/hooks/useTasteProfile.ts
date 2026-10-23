// Perfil de gustos de quien ve el viaje, para "Recomendado por IATOS" (carruseles de Comprar): lo que
// declaró (travel_profiles) y su ADN gastronómico (profiles.food_dna). Solo filas propias (RLS) y una
// lectura por viaje abierto; sin sesión o sin datos, null (la recomendación usa calificaciones).
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { tasteFrom, type TasteProfile } from "@/lib/tripPicks";

const cache = new Map<string, TasteProfile | null>();

export function useTasteProfile(userId: string | null | undefined): TasteProfile | null {
  const [taste, setTaste] = useState<TasteProfile | null>(() => (userId ? cache.get(userId) ?? null : null));
  useEffect(() => {
    if (!userId) { setTaste(null); return; }
    if (cache.has(userId)) { setTaste(cache.get(userId) ?? null); return; }
    let alive = true;
    (async () => {
      try {
        const [tp, prof] = await Promise.all([
          supabase.from("travel_profiles").select("preferencias_comida, intereses, estilo_viaje, presupuesto_rango").eq("user_id", userId).maybeSingle(),
          supabase.from("profiles").select("food_dna").eq("id", userId).maybeSingle(),
        ]);
        const t = tasteFrom((tp as any)?.data ?? null, (prof as any)?.data?.food_dna ?? null);
        const value = t.declared.length || t.cuisinesVisited.length || t.budget ? t : null;
        cache.set(userId, value);
        if (alive) setTaste(value);
      } catch {
        if (alive) setTaste(null);
      }
    })();
    return () => { alive = false; };
  }, [userId]);
  return taste;
}

/** Solo pruebas. */
export const __resetTasteCache = () => cache.clear();
