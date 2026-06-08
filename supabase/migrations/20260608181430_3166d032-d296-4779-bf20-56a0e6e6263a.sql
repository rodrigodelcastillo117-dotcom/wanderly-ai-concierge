-- Backfill: existing users with any trip or travel_profile are considered onboarded
INSERT INTO public.user_onboarding_state (user_id, completed_onboarding, completed_at, current_step)
SELECT u.id, true, now(), 5
FROM auth.users u
WHERE EXISTS (SELECT 1 FROM public.trips t WHERE t.user_id = u.id)
   OR EXISTS (SELECT 1 FROM public.travel_profiles tp WHERE tp.user_id = u.id)
ON CONFLICT (user_id) DO UPDATE
  SET completed_onboarding = true,
      completed_at = COALESCE(public.user_onboarding_state.completed_at, now()),
      current_step = GREATEST(public.user_onboarding_state.current_step, 5);