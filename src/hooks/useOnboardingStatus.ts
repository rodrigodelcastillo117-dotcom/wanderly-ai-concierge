import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export type OnboardingState = {
  user_id: string;
  completed_onboarding: boolean;
  completed_at: string | null;
  current_step: number;
  selected_cards: string[];
  selected_loyalty_airlines: string[];
  selected_loyalty_hotels: string[];
  travel_dna_seed: string | null;
};

const defaults = (uid: string): OnboardingState => ({
  user_id: uid,
  completed_onboarding: false,
  completed_at: null,
  current_step: 1,
  selected_cards: [],
  selected_loyalty_airlines: [],
  selected_loyalty_hotels: [],
  travel_dna_seed: null,
});

export function useOnboardingStatus() {
  const { user } = useAuth();
  const uid = user?.id ?? null;
  const [status, setStatus] = useState<OnboardingState | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    if (!uid) {
      setStatus(null);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    const { data } = await supabase
      .from("user_onboarding_state")
      .select("*")
      .eq("user_id", uid)
      .maybeSingle();

    if (!data) {
      // Backfill: if this user already has trips or a travel_profile,
      // they're a pre-existing user — mark onboarding complete.
      const [{ count: tripCount }, { data: tp }] = await Promise.all([
        supabase.from("trips").select("id", { count: "exact", head: true }).eq("user_id", uid),
        supabase.from("travel_profiles").select("user_id").eq("user_id", uid).maybeSingle(),
      ]);
      const isExisting = (tripCount ?? 0) > 0 || !!tp;
      const seed: OnboardingState = {
        ...defaults(uid),
        completed_onboarding: isExisting,
        completed_at: isExisting ? new Date().toISOString() : null,
        current_step: isExisting ? 5 : 1,
      };
      await supabase.from("user_onboarding_state").upsert(seed, { onConflict: "user_id" });
      const { data: fresh } = await supabase
        .from("user_onboarding_state")
        .select("*")
        .eq("user_id", uid)
        .maybeSingle();
      setStatus(fresh ? ({ ...seed, ...(fresh as any) }) : seed);
    } else {
      setStatus({
        ...defaults(uid),
        ...data,
        selected_cards: (data.selected_cards as any) ?? [],
        selected_loyalty_airlines: (data.selected_loyalty_airlines as any) ?? [],
        selected_loyalty_hotels: (data.selected_loyalty_hotels as any) ?? [],
      });
    }
    setIsLoading(false);
  }, [uid]);

  useEffect(() => {
    load();
  }, [load]);


  const markStepComplete = useCallback(
    async (step: number, data: Partial<OnboardingState>) => {
      if (!user) return;
      const patch = { ...data, current_step: Math.max(step + 1, 1) };
      const { data: upd } = await supabase
        .from("user_onboarding_state")
        .update(patch as any)
        .eq("user_id", user.id)
        .select()
        .maybeSingle();
      if (upd) setStatus((s) => (s ? { ...s, ...(upd as any) } : s));
    },
    [user]
  );

  const markOnboardingComplete = useCallback(
    async (finalData: Partial<OnboardingState>) => {
      if (!user) return;
      const patch = {
        ...finalData,
        completed_onboarding: true,
        completed_at: new Date().toISOString(),
        current_step: 5,
      };
      const { data: upd } = await supabase
        .from("user_onboarding_state")
        .update(patch as any)
        .eq("user_id", user.id)
        .select()
        .maybeSingle();
      if (upd) setStatus((s) => (s ? { ...s, ...(upd as any) } : s));
    },
    [user]
  );

  return { status, isLoading, markStepComplete, markOnboardingComplete, reload: load };
}
