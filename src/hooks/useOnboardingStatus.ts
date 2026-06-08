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
  const [status, setStatus] = useState<OnboardingState | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user) {
      setStatus(null);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    const { data } = await supabase
      .from("user_onboarding_state")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!data) {
      const seed = defaults(user.id);
      await supabase.from("user_onboarding_state").insert(seed);
      setStatus(seed);
    } else {
      setStatus({
        ...defaults(user.id),
        ...data,
        selected_cards: (data.selected_cards as any) ?? [],
        selected_loyalty_airlines: (data.selected_loyalty_airlines as any) ?? [],
        selected_loyalty_hotels: (data.selected_loyalty_hotels as any) ?? [],
      });
    }
    setIsLoading(false);
  }, [user]);

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
