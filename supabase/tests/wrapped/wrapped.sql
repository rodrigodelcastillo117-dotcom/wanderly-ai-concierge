-- IATOS Wrapped: wrapped_companions(p_year) y las tablas que el resumen lee desde el navegador.
-- Imprime "OK …" o "FALLA …". Requiere run.sh.
-- Año Y = el año pasado (todos sus viajes ya ocurrieron, la prueba no depende de la fecha en que corre).
-- Usuarios (ids a1…): 1 Olga (dueña) · 2 Carlos (colaborador aceptado en Lisboa, Roma y Kioto)
--   3 Sara (ajena, con su propio viaje) · 4 Pedro (invitación pendiente en Lisboa) · 5 Lía (aceptada en
--   Lisboa, sin full_name: se ve su username) · 6 Tomás (compañero de Sara) · 7 sin nombre (aceptado en Roma)
-- Viajes (ids a2…): 1 Lisboa (Y, Olga) · 2 Roma (Y, Olga) · 3 Kioto (Y-1, Olga) · 4 futuro (Olga) · 5 Oaxaca (Y, Sara)
\set ON_ERROR_STOP off
\pset tuples_only on
RESET ROLE;

CREATE OR REPLACE FUNCTION public.wr_ok(_label text, _cond boolean, _detail text DEFAULT '') RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF coalesce(_cond, false) THEN RAISE NOTICE 'OK % %', _label, _detail; ELSE RAISE NOTICE 'FALLA % %', _label, _detail; END IF;
END $$;
-- Ejecuta q como el usuario (rol authenticated) y devuelve el texto o ERR:<mensaje>.
CREATE OR REPLACE FUNCTION public.wr_as(_uid uuid, _q text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', coalesce(_uid::text, ''), false), set_config('request.jwt.claim.role', 'authenticated', false);
  SET LOCAL ROLE authenticated;
  EXECUTE _q INTO v;
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claim.role', '', false);
  RETURN coalesce(v, '<null>');
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claim.role', '', false);
  RETURN 'ERR:' || SQLERRM;
END $$;
-- Igual, como visitante sin sesión (rol anon).
CREATE OR REPLACE FUNCTION public.wr_anon(_q text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claim.role', 'anon', false);
  SET LOCAL ROLE anon;
  EXECUTE _q INTO v;
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.role', '', false);
  RETURN coalesce(v, '<null>');
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.role', '', false);
  RETURN 'ERR:' || SQLERRM;
END $$;
-- Año de las pruebas y la consulta que hace la app ("nombre:viajes" separados por coma, '' si no hay filas).
CREATE OR REPLACE FUNCTION public.wr_y() RETURNS integer LANGUAGE sql STABLE AS $$ SELECT extract(year FROM current_date)::int - 1 $$;
CREATE OR REPLACE FUNCTION public.wr_q(_year integer) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT format($f$SELECT coalesce(string_agg(name || ':' || shared_trips, ',' ORDER BY shared_trips DESC, name), '') FROM public.wrapped_companions(%s)$f$, coalesce(_year::text, 'NULL'))
$$;
GRANT EXECUTE ON FUNCTION public.wr_ok(text, boolean, text), public.wr_as(uuid, text), public.wr_anon(text), public.wr_y(), public.wr_q(integer) TO authenticated, anon;

INSERT INTO auth.users(id, email) VALUES
  ('a1000000-0000-0000-0000-000000000001', 'wr-olga@example.test'),
  ('a1000000-0000-0000-0000-000000000002', 'wr-carlos@example.test'),
  ('a1000000-0000-0000-0000-000000000003', 'wr-sara@example.test'),
  ('a1000000-0000-0000-0000-000000000004', 'wr-pedro@example.test'),
  ('a1000000-0000-0000-0000-000000000005', 'wr-lia@example.test'),
  ('a1000000-0000-0000-0000-000000000006', 'wr-tomas@example.test'),
  ('a1000000-0000-0000-0000-000000000007', 'wr-anon7@example.test')
ON CONFLICT DO NOTHING;
INSERT INTO public.profiles(id) SELECT id FROM auth.users WHERE id::text LIKE 'a1000000-%' ON CONFLICT DO NOTHING;
UPDATE public.profiles SET full_name = 'Olga Pérez' WHERE id = 'a1000000-0000-0000-0000-000000000001';
UPDATE public.profiles SET full_name = 'Carlos Ruiz' WHERE id = 'a1000000-0000-0000-0000-000000000002';
UPDATE public.profiles SET full_name = 'Sara Ajena' WHERE id = 'a1000000-0000-0000-0000-000000000003';
UPDATE public.profiles SET full_name = 'Pedro Pendiente' WHERE id = 'a1000000-0000-0000-0000-000000000004';
UPDATE public.profiles SET full_name = '  ', username = 'lia.viaja' WHERE id = 'a1000000-0000-0000-0000-000000000005';
UPDATE public.profiles SET full_name = 'Tomás Vega' WHERE id = 'a1000000-0000-0000-0000-000000000006';
UPDATE public.profiles SET full_name = NULL, username = NULL WHERE id = 'a1000000-0000-0000-0000-000000000007';

INSERT INTO public.trips(id, user_id, destino, fecha_salida, fecha_regreso) VALUES
  ('a2000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'Lisboa', make_date(public.wr_y(), 3, 10), make_date(public.wr_y(), 3, 15)),
  ('a2000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', 'Roma', make_date(public.wr_y(), 7, 1), make_date(public.wr_y(), 7, 9)),
  ('a2000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000001', 'Kioto', make_date(public.wr_y() - 1, 5, 1), make_date(public.wr_y() - 1, 5, 12)),
  ('a2000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-000000000001', 'Futuro', current_date + 5, current_date + 9),
  ('a2000000-0000-0000-0000-000000000005', 'a1000000-0000-0000-0000-000000000003', 'Oaxaca', make_date(public.wr_y(), 2, 1), make_date(public.wr_y(), 2, 4));
INSERT INTO public.trip_collaborators(trip_id, user_id, invited_by, status) VALUES
  ('a2000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', 'accepted'),
  ('a2000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-000000000001', 'pending'),
  ('a2000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000005', 'a1000000-0000-0000-0000-000000000001', 'accepted'),
  ('a2000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', 'accepted'),
  ('a2000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000007', 'a1000000-0000-0000-0000-000000000001', 'accepted'),
  ('a2000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', 'accepted'),
  ('a2000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', 'accepted'),
  ('a2000000-0000-0000-0000-000000000005', 'a1000000-0000-0000-0000-000000000006', 'a1000000-0000-0000-0000-000000000003', 'accepted');

-- Datos personales de Olga que el resumen lee desde el navegador (RLS por dueño).
INSERT INTO public.travel_moments(user_id, trip_id, caption, destino, image_path) VALUES
  ('a1000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', 'Atardecer en Alfama', 'Lisboa',
   'a1000000-0000-0000-0000-000000000001/a3000000-0000-0000-0000-000000000001.jpg');
INSERT INTO public.expenses(user_id, trip_id, amount, currency, category, expense_date) VALUES
  ('a1000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', 1200, 'MXN', 'Restaurantes', make_date(public.wr_y(), 3, 11));
INSERT INTO public.user_visits(user_id, trip_id, place_name, category) VALUES
  ('a1000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', 'Time Out Market', 'restaurant');
INSERT INTO public.trip_journal_entries(author_id, trip_id, text) VALUES
  ('a1000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', 'Día uno en Lisboa');

-- ───── Esquema y permisos ─────
SELECT public.wr_ok('W0 la función existe, es SECURITY DEFINER con search_path fijo y su única entrada es el año',
  EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = 'public.wrapped_companions(integer)'::regprocedure
           AND p.prosecdef AND p.proconfig @> ARRAY['search_path=public'])
  AND (SELECT count(*) FROM pg_proc WHERE proname = 'wrapped_companions' AND pronamespace = 'public'::regnamespace) = 1
  AND pg_get_function_identity_arguments('public.wrapped_companions(integer)'::regprocedure) = 'p_year integer');
SELECT public.wr_ok('W1 solo devuelve nombre y número de viajes (ni ids, ni correos, ni avatares)',
  pg_get_function_result('public.wrapped_companions(integer)'::regprocedure) = 'TABLE(name text, shared_trips integer)');
SELECT public.wr_ok('W2 anon y PUBLIC no tienen EXECUTE; authenticated sí',
  NOT has_function_privilege('anon', 'public.wrapped_companions(integer)', 'EXECUTE')
  AND NOT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a WHERE p.oid = 'public.wrapped_companions(integer)'::regprocedure AND a.grantee = 0)
  AND has_function_privilege('authenticated', 'public.wrapped_companions(integer)', 'EXECUTE'));

-- ───── Visitante sin sesión ─────
SELECT public.wr_ok('W3 anon no puede llamar la función', public.wr_anon(public.wr_q(public.wr_y())) LIKE 'ERR:permission denied%',
  public.wr_anon(public.wr_q(public.wr_y())));
SELECT public.wr_ok('W4 authenticated sin usuario (sin sub) no recibe nada',
  public.wr_as(NULL, public.wr_q(public.wr_y())) = '', public.wr_as(NULL, public.wr_q(public.wr_y())));

-- ───── Cada quien ve SOLO a sus compañeros ─────
SELECT public.wr_ok('W5 Olga: Carlos (2 viajes) y Lía por su usuario; ni Pedro (pendiente), ni el perfil sin nombre, ni gente de otros viajes',
  public.wr_as('a1000000-0000-0000-0000-000000000001', public.wr_q(public.wr_y())) = 'Carlos Ruiz:2,lia.viaja:1',
  public.wr_as('a1000000-0000-0000-0000-000000000001', public.wr_q(public.wr_y())));
SELECT public.wr_ok('W6 Carlos (colaborador): ve a la dueña y a la otra colaboradora, no a sí mismo',
  public.wr_as('a1000000-0000-0000-0000-000000000002', public.wr_q(public.wr_y())) = 'Olga Pérez:2,lia.viaja:1',
  public.wr_as('a1000000-0000-0000-0000-000000000002', public.wr_q(public.wr_y())));
SELECT public.wr_ok('W7 Lía: un viaje con cada quien',
  public.wr_as('a1000000-0000-0000-0000-000000000005', public.wr_q(public.wr_y())) = 'Carlos Ruiz:1,Olga Pérez:1',
  public.wr_as('a1000000-0000-0000-0000-000000000005', public.wr_q(public.wr_y())));
SELECT public.wr_ok('W8 Pedro (invitación pendiente) no recibe a nadie de ese viaje',
  public.wr_as('a1000000-0000-0000-0000-000000000004', public.wr_q(public.wr_y())) = '',
  public.wr_as('a1000000-0000-0000-0000-000000000004', public.wr_q(public.wr_y())));
SELECT public.wr_ok('W9 Sara (ajena) solo ve a Tomás: nada de los viajes de Olga',
  public.wr_as('a1000000-0000-0000-0000-000000000003', public.wr_q(public.wr_y())) = 'Tomás Vega:1',
  public.wr_as('a1000000-0000-0000-0000-000000000003', public.wr_q(public.wr_y())));
SELECT public.wr_ok('W10 Tomás ve a Sara y no a nadie de Olga',
  public.wr_as('a1000000-0000-0000-0000-000000000006', public.wr_q(public.wr_y())) = 'Sara Ajena:1',
  public.wr_as('a1000000-0000-0000-0000-000000000006', public.wr_q(public.wr_y())));

-- ───── Año calendario y viajes futuros ─────
SELECT public.wr_ok('W11 otro año: el viaje a Kioto cuenta solo en su año',
  public.wr_as('a1000000-0000-0000-0000-000000000001', public.wr_q(public.wr_y() - 1)) = 'Carlos Ruiz:1',
  public.wr_as('a1000000-0000-0000-0000-000000000001', public.wr_q(public.wr_y() - 1)));
SELECT public.wr_ok('W12 un viaje que aún no empieza no cuenta',
  public.wr_as('a1000000-0000-0000-0000-000000000001', public.wr_q(extract(year FROM current_date + 5)::int)) = '',
  public.wr_as('a1000000-0000-0000-0000-000000000001', public.wr_q(extract(year FROM current_date + 5)::int)));
SELECT public.wr_ok('W13 años fuera de rango o nulos: sin filas y sin error',
  public.wr_as('a1000000-0000-0000-0000-000000000001', public.wr_q(0)) = ''
  AND public.wr_as('a1000000-0000-0000-0000-000000000001', public.wr_q(99999)) = ''
  AND public.wr_as('a1000000-0000-0000-0000-000000000001', public.wr_q(NULL)) = '');

-- ───── Quien sale del viaje deja de contar ─────
DELETE FROM public.trip_collaborators WHERE trip_id = 'a2000000-0000-0000-0000-000000000002' AND user_id = 'a1000000-0000-0000-0000-000000000002';
SELECT public.wr_ok('W14 Carlos sale de Roma: Olga lo ve con 1 viaje y Carlos ya no cuenta Roma',
  public.wr_as('a1000000-0000-0000-0000-000000000001', public.wr_q(public.wr_y())) = 'Carlos Ruiz:1,lia.viaja:1'
  AND public.wr_as('a1000000-0000-0000-0000-000000000002', public.wr_q(public.wr_y())) = 'Olga Pérez:1,lia.viaja:1',
  public.wr_as('a1000000-0000-0000-0000-000000000001', public.wr_q(public.wr_y())));

-- ───── Lo demás del resumen sale de tablas con RLS por dueño: nadie lee el de otro ─────
SELECT public.wr_ok('W15 Olga lee sus momentos, gastos, lugares y diario (lo que usa su resumen)',
  public.wr_as('a1000000-0000-0000-0000-000000000001', $q$SELECT (SELECT count(*) FROM public.travel_moments)::text || '/' || (SELECT count(*) FROM public.expenses)::text || '/' || (SELECT count(*) FROM public.user_visits)::text || '/' || (SELECT count(*) FROM public.trip_journal_entries)::text$q$) = '1/1/1/1',
  public.wr_as('a1000000-0000-0000-0000-000000000001', $q$SELECT (SELECT count(*) FROM public.travel_moments)::text || '/' || (SELECT count(*) FROM public.expenses)::text || '/' || (SELECT count(*) FROM public.user_visits)::text || '/' || (SELECT count(*) FROM public.trip_journal_entries)::text$q$));
SELECT public.wr_ok('W16 Sara (ajena) no ve momentos, gastos, lugares, diario ni viajes de Olga',
  public.wr_as('a1000000-0000-0000-0000-000000000003', $q$SELECT (SELECT count(*) FROM public.travel_moments)::text || '/' || (SELECT count(*) FROM public.expenses)::text || '/' || (SELECT count(*) FROM public.user_visits)::text || '/' || (SELECT count(*) FROM public.trip_journal_entries)::text || '/' || (SELECT count(*) FROM public.trips WHERE user_id = 'a1000000-0000-0000-0000-000000000001')::text$q$) = '0/0/0/0/0',
  public.wr_as('a1000000-0000-0000-0000-000000000003', $q$SELECT (SELECT count(*) FROM public.travel_moments)::text || '/' || (SELECT count(*) FROM public.expenses)::text || '/' || (SELECT count(*) FROM public.user_visits)::text || '/' || (SELECT count(*) FROM public.trip_journal_entries)::text || '/' || (SELECT count(*) FROM public.trips WHERE user_id = 'a1000000-0000-0000-0000-000000000001')::text$q$));
SELECT public.wr_ok('W17 Lía (compañera de viaje) tampoco ve los momentos, gastos ni lugares de Olga',
  public.wr_as('a1000000-0000-0000-0000-000000000005', $q$SELECT (SELECT count(*) FROM public.travel_moments)::text || '/' || (SELECT count(*) FROM public.expenses)::text || '/' || (SELECT count(*) FROM public.user_visits)::text$q$) = '0/0/0',
  public.wr_as('a1000000-0000-0000-0000-000000000005', $q$SELECT (SELECT count(*) FROM public.travel_moments)::text || '/' || (SELECT count(*) FROM public.expenses)::text || '/' || (SELECT count(*) FROM public.user_visits)::text$q$));
SELECT public.wr_ok('W18 Pedro (pendiente) no ve el viaje compartido; Lía (aceptada) sí',
  public.wr_as('a1000000-0000-0000-0000-000000000004', $q$SELECT count(*)::text FROM public.trips WHERE id = 'a2000000-0000-0000-0000-000000000001'$q$) = '0'
  AND public.wr_as('a1000000-0000-0000-0000-000000000005', $q$SELECT count(*)::text FROM public.trips WHERE id = 'a2000000-0000-0000-0000-000000000001'$q$) = '1');
SELECT public.wr_ok('W19 anon no lee momentos, gastos, lugares ni perfiles',
  public.wr_anon($q$SELECT count(*)::text FROM public.travel_moments$q$) IN ('0') OR public.wr_anon($q$SELECT count(*)::text FROM public.travel_moments$q$) LIKE 'ERR:permission denied%',
  public.wr_anon($q$SELECT count(*)::text FROM public.travel_moments$q$));
SELECT public.wr_ok('W20 anon tampoco lee gastos ni perfiles',
  (public.wr_anon($q$SELECT count(*)::text FROM public.expenses$q$) = '0' OR public.wr_anon($q$SELECT count(*)::text FROM public.expenses$q$) LIKE 'ERR:permission denied%')
  AND (public.wr_anon($q$SELECT count(*)::text FROM public.profiles$q$) = '0' OR public.wr_anon($q$SELECT count(*)::text FROM public.profiles$q$) LIKE 'ERR:permission denied%'),
  public.wr_anon($q$SELECT count(*)::text FROM public.expenses$q$) || ' ' || public.wr_anon($q$SELECT count(*)::text FROM public.profiles$q$));
