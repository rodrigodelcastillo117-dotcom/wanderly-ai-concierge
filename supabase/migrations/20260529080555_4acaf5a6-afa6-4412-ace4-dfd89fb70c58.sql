
-- 1. Subscriptions: remove user INSERT/UPDATE policies (managed only by service_role via webhooks)
DROP POLICY IF EXISTS "Users insert own subscription" ON public.subscriptions;
DROP POLICY IF EXISTS "Users update own subscription" ON public.subscriptions;
DROP POLICY IF EXISTS subscriptions_insert_own ON public.subscriptions;
DROP POLICY IF EXISTS subscriptions_update_own ON public.subscriptions;
DROP POLICY IF EXISTS subscriptions_delete_own ON public.subscriptions;

-- 2. user_badges: remove user INSERT policy
DROP POLICY IF EXISTS user_badges_insert_own ON public.user_badges;

-- 3. user_missions: keep read, remove user write
DROP POLICY IF EXISTS user_missions_upsert_own ON public.user_missions;

-- 4. destination_daily_costs: enable RLS + allow public read (reference data)
ALTER TABLE public.destination_daily_costs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS destination_daily_costs_public_read ON public.destination_daily_costs;
CREATE POLICY destination_daily_costs_public_read
  ON public.destination_daily_costs FOR SELECT
  TO anon, authenticated
  USING (true);

-- 5. set_updated_at: fix mutable search_path
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
begin new.updated_at = now(); return new; end;
$function$;
