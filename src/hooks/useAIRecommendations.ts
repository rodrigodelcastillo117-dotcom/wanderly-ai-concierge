import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { sessionTrulyExpired } from "@/lib/authRestore";
import { useAuth } from "@/contexts/AuthContext";
import { afterCritical } from "@/lib/idleGate";

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

/**
 * Cambiaron tus gustos (por ejemplo, subiste un Mejor momento): la próxima vez que Inicio o
 * Descubrir pidan recomendaciones irán al servidor, que las regenera si el perfil cambió.
 */
export function invalidateRecommendations() {
  cache.clear();
}

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
  // Sesión local (sin red): antes era getUser(), que va al servidor; un tropiezo de red al abrir
  // la app se tomaba como "sesión vencida" y cerraba la sesión.
  const { data: local } = await supabase.auth.getSession();
  if (!local.session) throw new SessionExpiredError();

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
  const userId = user?.id ?? null;
  const [recos, setRecos] = useState<AIRecommendation[] | null>(() =>
    userId ? cache.get(userId) ?? null : null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (refresh = false) => {
    if (!userId) return;
    if (!refresh && cache.has(userId)) {
      setRecos(cache.get(userId)!);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      let pending = refresh ? undefined : inflight.get(userId);
      if (!pending) {
        pending = fetchRecommendations(refresh);
        inflight.set(userId, pending);
      }
      const result = await pending.finally(() => inflight.delete(userId));
      cache.set(userId, result);
      setRecos(result);
    } catch (e: unknown) {
      if (e instanceof SessionExpiredError) {
        if (await sessionTrulyExpired(supabase.auth)) {
          await supabase.auth.signOut({ scope: "local" });
          setError("Tu sesión expiró. Vuelve a iniciar sesión.");
        } else {
          setError("No pudimos conectar. Intenta de nuevo en un momento.");
        }
      } else if (e instanceof RateLimitedError) {
        setError(RATE_LIMITED_MSG);
      } else {
        console.error(e);
        setError(e instanceof Error ? e.message : "No pudimos generar recomendaciones");
      }
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    if (cache.has(userId)) { void load(false); return; }
    // Secundario (llama a la IA y está abajo del pliegue): se pide después de lo principal de la
    // pantalla; mientras, su esqueleto.
    setLoading(true);
    return afterCritical(() => void load(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  return { recos, loading, error, refresh: () => load(true) };
}
