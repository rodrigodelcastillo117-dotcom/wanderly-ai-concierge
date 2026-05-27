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

type AIRecommendationsResponse = {
  destinations?: AIRecommendation[];
  error?: string;
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
      // Asegurar sesión real contra backend antes de llamar Edge Functions.
      const { data: verified, error: userError } = await supabase.auth.getUser();
      if (userError || !verified.user) {
        await supabase.auth.signOut({ scope: "local" });
        setError("Tu sesión expiró. Vuelve a iniciar sesión.");
        return;
      }
      const { data, error } = await supabase.functions.invoke("recomendar-destinos", {
        body: { refresh },
      });
      if (error) {
        const msg = String(error.message || "");
        if (msg.includes("401") || /invalid auth|no auth/i.test(msg)) {
          await supabase.auth.signOut({ scope: "local" });
          setError("Tu sesión expiró. Vuelve a iniciar sesión.");
          return;
        }
        throw error;
      }
      const response = data as AIRecommendationsResponse | null;
      if (response?.error) throw new Error(response.error);
      setRecos(response?.destinations ?? []);
    } catch (e: unknown) {
      console.error(e);
      setError(e instanceof Error ? e.message : "No pudimos generar recomendaciones");
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
