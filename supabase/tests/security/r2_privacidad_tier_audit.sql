-- P3-7 (segunda auditoría, DEL2): después de purge_account_data quedaba profiles_tier_audit con el id
-- de la cuenta borrada (esa tabla usa profile_id, no user_id). Imprime "OK …" o "FALLA …". Ids 7f7f….
\set ON_ERROR_STOP off
\pset tuples_only on
RESET ROLE;
INSERT INTO auth.users(id, email) VALUES
  ('7f7f0000-0000-0000-0000-000000000005', 'tt-eli@example.test'),
  ('7f7f0000-0000-0000-0000-000000000006', 'tt-otra@example.test')
ON CONFLICT DO NOTHING;
INSERT INTO public.profiles_tier_audit (batch_id, profile_id, old_tier, new_tier, is_pro_at_change, reason) VALUES
  (gen_random_uuid(), '7f7f0000-0000-0000-0000-000000000005', 'free', 'pro', false, 'prueba'),
  (gen_random_uuid(), '7f7f0000-0000-0000-0000-000000000006', 'free', 'pro', false, 'prueba');
SELECT public.purge_account_data('7f7f0000-0000-0000-0000-000000000005')->>'ok' AS purged \gset
SELECT CASE WHEN :'purged' = 'true' AND NOT EXISTS (SELECT 1 FROM public.profiles_tier_audit WHERE profile_id = '7f7f0000-0000-0000-0000-000000000005')
            THEN 'OK TA1 el borrado de cuenta quita su historial de profiles_tier_audit'
            ELSE 'FALLA TA1 quedan ' || (SELECT count(*) FROM public.profiles_tier_audit WHERE profile_id = '7f7f0000-0000-0000-0000-000000000005') END;
SELECT CASE WHEN EXISTS (SELECT 1 FROM public.profiles_tier_audit WHERE profile_id = '7f7f0000-0000-0000-0000-000000000006')
            THEN 'OK TA2 no toca el historial de otras cuentas' ELSE 'FALLA TA2' END;
-- Barrido como el del auditor: ninguna tabla de public conserva el id de la cuenta borrada.
DO $$
DECLARE r record; c bigint; v_left text := '';
BEGIN
  FOR r IN SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' LOOP
    EXECUTE format('SELECT count(*) FROM public.%I x WHERE x::text ILIKE %L', r.table_name, '%7f7f0000-0000-0000-0000-000000000005%') INTO c;
    IF c > 0 THEN v_left := v_left || r.table_name || '=' || c || ' '; END IF;
  END LOOP;
  IF v_left = '' THEN RAISE NOTICE 'OK TA3 ninguna tabla de public conserva el id de la cuenta borrada';
  ELSE RAISE NOTICE 'FALLA TA3 residuo: %', v_left; END IF;
END $$;
