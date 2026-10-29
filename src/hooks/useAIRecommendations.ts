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
  /** El servidor no tenía gustos, favoritos ni viajes con qué personalizar (cuenta nueva). */
  sin_perfil?: boolean;
};

type RecoResult = { list: AIRecommendation[]; profileless: boolean };

const RATE_LIMITED_MSG = "Generaste muchas recomendaciones seguidas. Intenta de nuevo en unos minutos.";

// Compartido entre Inicio y Descubrir: navegar entre páginas no vuelve a pedirlas.
const cache = new Map<string, RecoResult>();
const inflight = new Map<string, Promise<RecoResult>>();

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

async function fetchRecommendations(refresh: boolean): Promise<RecoResult> {
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
  return { list: response?.destinations ?? [], profileless: response?.sin_perfil === true };
}

export function useAIRecommendations() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [recos, setRecos] = useState<AIRecommendation[] | null>(() =>
    userId ? cache.get(userId)?.list ?? null : null,
  );
  // Sin perfil todavía: se presentan como "Para empezar" y sin el "% afín", que no tendría base.
  const [profileless, setProfileless] = useState<boolean>(() => (userId ? cache.get(userId)?.profileless ?? false : false));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (refresh = false) => {
    if (!userId) return;
    if (!refresh && cache.has(userId)) {
      const hit = cache.get(userId)!;
      setRecos(hit.list);
      setProfileless(hit.profileless);
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
      setRecos(result.list);
      setProfileless(result.profileless);
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

  return { recos, profileless, loading, error, refresh: () => load(true) };
}
