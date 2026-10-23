-- Avatar por capas e inventario (20261027120000_avatar_inventario.sql). Imprime "OK …" o "FALLA …".
-- Requiere run.sh. Usuarios (ids e1…): 1 Eva (avatar por capas) · 2 Iván (otro usuario) · 3 Sin avatar.
\set ON_ERROR_STOP off
\pset tuples_only on
RESET ROLE;

CREATE OR REPLACE FUNCTION public.ai_ok(_label text, _cond boolean, _detail text DEFAULT '') RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF coalesce(_cond, false) THEN RAISE NOTICE 'OK % %', _label, _detail; ELSE RAISE NOTICE 'FALLA % %', _label, _detail; END IF;
END $$;
-- Ejecuta q como el usuario (rol authenticated) y devuelve el texto o ERR:<mensaje>.
CREATE OR REPLACE FUNCTION public.ai_as(_uid uuid, _q text) RETURNS text LANGUAGE plpgsql AS $$
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
CREATE OR REPLACE FUNCTION public.ai_anon(_q text) RETURNS text LANGUAGE plpgsql AS $$
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
CREATE OR REPLACE FUNCTION public.ai_service(_q text) RETURNS text LANGUAGE plpgsql AS $$
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
GRANT EXECUTE ON FUNCTION public.ai_ok(text, boolean, text), public.ai_as(uuid, text), public.ai_anon(text), public.ai_service(text) TO authenticated, anon, service_role;

INSERT INTO auth.users(id, email) VALUES
  ('e1000000-0000-4000-8000-000000000001', 'ai-eva@example.test'),
  ('e1000000-0000-4000-8000-000000000002', 'ai-ivan@example.test'),
  ('e1000000-0000-4000-8000-000000000003', 'ai-sin@example.test')
ON CONFLICT DO NOTHING;
INSERT INTO public.profiles(id) SELECT id FROM auth.users WHERE id::text LIKE 'e1000000-%' ON CONFLICT DO NOTHING;

-- ───── bucket público del inventario ─────
SELECT public.ai_ok('AI1 bucket avatar-assets público, solo PNG/WebP, máx. 4 MB',
  (SELECT public AND allowed_mime_types = ARRAY['image/png', 'image/webp'] AND file_size_limit = 4194304 FROM storage.buckets WHERE id = 'avatar-assets'));
SELECT public.ai_ok('AI2 sin políticas de la app sobre avatar-assets (solo service_role sube)',
  (SELECT count(*) = 0 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
     AND (coalesce(qual, '') LIKE '%avatar-assets%' OR coalesce(with_check, '') LIKE '%avatar-assets%')));
SELECT public.ai_ok('AI3 un usuario no puede subir al inventario',
  public.ai_as('e1000000-0000-4000-8000-000000000001', $q$INSERT INTO storage.objects(bucket_id, name) VALUES ('avatar-assets', 'fondos/mx-angel.png') RETURNING 'subio'$q$) LIKE 'ERR:%');

-- ───── avatar_assets ─────
SELECT public.ai_ok('AI4 service_role registra un fondo',
  public.ai_service($q$INSERT INTO public.avatar_assets(id, kind, pais, path, prompt_hash, width, height, bytes, model)
    VALUES ('mx-angel', 'fondo', 'MX', 'fondos/mx-angel.png', '0123456789abcdef', 1024, 1280, 900000, 'google/gemini-3-pro-image-preview') RETURNING id$q$) = 'mx-angel');
SELECT public.ai_ok('AI5 service_role registra un objeto',
  public.ai_service($q$INSERT INTO public.avatar_assets(id, kind, souvenir_key, path, prompt_hash, width, height, bytes)
    VALUES ('c-paris-1', 'objeto', 'ciudad:paris', 'objetos/c-paris-1.png', 'fedcba9876543210', 512, 512, 120000) RETURNING id$q$) = 'c-paris-1');
SELECT public.ai_ok('AI6 la ruta debe corresponder al tipo y al id',
  public.ai_service($q$INSERT INTO public.avatar_assets(id, kind, pais, path, prompt_hash, width, height, bytes)
    VALUES ('mx-bellas-artes', 'fondo', 'MX', 'objetos/otro.png', '0123456789abcdef', 1024, 1280, 1) RETURNING id$q$) LIKE 'ERR:%');
SELECT public.ai_ok('AI7 un fondo exige país; un id con mayúsculas o ../ se rechaza',
  public.ai_service($q$INSERT INTO public.avatar_assets(id, kind, path, prompt_hash, width, height, bytes)
    VALUES ('xx-a', 'fondo', 'fondos/xx-a.png', '0123456789abcdef', 1024, 1280, 1) RETURNING id$q$) LIKE 'ERR:%'
  AND public.ai_service($q$INSERT INTO public.avatar_assets(id, kind, souvenir_key, path, prompt_hash, width, height, bytes)
    VALUES ('../X', 'objeto', 'ciudad:paris', 'objetos/../X.png', '0123456789abcdef', 512, 512, 1) RETURNING id$q$) LIKE 'ERR:%');
SELECT public.ai_ok('AI8 la huella del prompt es de 16 hex',
  public.ai_service($q$INSERT INTO public.avatar_assets(id, kind, souvenir_key, path, prompt_hash, width, height, bytes)
    VALUES ('c-paris-2', 'objeto', 'ciudad:paris', 'objetos/c-paris-2.png', 'zz', 512, 512, 1) RETURNING id$q$) LIKE 'ERR:%');
SELECT public.ai_ok('AI9 un usuario autenticado lee el catálogo',
  public.ai_as('e1000000-0000-4000-8000-000000000002', $q$SELECT string_agg(id, ',' ORDER BY id) FROM public.avatar_assets$q$) = 'c-paris-1,mx-angel');
SELECT public.ai_ok('AI10 anon no lee el catálogo',
  public.ai_anon($q$SELECT count(*)::text FROM public.avatar_assets$q$) LIKE 'ERR:%');
SELECT public.ai_ok('AI11 un usuario no escribe el catálogo (insert/update/delete)',
  public.ai_as('e1000000-0000-4000-8000-000000000001', $q$INSERT INTO public.avatar_assets(id, kind, pais, path, prompt_hash, width, height, bytes)
    VALUES ('mx-x', 'fondo', 'MX', 'fondos/mx-x.png', '0123456789abcdef', 1024, 1280, 1) RETURNING id$q$) LIKE 'ERR:%'
  AND public.ai_as('e1000000-0000-4000-8000-000000000001', $q$UPDATE public.avatar_assets SET bytes = 1 RETURNING id$q$) LIKE 'ERR:%'
  AND public.ai_as('e1000000-0000-4000-8000-000000000001', $q$DELETE FROM public.avatar_assets RETURNING id$q$) LIKE 'ERR:%');

-- ───── avatar_profiles: capas, país, fondo, objetos, cara, mano, cuerpo ─────
SELECT public.ai_ok('AI12 el servidor guarda un avatar por capas completo',
  public.ai_service($q$INSERT INTO public.avatar_profiles(user_id, base_path, capas, pais_fondo, fondo_id, objetos, cara, mano, current_url, current_path, cuerpo_url, cuerpo_path, version)
    VALUES ('e1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001/variantes/p.png', true, 'ES', 'es-bernabeu',
            ARRAY['c-paris-1', 'p-ar-1'], ARRAY[0.5, 0.12, 0.28]::real[], ARRAY[0.33, 0.4]::real[],
            'https://x.supabase.co/storage/v1/object/public/travel-moments/avatars/e1000000-0000-4000-8000-000000000001/a.png',
            'avatars/e1000000-0000-4000-8000-000000000001/a.png',
            'https://x.supabase.co/storage/v1/object/public/travel-moments/avatars/e1000000-0000-4000-8000-000000000001/a-cuerpo.png',
            'avatars/e1000000-0000-4000-8000-000000000001/a-cuerpo.png', 1) RETURNING 'ok'$q$) = 'ok');
SELECT public.ai_ok('AI13 el fondo siempre es del país de origen (fondo de Francia con país España: no)',
  public.ai_service($q$UPDATE public.avatar_profiles SET fondo_id = 'fr-eiffel' WHERE user_id = 'e1000000-0000-4000-8000-000000000001' RETURNING 'x'$q$) LIKE 'ERR:%');
SELECT public.ai_ok('AI14 sin país no hay fondo guardado',
  public.ai_service($q$INSERT INTO public.avatar_profiles(user_id, fondo_id) VALUES ('e1000000-0000-4000-8000-000000000003', 'mx-angel') RETURNING 'x'$q$) LIKE 'ERR:%');
SELECT public.ai_ok('AI15 país con formato ISO2',
  public.ai_service($q$UPDATE public.avatar_profiles SET pais_fondo = 'esp', fondo_id = NULL WHERE user_id = 'e1000000-0000-4000-8000-000000000001' RETURNING 'x'$q$) LIKE 'ERR:%');
SELECT public.ai_ok('AI16 máximo 3 objetos visibles',
  public.ai_service($q$UPDATE public.avatar_profiles SET objetos = ARRAY['a-1', 'b-1', 'c-1', 'd-1'] WHERE user_id = 'e1000000-0000-4000-8000-000000000001' RETURNING 'x'$q$) LIKE 'ERR:%');
SELECT public.ai_ok('AI17 ids de objetos válidos (sin comas, espacios ni ../)',
  public.ai_service($q$UPDATE public.avatar_profiles SET objetos = ARRAY['c-paris-1', '../x'] WHERE user_id = 'e1000000-0000-4000-8000-000000000001' RETURNING 'x'$q$) LIKE 'ERR:%'
  AND public.ai_service($q$UPDATE public.avatar_profiles SET objetos = ARRAY['a,b'] WHERE user_id = 'e1000000-0000-4000-8000-000000000001' RETURNING 'x'$q$) LIKE 'ERR:%');
SELECT public.ai_ok('AI18 cara = 3 fracciones 0-1 y mano = 2 fracciones 0-1',
  public.ai_service($q$UPDATE public.avatar_profiles SET cara = ARRAY[0.5, 1.4, 0.2]::real[] WHERE user_id = 'e1000000-0000-4000-8000-000000000001' RETURNING 'x'$q$) LIKE 'ERR:%'
  AND public.ai_service($q$UPDATE public.avatar_profiles SET mano = ARRAY[0.5]::real[] WHERE user_id = 'e1000000-0000-4000-8000-000000000001' RETURNING 'x'$q$) LIKE 'ERR:%');
SELECT public.ai_ok('AI19 el cuerpo completo solo bajo avatars/<su id>/',
  public.ai_service($q$UPDATE public.avatar_profiles SET cuerpo_path = 'avatars/e1000000-0000-4000-8000-000000000002/robado.png' WHERE user_id = 'e1000000-0000-4000-8000-000000000001' RETURNING 'x'$q$) LIKE 'ERR:%'
  AND public.ai_service($q$UPDATE public.avatar_profiles SET cuerpo_url = 'http://evil.test/x.png' WHERE user_id = 'e1000000-0000-4000-8000-000000000001' RETURNING 'x'$q$) LIKE 'ERR:%');
SELECT public.ai_ok('AI20 "por capas" exige la imagen base de la persona',
  public.ai_service($q$INSERT INTO public.avatar_profiles(user_id, capas) VALUES ('e1000000-0000-4000-8000-000000000002', true) RETURNING 'x'$q$) LIKE 'ERR:%');
SELECT public.ai_ok('AI21 sin avatar aún: se guarda solo el país (se pregunta una vez)',
  public.ai_service($q$INSERT INTO public.avatar_profiles(user_id, pais_fondo) VALUES ('e1000000-0000-4000-8000-000000000003', 'MX') RETURNING capas::text || ',' || pais_fondo || ',' || cardinality(objetos)$q$) = 'false,MX,0');
SELECT public.ai_ok('AI22 la persona lee su propio estado de capas',
  public.ai_as('e1000000-0000-4000-8000-000000000001', $q$SELECT capas::text || '|' || pais_fondo || '|' || fondo_id || '|' || array_to_string(objetos, ',') || '|' || cuerpo_path FROM public.avatar_profiles$q$)
  = 'true|ES|es-bernabeu|c-paris-1,p-ar-1|avatars/e1000000-0000-4000-8000-000000000001/a-cuerpo.png');
SELECT public.ai_ok('AI23 nadie ve el avatar de otro',
  public.ai_as('e1000000-0000-4000-8000-000000000002', $q$SELECT count(*)::text FROM public.avatar_profiles$q$) = '0');
SELECT public.ai_ok('AI24 la app no cambia su fondo ni sus objetos (solo el servidor)',
  public.ai_as('e1000000-0000-4000-8000-000000000001', $q$UPDATE public.avatar_profiles SET fondo_id = 'es-sagrada-familia' RETURNING 'x'$q$) LIKE 'ERR:%'
  AND public.ai_as('e1000000-0000-4000-8000-000000000001', $q$UPDATE public.avatar_profiles SET objetos = '{}' RETURNING 'x'$q$) LIKE 'ERR:%');
SELECT public.ai_ok('AI25 la app no se marca "por capas" ni se inventa un cuerpo completo',
  public.ai_as('e1000000-0000-4000-8000-000000000003', $q$UPDATE public.avatar_profiles SET capas = true, base_path = 'e1000000-0000-4000-8000-000000000003/x.png' RETURNING 'x'$q$) LIKE 'ERR:%'
  AND public.ai_as('e1000000-0000-4000-8000-000000000003', $q$INSERT INTO public.avatar_profiles(user_id, cuerpo_url) VALUES ('e1000000-0000-4000-8000-000000000002', 'https://x/y.png') RETURNING 'x'$q$) LIKE 'ERR:%');
SELECT public.ai_ok('AI26 anon no lee avatar_profiles',
  public.ai_anon($q$SELECT count(*)::text FROM public.avatar_profiles$q$) LIKE 'ERR:%');
SELECT public.ai_ok('AI27 cambiar de país y de fondo juntos sí (el servidor resuelve el primer fondo del país nuevo)',
  public.ai_service($q$UPDATE public.avatar_profiles SET pais_fondo = 'MX', fondo_id = 'mx-bellas-artes' WHERE user_id = 'e1000000-0000-4000-8000-000000000001' RETURNING fondo_id$q$) = 'mx-bellas-artes');

-- ───── avatar_variants: recorte, cara y mano ─────
SELECT public.ai_ok('AI28 una variante nueva no está recortada por defecto; se guarda cara y mano',
  public.ai_service($q$INSERT INTO public.avatar_variants(user_id, storage_path, recortada, cara, mano)
    VALUES ('e1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001/variantes/v1.png', true, ARRAY[0.5, 0.13, 0.27]::real[], ARRAY[0.32, 0.41]::real[]) RETURNING recortada::text$q$) = 'true'
  AND (SELECT column_default = 'false' AND is_nullable = 'NO' FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'avatar_variants' AND column_name = 'recortada'));
SELECT public.ai_ok('AI29 cara/mano de variantes con rango válido',
  public.ai_service($q$INSERT INTO public.avatar_variants(user_id, storage_path, mano)
    VALUES ('e1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001/variantes/v2.png', ARRAY[-0.1, 0.2]::real[]) RETURNING 'x'$q$) LIKE 'ERR:%');
SELECT public.ai_ok('AI30 nadie ve las variantes de otro ni las cambia',
  public.ai_as('e1000000-0000-4000-8000-000000000002', $q$SELECT count(*)::text FROM public.avatar_variants$q$) = '0'
  AND public.ai_as('e1000000-0000-4000-8000-000000000001', $q$UPDATE public.avatar_variants SET recortada = false RETURNING 'x'$q$) LIKE 'ERR:%');

-- ───── bandera avatar_capas_enabled: false | true | "founders" ─────
INSERT INTO public.founders(user_id, person) VALUES ('e1000000-0000-4000-8000-000000000001', 'rodrigo') ON CONFLICT DO NOTHING;
SELECT public.ai_ok('AI31 sale apagada: nadie la tiene (ni fundadores)',
  (SELECT value = 'false'::jsonb FROM public.app_flags WHERE key = 'avatar_capas_enabled')
  AND NOT public.avatar_capas_para('e1000000-0000-4000-8000-000000000001')
  AND public.ai_as('e1000000-0000-4000-8000-000000000001', $q$SELECT public.avatar_capas_activo()::text$q$) = 'false');
UPDATE public.app_flags SET value = '"founders"'::jsonb WHERE key = 'avatar_capas_enabled';
SELECT public.ai_ok('AI32 "founders": solo la cuenta fundadora la tiene',
  public.ai_as('e1000000-0000-4000-8000-000000000001', $q$SELECT public.avatar_capas_activo()::text$q$) = 'true'
  AND public.ai_as('e1000000-0000-4000-8000-000000000002', $q$SELECT public.avatar_capas_activo()::text$q$) = 'false'
  AND NOT public.avatar_capas_para(NULL));
UPDATE public.app_flags SET value = 'true'::jsonb WHERE key = 'avatar_capas_enabled';
SELECT public.ai_ok('AI33 true: todos la tienen',
  public.ai_as('e1000000-0000-4000-8000-000000000002', $q$SELECT public.avatar_capas_activo()::text$q$) = 'true');
UPDATE public.app_flags SET value = '"otra cosa"'::jsonb WHERE key = 'avatar_capas_enabled';
SELECT public.ai_ok('AI34 un valor desconocido cuenta como apagada (falla cerrada)',
  NOT public.avatar_capas_para('e1000000-0000-4000-8000-000000000001'));
UPDATE public.app_flags SET value = 'false'::jsonb WHERE key = 'avatar_capas_enabled';
SELECT public.ai_ok('AI35 la app no pregunta por otros ni lee la bandera o la lista de fundadores',
  public.ai_as('e1000000-0000-4000-8000-000000000002', $q$SELECT public.avatar_capas_para('e1000000-0000-4000-8000-000000000001')::text$q$) LIKE 'ERR:%'
  AND public.ai_as('e1000000-0000-4000-8000-000000000002', $q$SELECT value::text FROM public.app_flags WHERE key = 'avatar_capas_enabled'$q$) LIKE 'ERR:%'
  AND public.ai_as('e1000000-0000-4000-8000-000000000002', $q$SELECT count(*)::text FROM public.founders$q$) LIKE 'ERR:%');
SELECT public.ai_ok('AI36 anon no puede consultar la bandera',
  public.ai_anon($q$SELECT public.avatar_capas_activo()::text$q$) LIKE 'ERR:%');
DELETE FROM public.founders WHERE user_id = 'e1000000-0000-4000-8000-000000000001';

-- Limpieza: las funciones de apoyo no se quedan en la base (run_all compara funciones con la referencia).
DROP FUNCTION public.ai_ok(text, boolean, text), public.ai_as(uuid, text), public.ai_anon(text), public.ai_service(text);
