-- Diario que aprende: trip_journal_entries.ai_learn_status y journal_learnings. Imprime "OK …" o
-- "FALLA …". Requiere run.sh.
-- Usuarios (d1…): 1 Ana (dueña del viaje a Roma) · 2 Beto (colaborador aceptado) · 3 Ciro (ajeno)
-- Viajes (d2…): 1 Roma (Ana) · 2 Oaxaca (Ciro)
\set ON_ERROR_STOP off
\pset tuples_only on
RESET ROLE;

CREATE OR REPLACE FUNCTION public.dj_ok(_label text, _cond boolean, _detail text DEFAULT '') RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF coalesce(_cond, false) THEN RAISE NOTICE 'OK % %', _label, _detail; ELSE RAISE NOTICE 'FALLA % %', _label, _detail; END IF;
END $$;
-- Ejecuta q como el usuario (rol authenticated) y devuelve el texto o ERR:<mensaje>.
CREATE OR REPLACE FUNCTION public.dj_as(_uid uuid, _q text) RETURNS text LANGUAGE plpgsql AS $$
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
CREATE OR REPLACE FUNCTION public.dj_anon(_q text) RETURNS text LANGUAGE plpgsql AS $$
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
-- Como la llave de servicio (rol service_role).
CREATE OR REPLACE FUNCTION public.dj_service(_q text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  SET LOCAL ROLE service_role;
  EXECUTE _q INTO v;
  RESET ROLE;
  RETURN coalesce(v, '<null>');
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  RETURN 'ERR:' || SQLERRM;
END $$;
GRANT EXECUTE ON FUNCTION public.dj_ok(text, boolean, text), public.dj_as(uuid, text), public.dj_anon(text), public.dj_service(text)
  TO authenticated, anon, service_role;

INSERT INTO auth.users(id, email) VALUES
  ('d1000000-0000-0000-0000-000000000001', 'dj-ana@example.test'),
  ('d1000000-0000-0000-0000-000000000002', 'dj-beto@example.test'),
  ('d1000000-0000-0000-0000-000000000003', 'dj-ciro@example.test')
ON CONFLICT DO NOTHING;
INSERT INTO public.profiles(id) SELECT id FROM auth.users WHERE id::text LIKE 'd1000000-%' ON CONFLICT DO NOTHING;
INSERT INTO public.trips(id, user_id, destino) VALUES
  ('d2000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001', 'Roma'),
  ('d2000000-0000-0000-0000-000000000002', 'd1000000-0000-0000-0000-000000000003', 'Oaxaca');
INSERT INTO public.trip_collaborators(trip_id, user_id, invited_by, status) VALUES
  ('d2000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000002', 'd1000000-0000-0000-0000-000000000001', 'accepted');
-- Caché del perfil de gustos ya calculada para Beto (el trigger solo actualiza filas existentes).
INSERT INTO public.user_taste_profiles(user_id, rev, computed_rev) VALUES ('d1000000-0000-0000-0000-000000000002', 3, 3);

-- ───── Estado del aprendizaje: solo el servidor lo escribe ─────
SELECT public.dj_as('d1000000-0000-0000-0000-000000000001', $q$
  WITH i AS (INSERT INTO public.trip_journal_entries(id, trip_id, author_id, text, ai_learn_status, ai_learned_at)
             VALUES ('d3000000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001',
                     'Nos encantó la cacio e pepe de Roscioli', 'done', now()) RETURNING ai_learn_status, ai_learned_at)
  SELECT ai_learn_status || ':' || coalesce(ai_learned_at::text, 'null') FROM i$q$) AS d1 \gset
SELECT public.dj_ok('D1 una entrada nueva desde la app nace pending aunque el cliente mande done', :'d1' = 'pending:null', :'d1');
SELECT public.dj_as('d1000000-0000-0000-0000-000000000002', $q$
  WITH i AS (INSERT INTO public.trip_journal_entries(id, trip_id, author_id, text)
             VALUES ('d3000000-0000-0000-0000-000000000002', 'd2000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000002',
                     'No me gustaron las filas del Vaticano') RETURNING 1)
  SELECT count(*) FROM i$q$) AS d1b \gset
SELECT public.dj_as('d1000000-0000-0000-0000-000000000001', $q$
  WITH u AS (UPDATE public.trip_journal_entries SET ai_learn_status = 'done' WHERE id = 'd3000000-0000-0000-0000-000000000001' RETURNING ai_learn_status)
  SELECT string_agg(ai_learn_status, ',') FROM u$q$) AS d2 \gset
SELECT public.dj_ok('D2 el autor no puede marcar su entrada como aprendida', :'d2' = 'pending' AND :'d1b' = '1', :'d2');
UPDATE public.trip_journal_entries SET ai_learn_status = 'done', ai_learned_at = now() WHERE id = 'd3000000-0000-0000-0000-000000000001';
SELECT public.dj_as('d1000000-0000-0000-0000-000000000001', $q$
  WITH u AS (UPDATE public.trip_journal_entries SET photo_path = NULL WHERE id = 'd3000000-0000-0000-0000-000000000001' RETURNING ai_learn_status)
  SELECT string_agg(ai_learn_status, ',') FROM u$q$) AS d3a \gset
SELECT public.dj_as('d1000000-0000-0000-0000-000000000001', $q$
  WITH u AS (UPDATE public.trip_journal_entries SET text = 'Nos encantó la cacio e pepe de Roscioli. Volvería.' WHERE id = 'd3000000-0000-0000-0000-000000000001' RETURNING ai_learn_status || ':' || coalesce(ai_learned_at::text, 'null') AS s)
  SELECT string_agg(s, ',') FROM u$q$) AS d3b \gset
SELECT public.dj_ok('D3 sin cambiar el texto el estado se conserva; al editar el texto vuelve a pending', :'d3a' = 'done' AND :'d3b' = 'pending:null', :'d3a' || ' / ' || :'d3b');
SELECT public.dj_service($q$WITH u AS (UPDATE public.trip_journal_entries SET ai_learn_status = 'done' WHERE id = 'd3000000-0000-0000-0000-000000000001' RETURNING ai_learn_status) SELECT string_agg(ai_learn_status, ',') FROM u$q$) AS d4 \gset
SELECT public.dj_ok('D4 la llave de servicio sí escribe el estado (y un valor fuera de la lista se rechaza)',
  (SELECT ai_learn_status FROM public.trip_journal_entries WHERE id = 'd3000000-0000-0000-0000-000000000001') = 'done'
  AND public.dj_service($q$WITH u AS (UPDATE public.trip_journal_entries SET ai_learn_status = 'inventado' WHERE id = 'd3000000-0000-0000-0000-000000000001' RETURNING 1) SELECT count(*) FROM u$q$) LIKE 'ERR:%violates check%',
  :'d4');

-- ───── journal_learnings: la crea solo el servidor ─────
SELECT public.dj_ok('D5 RLS activa y sin acceso para anon ni PUBLIC; authenticated solo SELECT, DELETE y UPDATE(texto)',
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.journal_learnings'::regclass)
  AND NOT has_table_privilege('anon', 'public.journal_learnings', 'SELECT')
  AND NOT has_any_column_privilege('anon', 'public.journal_learnings', 'SELECT,INSERT,UPDATE')
  AND has_table_privilege('authenticated', 'public.journal_learnings', 'SELECT')
  AND has_table_privilege('authenticated', 'public.journal_learnings', 'DELETE')
  AND NOT has_table_privilege('authenticated', 'public.journal_learnings', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.journal_learnings', 'UPDATE')
  AND has_column_privilege('authenticated', 'public.journal_learnings', 'texto', 'UPDATE')
  AND NOT has_column_privilege('authenticated', 'public.journal_learnings', 'user_id', 'UPDATE')
  AND NOT has_column_privilege('authenticated', 'public.journal_learnings', 'sentimiento', 'UPDATE'));
SELECT public.dj_as('d1000000-0000-0000-0000-000000000001', $q$
  WITH i AS (INSERT INTO public.journal_learnings(user_id, entry_id, trip_id, categoria, sentimiento, texto, cita)
             VALUES ('d1000000-0000-0000-0000-000000000001', 'd3000000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000001',
                     'comida', 'positivo', 'Te encanta todo', 'inventado') RETURNING 1)
  SELECT count(*) FROM i$q$) AS d6 \gset
SELECT public.dj_ok('D6 la app no puede crear "aprendizajes" (solo el servidor, con la cita de la entrada)', :'d6' LIKE 'ERR:permission denied%', :'d6');

SELECT public.dj_service($q$
  WITH i AS (INSERT INTO public.journal_learnings(id, user_id, entry_id, trip_id, categoria, sentimiento, texto, lugar, ciudad, cita) VALUES
    ('d4000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001', 'd3000000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000001',
     'comida', 'positivo', '  Te encantó la cacio e pepe   de Roscioli ', 'Roscioli', 'Roma', 'Nos encantó la cacio e pepe de Roscioli'),
    ('d4000000-0000-0000-0000-000000000002', 'd1000000-0000-0000-0000-000000000001', 'd3000000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000001',
     'comida', 'positivo', 'Volverías a Roscioli', 'Roscioli', 'Roma', 'Volvería'),
    ('d4000000-0000-0000-0000-000000000003', 'd1000000-0000-0000-0000-000000000002', 'd3000000-0000-0000-0000-000000000002', 'd2000000-0000-0000-0000-000000000001',
     'lugar', 'negativo', 'No te gustaron las filas del Vaticano', 'Vaticano', 'Roma', 'No me gustaron las filas del Vaticano')
    RETURNING 1)
  SELECT count(*) FROM i$q$) AS d7 \gset
SELECT public.dj_ok('D7 la llave de servicio guarda lo aprendido, con el texto limpio',
  :'d7' = '3' AND (SELECT texto FROM public.journal_learnings WHERE id = 'd4000000-0000-0000-0000-000000000001') = 'Te encantó la cacio e pepe de Roscioli', :'d7');
SELECT public.dj_ok('D8 subir lo aprendido de Beto marca su perfil de gustos para recalcular (rev 3 → 4)',
  (SELECT rev FROM public.user_taste_profiles WHERE user_id = 'd1000000-0000-0000-0000-000000000002') = 4,
  (SELECT rev::text FROM public.user_taste_profiles WHERE user_id = 'd1000000-0000-0000-0000-000000000002'));
SELECT public.dj_ok('D9 un sentimiento o categoría fuera de la lista se rechaza',
  public.dj_service($q$WITH i AS (INSERT INTO public.journal_learnings(user_id, entry_id, trip_id, categoria, sentimiento, texto, cita)
    VALUES ('d1000000-0000-0000-0000-000000000001', 'd3000000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000001', 'comida', 'neutral', 'algo', 'cita') RETURNING 1) SELECT count(*) FROM i$q$) LIKE 'ERR:%check%'
  AND public.dj_service($q$WITH i AS (INSERT INTO public.journal_learnings(user_id, entry_id, trip_id, categoria, sentimiento, texto, cita)
    VALUES ('d1000000-0000-0000-0000-000000000001', 'd3000000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000001', 'chisme', 'positivo', 'algo', 'cita') RETURNING 1) SELECT count(*) FROM i$q$) LIKE 'ERR:%check%');

-- ───── Cada quien ve SOLO lo suyo (también en el viaje compartido) ─────
SELECT public.dj_ok('D10 Ana (dueña) ve sus 2 puntos y NO el de su colaborador, aunque es de su viaje',
  public.dj_as('d1000000-0000-0000-0000-000000000001', $q$SELECT string_agg(texto, '|' ORDER BY texto) FROM public.journal_learnings WHERE trip_id = 'd2000000-0000-0000-0000-000000000001'$q$)
    = 'Te encantó la cacio e pepe de Roscioli|Volverías a Roscioli');
SELECT public.dj_ok('D11 Beto (colaborador) ve solo lo suyo: lo que escribió alimenta SU perfil',
  public.dj_as('d1000000-0000-0000-0000-000000000002', $q$SELECT string_agg(user_id::text || ':' || texto, '|') FROM public.journal_learnings$q$)
    = 'd1000000-0000-0000-0000-000000000002:No te gustaron las filas del Vaticano');
SELECT public.dj_ok('D12 Ciro (ajeno) no ve nada',
  public.dj_as('d1000000-0000-0000-0000-000000000003', $q$SELECT count(*)::text FROM public.journal_learnings$q$) = '0');
SELECT public.dj_ok('D13 anon no puede leer', public.dj_anon($q$SELECT count(*)::text FROM public.journal_learnings$q$) LIKE 'ERR:permission denied%');
SELECT public.dj_ok('D14 anon no puede borrar ni corregir',
  public.dj_anon($q$WITH d AS (DELETE FROM public.journal_learnings RETURNING 1) SELECT count(*) FROM d$q$) LIKE 'ERR:permission denied%'
  AND public.dj_anon($q$WITH u AS (UPDATE public.journal_learnings SET texto = 'x' RETURNING 1) SELECT count(*) FROM u$q$) LIKE 'ERR:permission denied%');
SELECT public.dj_ok('D15 sin sesión (authenticated sin sub) no ve nada',
  public.dj_as(NULL, $q$SELECT count(*)::text FROM public.journal_learnings$q$) = '0');

-- ───── Corregir y borrar: solo lo propio ─────
SELECT public.dj_ok('D16 Ana no puede borrar lo de Beto (0 filas) y sigue ahí',
  public.dj_as('d1000000-0000-0000-0000-000000000001', $q$WITH d AS (DELETE FROM public.journal_learnings WHERE id = 'd4000000-0000-0000-0000-000000000003' RETURNING 1) SELECT count(*) FROM d$q$) = '0'
  AND EXISTS (SELECT 1 FROM public.journal_learnings WHERE id = 'd4000000-0000-0000-0000-000000000003'));
SELECT public.dj_ok('D17 Ana no puede corregir lo de Beto (0 filas)',
  public.dj_as('d1000000-0000-0000-0000-000000000001', $q$WITH u AS (UPDATE public.journal_learnings SET texto = 'Hackeado' WHERE id = 'd4000000-0000-0000-0000-000000000003' RETURNING 1) SELECT count(*) FROM u$q$) = '0'
  AND (SELECT texto FROM public.journal_learnings WHERE id = 'd4000000-0000-0000-0000-000000000003') = 'No te gustaron las filas del Vaticano');
SELECT public.dj_as('d1000000-0000-0000-0000-000000000001', $q$WITH u AS (UPDATE public.journal_learnings SET texto = '  Te encantó la cacio e pepe  ' WHERE id = 'd4000000-0000-0000-0000-000000000001' RETURNING texto, edited_at IS NOT NULL AS ed) SELECT texto || ':' || ed FROM u$q$) AS d18 \gset
SELECT public.dj_ok('D18 Ana corrige el texto de lo suyo (limpio y marcado como editado)', :'d18' = 'Te encantó la cacio e pepe:true', :'d18');
SELECT public.dj_ok('D19 pero no puede cambiar el dueño, el sentimiento ni la cita',
  public.dj_as('d1000000-0000-0000-0000-000000000001', $q$WITH u AS (UPDATE public.journal_learnings SET user_id = 'd1000000-0000-0000-0000-000000000003' WHERE id = 'd4000000-0000-0000-0000-000000000001' RETURNING 1) SELECT count(*) FROM u$q$) LIKE 'ERR:permission denied%'
  AND public.dj_as('d1000000-0000-0000-0000-000000000001', $q$WITH u AS (UPDATE public.journal_learnings SET sentimiento = 'negativo' WHERE id = 'd4000000-0000-0000-0000-000000000001' RETURNING 1) SELECT count(*) FROM u$q$) LIKE 'ERR:permission denied%'
  AND public.dj_as('d1000000-0000-0000-0000-000000000001', $q$WITH u AS (UPDATE public.journal_learnings SET cita = 'otra' WHERE id = 'd4000000-0000-0000-0000-000000000001' RETURNING 1) SELECT count(*) FROM u$q$) LIKE 'ERR:permission denied%');
SELECT public.dj_ok('D20 un texto vacío no se acepta',
  public.dj_as('d1000000-0000-0000-0000-000000000001', $q$WITH u AS (UPDATE public.journal_learnings SET texto = '   ' WHERE id = 'd4000000-0000-0000-0000-000000000001' RETURNING 1) SELECT count(*) FROM u$q$) LIKE 'ERR:%check%');
UPDATE public.user_taste_profiles SET rev = 10 WHERE user_id = 'd1000000-0000-0000-0000-000000000002';
SELECT public.dj_as('d1000000-0000-0000-0000-000000000002', $q$WITH d AS (DELETE FROM public.journal_learnings WHERE id = 'd4000000-0000-0000-0000-000000000003' RETURNING 1) SELECT count(*) FROM d$q$) AS d21 \gset
SELECT public.dj_ok('D21 Beto borra un punto suyo: desaparece y su perfil de gustos se recalcula (rev 10 → 11)',
  :'d21' = '1'
  AND NOT EXISTS (SELECT 1 FROM public.journal_learnings WHERE id = 'd4000000-0000-0000-0000-000000000003')
  AND (SELECT rev FROM public.user_taste_profiles WHERE user_id = 'd1000000-0000-0000-0000-000000000002') = 11, :'d21');

-- ───── Se borra con la entrada, con el viaje y con la cuenta ─────
SELECT public.dj_as('d1000000-0000-0000-0000-000000000001', $q$WITH d AS (DELETE FROM public.trip_journal_entries WHERE id = 'd3000000-0000-0000-0000-000000000001' RETURNING 1) SELECT count(*) FROM d$q$) AS d22 \gset
SELECT public.dj_ok('D22 borrar la entrada borra lo aprendido de ella',
  :'d22' = '1' AND NOT EXISTS (SELECT 1 FROM public.journal_learnings WHERE entry_id = 'd3000000-0000-0000-0000-000000000001'), :'d22');
INSERT INTO public.trip_journal_entries(id, trip_id, author_id, text) VALUES
  ('d3000000-0000-0000-0000-000000000003', 'd2000000-0000-0000-0000-000000000002', 'd1000000-0000-0000-0000-000000000003', 'Amé el mole negro');
INSERT INTO public.journal_learnings(user_id, entry_id, trip_id, categoria, sentimiento, texto, cita) VALUES
  ('d1000000-0000-0000-0000-000000000003', 'd3000000-0000-0000-0000-000000000003', 'd2000000-0000-0000-0000-000000000002', 'comida', 'positivo', 'Te encantó el mole negro', 'Amé el mole negro');
SELECT public.dj_as('d1000000-0000-0000-0000-000000000003', $q$WITH d AS (DELETE FROM public.trips WHERE id = 'd2000000-0000-0000-0000-000000000002' RETURNING 1) SELECT count(*) FROM d$q$) AS d23 \gset
SELECT public.dj_ok('D23 borrar el viaje borra entradas y lo aprendido',
  :'d23' = '1' AND NOT EXISTS (SELECT 1 FROM public.journal_learnings WHERE trip_id = 'd2000000-0000-0000-0000-000000000002')
  AND NOT EXISTS (SELECT 1 FROM public.trip_journal_entries WHERE trip_id = 'd2000000-0000-0000-0000-000000000002'), :'d23');
INSERT INTO public.trip_journal_entries(id, trip_id, author_id, text) VALUES
  ('d3000000-0000-0000-0000-000000000004', 'd2000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000002', 'Prefiero caminar de noche');
INSERT INTO public.journal_learnings(user_id, entry_id, trip_id, categoria, sentimiento, texto, cita) VALUES
  ('d1000000-0000-0000-0000-000000000002', 'd3000000-0000-0000-0000-000000000004', 'd2000000-0000-0000-0000-000000000001', 'ritmo', 'positivo', 'Prefieres caminar de noche', 'Prefiero caminar de noche');
SELECT public.purge_account_data('d1000000-0000-0000-0000-000000000002');
SELECT public.dj_ok('D24 borrar la cuenta de Beto (purge_account_data) borra todo lo aprendido de él',
  NOT EXISTS (SELECT 1 FROM public.journal_learnings WHERE user_id = 'd1000000-0000-0000-0000-000000000002'));
SELECT public.dj_ok('D25 las funciones de los triggers no se pueden llamar desde la app',
  NOT has_function_privilege('authenticated', 'public.trip_journal_learn_guard()', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.journal_learnings_guard()', 'EXECUTE')
  AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'taste_bump_journal_learnings' AND tgrelid = 'public.journal_learnings'::regclass));
SELECT public.dj_ok('D26 las entradas anteriores a la migración no quedan pendientes de aprender (NULL) y las nuevas sí (pending por omisión)',
  (SELECT column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'trip_journal_entries' AND column_name = 'ai_learn_status') LIKE '''pending''%'
  AND (SELECT is_nullable FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'trip_journal_entries' AND column_name = 'ai_learn_status') = 'YES');

RESET ROLE;
DROP FUNCTION IF EXISTS public.dj_ok(text, boolean, text), public.dj_as(uuid, text), public.dj_anon(text), public.dj_service(text);
