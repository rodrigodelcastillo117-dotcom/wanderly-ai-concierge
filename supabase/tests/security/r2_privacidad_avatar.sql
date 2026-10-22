-- T-P2-5 y N-L1 (segunda auditoría): profiles.avatar_url solo la escribe el servidor; al registrarse
-- no se copia del metadato (que controla quien se registra); las URL ajenas ya guardadas se limpian.
-- Imprime "OK …" o "FALLA …". Lo corre security/run.sh. Ids propios: 7a7a….
\set ON_ERROR_STOP off
\pset tuples_only on
RESET ROLE;

CREATE OR REPLACE FUNCTION public.ta_ok(_label text, _cond boolean, _detail text DEFAULT '') RETURNS text LANGUAGE sql AS $$
  SELECT CASE WHEN coalesce(_cond, false) THEN 'OK ' ELSE 'FALLA ' END || _label || CASE WHEN _detail <> '' THEN ' [' || _detail || ']' ELSE '' END;
$$;
CREATE OR REPLACE FUNCTION public.ta_as(_uid uuid, _role text, _q text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', coalesce(_uid::text, ''), false), set_config('request.jwt.claim.role', _role, false);
  EXECUTE format('SET LOCAL ROLE %I', _role);
  EXECUTE _q INTO v;
  RESET ROLE;
  RETURN coalesce(v, '<null>');
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  RETURN 'ERR:' || SQLERRM;
END $$;
GRANT EXECUTE ON FUNCTION public.ta_ok(text, boolean, text), public.ta_as(uuid, text, text) TO authenticated, service_role;

-- Versión de producción de handle_new_user (D2 de INFORME_produccion.md: copia avatar_url del metadato).
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, avatar_url)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', ''),
          NEW.raw_user_meta_data->>'avatar_url')
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END $$;
INSERT INTO auth.users(id, email, raw_user_meta_data) VALUES
  ('7a7a0000-0000-0000-0000-000000000001', 'ta-planta@example.test', '{"name":"Planta","avatar_url":"https://rastreador.example/p.gif"}'),
  ('7a7a0000-0000-0000-0000-000000000002', 'ta-legit@example.test', '{"full_name":"Legit"}');
UPDATE public.profiles SET avatar_url = 'https://uhkdewinscffhdonhhmt.supabase.co/storage/v1/object/public/travel-moments/avatars/7a7a0000-0000-0000-0000-000000000002/v1.png'
 WHERE id = '7a7a0000-0000-0000-0000-000000000002';
SELECT public.ta_ok('AVP0 (antes) la versión de producción copió el avatar plantado al registrarse',
  (SELECT avatar_url FROM public.profiles WHERE id = '7a7a0000-0000-0000-0000-000000000001') = 'https://rastreador.example/p.gif');

\ir ../../migrations/20261026140000_r2_privacidad_avatar.sql
RESET ROLE;

SELECT public.ta_ok('AVP1 la migración limpia la URL ajena ya guardada',
  (SELECT avatar_url FROM public.profiles WHERE id = '7a7a0000-0000-0000-0000-000000000001') IS NULL);
SELECT public.ta_ok('AVP1b y conserva el avatar real (nuestro storage, carpeta de la persona)',
  (SELECT avatar_url FROM public.profiles WHERE id = '7a7a0000-0000-0000-0000-000000000002') LIKE 'https://uhkdewinscffhdonhhmt.supabase.co/%/avatars/7a7a0000-0000-0000-0000-000000000002/v1.png');

-- Registro nuevo con metadato de avatar: no se copia; el nombre sale de full_name o de name.
INSERT INTO auth.users(id, email, raw_user_meta_data) VALUES
  ('7a7a0000-0000-0000-0000-000000000003', 'ta-nuevo@example.test', '{"name":"Nuevo Nombre","avatar_url":"https://rastreador.example/q.gif"}');
SELECT public.ta_ok('AVP2 handle_new_user ya no copia avatar_url del metadato',
  (SELECT avatar_url IS NULL AND full_name = 'Nuevo Nombre' AND email = 'ta-nuevo@example.test' FROM public.profiles WHERE id = '7a7a0000-0000-0000-0000-000000000003'));
INSERT INTO auth.users(id, email, raw_user_meta_data) VALUES ('7a7a0000-0000-0000-0000-000000000004', 'ta-full@example.test', '{"full_name":"Full","name":"Otro"}');
SELECT public.ta_ok('AVP2b full_name tiene prioridad sobre name',
  (SELECT full_name FROM public.profiles WHERE id = '7a7a0000-0000-0000-0000-000000000004') = 'Full');
-- ON CONFLICT DO NOTHING: si el perfil ya existe (alta repetida), no falla.
-- (sin disparar la cascada de la llave foránea: el perfil se queda y el alta se repite)
SET session_replication_role = replica;
DELETE FROM auth.users WHERE id = '7a7a0000-0000-0000-0000-000000000004';
SET session_replication_role = origin;
INSERT INTO auth.users(id, email, raw_user_meta_data) VALUES ('7a7a0000-0000-0000-0000-000000000004', 'ta-full2@example.test', '{"full_name":"Otra vez"}');
SELECT public.ta_ok('AVP2c alta con perfil ya existente: no falla y no lo pisa',
  (SELECT full_name FROM public.profiles WHERE id = '7a7a0000-0000-0000-0000-000000000004') = 'Full');

-- N-L1: el cliente no puede escribir avatar_url (ni para sí mismo); el servidor sí.
SELECT public.ta_ok('AVP3 authenticated NO puede poner un rastreador como su avatar',
  public.ta_as('7a7a0000-0000-0000-0000-000000000002', 'authenticated',
    $q$WITH u AS (UPDATE public.profiles SET avatar_url = 'https://rastreador.example/p.gif' WHERE id = auth.uid() RETURNING 1) SELECT count(*)::text FROM u$q$) LIKE 'ERR:%no se puede cambiar%');
SELECT public.ta_ok('AVP3b ni borrarlo directo (se borra con la acción "eliminar" del servidor)',
  public.ta_as('7a7a0000-0000-0000-0000-000000000002', 'authenticated',
    $q$WITH u AS (UPDATE public.profiles SET avatar_url = NULL WHERE id = auth.uid() RETURNING 1) SELECT count(*)::text FROM u$q$) LIKE 'ERR:%');
SELECT public.ta_ok('AVP3c lo demás del perfil sí se edita desde la app',
  public.ta_as('7a7a0000-0000-0000-0000-000000000002', 'authenticated',
    $q$WITH u AS (UPDATE public.profiles SET full_name = 'Legit Editado' WHERE id = auth.uid() RETURNING 1) SELECT count(*)::text FROM u$q$) = '1');
SELECT public.ta_ok('AVP4 service_role (generate-avatar / avatar-evolve) sí guarda el avatar',
  public.ta_as(NULL, 'service_role',
    $q$WITH u AS (UPDATE public.profiles SET avatar_url = 'https://uhkdewinscffhdonhhmt.supabase.co/storage/v1/object/public/travel-moments/avatars/7a7a0000-0000-0000-0000-000000000002/v2.png' WHERE id = '7a7a0000-0000-0000-0000-000000000002' RETURNING 1) SELECT count(*)::text FROM u$q$) = '1');
SELECT public.ta_ok('AVP4b y lo puede quitar (Borrar mi avatar)',
  public.ta_as(NULL, 'service_role',
    $q$WITH u AS (UPDATE public.profiles SET avatar_url = NULL WHERE id = '7a7a0000-0000-0000-0000-000000000002' RETURNING 1) SELECT count(*)::text FROM u$q$) = '1');

DROP FUNCTION public.ta_ok(text, boolean, text);
DROP FUNCTION public.ta_as(uuid, text, text);
