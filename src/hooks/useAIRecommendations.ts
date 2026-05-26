import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export type AIRecommendation = {
  name: string;
  country: string;
  score: number;
  reason: string;
  best_months?: string;
  trip_type?: string;
  image_query: string;
};

export function useAIRecommendations() {
  const { user } = useAuth();
  const [recos, setRecos] = useState<AIRecommendation[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (refresh = false) => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const { data, error } = await supabase.functions.invoke("recomendar-destinos", {
        body: { refresh },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      setRecos((data as any)?.destinations ?? []);
    } catch (e: any) {
      console.error(e);
      setError(e?.message ?? "No pudimos generar recomendaciones");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (user) void load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  return { recos, loading, error, refresh: () => load(true) };
}
