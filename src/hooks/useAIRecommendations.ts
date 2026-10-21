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

const RATE_LIMITED_MSG = "Generaste muchas recomendaciones seguidas. Intenta de nuevo en unos minutos.";

// Compartido entre Inicio y Descubrir: navegar entre páginas no vuelve a pedirlas.
const cache = new Map<string, AIRecommendation[]>();
const inflight = new Map<string, Promise<AIRecommendation[]>>();

/** Solo para pruebas. */
export function __resetRecommendationsCache() {
  cache.clear();
  inflight.clear();
}

class SessionExpiredError extends Error {}
class RateLimitedError extends Error {}

function statusOf(error: unknown): number | null {
  const ctx = (error as { context?: unknown })?.context;
  return ctx instanceof Response ? ctx.status : null;
}

async function fetchRecommendations(refresh: boolean): Promise<AIRecommendation[]> {
  // Asegurar sesión real contra backend antes de llamar Edge Functions.
  const { data: verified, error: userError } = await supabase.auth.getUser();
  if (userError || !verified.user) throw new SessionExpiredError();

  const { data, error } = await supabase.functions.invoke("recomendar-destinos", {
    body: { refresh },
  });
  if (error) {
    const status = statusOf(error);
    if (status === 429) throw new RateLimitedError();
    const msg = String(error.message || "");
    if (status === 401 || msg.includes("401") || /invalid auth|no auth/i.test(msg)) {
      throw new SessionExpiredError();
    }
    throw error;
  }
  const response = data as AIRecommendationsResponse | null;
  if (response?.error) throw new Error(response.error);
  return response?.destinations ?? [];
}

export function useAIRecommendations() {
  const { user } = useAuth();
  const [recos, setRecos] = useState<AIRecommendation[] | null>(() =>
    user ? cache.get(user.id) ?? null : null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (refresh = false) => {
    if (!user) return;
    if (!refresh && cache.has(user.id)) {
      setRecos(cache.get(user.id)!);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      let pending = refresh ? undefined : inflight.get(user.id);
      if (!pending) {
        pending = fetchRecommendations(refresh);
        inflight.set(user.id, pending);
      }
      const result = await pending.finally(() => inflight.delete(user.id));
      cache.set(user.id, result);
      setRecos(result);
    } catch (e: unknown) {
      if (e instanceof SessionExpiredError) {
        await supabase.auth.signOut({ scope: "local" });
        setError("Tu sesión expiró. Vuelve a iniciar sesión.");
      } else if (e instanceof RateLimitedError) {
        setError(RATE_LIMITED_MSG);
      } else {
        console.error(e);
        setError(e instanceof Error ? e.message : "No pudimos generar recomendaciones");
      }
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
