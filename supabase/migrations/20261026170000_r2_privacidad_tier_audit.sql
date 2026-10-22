-- P3-7 (segunda auditoría, DEL2): purge_account_data dejaba profiles_tier_audit con el id de la
-- cuenta borrada (la tabla usa profile_id, no user_id, y el barrido genérico va por user_id).
-- Idempotente. Es la versión de 20261026130000 (cola de storage sin el id) + ese DELETE.
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
 -- P3-7: el historial de tier usa profile_id (el barrido por user_id no lo encuentra).
 DELETE FROM public.profiles_tier_audit WHERE profile_id=p_user_id;
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
 -- T-P2-3: lo que el borrado de sus viajes anotó en la cola sigue pendiente, pero sin su id.
 UPDATE public.storage_purge_queue SET user_id = NULL WHERE user_id = p_user_id;
 RETURN jsonb_build_object('ok',true,'tables',v_counts);
END $$;
REVOKE ALL ON FUNCTION public.purge_account_data(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.purge_account_data(uuid) TO service_role;
