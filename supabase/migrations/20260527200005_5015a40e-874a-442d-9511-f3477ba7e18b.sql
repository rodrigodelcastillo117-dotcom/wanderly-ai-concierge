
CREATE TABLE public.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_subscriptions TO authenticated;
GRANT ALL ON public.push_subscriptions TO service_role;
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ps_select_own" ON public.push_subscriptions FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "ps_insert_own" ON public.push_subscriptions FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "ps_update_own" ON public.push_subscriptions FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "ps_delete_own" ON public.push_subscriptions FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TABLE public.tracked_flights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  trip_id uuid,
  flight text NOT NULL,
  flight_date date,
  route text,
  last_status text,
  last_gate text,
  last_terminal text,
  last_estimated text,
  last_checked_at timestamptz,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, flight, flight_date)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tracked_flights TO authenticated;
GRANT ALL ON public.tracked_flights TO service_role;
ALTER TABLE public.tracked_flights ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tf_select_own" ON public.tracked_flights FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "tf_insert_own" ON public.tracked_flights FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "tf_update_own" ON public.tracked_flights FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "tf_delete_own" ON public.tracked_flights FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE INDEX idx_tracked_flights_active ON public.tracked_flights (active, last_checked_at) WHERE active = true;

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
