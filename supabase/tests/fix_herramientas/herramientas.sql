-- amigo_existe(uuid) de 20261029030000_fix_herramientas.sql. Imprime "<ID> <descripción> [esperado]: observado"
-- (run.sh lo convierte en OK/FALLA con t_brackets). Requiere la base con TODAS las migraciones en orden.
\set ON_ERROR_STOP off
\pset tuples_only on
RESET ROLE;
CREATE SCHEMA IF NOT EXISTS fh;
GRANT USAGE ON SCHEMA fh TO anon, authenticated, service_role;
CREATE OR REPLACE FUNCTION fh.run(_role text, _uid uuid, _q text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', coalesce(_uid::text, ''), false), set_config('request.jwt.claim.role', _role, false);
  EXECUTE format('SET LOCAL ROLE %I', _role);
  EXECUTE _q INTO v;
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claim.role', '', false);
  RETURN coalesce(v, '<null>');
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claim.role', '', false);
  RETURN 'ERR';
END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA fh TO anon, authenticated, service_role;

INSERT INTO auth.users (id, email, created_at) VALUES
  ('fa000000-0000-0000-0000-000000000001', 'fh1@example.test', now()),
  ('fa000000-0000-0000-0000-000000000002', 'fh2@example.test', now()) ON CONFLICT DO NOTHING;
INSERT INTO public.profiles (id) VALUES ('fa000000-0000-0000-0000-000000000001'), ('fa000000-0000-0000-0000-000000000002') ON CONFLICT DO NOTHING;

SELECT 'A1 un perfil que existe [true]: ' || fh.run('authenticated', 'fa000000-0000-0000-0000-000000000001', $q$SELECT public.amigo_existe('fa000000-0000-0000-0000-000000000002')::text$q$);
SELECT 'A2 un id que no existe [false]: ' || fh.run('authenticated', 'fa000000-0000-0000-0000-000000000001', $q$SELECT public.amigo_existe('fa000000-0000-0000-0000-0000000000ff')::text$q$);
SELECT 'A3 anon no la puede llamar [ERR]: ' || fh.run('anon', NULL, $q$SELECT public.amigo_existe('fa000000-0000-0000-0000-000000000002')::text$q$);
SELECT 'A4 sin sesión (sub vacío) no responde true [false]: ' || fh.run('authenticated', NULL, $q$SELECT public.amigo_existe('fa000000-0000-0000-0000-000000000002')::text$q$);
SELECT 'A5 solo devuelve un booleano (sin datos del perfil) [boolean]: ' || (SELECT format_type(prorettype, NULL) FROM pg_proc WHERE proname = 'amigo_existe' AND pronamespace = 'public'::regnamespace);
SELECT 'A6 SECURITY DEFINER con search_path fijo [true|search_path=public]: ' || (SELECT prosecdef::text || '|' || array_to_string(proconfig, ',') FROM pg_proc WHERE proname = 'amigo_existe' AND pronamespace = 'public'::regnamespace);
