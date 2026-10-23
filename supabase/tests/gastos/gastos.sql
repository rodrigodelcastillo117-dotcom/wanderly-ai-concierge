-- Gastos del viaje estilo Splitwise (20261027020000_gastos_split.sql). Imprime "OK …" o "FALLA …". Requiere run.sh.
-- Usuarios (ids a1…): 1 Olga (dueña) · 2 Carlos (colaborador) · 3 Sara (no es miembro; tiene su viaje)
--                     4 Pedro (invitación pendiente) · 5 Lía (colaboradora que luego sale)
-- Viajes (ids a2…): 1 Lisboa (de Olga) · 2 Roma (de Sara)
\set ON_ERROR_STOP off
\pset tuples_only on
RESET ROLE;

CREATE OR REPLACE FUNCTION public.gs_ok(_label text, _cond boolean, _detail text DEFAULT '') RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF coalesce(_cond, false) THEN RAISE NOTICE 'OK % %', _label, _detail; ELSE RAISE NOTICE 'FALLA % %', _label, _detail; END IF;
END $$;
-- Ejecuta q como el usuario (rol authenticated) y devuelve el texto o ERR:<mensaje>. Las revisiones que
-- la base hace al confirmar (partes = total) se fuerzan al final de q con SET CONSTRAINTS … IMMEDIATE,
-- como pasaría al terminar la petición de la app.
CREATE OR REPLACE FUNCTION public.gs_as(_uid uuid, _q text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', _uid::text, false), set_config('request.jwt.claim.role', 'authenticated', false);
  SET LOCAL ROLE authenticated;
  EXECUTE _q INTO v;
  SET CONSTRAINTS trg_trip_split_shares_sum, trg_trip_split_expenses_sum IMMEDIATE;
  SET CONSTRAINTS trg_trip_split_shares_sum, trg_trip_split_expenses_sum DEFERRED;
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claim.role', '', false);
  RETURN coalesce(v, '<null>');
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claim.role', '', false);
  RETURN 'ERR:' || SQLERRM;
END $$;
CREATE OR REPLACE FUNCTION public.gs_anon(_q text) RETURNS text LANGUAGE plpgsql AS $$
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
-- Id de una persona por viaje y nombre (solo para armar las pruebas).
CREATE OR REPLACE FUNCTION public.gs_p(_trip uuid, _name text) RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM public.trip_split_people WHERE trip_id = _trip AND name = _name ORDER BY created_at LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION public.gs_ok(text, boolean, text), public.gs_as(uuid, text), public.gs_anon(text), public.gs_p(uuid, text) TO authenticated, anon;

INSERT INTO auth.users(id, email) VALUES
  ('a1000000-0000-0000-0000-000000000001', 'gs-olga@example.test'),
  ('a1000000-0000-0000-0000-000000000002', 'gs-carlos@example.test'),
  ('a1000000-0000-0000-0000-000000000003', 'gs-sara@example.test'),
  ('a1000000-0000-0000-0000-000000000004', 'gs-pedro@example.test'),
  ('a1000000-0000-0000-0000-000000000005', 'gs-lia@example.test')
ON CONFLICT DO NOTHING;
INSERT INTO public.profiles(id) SELECT id FROM auth.users WHERE id::text LIKE 'a1000000-%' ON CONFLICT DO NOTHING;
UPDATE public.profiles SET full_name = 'Olga Pérez' WHERE id = 'a1000000-0000-0000-0000-000000000001';
UPDATE public.profiles SET full_name = 'Carlos Ruiz' WHERE id = 'a1000000-0000-0000-0000-000000000002';
UPDATE public.profiles SET full_name = 'Sara Intrusa' WHERE id = 'a1000000-0000-0000-0000-000000000003';
UPDATE public.profiles SET full_name = 'Pedro Pendiente' WHERE id = 'a1000000-0000-0000-0000-000000000004';
UPDATE public.profiles SET full_name = NULL, username = 'lia.viaja' WHERE id = 'a1000000-0000-0000-0000-000000000005';
INSERT INTO public.trips(id, user_id, destino) VALUES
  ('a2000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'Lisboa'),
  ('a2000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000003', 'Roma');
INSERT INTO public.trip_collaborators(trip_id, user_id, invited_by, status) VALUES
  ('a2000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', 'accepted'),
  ('a2000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-000000000001', 'pending'),
  ('a2000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000005', 'a1000000-0000-0000-0000-000000000001', 'accepted');

-- ───── Esquema ─────
SELECT public.gs_ok('GS0 RLS en las 4 tablas; anon sin ningún permiso en tablas ni RPC',
  (SELECT bool_and(relrowsecurity) FROM pg_class WHERE oid IN ('public.trip_split_people'::regclass, 'public.trip_split_expenses'::regclass,
     'public.trip_split_shares'::regclass, 'public.trip_split_payments'::regclass))
  AND NOT EXISTS (SELECT 1 FROM unnest(ARRAY['public.trip_split_people', 'public.trip_split_expenses', 'public.trip_split_shares', 'public.trip_split_payments']) t
                   WHERE has_table_privilege('anon', t, 'SELECT') OR has_table_privilege('anon', t, 'INSERT')
                      OR has_table_privilege('anon', t, 'UPDATE') OR has_table_privilege('anon', t, 'DELETE'))
  AND NOT has_function_privilege('anon', 'public.trip_split_save_expense(uuid, jsonb, jsonb, uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.trip_split_members(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.trip_split_sync_members(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.trip_split_claim_guest(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.my_split_shares(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._split_sync_trip(uuid, uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._split_equal_assign(uuid, uuid[])', 'EXECUTE'));

-- ───── Miembros reales ─────
-- (Lo que cambia una llamada se revisa en la sentencia siguiente: la misma sentencia no lo vería.)
SELECT public.gs_as('a1000000-0000-0000-0000-000000000001', $q$SELECT public.trip_split_sync_members('a2000000-0000-0000-0000-000000000001')::text$q$) AS gs1 \gset
SELECT public.gs_ok('GS1 Olga abre Gastos: cada miembro aceptado tiene su persona (no la invitación pendiente)',
  :'gs1' = '3'
  AND (SELECT string_agg(name, ',' ORDER BY name) FROM public.trip_split_people WHERE trip_id = 'a2000000-0000-0000-0000-000000000001') = 'Carlos Ruiz,Olga Pérez,lia.viaja'
  AND NOT EXISTS (SELECT 1 FROM public.trip_split_people WHERE member_id = 'a1000000-0000-0000-0000-000000000004'));
SELECT public.gs_ok('GS2 abrirlo otra vez no duplica a nadie',
  public.gs_as('a1000000-0000-0000-0000-000000000002', $q$SELECT public.trip_split_sync_members('a2000000-0000-0000-0000-000000000001')::text$q$) = '0');
SELECT public.gs_ok('GS3 Sara (no es miembro) no sincroniza, no ve personas ni miembros del viaje de Olga',
  public.gs_as('a1000000-0000-0000-0000-000000000003', $q$SELECT public.trip_split_sync_members('a2000000-0000-0000-0000-000000000001')::text$q$) LIKE 'ERR:%no_access%'
  AND public.gs_as('a1000000-0000-0000-0000-000000000003', $q$SELECT count(*)::text FROM public.trip_split_people$q$) = '0'
  AND public.gs_as('a1000000-0000-0000-0000-000000000003', $q$SELECT count(*)::text FROM public.trip_split_members('a2000000-0000-0000-0000-000000000001')$q$) = '0');
SELECT public.gs_ok('GS4 Carlos ve a los 3 miembros con su nombre y quién organiza',
  public.gs_as('a1000000-0000-0000-0000-000000000002',
    $q$SELECT string_agg(name || ':' || is_owner::text, ',' ORDER BY name) FROM public.trip_split_members('a2000000-0000-0000-0000-000000000001')$q$)
  = 'Carlos Ruiz:false,Olga Pérez:true,lia.viaja:false');
SELECT public.gs_ok('GS5 Pedro (pendiente) no ve nada todavía',
  public.gs_as('a1000000-0000-0000-0000-000000000004', $q$SELECT count(*)::text FROM public.trip_split_people$q$) = '0');
SELECT public.gs_ok('GS6 Carlos agrega a "Juan" (sin app); aunque mande member_id de Sara, queda sin app',
  public.gs_as('a1000000-0000-0000-0000-000000000002',
    $q$INSERT INTO public.trip_split_people(trip_id, name, member_id) VALUES ('a2000000-0000-0000-0000-000000000001', 'Juan', 'a1000000-0000-0000-0000-000000000003')
       RETURNING coalesce(member_id::text, 'sin app') || '|' || created_by::text$q$) = 'sin app|a1000000-0000-0000-0000-000000000002');
SELECT public.gs_ok('GS7 Sara no puede agregar personas al viaje de Olga',
  public.gs_as('a1000000-0000-0000-0000-000000000003',
    $q$INSERT INTO public.trip_split_people(trip_id, name) VALUES ('a2000000-0000-0000-0000-000000000001', 'Intrusa') RETURNING id::text$q$) LIKE 'ERR:%row-level security%');
SELECT public.gs_ok('GS8 nadie convierte a un miembro en persona sin app ni lo renombra',
  public.gs_as('a1000000-0000-0000-0000-000000000002',
    $q$WITH u AS (UPDATE public.trip_split_people SET name = 'X', member_id = NULL WHERE member_id = 'a1000000-0000-0000-0000-000000000001' RETURNING 1) SELECT count(*)::text FROM u$q$) = '0'
  AND (SELECT name FROM public.trip_split_people WHERE member_id = 'a1000000-0000-0000-0000-000000000001') = 'Olga Pérez');

-- Sara también usa su propio viaje (para intentar cruzar personas entre viajes).
SELECT public.gs_as('a1000000-0000-0000-0000-000000000003', $q$SELECT public.trip_split_sync_members('a2000000-0000-0000-0000-000000000002')::text$q$);

-- ───── Registrar gastos ─────
SELECT public.gs_as('a1000000-0000-0000-0000-000000000002', $q$SELECT public.trip_split_save_expense('a2000000-0000-0000-0000-000000000001',
      jsonb_build_object('payer_id', public.gs_p('a2000000-0000-0000-0000-000000000001', 'Carlos Ruiz'), 'amount', 300, 'currency', 'eur',
        'description', 'Cena', 'category', 'Restaurantes', 'expense_date', '2026-11-02', 'city', 'Lisboa', 'split_mode', 'equal'),
      jsonb_build_array(
        jsonb_build_object('person_id', public.gs_p('a2000000-0000-0000-0000-000000000001', 'Carlos Ruiz'), 'amount', 100),
        jsonb_build_object('person_id', public.gs_p('a2000000-0000-0000-0000-000000000001', 'Olga Pérez'), 'amount', 100),
        jsonb_build_object('person_id', public.gs_p('a2000000-0000-0000-0000-000000000001', 'Juan'), 'amount', 100)))::text$q$) AS gs9 \gset
SELECT public.gs_ok('GS9 Carlos registra una cena de €300 que pagó él, entre él, Olga y Juan: €100 cada uno',
  :'gs9' ~ '^[0-9a-f-]{36}$'
  AND (SELECT string_agg(s.amount::text, ',') FROM public.trip_split_shares s JOIN public.trip_split_expenses e ON e.id = s.expense_id WHERE e.description = 'Cena') = '100.00,100.00,100.00'
  AND (SELECT currency || '|' || created_by::text FROM public.trip_split_expenses WHERE description = 'Cena') = 'EUR|a1000000-0000-0000-0000-000000000002');
SELECT public.gs_ok('GS10 una división que NO suma el total (€100 + €100 de €300) se rechaza y no queda nada',
  public.gs_as('a1000000-0000-0000-0000-000000000002', $q$SELECT public.trip_split_save_expense('a2000000-0000-0000-0000-000000000001',
      jsonb_build_object('payer_id', public.gs_p('a2000000-0000-0000-0000-000000000001', 'Carlos Ruiz'), 'amount', 300, 'currency', 'EUR', 'description', 'Mal dividido', 'split_mode', 'exact'),
      jsonb_build_array(
        jsonb_build_object('person_id', public.gs_p('a2000000-0000-0000-0000-000000000001', 'Carlos Ruiz'), 'amount', 100),
        jsonb_build_object('person_id', public.gs_p('a2000000-0000-0000-0000-000000000001', 'Olga Pérez'), 'amount', 100)))::text$q$) LIKE 'ERR:%split_sum_mismatch%'
  AND NOT EXISTS (SELECT 1 FROM public.trip_split_expenses WHERE description = 'Mal dividido'));
SELECT public.gs_ok('GS11 una división que se pasa del total (€200 + €200 de €300) también se rechaza',
  public.gs_as('a1000000-0000-0000-0000-000000000002', $q$SELECT public.trip_split_save_expense('a2000000-0000-0000-0000-000000000001',
      jsonb_build_object('payer_id', public.gs_p('a2000000-0000-0000-0000-000000000001', 'Carlos Ruiz'), 'amount', 300, 'currency', 'EUR', 'description', 'De más', 'split_mode', 'exact'),
      jsonb_build_array(
        jsonb_build_object('person_id', public.gs_p('a2000000-0000-0000-0000-000000000001', 'Carlos Ruiz'), 'amount', 200),
        jsonb_build_object('person_id', public.gs_p('a2000000-0000-0000-0000-000000000001', 'Olga Pérez'), 'amount', 200)))::text$q$) LIKE 'ERR:%split_sum_mismatch%');
SELECT public.gs_ok('GS12 monto negativo: se rechaza',
  public.gs_as('a1000000-0000-0000-0000-000000000002', $q$SELECT public.trip_split_save_expense('a2000000-0000-0000-0000-000000000001',
      jsonb_build_object('payer_id', public.gs_p('a2000000-0000-0000-0000-000000000001', 'Carlos Ruiz'), 'amount', -50, 'currency', 'EUR', 'description', 'Negativo'),
      jsonb_build_array(jsonb_build_object('person_id', public.gs_p('a2000000-0000-0000-0000-000000000001', 'Carlos Ruiz'), 'amount', -50)))::text$q$) LIKE 'ERR:%positive%');
SELECT public.gs_ok('GS13 una parte negativa que "cuadra" el total (€400 − €100) se rechaza',
  public.gs_as('a1000000-0000-0000-0000-000000000002', $q$SELECT public.trip_split_save_expense('a2000000-0000-0000-0000-000000000001',
      jsonb_build_object('payer_id', public.gs_p('a2000000-0000-0000-0000-000000000001', 'Carlos Ruiz'), 'amount', 300, 'currency', 'EUR', 'description', 'Truco', 'split_mode', 'exact'),
      jsonb_build_array(
        jsonb_build_object('person_id', public.gs_p('a2000000-0000-0000-0000-000000000001', 'Carlos Ruiz'), 'amount', 400),
        jsonb_build_object('person_id', public.gs_p('a2000000-0000-0000-0000-000000000001', 'Olga Pérez'), 'amount', -100)))::text$q$) LIKE 'ERR:%trip_split_shares_amount_positive%');
SELECT public.gs_ok('GS14 Carlos NO puede registrar que pagó Olga (suplantar a quien pagó)',
  public.gs_as('a1000000-0000-0000-0000-000000000002', $q$SELECT public.trip_split_save_expense('a2000000-0000-0000-0000-000000000001',
      jsonb_build_object('payer_id', public.gs_p('a2000000-0000-0000-0000-000000000001', 'Olga Pérez'), 'amount', 900, 'currency', 'EUR', 'description', 'Hotel que pagó Olga'),
      jsonb_build_array(jsonb_build_object('person_id', public.gs_p('a2000000-0000-0000-0000-000000000001', 'lia.viaja'), 'amount', 900)))::text$q$) LIKE 'ERR:%split_payer_not_you%');
SELECT public.gs_ok('GS15 …ni con un INSERT directo a la tabla',
  public.gs_as('a1000000-0000-0000-0000-000000000002', $q$INSERT INTO public.trip_split_expenses(trip_id, payer_id, amount, description)
      VALUES ('a2000000-0000-0000-0000-000000000001', public.gs_p('a2000000-0000-0000-0000-000000000001', 'Olga Pérez'), 900, 'Directo') RETURNING id::text$q$) LIKE 'ERR:%split_payer_not_you%');
SELECT public.gs_ok('GS16 …ni cambiando después quién pagó en su gasto',
  public.gs_as('a1000000-0000-0000-0000-000000000002', $q$WITH u AS (UPDATE public.trip_split_expenses SET payer_id = public.gs_p('a2000000-0000-0000-0000-000000000001', 'Olga Pérez')
      WHERE description = 'Cena' RETURNING 1) SELECT count(*)::text FROM u$q$) LIKE 'ERR:%split_payer_not_you%');
SELECT public.gs_ok('GS17 sí puede registrar lo que pagó Juan (sin app) por él y Lía, en montos exactos',
  public.gs_as('a1000000-0000-0000-0000-000000000002', $q$SELECT public.trip_split_save_expense('a2000000-0000-0000-0000-000000000001',
      jsonb_build_object('payer_id', public.gs_p('a2000000-0000-0000-0000-000000000001', 'Juan'), 'amount', 75.5, 'currency', 'EUR', 'description', 'Taxi', 'split_mode', 'exact'),
      jsonb_build_array(
        jsonb_build_object('person_id', public.gs_p('a2000000-0000-0000-0000-000000000001', 'Carlos Ruiz'), 'amount', 50.25),
        jsonb_build_object('person_id', public.gs_p('a2000000-0000-0000-0000-000000000001', 'lia.viaja'), 'amount', 25.25)))::text$q$) ~ '^[0-9a-f-]{36}$');
SELECT public.gs_ok('GS18 Sara (no es miembro) no puede registrar gastos en el viaje de Olga',
  public.gs_as('a1000000-0000-0000-0000-000000000003', $q$SELECT public.trip_split_save_expense('a2000000-0000-0000-0000-000000000001',
      jsonb_build_object('payer_id', public.gs_p('a2000000-0000-0000-0000-000000000001', 'Juan'), 'amount', 10, 'currency', 'EUR', 'description', 'Intrusa'),
      jsonb_build_array(jsonb_build_object('person_id', public.gs_p('a2000000-0000-0000-0000-000000000001', 'Juan'), 'amount', 10)))::text$q$) LIKE 'ERR:%row-level security%');
SELECT public.gs_ok('GS19 Sara no puede usar en SU viaje a una persona del viaje de Olga (ni como quien pagó ni en la división)',
  public.gs_as('a1000000-0000-0000-0000-000000000003', $q$SELECT public.trip_split_save_expense('a2000000-0000-0000-0000-000000000002',
      jsonb_build_object('payer_id', public.gs_p('a2000000-0000-0000-0000-000000000001', 'Juan'), 'amount', 10, 'currency', 'EUR', 'description', 'Cruce'),
      jsonb_build_array(jsonb_build_object('person_id', public.gs_p('a2000000-0000-0000-0000-000000000002', 'Sara Intrusa'), 'amount', 10)))::text$q$) LIKE 'ERR:%split_payer_other_trip%'
  AND public.gs_as('a1000000-0000-0000-0000-000000000003', $q$SELECT public.trip_split_save_expense('a2000000-0000-0000-0000-000000000002',
      jsonb_build_object('payer_id', public.gs_p('a2000000-0000-0000-0000-000000000002', 'Sara Intrusa'), 'amount', 10, 'currency', 'EUR', 'description', 'Cruce'),
      jsonb_build_array(jsonb_build_object('person_id', public.gs_p('a2000000-0000-0000-0000-000000000001', 'Olga Pérez'), 'amount', 10)))::text$q$) LIKE 'ERR:%split_share_other_trip%');

-- ───── Cambiar las partes por fuera (API directa) ─────
SELECT public.gs_ok('GS20 subir una parte por fuera (ya no suma) se rechaza',
  public.gs_as('a1000000-0000-0000-0000-000000000002', $q$WITH u AS (UPDATE public.trip_split_shares SET amount = 1
      WHERE person_id = public.gs_p('a2000000-0000-0000-0000-000000000001', 'Olga Pérez') RETURNING 1) SELECT count(*)::text FROM u$q$) LIKE 'ERR:%split_sum_mismatch%'
  AND (SELECT amount FROM public.trip_split_shares WHERE person_id = public.gs_p('a2000000-0000-0000-0000-000000000001', 'Olga Pérez')) = 100);
SELECT public.gs_ok('GS21 borrar una parte por fuera se rechaza; borrar todas también',
  public.gs_as('a1000000-0000-0000-0000-000000000002', $q$WITH d AS (DELETE FROM public.trip_split_shares
      WHERE person_id = public.gs_p('a2000000-0000-0000-0000-000000000001', 'Olga Pérez') RETURNING 1) SELECT count(*)::text FROM d$q$) LIKE 'ERR:%split_sum_mismatch%'
  AND public.gs_as('a1000000-0000-0000-0000-000000000002', $q$WITH d AS (DELETE FROM public.trip_split_shares s USING public.trip_split_expenses e
      WHERE e.id = s.expense_id AND e.description = 'Cena' RETURNING 1) SELECT count(*)::text FROM d$q$) LIKE 'ERR:%split_sum_mismatch%');
SELECT public.gs_ok('GS22 Lía (no lo registró ni organiza) no puede cambiar ni borrar el gasto de Carlos ni sus partes',
  public.gs_as('a1000000-0000-0000-0000-000000000005', $q$WITH u AS (UPDATE public.trip_split_expenses SET amount = 1 WHERE description = 'Cena' RETURNING 1) SELECT count(*)::text FROM u$q$) = '0'
  AND public.gs_as('a1000000-0000-0000-0000-000000000005', $q$WITH d AS (DELETE FROM public.trip_split_expenses WHERE description = 'Cena' RETURNING 1) SELECT count(*)::text FROM d$q$) = '0'
  AND public.gs_as('a1000000-0000-0000-0000-000000000005', $q$WITH u AS (UPDATE public.trip_split_shares SET amount = amount RETURNING 1) SELECT count(*)::text FROM u$q$) = '0');
SELECT public.gs_as('a1000000-0000-0000-0000-000000000002', $q$SELECT public.trip_split_save_expense('a2000000-0000-0000-0000-000000000001',
      jsonb_build_object('payer_id', public.gs_p('a2000000-0000-0000-0000-000000000001', 'Carlos Ruiz'), 'amount', 330, 'currency', 'EUR', 'description', 'Cena', 'split_mode', 'percent'),
      jsonb_build_array(
        jsonb_build_object('person_id', public.gs_p('a2000000-0000-0000-0000-000000000001', 'Carlos Ruiz'), 'amount', 165, 'percent', 50),
        jsonb_build_object('person_id', public.gs_p('a2000000-0000-0000-0000-000000000001', 'Olga Pérez'), 'amount', 165, 'percent', 50)),
      (SELECT id FROM public.trip_split_expenses WHERE description = 'Cena'))::text$q$) AS gs23 \gset
SELECT public.gs_ok('GS23 Carlos corrige su gasto (ahora €330 entre él y Olga, mitad y mitad) y las partes cuadran',
  :'gs23' ~ '^[0-9a-f-]{36}$'
  AND (SELECT sum(s.amount) FROM public.trip_split_shares s JOIN public.trip_split_expenses e ON e.id = s.expense_id WHERE e.description = 'Cena') = 330);

-- ───── Liquidar (pagos entre dos personas) ─────
SELECT public.gs_ok('GS24 Olga registra que le pagó €165 a Carlos (ella es parte)',
  public.gs_as('a1000000-0000-0000-0000-000000000001', $q$INSERT INTO public.trip_split_payments(trip_id, from_person, to_person, amount, currency)
      VALUES ('a2000000-0000-0000-0000-000000000001', public.gs_p('a2000000-0000-0000-0000-000000000001', 'Olga Pérez'),
              public.gs_p('a2000000-0000-0000-0000-000000000001', 'Carlos Ruiz'), 165, 'eur') RETURNING currency || '|' || created_by::text$q$)
  = 'EUR|a1000000-0000-0000-0000-000000000001');
SELECT public.gs_ok('GS25 Lía NO puede registrar un pago entre Olga y Carlos (no es parte)',
  public.gs_as('a1000000-0000-0000-0000-000000000005', $q$INSERT INTO public.trip_split_payments(trip_id, from_person, to_person, amount, currency)
      VALUES ('a2000000-0000-0000-0000-000000000001', public.gs_p('a2000000-0000-0000-0000-000000000001', 'Olga Pérez'),
              public.gs_p('a2000000-0000-0000-0000-000000000001', 'Carlos Ruiz'), 10, 'EUR') RETURNING id::text$q$) LIKE 'ERR:%row-level security%');
SELECT public.gs_ok('GS26 …ni a nombre de Carlos poniendo created_by de él',
  public.gs_as('a1000000-0000-0000-0000-000000000005', $q$INSERT INTO public.trip_split_payments(trip_id, from_person, to_person, amount, currency, created_by)
      VALUES ('a2000000-0000-0000-0000-000000000001', public.gs_p('a2000000-0000-0000-0000-000000000001', 'Juan'),
              public.gs_p('a2000000-0000-0000-0000-000000000001', 'Carlos Ruiz'), 10, 'EUR', 'a1000000-0000-0000-0000-000000000002') RETURNING id::text$q$) LIKE 'ERR:%row-level security%');
SELECT public.gs_ok('GS27 Lía sí registra que le pagó €25.25 a Juan (sin app)',
  public.gs_as('a1000000-0000-0000-0000-000000000005', $q$INSERT INTO public.trip_split_payments(trip_id, from_person, to_person, amount, currency)
      VALUES ('a2000000-0000-0000-0000-000000000001', public.gs_p('a2000000-0000-0000-0000-000000000001', 'lia.viaja'),
              public.gs_p('a2000000-0000-0000-0000-000000000001', 'Juan'), 25.25, 'EUR') RETURNING 'ok'$q$) = 'ok');
SELECT public.gs_ok('GS28 pagos inválidos: negativo, a sí misma, a una persona de otro viaje; Sara no paga en viaje ajeno',
  public.gs_as('a1000000-0000-0000-0000-000000000001', $q$INSERT INTO public.trip_split_payments(trip_id, from_person, to_person, amount)
      VALUES ('a2000000-0000-0000-0000-000000000001', public.gs_p('a2000000-0000-0000-0000-000000000001', 'Olga Pérez'),
              public.gs_p('a2000000-0000-0000-0000-000000000001', 'Carlos Ruiz'), -5) RETURNING id::text$q$) LIKE 'ERR:%positive%'
  AND public.gs_as('a1000000-0000-0000-0000-000000000001', $q$INSERT INTO public.trip_split_payments(trip_id, from_person, to_person, amount)
      VALUES ('a2000000-0000-0000-0000-000000000001', public.gs_p('a2000000-0000-0000-0000-000000000001', 'Olga Pérez'),
              public.gs_p('a2000000-0000-0000-0000-000000000001', 'Olga Pérez'), 5) RETURNING id::text$q$) LIKE 'ERR:%'
  AND public.gs_as('a1000000-0000-0000-0000-000000000001', $q$INSERT INTO public.trip_split_payments(trip_id, from_person, to_person, amount)
      VALUES ('a2000000-0000-0000-0000-000000000001', public.gs_p('a2000000-0000-0000-0000-000000000001', 'Olga Pérez'),
              public.gs_p('a2000000-0000-0000-0000-000000000002', 'Sara Intrusa'), 5) RETURNING id::text$q$) LIKE 'ERR:%split_payment_other_trip%'
  AND public.gs_as('a1000000-0000-0000-0000-000000000003', $q$INSERT INTO public.trip_split_payments(trip_id, from_person, to_person, amount)
      VALUES ('a2000000-0000-0000-0000-000000000001', public.gs_p('a2000000-0000-0000-0000-000000000001', 'Juan'),
              public.gs_p('a2000000-0000-0000-0000-000000000001', 'Carlos Ruiz'), 5) RETURNING id::text$q$) LIKE 'ERR:%row-level security%');
SELECT public.gs_ok('GS29 un pago no se edita (solo se borra): Olga no puede cambiar el monto',
  public.gs_as('a1000000-0000-0000-0000-000000000001', $q$WITH u AS (UPDATE public.trip_split_payments SET amount = 1 RETURNING 1) SELECT count(*)::text FROM u$q$) LIKE 'ERR:%permission denied%');

-- ───── Quién ve qué ─────
SELECT public.gs_ok('GS30 Sara no ve gastos, partes ni pagos del viaje de Olga',
  public.gs_as('a1000000-0000-0000-0000-000000000003',
    $q$SELECT (SELECT count(*) FROM public.trip_split_expenses WHERE trip_id = 'a2000000-0000-0000-0000-000000000001') || '|' ||
              (SELECT count(*) FROM public.trip_split_shares WHERE trip_id = 'a2000000-0000-0000-0000-000000000001') || '|' ||
              (SELECT count(*) FROM public.trip_split_payments WHERE trip_id = 'a2000000-0000-0000-0000-000000000001')$q$) = '0|0|0');
SELECT public.gs_ok('GS31 Lía (miembro) ve todo lo compartido: 2 gastos, 4 partes, 2 pagos',
  public.gs_as('a1000000-0000-0000-0000-000000000005',
    $q$SELECT (SELECT count(*) FROM public.trip_split_expenses) || '|' || (SELECT count(*) FROM public.trip_split_shares) || '|' ||
              (SELECT count(*) FROM public.trip_split_payments)$q$) = '2|4|2');
SELECT public.gs_ok('GS32 anon no lee nada (ni tablas ni la RPC)',
  public.gs_anon($q$SELECT count(*)::text FROM public.trip_split_expenses$q$) LIKE 'ERR:%permission denied%'
  AND public.gs_anon($q$SELECT count(*)::text FROM public.trip_split_shares$q$) LIKE 'ERR:%permission denied%'
  AND public.gs_anon($q$SELECT count(*)::text FROM public.trip_split_payments$q$) LIKE 'ERR:%permission denied%'
  AND public.gs_anon($q$SELECT count(*)::text FROM public.trip_split_people$q$) LIKE 'ERR:%permission denied%'
  AND public.gs_anon($q$SELECT count(*)::text FROM public.my_split_shares()$q$) LIKE 'ERR:%permission denied%');
SELECT public.gs_ok('GS33 "mi parte" (para Gastos y el dashboard): Carlos ve €165 de la cena y €50.25 del taxi; Sara nada',
  public.gs_as('a1000000-0000-0000-0000-000000000002',
    $q$SELECT string_agg(description || ':' || amount::text || ':' || paid_by_me::text, ',' ORDER BY description) FROM public.my_split_shares('a2000000-0000-0000-0000-000000000001')$q$)
  = 'Cena:165.00:true,Taxi:50.25:false'
  AND public.gs_as('a1000000-0000-0000-0000-000000000003', $q$SELECT count(*)::text FROM public.my_split_shares('a2000000-0000-0000-0000-000000000001')$q$) = '0');

-- ───── "Soy yo" y quitar personas sin app ─────
SELECT public.gs_as('a1000000-0000-0000-0000-000000000001',
  $q$INSERT INTO public.trip_split_people(trip_id, name) VALUES ('a2000000-0000-0000-0000-000000000001', 'Lía (a mano)') RETURNING id::text$q$);
SELECT public.gs_as('a1000000-0000-0000-0000-000000000001', $q$SELECT public.trip_split_save_expense('a2000000-0000-0000-0000-000000000001',
      jsonb_build_object('payer_id', public.gs_p('a2000000-0000-0000-0000-000000000001', 'Lía (a mano)'), 'amount', 40, 'currency', 'EUR', 'description', 'Museo'),
      jsonb_build_array(
        jsonb_build_object('person_id', public.gs_p('a2000000-0000-0000-0000-000000000001', 'Lía (a mano)'), 'amount', 20),
        jsonb_build_object('person_id', public.gs_p('a2000000-0000-0000-0000-000000000001', 'lia.viaja'), 'amount', 20)))::text$q$);
SELECT public.gs_ok('GS34 Sara no puede decir "soy yo" de una persona del viaje de Olga',
  public.gs_as('a1000000-0000-0000-0000-000000000003', $q$SELECT public.trip_split_claim_guest(public.gs_p('a2000000-0000-0000-0000-000000000001', 'Lía (a mano)'))::text$q$) LIKE 'ERR:%no_access%');
SELECT public.gs_ok('GS35 nadie dice "soy yo" de un miembro',
  public.gs_as('a1000000-0000-0000-0000-000000000005', $q$SELECT public.trip_split_claim_guest(public.gs_p('a2000000-0000-0000-0000-000000000001', 'Olga Pérez'))::text$q$) LIKE 'ERR:%split_not_guest%');
SELECT public.gs_as('a1000000-0000-0000-0000-000000000005', $q$SELECT public.trip_split_claim_guest(public.gs_p('a2000000-0000-0000-0000-000000000001', 'Lía (a mano)'))::text$q$) AS gs36 \gset
SELECT public.gs_ok('GS36 Lía dice "soy yo" de "Lía (a mano)": su pago y su parte pasan a ella, sin perder nada',
  :'gs36' = public.gs_p('a2000000-0000-0000-0000-000000000001', 'lia.viaja')::text
  AND public.gs_p('a2000000-0000-0000-0000-000000000001', 'Lía (a mano)') IS NULL
  AND (SELECT p.member_id::text || '|' || s.amount::text FROM public.trip_split_expenses e JOIN public.trip_split_people p ON p.id = e.payer_id
         JOIN public.trip_split_shares s ON s.expense_id = e.id WHERE e.description = 'Museo') = 'a1000000-0000-0000-0000-000000000005|40.00');
SELECT public.gs_ok('GS37 no se puede quitar a Juan (pagó el taxi y recibió un pago)',
  public.gs_as('a1000000-0000-0000-0000-000000000002', $q$WITH d AS (DELETE FROM public.trip_split_people WHERE name = 'Juan' RETURNING 1) SELECT count(*)::text FROM d$q$) LIKE 'ERR:%split_person_has_payments%');
SELECT public.gs_as('a1000000-0000-0000-0000-000000000001',
  $q$INSERT INTO public.trip_split_people(trip_id, name) VALUES ('a2000000-0000-0000-0000-000000000001', 'Ana') RETURNING id::text$q$);
SELECT public.gs_as('a1000000-0000-0000-0000-000000000001', $q$SELECT public.trip_split_save_expense('a2000000-0000-0000-0000-000000000001',
      jsonb_build_object('payer_id', public.gs_p('a2000000-0000-0000-0000-000000000001', 'Olga Pérez'), 'amount', 10, 'currency', 'EUR', 'description', 'Café', 'split_mode', 'equal'),
      jsonb_build_array(
        jsonb_build_object('person_id', public.gs_p('a2000000-0000-0000-0000-000000000001', 'Olga Pérez'), 'amount', 3.34),
        jsonb_build_object('person_id', public.gs_p('a2000000-0000-0000-0000-000000000001', 'Ana'), 'amount', 3.33),
        jsonb_build_object('person_id', public.gs_p('a2000000-0000-0000-0000-000000000001', 'Juan'), 'amount', 3.33)))::text$q$);
SELECT public.gs_as('a1000000-0000-0000-0000-000000000001', $q$WITH d AS (DELETE FROM public.trip_split_people WHERE name = 'Ana' RETURNING 1) SELECT count(*)::text FROM d$q$) AS gs38 \gset
SELECT public.gs_ok('GS38 quitar a Ana (solo estaba en un café en partes iguales) reparte su parte entre los demás',
  :'gs38' = '1'
  AND (SELECT string_agg(s.amount::text, ',' ORDER BY s.amount DESC) FROM public.trip_split_shares s JOIN public.trip_split_expenses e ON e.id = s.expense_id WHERE e.description = 'Café') = '5.00,5.00');

-- ───── Foto del ticket (bucket privado trip-receipts) ─────
SELECT public.gs_ok('GS39 el bucket es privado, con límite de 10 MB y solo fotos o PDF',
  (SELECT NOT public AND file_size_limit = 10485760 AND 'image/jpeg' = ANY (allowed_mime_types) AND NOT ('text/html' = ANY (allowed_mime_types))
     FROM storage.buckets WHERE id = 'trip-receipts'));
SELECT public.gs_ok('GS40 Carlos sube la foto en su carpeta del viaje; no en la de Olga; Sara no sube al viaje de Olga',
  public.gs_as('a1000000-0000-0000-0000-000000000002', $q$INSERT INTO storage.objects(bucket_id, name, owner)
      VALUES ('trip-receipts', 'a2000000-0000-0000-0000-000000000001/a1000000-0000-0000-0000-000000000002/ticket-1.jpg', auth.uid()) RETURNING 'ok'$q$) = 'ok'
  AND public.gs_as('a1000000-0000-0000-0000-000000000002', $q$INSERT INTO storage.objects(bucket_id, name, owner)
      VALUES ('trip-receipts', 'a2000000-0000-0000-0000-000000000001/a1000000-0000-0000-0000-000000000001/ticket-x.jpg', auth.uid()) RETURNING 'ok'$q$) LIKE 'ERR:%row-level security%'
  AND public.gs_as('a1000000-0000-0000-0000-000000000003', $q$INSERT INTO storage.objects(bucket_id, name, owner)
      VALUES ('trip-receipts', 'a2000000-0000-0000-0000-000000000001/a1000000-0000-0000-0000-000000000003/ticket-x.jpg', auth.uid()) RETURNING 'ok'$q$) LIKE 'ERR:%row-level security%');
SELECT public.gs_ok('GS41 mientras no es de un gasto compartido, solo Carlos ve su foto',
  public.gs_as('a1000000-0000-0000-0000-000000000002', $q$SELECT count(*)::text FROM storage.objects WHERE bucket_id = 'trip-receipts'$q$) = '1'
  AND public.gs_as('a1000000-0000-0000-0000-000000000001', $q$SELECT count(*)::text FROM storage.objects WHERE bucket_id = 'trip-receipts'$q$) = '0');
SELECT public.gs_as('a1000000-0000-0000-0000-000000000002', $q$SELECT public.trip_split_save_expense('a2000000-0000-0000-0000-000000000001',
      jsonb_build_object('payer_id', public.gs_p('a2000000-0000-0000-0000-000000000001', 'Carlos Ruiz'), 'amount', 60, 'currency', 'EUR', 'description', 'Súper',
        'receipt_path', 'a2000000-0000-0000-0000-000000000001/a1000000-0000-0000-0000-000000000002/ticket-1.jpg',
        'scan', jsonb_build_object('confianza', 'alta', 'comercio', 'Pingo Doce')),
      jsonb_build_array(
        jsonb_build_object('person_id', public.gs_p('a2000000-0000-0000-0000-000000000001', 'Carlos Ruiz'), 'amount', 30),
        jsonb_build_object('person_id', public.gs_p('a2000000-0000-0000-0000-000000000001', 'Olga Pérez'), 'amount', 30)))::text$q$);
SELECT public.gs_ok('GS42 ya en un gasto compartido la ven los miembros; Sara y anon no',
  public.gs_as('a1000000-0000-0000-0000-000000000001', $q$SELECT count(*)::text FROM storage.objects WHERE bucket_id = 'trip-receipts'$q$) = '1'
  AND public.gs_as('a1000000-0000-0000-0000-000000000005', $q$SELECT count(*)::text FROM storage.objects WHERE bucket_id = 'trip-receipts'$q$) = '1'
  AND public.gs_as('a1000000-0000-0000-0000-000000000003', $q$SELECT count(*)::text FROM storage.objects WHERE bucket_id = 'trip-receipts'$q$) = '0'
  AND public.gs_anon($q$SELECT count(*)::text FROM storage.objects WHERE bucket_id = 'trip-receipts'$q$) = '0');
SELECT public.gs_ok('GS43 un gasto no apunta a una foto de otro viaje',
  public.gs_as('a1000000-0000-0000-0000-000000000003', $q$SELECT public.trip_split_save_expense('a2000000-0000-0000-0000-000000000002',
      jsonb_build_object('payer_id', public.gs_p('a2000000-0000-0000-0000-000000000002', 'Sara Intrusa'), 'amount', 5, 'currency', 'EUR', 'description', 'Robo de foto',
        'receipt_path', 'a2000000-0000-0000-0000-000000000001/a1000000-0000-0000-0000-000000000002/ticket-1.jpg'),
      jsonb_build_array(jsonb_build_object('person_id', public.gs_p('a2000000-0000-0000-0000-000000000002', 'Sara Intrusa'), 'amount', 5)))::text$q$) LIKE 'ERR:%trip_split_expenses_extras_chk%');
SELECT public.gs_as('a1000000-0000-0000-0000-000000000002', $q$WITH d AS (DELETE FROM public.trip_split_expenses WHERE description = 'Súper' RETURNING 1) SELECT count(*)::text FROM d$q$);
SELECT public.gs_ok('GS44 borrar el gasto manda su foto a la cola de purga',
  EXISTS (SELECT 1 FROM public.storage_purge_queue WHERE bucket_id = 'trip-receipts'
           AND name = 'a2000000-0000-0000-0000-000000000001/a1000000-0000-0000-0000-000000000002/ticket-1.jpg'));

-- ───── Gastos personales (siguen siendo solo míos) ─────
SELECT public.gs_ok('GS45 Olga guarda un gasto personal con ciudad; nadie más lo ve; monto negativo no',
  public.gs_as('a1000000-0000-0000-0000-000000000001', $q$INSERT INTO public.expenses(user_id, trip_id, amount, currency, category, city)
      VALUES (auth.uid(), 'a2000000-0000-0000-0000-000000000001', 12, 'EUR', 'Restaurantes', 'Lisboa') RETURNING city$q$) = 'Lisboa'
  AND public.gs_as('a1000000-0000-0000-0000-000000000002', $q$SELECT count(*)::text FROM public.expenses$q$) = '0'
  AND public.gs_as('a1000000-0000-0000-0000-000000000001', $q$INSERT INTO public.expenses(user_id, amount, currency, category)
      VALUES (auth.uid(), -3, 'EUR', 'Otros') RETURNING id::text$q$) LIKE 'ERR:%expenses_amount_positive%');

-- ───── Salir del viaje y borrar ─────
DELETE FROM public.trip_collaborators WHERE trip_id = 'a2000000-0000-0000-0000-000000000001' AND user_id = 'a1000000-0000-0000-0000-000000000005';
SELECT public.gs_ok('GS46 Lía ya fuera del viaje no ve ni registra nada; su persona y sus gastos se quedan para el grupo',
  public.gs_as('a1000000-0000-0000-0000-000000000005', $q$SELECT count(*)::text FROM public.trip_split_expenses$q$) = '0'
  AND public.gs_as('a1000000-0000-0000-0000-000000000005', $q$SELECT count(*)::text FROM public.my_split_shares()$q$) = '0'
  AND public.gs_as('a1000000-0000-0000-0000-000000000005', $q$INSERT INTO public.trip_split_people(trip_id, name) VALUES ('a2000000-0000-0000-0000-000000000001', 'x') RETURNING 'ok'$q$) LIKE 'ERR:%row-level security%'
  AND public.gs_as('a1000000-0000-0000-0000-000000000002', $q$SELECT count(*)::text FROM public.trip_split_people WHERE member_id = 'a1000000-0000-0000-0000-000000000005'$q$) = '1');
INSERT INTO storage.objects(bucket_id, name, owner) VALUES
  ('trip-receipts', 'a2000000-0000-0000-0000-000000000001/a1000000-0000-0000-0000-000000000001/ticket-2.jpg', 'a1000000-0000-0000-0000-000000000001');
DELETE FROM public.trips WHERE id = 'a2000000-0000-0000-0000-000000000001';
SELECT public.gs_ok('GS47 borrar el viaje borra todo lo compartido y manda sus fotos a la purga',
  NOT EXISTS (SELECT 1 FROM public.trip_split_people WHERE trip_id = 'a2000000-0000-0000-0000-000000000001')
  AND NOT EXISTS (SELECT 1 FROM public.trip_split_expenses WHERE trip_id = 'a2000000-0000-0000-0000-000000000001')
  AND NOT EXISTS (SELECT 1 FROM public.trip_split_shares WHERE trip_id = 'a2000000-0000-0000-0000-000000000001')
  AND NOT EXISTS (SELECT 1 FROM public.trip_split_payments WHERE trip_id = 'a2000000-0000-0000-0000-000000000001')
  AND EXISTS (SELECT 1 FROM public.storage_purge_queue WHERE bucket_id = 'trip-receipts' AND reason = 'trip_deleted'
               AND name = 'a2000000-0000-0000-0000-000000000001/a1000000-0000-0000-0000-000000000001/ticket-2.jpg'));
