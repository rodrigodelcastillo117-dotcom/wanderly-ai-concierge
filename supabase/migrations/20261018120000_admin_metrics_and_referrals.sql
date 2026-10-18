-- Admin metrics panel + referral attribution.

-- ---------------------------------------------------------------- admins
-- Membership is granted by a person in the SQL editor (docs/ops/programar-tareas.sql);
-- clients can only check whether they themselves are an admin.
CREATE TABLE IF NOT EXISTS public.admins (
  user_id UUID PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.admins ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS admins_select_self ON public.admins;
CREATE POLICY admins_select_self ON public.admins
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
REVOKE INSERT, UPDATE, DELETE ON public.admins FROM anon, authenticated;
GRANT SELECT ON public.admins TO authenticated;
GRANT ALL ON public.admins TO service_role;

-- ---------------------------------------------------------------- referrals
-- user_id is the person who joined (so account deletion purges it automatically);
-- referrer_id is removed by purge_account_data below.
CREATE TABLE IF NOT EXISTS public.referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE,
  referrer_id UUID NOT NULL,
  code TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (user_id <> referrer_id)
);
CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON public.referrals (referrer_id);
ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS referrals_select_as_referrer ON public.referrals;
CREATE POLICY referrals_select_as_referrer ON public.referrals
  FOR SELECT TO authenticated USING (auth.uid() = referrer_id);
REVOKE INSERT, UPDATE, DELETE ON public.referrals FROM anon, authenticated;
GRANT SELECT ON public.referrals TO authenticated;
GRANT ALL ON public.referrals TO service_role;

-- Called once by a newly registered user. Only accounts created in the last 24h
-- can be attributed, so existing users can't retro-assign themselves to anyone.
CREATE OR REPLACE FUNCTION public.claim_referral(p_code text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_referrer uuid;
BEGIN
  IF v_user IS NULL OR p_code IS NULL OR length(trim(p_code)) = 0 THEN RETURN false; END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = v_user AND created_at > now() - interval '24 hours') THEN
    RETURN false;
  END IF;
  SELECT id INTO v_referrer FROM public.profiles WHERE upper(invite_code) = upper(trim(p_code));
  IF v_referrer IS NULL OR v_referrer = v_user THEN RETURN false; END IF;
  INSERT INTO public.referrals (user_id, referrer_id, code)
  VALUES (v_user, v_referrer, upper(trim(p_code)))
  ON CONFLICT (user_id) DO NOTHING;
  RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.claim_referral(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_referral(text) TO authenticated;

-- ---------------------------------------------------------------- metrics
-- Aggregates only; raises for anyone who isn't in public.admins.
CREATE OR REPLACE FUNCTION public.admin_metrics()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  d30 timestamptz := now() - interval '30 days';
  d7 timestamptz := now() - interval '7 days';
  v_users bigint;
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (SELECT 1 FROM public.admins WHERE user_id = auth.uid()) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO v_users FROM auth.users;

  SELECT jsonb_build_object(
    'generated_at', now(),
    'users', jsonb_build_object(
      'total', v_users,
      'last_7d', (SELECT count(*) FROM auth.users WHERE created_at >= d7),
      'last_30d', (SELECT count(*) FROM auth.users WHERE created_at >= d30),
      'active_30d', (SELECT count(DISTINCT user_id) FROM (
          SELECT user_id FROM public.trips WHERE created_at >= d30
          UNION ALL SELECT user_id FROM public.concierge_conversations WHERE updated_at >= d30
          UNION ALL SELECT user_id FROM public.bookings WHERE created_at >= d30
        ) a)
    ),
    'activation', jsonb_build_object(
      'users_with_trip', (SELECT count(DISTINCT user_id) FROM public.trips),
      'pct', CASE WHEN v_users = 0 THEN 0
             ELSE round(100.0 * (SELECT count(DISTINCT user_id) FROM public.trips) / v_users, 1) END
    ),
    'trips', jsonb_build_object(
      'total', (SELECT count(*) FROM public.trips),
      'last_30d', (SELECT count(*) FROM public.trips WHERE created_at >= d30),
      'avg_total_mxn', (SELECT round(avg(total_estimado)) FROM public.trips
                        WHERE total_estimado > 0 AND coalesce(moneda, 'MXN') = 'MXN')
    ),
    'concierge', jsonb_build_object(
      'conversations', (SELECT count(*) FROM public.concierge_conversations),
      'users', (SELECT count(DISTINCT user_id) FROM public.concierge_conversations),
      'messages', (SELECT coalesce(sum(CASE WHEN jsonb_typeof(messages::jsonb) = 'array'
                                            THEN jsonb_array_length(messages::jsonb) ELSE 0 END), 0)
                   FROM public.concierge_conversations)
    ),
    'bookings', jsonb_build_object(
      'total', (SELECT count(*) FROM public.bookings),
      'last_30d', (SELECT count(*) FROM public.bookings WHERE created_at >= d30),
      'by_category', (SELECT coalesce(jsonb_object_agg(category, n), '{}'::jsonb)
                      FROM (SELECT category, count(*) n FROM public.bookings GROUP BY category) c)
    ),
    'affiliate_clicks', jsonb_build_object(
      'total', (SELECT count(*) FROM public.affiliate_clicks),
      'last_30d', (SELECT count(*) FROM public.affiliate_clicks WHERE clicked_at >= d30)
    ),
    'price_watches', jsonb_build_object(
      'active', (SELECT count(*) FROM public.price_watches WHERE active),
      'total', (SELECT count(*) FROM public.price_watches),
      'alerts_sent', (SELECT coalesce(sum(alerts_sent), 0) FROM public.price_watches),
      'checks', (SELECT count(*) FROM public.price_watch_checks)
    ),
    'subscriptions', (SELECT coalesce(jsonb_object_agg(status, n), '{}'::jsonb)
                      FROM (SELECT status, count(*) n FROM public.subscriptions GROUP BY status) s),
    'fixer', jsonb_build_object(
      'total', (SELECT count(*) FROM public.fixer_escalations),
      'last_30d', (SELECT count(*) FROM public.fixer_escalations WHERE created_at >= d30)
    ),
    'referrals', jsonb_build_object(
      'total', (SELECT count(*) FROM public.referrals),
      'last_30d', (SELECT count(*) FROM public.referrals WHERE created_at >= d30),
      'referrers', (SELECT count(DISTINCT referrer_id) FROM public.referrals)
    ),
    'weekly', (
      SELECT jsonb_agg(jsonb_build_object(
        'week', to_char(w, 'YYYY-MM-DD'),
        'signups', (SELECT count(*) FROM auth.users WHERE created_at >= w AND created_at < w + interval '7 days'),
        'trips', (SELECT count(*) FROM public.trips WHERE created_at >= w AND created_at < w + interval '7 days'),
        'bookings', (SELECT count(*) FROM public.bookings WHERE created_at >= w AND created_at < w + interval '7 days')
      ) ORDER BY w)
      FROM generate_series(date_trunc('week', now()) - interval '11 weeks', date_trunc('week', now()), interval '1 week') w
    )
  ) INTO v_result;

  RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.admin_metrics() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_metrics() TO authenticated;

-- ---------------------------------------------------------------- erasure
-- Same as 20261017101000 plus referrals where the deleted user was the referrer.
CREATE OR REPLACE FUNCTION public.purge_account_data(p_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE t record; v_trips uuid[]; v_count integer; v_counts jsonb := '{}'::jsonb;
BEGIN
 IF p_user_id IS NULL THEN RAISE EXCEPTION 'user_required'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text,0));
 SELECT coalesce(array_agg(id),'{}'::uuid[]) INTO v_trips FROM public.trips WHERE user_id=p_user_id;
 -- Remove only relationships involving this identity, never the other person's profile/trip.
 DELETE FROM public.friendships WHERE requester_id=p_user_id OR addressee_id=p_user_id;
 DELETE FROM public.trip_collaborators WHERE user_id=p_user_id OR invited_by=p_user_id OR trip_id=ANY(v_trips);
 DELETE FROM public.trip_journal_entries WHERE author_id=p_user_id;
 DELETE FROM public.notifications WHERE related_id=ANY(v_trips);
 DELETE FROM public.referrals WHERE referrer_id=p_user_id;
 -- These two legacy trip references have no FK; detach others' records explicitly.
 UPDATE public.concierge_requests SET trip_id=NULL WHERE trip_id=ANY(v_trips) AND user_id<>p_user_id;
 UPDATE public.tracked_flights SET trip_id=NULL WHERE trip_id=ANY(v_trips) AND user_id<>p_user_id;
 -- Enumerate actual base tables, not views: new user_id tables are covered automatically.
 FOR t IN SELECT c.table_name FROM information_schema.columns c JOIN information_schema.tables b ON b.table_schema=c.table_schema AND b.table_name=c.table_name
 WHERE c.table_schema='public' AND c.column_name='user_id' AND c.udt_name='uuid' AND b.table_type='BASE TABLE' AND c.table_name<>'trips' ORDER BY c.table_name
 LOOP
   EXECUTE format('DELETE FROM public.%I WHERE user_id = $1',t.table_name) USING p_user_id;
   GET DIAGNOSTICS v_count=ROW_COUNT;
   v_counts := v_counts || jsonb_build_object(t.table_name,v_count);
 END LOOP;
 DELETE FROM public.rate_limits WHERE subject='user:'||p_user_id::text OR subject=p_user_id::text;
 -- Cascades remove journal, packing and split data of owned trips. SET NULL FKs retain others' personal records.
 DELETE FROM public.trips WHERE user_id=p_user_id;
 DELETE FROM public.profiles WHERE id=p_user_id;
 RETURN jsonb_build_object('ok',true,'tables',v_counts);
END $$;
REVOKE ALL ON FUNCTION public.purge_account_data(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.purge_account_data(uuid) TO service_role;
