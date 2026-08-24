-- 1) get_access_state: siempre scoped al usuario autenticado
CREATE OR REPLACE FUNCTION public.get_access_state(_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := COALESCE(auth.uid(), _user_id);
  v_pro boolean;
  v_row public.usage_limits%ROWTYPE;
  v_period text := to_char(now(), 'YYYY-MM');
  v_msgs int := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  v_pro := public.is_pro(v_uid);
  SELECT * INTO v_row FROM public.usage_limits WHERE user_id = v_uid;
  IF FOUND AND v_row.concierge_period = v_period THEN
    v_msgs := v_row.concierge_messages_used;
  END IF;
  RETURN jsonb_build_object(
    'is_pro', v_pro,
    'concierge_used', v_msgs,
    'concierge_limit', 3,
    'concierge_remaining', GREATEST(0, 3 - v_msgs),
    'trips_used', COALESCE(v_row.trips_analyzed_used, 0),
    'trips_limit', 1,
    'trips_remaining', GREATEST(0, 1 - COALESCE(v_row.trips_analyzed_used, 0))
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_access_state(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_access_state(uuid) TO authenticated, service_role;

-- 2) Revocar ejecución pública/anon de funciones internas
REVOKE ALL ON FUNCTION public.aceptar_invitacion_viaje(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.aceptar_invitacion_viaje(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.rechazar_invitacion_viaje(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rechazar_invitacion_viaje(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.ensure_ai_prefs(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_ai_prefs(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.gen_invite_code() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gen_invite_code() TO service_role;
REVOKE ALL ON FUNCTION public.notify_trip_updated() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.on_trip_insert_dna() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.on_visit_insert_dna() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_invite_code_default() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- 3) Rate limiting
CREATE TABLE IF NOT EXISTS public.rate_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject text NOT NULL,
  bucket text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.rate_limits TO service_role;

ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rate_limits sin acceso directo"
  ON public.rate_limits FOR SELECT TO authenticated USING (false);

CREATE INDEX IF NOT EXISTS rate_limits_lookup_idx
  ON public.rate_limits (subject, bucket, created_at DESC);

CREATE OR REPLACE FUNCTION public.check_rate_limit(
  _subject text,
  _bucket text,
  _limit int,
  _window_seconds int
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_count int;
BEGIN
  DELETE FROM public.rate_limits
   WHERE created_at < now() - interval '1 day';

  SELECT count(*) INTO v_count
    FROM public.rate_limits
   WHERE subject = _subject
     AND bucket = _bucket
     AND created_at > now() - make_interval(secs => _window_seconds);

  IF v_count >= _limit THEN
    RETURN jsonb_build_object('allowed', false, 'count', v_count, 'limit', _limit,
                              'retry_after', _window_seconds);
  END IF;

  INSERT INTO public.rate_limits (subject, bucket) VALUES (_subject, _bucket);
  RETURN jsonb_build_object('allowed', true, 'count', v_count + 1, 'limit', _limit);
END;
$function$;

REVOKE ALL ON FUNCTION public.check_rate_limit(text, text, int, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_rate_limit(text, text, int, int) TO service_role;