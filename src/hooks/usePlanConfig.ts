import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { trialCopy, type TrialMode } from "@/lib/planCopy";

// Lee una sola vez por sesión cómo funciona la prueba (public_plan_config). Si la función aún no
// existe en producción o falla, se asume "card": es lo que hace el checkout mientras el dueño no
// encienda la prueba sin tarjeta, así que nunca se promete algo que no ocurre.
let cached: TrialMode | null = null;
let inflight: Promise<TrialMode> | null = null;

export function loadTrialMode(): Promise<TrialMode> {
  if (cached) return Promise.resolve(cached);
  if (!inflight) {
    inflight = Promise.resolve(supabase.rpc("public_plan_config" as never))
      .then(({ data, error }: { data: unknown; error: unknown }) => {
        const on = !error && !!(data as { trial_no_card_enabled?: boolean } | null)?.trial_no_card_enabled;
        cached = on ? "no_card" : "card";
        return cached;
      })
      .catch(() => (cached = "card"));
  }
  return inflight;
}

/** Solo para pruebas. */
export const __resetTrialMode = () => { cached = null; inflight = null; };

export function useTrialCopy() {
  const [mode, setMode] = useState<TrialMode>(cached ?? "card");
  useEffect(() => {
    let alive = true;
    loadTrialMode().then((m) => alive && setMode(m));
    return () => { alive = false; };
  }, []);
  return { mode, copy: trialCopy(mode) };
}
