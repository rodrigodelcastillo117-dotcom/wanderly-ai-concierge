import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Tracks whether a contextual tooltip has been shown to the user.
 * Reads/writes `tooltips_shown` (JSONB array of ids) in `user_onboarding_state`.
 * Only returns shouldShow=true if the user finished initial onboarding AND the id is not yet in the list.
 */
export function useTooltipShown(tooltipId: string) {
  const { user } = useAuth();
  const uid = user?.id ?? null;
  const [shouldShow, setShouldShow] = useState(false);
  const dismissedRef = useRef(false);

  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("user_onboarding_state")
        .select("completed_onboarding, tooltips_shown")
        .eq("user_id", uid)
        .maybeSingle();
      if (cancelled || !data) return;
      const completed = (data as any).completed_onboarding === true;
      const shown: string[] = ((data as any).tooltips_shown as any) ?? [];
      if (completed && !shown.includes(tooltipId) && !dismissedRef.current) {
        setShouldShow(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [uid, tooltipId]);

  const dismiss = async () => {
    if (dismissedRef.current) return;
    dismissedRef.current = true;
    setShouldShow(false);
    if (!uid) return;
    // Re-fetch the current array to avoid clobbering concurrent updates
    const { data } = await supabase
      .from("user_onboarding_state")
      .select("tooltips_shown")
      .eq("user_id", uid)
      .maybeSingle();
    const current: string[] = ((data as any)?.tooltips_shown as any) ?? [];
    if (current.includes(tooltipId)) return;
    const next = [...current, tooltipId];
    await supabase
      .from("user_onboarding_state")
      .update({ tooltips_shown: next as any })
      .eq("user_id", uid);
  };

  return { shouldShow, dismiss };
}
