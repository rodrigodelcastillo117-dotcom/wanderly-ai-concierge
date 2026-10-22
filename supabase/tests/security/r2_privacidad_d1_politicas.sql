-- D1 (INFORME_produccion.md): producción tiene políticas *_own creadas fuera de git que, por ser
-- PERMISIVAS (se combinan con OR), anulan la verificación de acceso al viaje de
-- 20261022141600_sec2_trip_id_checks.sql en expenses y user_visits. Aquí se recrean como están en
-- producción, se demuestra el ataque, se aplica la migración y se demuestra que ya no pasa.
-- Imprime "OK …" o "FALLA …". Lo corre security/run.sh. Ids propios: 7b7b….
\set ON_ERROR_STOP off
\pset tuples_only on
RESET ROLE;

CREATE OR REPLACE FUNCTION public.t1_ok(_label text, _cond boolean, _detail text DEFAULT '') RETURNS text LANGUAGE sql AS $$
  SELECT CASE WHEN coalesce(_cond, false) THEN 'OK ' ELSE 'FALLA ' END || _label || CASE WHEN _detail <> '' THEN ' [' || _detail || ']' ELSE '' END;
$$;
CREATE OR REPLACE FUNCTION public.t1_as(_uid uuid, _q text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', _uid::text, false), set_config('request.jwt.claim.role', 'authenticated', false);
  SET LOCAL ROLE authenticated;
  EXECUTE _q INTO v;
  RESET ROLE;
  RETURN coalesce(v, '<null>');
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  RETURN 'ERR:' || SQLERRM;
END $$;
GRANT EXECUTE ON FUNCTION public.t1_ok(text, boolean, text), public.t1_as(uuid, text) TO authenticated;

-- 1 Ana (dueña del viaje) · 2 Beto (extraño)
INSERT INTO auth.users(id, email) VALUES
  ('7b7b0000-0000-0000-0000-000000000001', 't1-ana@example.test'),
  ('7b7b0000-0000-0000-0000-000000000002', 't1-beto@example.test')
ON CONFLICT DO NOTHING;
INSERT INTO public.trips(id, user_id, destino) VALUES
  ('7b7b1000-0000-0000-0000-000000000001', '7b7b0000-0000-0000-0000-000000000001', 'Viaje de Ana'),
  ('7b7b1000-0000-0000-0000-000000000002', '7b7b0000-0000-0000-0000-000000000002', 'Viaje de Beto')
ON CONFLICT DO NOTHING;

-- Deriva de producción: las cuatro *_own que aflojan la regla (solo piden auth.uid() = user_id).
DROP POLICY IF EXISTS expenses_insert_own ON public.expenses;
CREATE POLICY expenses_insert_own ON public.expenses FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS expenses_update_own ON public.expenses;
CREATE POLICY expenses_update_own ON public.expenses FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS user_visits_insert_own ON public.user_visits;
CREATE POLICY user_visits_insert_own ON public.user_visits FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS user_visits_update_own ON public.user_visits;
CREATE POLICY user_visits_update_own ON public.user_visits FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
-- Una *_own equivalente (no afloja nada): debe quedarse.
DROP POLICY IF EXISTS expenses_select_own ON public.expenses;
CREATE POLICY expenses_select_own ON public.expenses FOR SELECT TO authenticated USING (auth.uid() = user_id);

SELECT public.t1_ok('D1-0 (antes) con la deriva, Beto registra un gasto en el viaje de Ana',
  public.t1_as('7b7b0000-0000-0000-0000-000000000002', $q$WITH i AS (INSERT INTO public.expenses (user_id, trip_id, amount, category) VALUES ('7b7b0000-0000-0000-0000-000000000002', '7b7b1000-0000-0000-0000-000000000001', 100, 'comida') RETURNING 1) SELECT count(*)::text FROM i$q$) = '1');
SELECT public.t1_ok('D1-0b (antes) con la deriva, Beto registra una visita en el viaje de Ana',
  public.t1_as('7b7b0000-0000-0000-0000-000000000002', $q$WITH i AS (INSERT INTO public.user_visits (user_id, trip_id, place_name) VALUES ('7b7b0000-0000-0000-0000-000000000002', '7b7b1000-0000-0000-0000-000000000001', 'Museo') RETURNING 1) SELECT count(*)::text FROM i$q$) = '1');
RESET ROLE;
DELETE FROM public.expenses WHERE user_id = '7b7b0000-0000-0000-0000-000000000002';
DELETE FROM public.user_visits WHERE user_id = '7b7b0000-0000-0000-0000-000000000002';

\ir ../../migrations/20261026050000_r2_privacidad_d1_politicas_produccion.sql
RESET ROLE;

SELECT public.t1_ok('D1-1 ya no existen las cuatro *_own que aflojaban la regla',
  NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
               AND policyname IN ('expenses_insert_own', 'expenses_update_own', 'user_visits_insert_own', 'user_visits_update_own')));
SELECT public.t1_ok('D1-1b la *_own equivalente (expenses_select_own) no se toca',
  EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND policyname = 'expenses_select_own'));
SELECT public.t1_ok('D1-2 Beto NO registra un gasto en el viaje de Ana',
  public.t1_as('7b7b0000-0000-0000-0000-000000000002', $q$WITH i AS (INSERT INTO public.expenses (user_id, trip_id, amount, category) VALUES ('7b7b0000-0000-0000-0000-000000000002', '7b7b1000-0000-0000-0000-000000000001', 100, 'comida') RETURNING 1) SELECT count(*)::text FROM i$q$) LIKE 'ERR:%row-level security%');
SELECT public.t1_ok('D1-3 Beto NO registra una visita en el viaje de Ana',
  public.t1_as('7b7b0000-0000-0000-0000-000000000002', $q$WITH i AS (INSERT INTO public.user_visits (user_id, trip_id, place_name) VALUES ('7b7b0000-0000-0000-0000-000000000002', '7b7b1000-0000-0000-0000-000000000001', 'Museo') RETURNING 1) SELECT count(*)::text FROM i$q$) LIKE 'ERR:%row-level security%');
-- Mover a un viaje ajeno un gasto/visita propios (UPDATE) tampoco.
INSERT INTO public.expenses (id, user_id, trip_id, amount, category) VALUES ('7b7b2000-0000-0000-0000-000000000001', '7b7b0000-0000-0000-0000-000000000002', '7b7b1000-0000-0000-0000-000000000002', 50, 'taxi');
INSERT INTO public.user_visits (id, user_id, trip_id, place_name) VALUES ('7b7b3000-0000-0000-0000-000000000001', '7b7b0000-0000-0000-0000-000000000002', '7b7b1000-0000-0000-0000-000000000002', 'Plaza');
SELECT public.t1_ok('D1-4 Beto NO mueve su gasto al viaje de Ana',
  public.t1_as('7b7b0000-0000-0000-0000-000000000002', $q$WITH u AS (UPDATE public.expenses SET trip_id = '7b7b1000-0000-0000-0000-000000000001' WHERE id = '7b7b2000-0000-0000-0000-000000000001' RETURNING 1) SELECT count(*)::text FROM u$q$) LIKE 'ERR:%row-level security%');
SELECT public.t1_ok('D1-5 Beto NO mueve su visita al viaje de Ana',
  public.t1_as('7b7b0000-0000-0000-0000-000000000002', $q$WITH u AS (UPDATE public.user_visits SET trip_id = '7b7b1000-0000-0000-0000-000000000001' WHERE id = '7b7b3000-0000-0000-0000-000000000001' RETURNING 1) SELECT count(*)::text FROM u$q$) LIKE 'ERR:%row-level security%');
SELECT public.t1_ok('D1-6 en su propio viaje y sin viaje sí registra gastos y visitas',
  public.t1_as('7b7b0000-0000-0000-0000-000000000002', $q$WITH i AS (INSERT INTO public.expenses (user_id, trip_id, amount, category) VALUES ('7b7b0000-0000-0000-0000-000000000002', '7b7b1000-0000-0000-0000-000000000002', 10, 'comida'), ('7b7b0000-0000-0000-0000-000000000002', NULL, 10, 'comida') RETURNING 1) SELECT count(*)::text FROM i$q$) = '2'
  AND public.t1_as('7b7b0000-0000-0000-0000-000000000002', $q$WITH i AS (INSERT INTO public.user_visits (user_id, trip_id, place_name) VALUES ('7b7b0000-0000-0000-0000-000000000002', '7b7b1000-0000-0000-0000-000000000002', 'Café'), ('7b7b0000-0000-0000-0000-000000000002', NULL, 'Parque') RETURNING 1) SELECT count(*)::text FROM i$q$) = '2');

RESET ROLE;
DROP POLICY IF EXISTS expenses_select_own ON public.expenses;  -- solo existía para esta prueba
DROP FUNCTION public.t1_ok(text, boolean, text);
DROP FUNCTION public.t1_as(uuid, text);
