-- Social · perfil del amigo con avatar, viajes y actividad (20261027090000_social_amigos.sql).
-- Imprime "OK …" o "FALLA …". Lo corre social/run.sh sobre la base con TODAS las migraciones.
-- Usuarios (ids 6a…): 1 Rodrigo (mira) · 2 Carlo (amigo que comparte) · 3 extraño · 4 con solicitud
--                     pendiente a Carlo · 5 bloqueado por Carlo · 6 otro amigo de Rodrigo (feed)
\set ON_ERROR_STOP off
\pset tuples_only on
RESET ROLE;

CREATE OR REPLACE FUNCTION public.sm_ok(_label text, _cond boolean, _detail text DEFAULT '') RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF coalesce(_cond, false) THEN RAISE NOTICE 'OK % %', _label, left(_detail, 200); ELSE RAISE NOTICE 'FALLA % %', _label, left(_detail, 400); END IF;
END $$;
-- Ejecuta q con el rol dado (authenticated con ese usuario, o anon) y devuelve el texto o ERR:<mensaje>.
CREATE OR REPLACE FUNCTION public.sm_as(_uid uuid, _q text, _role text DEFAULT 'authenticated') RETURNS text LANGUAGE plpgsql AS $$
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
GRANT EXECUTE ON FUNCTION public.sm_ok(text, boolean, text), public.sm_as(uuid, text, text) TO anon, authenticated;

\set R '6a000000-0000-0000-0000-000000000001'
\set C '6a000000-0000-0000-0000-000000000002'
\set X '6a000000-0000-0000-0000-000000000003'
\set P '6a000000-0000-0000-0000-000000000004'
\set B '6a000000-0000-0000-0000-000000000005'
\set O '6a000000-0000-0000-0000-000000000006'

INSERT INTO auth.users(id, email) VALUES
  (:'R', 'sm-rodrigo@example.test'), (:'C', 'sm-carlo-secreto@example.test'), (:'X', 'sm-extrano@example.test'),
  (:'P', 'sm-pendiente@example.test'), (:'B', 'sm-bloqueado@example.test'), (:'O', 'sm-otro@example.test')
ON CONFLICT DO NOTHING;
INSERT INTO public.profiles(id) SELECT id FROM auth.users WHERE id::text LIKE '6a000000-%' ON CONFLICT DO NOTHING;
UPDATE public.profiles SET full_name = 'Rodrigo del Castillo' WHERE id = :'R';
UPDATE public.profiles SET full_name = 'Carlo Ceniceros',
       avatar_url = 'https://uhkdewinscffhdonhhmt.supabase.co/storage/v1/object/public/travel-moments/avatars/' || :'C' || '/v3.png'
 WHERE id = :'C';
UPDATE public.profiles SET full_name = 'Otra Amiga' WHERE id = :'O';
INSERT INTO public.avatar_profiles(user_id, current_url, current_path, version)
VALUES (:'C', 'https://uhkdewinscffhdonhhmt.supabase.co/storage/v1/object/public/travel-moments/avatars/' || :'C' || '/v3.png',
        'avatars/' || :'C' || '/v3.png', 3)
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO public.friendships(requester_id, addressee_id, status) VALUES
  (:'R', :'C', 'accepted'), (:'P', :'C', 'pending'), (:'C', :'B', 'blocked'), (:'R', :'O', 'accepted');

INSERT INTO storage.buckets(id, name, public) VALUES ('travel-moments', 'travel-moments', true), ('travel-moments-private', 'travel-moments-private', false)
ON CONFLICT DO NOTHING;
INSERT INTO storage.objects(bucket_id, name) VALUES
  ('travel-moments', 'avatars/' || :'C' || '/v3.png'),
  ('travel-moments', 'avatars/' || :'C' || '/v1-viejo.png'),
  ('travel-moments-private', :'C' || '/6a500000-0000-0000-0000-000000000001.jpg'),
  ('travel-moments-private', :'C' || '/6a500000-0000-0000-0000-000000000002.jpg');

-- Viajes de Carlo: pasado suyo, pasado escondido, próximo suyo, uno juntos (de Rodrigo con Carlo) y un borrador sin fecha.
INSERT INTO public.trips(id, user_id, destino, pais_destino, fecha_salida, fecha_regreso, cover_image_url, presupuesto_objetivo, total_estimado) VALUES
  ('6a100000-0000-0000-0000-000000000001', :'C', 'Roma', 'Italia', current_date - 200, current_date - 193, 'https://images.pexels.com/roma.jpg', 99991, 88881),
  ('6a100000-0000-0000-0000-000000000002', :'C', 'Oslo', 'Noruega', current_date - 100, current_date - 95, 'https://rastreador.example/pixel.gif', 99992, 88882),
  ('6a100000-0000-0000-0000-000000000003', :'C', 'Lisboa', 'Portugal', current_date + 30, current_date + 35, NULL, 99993, 88883),
  ('6a100000-0000-0000-0000-000000000004', :'R', 'Madrid', 'España', current_date - 400, current_date - 395, NULL, 99994, 88884),
  ('6a100000-0000-0000-0000-000000000005', :'C', 'Borrador', NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO public.trip_collaborators(trip_id, user_id, invited_by, status) VALUES
  ('6a100000-0000-0000-0000-000000000004', :'C', :'R', 'accepted');

-- Actividad de Carlo.
INSERT INTO public.bookings(id, user_id, category, provider, status, title, subtitle, city, country, start_at, price_amount, confirmation_code, booking_url, created_at, raw_payload) VALUES
  ('6a200000-0000-0000-0000-000000000001', :'C', 'restaurant', 'OpenTable', 'confirmed', 'Suntory (Polanco)', '20:30 · 4 personas', 'Ciudad de México', 'México',
   now() + interval '1 day', 4321.50, 'CONF-SECRETO-77', 'https://opentable.example/r?token=SECRETO', now() - interval '3 days', NULL),
  ('6a200000-0000-0000-0000-000000000002', :'C', 'hotel', 'Por su cuenta', 'pending', 'Hotel Eden', NULL, 'Roma', 'Italia', NULL, NULL, NULL, NULL, now() - interval '5 days',
   '{"compra_item":"hotel:eden","marcado_por_usuario":true}'),
  ('6a200000-0000-0000-0000-000000000003', :'C', 'restaurant', 'OpenTable', 'pending', 'Solo un clic', NULL, 'CDMX', NULL, NULL, NULL, NULL, 'https://x.example', now() - interval '4 days', NULL),
  ('6a200000-0000-0000-0000-000000000004', :'C', 'flight', 'Aeroméxico', 'confirmed', 'Vuelo AM 001 MEX-MAD', NULL, 'Madrid', NULL, now() + interval '9 days', 20000, 'PNR123', NULL, now() - interval '6 days', NULL),
  ('6a200000-0000-0000-0000-000000000005', :'C', 'restaurant', 'OpenTable', 'confirmed', 'Reserva de hace una hora', NULL, 'CDMX', NULL, now() + interval '2 hours', NULL, NULL, NULL, now() - interval '1 hour', NULL),
  ('6a200000-0000-0000-0000-000000000006', :'C', 'restaurant', 'OpenTable', 'cancelled', 'Cancelada', NULL, 'CDMX', NULL, NULL, NULL, NULL, NULL, now() - interval '7 days', NULL);
INSERT INTO public.social_recomendaciones(id, user_id, nombre, ciudad, categoria, estrellas, nota, created_at) VALUES
  ('6a300000-0000-0000-0000-000000000001', :'C', 'Cocina Las Ranitas', 'Oaxaca', 'restaurant', 5, 'El mole negro', now() - interval '2 days');
INSERT INTO public.recomendaciones(id, user_id, titulo, tipo, descripcion, guardado, created_at) VALUES
  ('6a400000-0000-0000-0000-000000000001', :'C', 'Hotel Eden, Roma', 'hotel', 'nota privada', true, now() - interval '8 days'),
  ('6a400000-0000-0000-0000-000000000002', :'C', 'No guardado', 'hotel', NULL, false, now() - interval '8 days');
INSERT INTO public.visited_places(id, user_id, place_id, name, cuisine, status, visited_at, notes, lat, lng) VALUES
  ('6a600000-0000-0000-0000-000000000001', :'C', 'ChIJlouvre000000', 'Museo del Louvre', NULL, 'visited', now() - interval '10 days', 'nota privada del Louvre', 48.86, 2.33),
  ('6a600000-0000-0000-0000-000000000002', :'C', 'ChIJahoritaaaaaa', 'Visitado ahorita', NULL, 'visited', now() - interval '10 minutes', NULL, 19.4, -99.1);
INSERT INTO public.travel_moments(id, user_id, image_path, caption, destino, created_at) VALUES
  ('6a500000-0000-0000-0000-000000000001', :'C', :'C' || '/6a500000-0000-0000-0000-000000000001.jpg', 'Atardecer', 'Roma', now() - interval '9 days'),
  ('6a500000-0000-0000-0000-000000000002', :'C', :'C' || '/6a500000-0000-0000-0000-000000000002.jpg', 'No compartido', 'Roma', now() - interval '9 days');
INSERT INTO public.social_momentos_compartidos(moment_id, user_id) VALUES ('6a500000-0000-0000-0000-000000000001', :'C');
-- Actividad de la otra amiga (para el feed de Rodrigo).
INSERT INTO public.social_recomendaciones(id, user_id, nombre, ciudad, categoria, estrellas, created_at) VALUES
  ('6a300000-0000-0000-0000-000000000002', :'O', 'Café de Tacuba', 'CDMX', 'restaurant', 4, now() - interval '1 day 2 hours');
INSERT INTO public.social_privacidad(user_id, recomendaciones) VALUES (:'O', true);

-- ───── Valores por defecto: viajes pasados con mes y año, lo demás apagado ─────
SELECT public.sm_as(:'R', format($q$SELECT public.amigo_viajes(%L)::text$q$, :'C')) AS v0 \gset
SELECT public.sm_ok('AM1 por defecto Rodrigo ve los viajes pasados de Carlo y el de los dos',
  :'v0'::jsonb->>'ok' = 'true' AND :'v0' LIKE '%Roma%' AND :'v0' LIKE '%Oslo%' AND :'v0' LIKE '%Madrid%', :'v0');
SELECT public.sm_ok('AM1b por defecto NO ve sus viajes próximos ni borradores', :'v0' NOT LIKE '%Lisboa%' AND :'v0' NOT LIKE '%Borrador%', :'v0');
SELECT public.sm_ok('AM1c viaje solo de Carlo: mes y año, sin fecha completa ni id',
  (SELECT v->>'mes_salida' = to_char(current_date - 200, 'YYYY-MM') AND v->'fecha_salida' = 'null'::jsonb AND v->'id' = 'null'::jsonb AND v->>'juntos' = 'false'
     FROM jsonb_array_elements(:'v0'::jsonb->'viajes') v WHERE v->>'destino' = 'Roma'), :'v0');
SELECT public.sm_ok('AM1d viaje de los dos: "juntos", con id y fechas',
  (SELECT v->>'juntos' = 'true' AND v->>'id' = '6a100000-0000-0000-0000-000000000004' AND v->>'fecha_salida' = (current_date - 400)::text
     FROM jsonb_array_elements(:'v0'::jsonb->'viajes') v WHERE v->>'destino' = 'Madrid'), :'v0');
SELECT public.sm_ok('AM1e nunca precios, presupuesto ni portada de un host desconocido',
  :'v0' LIKE '{"ok": true%' AND :'v0' NOT LIKE '%9999%' AND :'v0' NOT LIKE '%8888%' AND :'v0' NOT LIKE '%presupuesto%' AND :'v0' NOT LIKE '%rastreador%'
  AND :'v0' LIKE '%images.pexels.com/roma.jpg%', :'v0');
SELECT public.sm_as(:'R', format($q$SELECT public.amigo_actividad(%L)::text$q$, :'C')) AS a0 \gset
SELECT public.sm_ok('AM2 por defecto la actividad está apagada (sin elementos)',
  :'a0'::jsonb->>'ok' = 'true' AND jsonb_array_length(:'a0'::jsonb->'items') = 0 AND :'a0'::jsonb#>>'{comparte,reservas}' = 'false', :'a0');

-- ───── Carlo prende todo ─────
SELECT public.sm_ok('AM3 una llave desconocida o no booleana se rechaza',
  public.sm_as(:'C', $q$SELECT public.guardar_privacidad_social('{"reservas": true, "es_admin": true}')->>'error'$q$) = 'ajustes_invalidos'
  AND public.sm_as(:'C', $q$SELECT public.guardar_privacidad_social('{"reservas": "si"}')->>'error'$q$) = 'ajustes_invalidos');
SELECT public.sm_ok('AM3b Carlo prende reservas, recomendaciones, favoritos, visitados, momentos y próximos',
  public.sm_as(:'C', $q$SELECT public.guardar_privacidad_social('{"reservas": true, "recomendaciones": true, "favoritos": true, "visitados": true, "momentos": true, "viajes_proximos": true}')->>'ok'$q$) = 'true');
SELECT public.sm_as(:'R', format($q$SELECT public.amigo_actividad(%L)::text$q$, :'C')) AS a1 \gset
SELECT public.sm_ok('AM4 Rodrigo ve la reserva confirmada, la marcada "Ya lo compré", la recomendación, el favorito, la visita y el momento',
  :'a1' LIKE '%Suntory (Polanco)%' AND :'a1' LIKE '%Hotel Eden%' AND :'a1' LIKE '%Cocina Las Ranitas%' AND :'a1' LIKE '%Hotel Eden, Roma%'
  AND :'a1' LIKE '%Museo del Louvre%' AND :'a1' LIKE '%Atardecer%', :'a1');
SELECT public.sm_ok('AM4b sin precio, código, proveedor, horario, enlace ni notas privadas',
  :'a1'::jsonb->>'ok' = 'true' AND :'a1' NOT LIKE '%4321%' AND :'a1' NOT LIKE '%CONF-SECRETO%' AND :'a1' NOT LIKE '%OpenTable%' AND :'a1' NOT LIKE '%20:30%'
  AND :'a1' NOT LIKE '%token=SECRETO%' AND :'a1' NOT LIKE '%nota privada%' AND :'a1' NOT LIKE '%48.86%' AND :'a1' NOT LIKE '%sm-carlo-secreto%', :'a1');
SELECT public.sm_ok('AM4c ni vuelos, ni clics a un socio, ni canceladas, ni favoritos no guardados, ni momentos no compartidos',
  :'a1' LIKE '{"ok": true%' AND :'a1' NOT LIKE '%MEX-MAD%' AND :'a1' NOT LIKE '%Solo un clic%' AND :'a1' NOT LIKE '%Cancelada%' AND :'a1' NOT LIKE '%No guardado%' AND :'a1' NOT LIKE '%No compartido%', :'a1');
SELECT public.sm_ok('AM4d nada en vivo: lo de la última hora no sale y la fecha es solo el día',
  :'a1' LIKE '{"ok": true%' AND :'a1' NOT LIKE '%hace una hora%' AND :'a1' NOT LIKE '%Visitado ahorita%'
  AND (SELECT bool_and(i->>'fecha' ~ '^\d{4}-\d{2}-\d{2}$') FROM jsonb_array_elements(:'a1'::jsonb->'items') i), :'a1');
SELECT public.sm_as(:'R', format($q$SELECT public.amigo_viajes(%L)::text$q$, :'C')) AS v1 \gset
SELECT public.sm_ok('AM4e con "próximos" prendido ya sale Lisboa (con mes y año)', :'v1' LIKE '%Lisboa%' AND :'v1' LIKE '%' || to_char(current_date + 30, 'YYYY-MM') || '%', :'v1');

-- ───── Esconder uno por uno ─────
SELECT public.sm_ok('AM5 Carlo esconde el viaje a Oslo y su visita al Louvre',
  public.sm_as(:'C', $q$SELECT public.ocultar_social('viaje:6a100000-0000-0000-0000-000000000002', true)->>'ok'$q$) = 'true'
  AND public.sm_as(:'C', $q$SELECT public.ocultar_social('visita:6a600000-0000-0000-0000-000000000001', true)->>'ok'$q$) = 'true');
SELECT public.sm_ok('AM5b Rodrigo ya no los ve',
  public.sm_as(:'R', format($q$SELECT public.amigo_actividad(%L)::text$q$, :'C')) LIKE '{"ok": true%' AND public.sm_as(:'R', format($q$SELECT public.amigo_viajes(%L)::text$q$, :'C')) NOT LIKE '%Oslo%'
  AND public.sm_as(:'R', format($q$SELECT public.amigo_actividad(%L)::text$q$, :'C')) NOT LIKE '%Louvre%');
SELECT public.sm_ok('AM5c nadie esconde (ni comparte) lo de otro',
  public.sm_as(:'R', $q$SELECT public.ocultar_social('reserva:6a200000-0000-0000-0000-000000000001', true)->>'error'$q$) = 'no_existe'
  AND public.sm_as(:'R', $q$SELECT public.ocultar_social('viaje:6a100000-0000-0000-0000-000000000003', true)->>'error'$q$) = 'no_existe'
  AND public.sm_as(:'R', $q$SELECT public.compartir_momento_social('6a500000-0000-0000-0000-000000000002', true)->>'error'$q$) = 'no_existe');

-- ───── Abuso: extraño, solicitud pendiente, bloqueado y anon ─────
SELECT public.sm_ok('AM6 un extraño no ve viajes ni actividad (privado)',
  public.sm_as(:'X', format($q$SELECT public.amigo_viajes(%L)->>'error'$q$, :'C')) = 'privado'
  AND public.sm_as(:'X', format($q$SELECT public.amigo_actividad(%L)->>'error'$q$, :'C')) = 'privado');
SELECT public.sm_ok('AM6b un extraño no recibe avatares ni ve objetos de Carlo en storage',
  public.sm_as(:'X', $q$SELECT public.amigos_avatares()::text$q$) = '[]'
  AND public.sm_as(:'X', format($q$SELECT count(*)::text FROM storage.objects WHERE name LIKE '%%%s%%'$q$, :'C')) = '0');
SELECT public.sm_ok('AM6c un extraño no puede reaccionar ni preguntar',
  public.sm_as(:'X', format($q$SELECT public.reaccionar_actividad(%L, 'reserva:6a200000-0000-0000-0000-000000000001', 'corazon')->>'error'$q$, :'C')) = 'no_disponible'
  AND public.sm_as(:'X', format($q$SELECT public.preguntar_actividad(%L, 'reserva:6a200000-0000-0000-0000-000000000001', 'hola?')->>'error'$q$, :'C')) = 'no_disponible');
SELECT public.sm_ok('AM7 con la solicitud PENDIENTE tampoco ve nada',
  public.sm_as(:'P', format($q$SELECT public.amigo_viajes(%L)->>'error'$q$, :'C')) = 'privado'
  AND public.sm_as(:'P', format($q$SELECT public.amigo_actividad(%L)->>'error'$q$, :'C')) = 'privado'
  AND public.sm_as(:'P', $q$SELECT public.amigos_avatares()::text$q$) = '[]'
  AND public.sm_as(:'P', format($q$SELECT count(*)::text FROM storage.objects WHERE name LIKE '%%%s%%'$q$, :'C')) = '0');
SELECT public.sm_ok('AM8 el BLOQUEADO no ve nada',
  public.sm_as(:'B', format($q$SELECT public.amigo_viajes(%L)->>'error'$q$, :'C')) = 'privado'
  AND public.sm_as(:'B', format($q$SELECT public.amigo_actividad(%L)->>'error'$q$, :'C')) = 'privado'
  AND public.sm_as(:'B', format($q$SELECT count(*)::text FROM storage.objects WHERE name LIKE '%%%s%%'$q$, :'C')) = '0');
SELECT public.sm_ok('AM9 anon no puede llamar ninguna función nueva',
  public.sm_as(NULL, format($q$SELECT public.amigo_viajes(%L)::text$q$, :'C'), 'anon') LIKE 'ERR:permission denied%'
  AND public.sm_as(NULL, format($q$SELECT public.amigo_actividad(%L)::text$q$, :'C'), 'anon') LIKE 'ERR:permission denied%'
  AND public.sm_as(NULL, $q$SELECT public.amigos_actividad()::text$q$, 'anon') LIKE 'ERR:permission denied%'
  AND public.sm_as(NULL, $q$SELECT public.amigos_avatares()::text$q$, 'anon') LIKE 'ERR:permission denied%'
  AND public.sm_as(NULL, $q$SELECT public.mi_actividad_social()::text$q$, 'anon') LIKE 'ERR:permission denied%'
  AND public.sm_as(NULL, $q$SELECT public.social_puede_ver_objeto('travel-moments', 'x')::text$q$, 'anon') LIKE 'ERR:permission denied%'
  AND public.sm_as(NULL, $q$SELECT count(*)::text FROM storage.objects$q$, 'anon') = '0');
SELECT public.sm_ok('AM9b ni anon ni un usuario leen o escriben las tablas nuevas directo',
  public.sm_as(NULL, $q$SELECT count(*)::text FROM public.social_privacidad$q$, 'anon') LIKE 'ERR:permission denied%'
  AND public.sm_as(:'R', $q$SELECT count(*)::text FROM public.social_reacciones$q$) LIKE 'ERR:permission denied%'
  AND public.sm_as(:'R', $q$SELECT count(*)::text FROM public.social_recomendaciones$q$) LIKE 'ERR:permission denied%'
  AND public.sm_as(:'X', format($q$INSERT INTO public.social_privacidad(user_id, reservas) VALUES (%L, true) RETURNING 'x'$q$, :'C')) LIKE 'ERR:permission denied%'
  AND public.sm_as(:'R', $q$SELECT public._social_items('6a000000-0000-0000-0000-000000000002', true)::text$q$) LIKE 'ERR:permission denied%');
SELECT public.sm_ok('AM9c un extraño no lee el feed de nadie (su feed sale vacío)',
  public.sm_as(:'X', $q$SELECT public.amigos_actividad()::text$q$) = '[]');

-- ───── Avatar: enlace firmado solo para amigos y solo el actual ─────
SELECT public.sm_as(:'R', $q$SELECT public.amigos_avatares()::text$q$) AS av \gset
SELECT public.sm_ok('AM10 Rodrigo recibe la ruta del avatar ACTUAL de Carlo',
  (SELECT a->>'path' FROM jsonb_array_elements(:'av'::jsonb) a WHERE a->>'id' = :'C') = 'avatars/' || :'C' || '/v3.png', :'av');
SELECT public.sm_ok('AM10b en storage ve ese objeto (puede firmarlo) pero no el avatar viejo',
  public.sm_as(:'R', format($q$SELECT string_agg(name, ',') FROM storage.objects WHERE bucket_id = 'travel-moments' AND name LIKE 'avatars/%s/%%'$q$, :'C')) = 'avatars/' || :'C' || '/v3.png');
-- Avatar huérfano: profiles.avatar_url vacío (lo limpió una migración o nunca se copió) y solo queda el
-- legado en perfil_ia: la ruta sale de ahí (es la carpeta avatars/<id>/ que solo escribe el servidor).
UPDATE public.profiles SET avatar_url = NULL WHERE id = :'O';
INSERT INTO public.ai_user_preferences(user_id, perfil_ia) VALUES (:'O',
  jsonb_build_object('avatar_url', 'https://uhkdewinscffhdonhhmt.supabase.co/storage/v1/object/public/travel-moments/avatars/' || :'O' || '/v1-1700000000.png'))
ON CONFLICT (user_id) DO UPDATE SET perfil_ia = EXCLUDED.perfil_ia;
SELECT public.sm_ok('AM10c avatar huérfano (solo en perfil_ia) también se encuentra; una ruta con ".." no',
  (SELECT a->>'path' FROM jsonb_array_elements(public.sm_as(:'R', $q$SELECT public.amigos_avatares()::text$q$)::jsonb) a WHERE a->>'id' = :'O')
    = 'avatars/' || :'O' || '/v1-1700000000.png'
  AND public.sm_as(:'R', format($q$SELECT public.social_puede_ver_objeto('travel-moments', 'avatars/%s/..')::text$q$, :'C')) = 'false'
  AND public.sm_as(:'R', format($q$SELECT public.social_puede_ver_objeto('travel-moments', 'avatars/%s/v1-viejo.png')::text$q$, :'C')) = 'false');
SELECT public.sm_ok('AM10d Carlo apaga "Mi avatar": sin ruta, sin objeto y sin avatar_url en perfil ni lista',
  public.sm_as(:'C', $q$SELECT public.guardar_privacidad_social('{"avatar": false}')->>'ok'$q$) = 'true'
  AND public.sm_as(:'R', $q$SELECT public.amigos_avatares()::text$q$) LIKE '[%' AND public.sm_as(:'R', $q$SELECT public.amigos_avatares()::text$q$) NOT LIKE '%' || :'C' || '%'
  AND public.sm_as(:'R', format($q$SELECT count(*)::text FROM storage.objects WHERE bucket_id = 'travel-moments' AND name LIKE 'avatars/%s/%%'$q$, :'C')) = '0'
  AND public.sm_as(:'R', format($q$SELECT public.amigo_perfil(%L)#>>'{amigo,avatar_url}'$q$, :'C')) = '<null>'
  AND public.sm_as(:'R', format($q$SELECT coalesce(avatar_url, 'vacio') FROM public.friend_profiles(ARRAY[%L]::uuid[])$q$, :'C')) = 'vacio');
SELECT public.sm_ok('AM10e lo vuelve a prender y regresa',
  public.sm_as(:'C', $q$SELECT public.guardar_privacidad_social('{"avatar": true}')->>'ok'$q$) = 'true'
  AND public.sm_as(:'R', format($q$SELECT public.amigo_perfil(%L)#>>'{amigo,avatar_url}'$q$, :'C')) LIKE '%/avatars/' || :'C' || '/v3.png');

-- ───── Momentos: solo el compartido ─────
SELECT public.sm_ok('AM11 Rodrigo ve en storage solo la foto del momento compartido',
  public.sm_as(:'R', $q$SELECT string_agg(name, ',') FROM storage.objects WHERE bucket_id = 'travel-moments-private'$q$) = :'C' || '/6a500000-0000-0000-0000-000000000001.jpg');

-- ───── Reacciones ─────
SELECT public.sm_ok('AM12 Rodrigo reacciona ❤️ a la reserva de Suntory',
  public.sm_as(:'R', format($q$SELECT public.reaccionar_actividad(%L, 'reserva:6a200000-0000-0000-0000-000000000001', 'corazon')->>'mi_reaccion'$q$, :'C')) = 'corazon');
SELECT public.sm_ok('AM12b a Carlo le llega "A Rodrigo le encantó tu reserva ❤️" (una vez, sin enlaces)',
  (SELECT count(*) FROM public.notifications WHERE user_id = :'C' AND type = 'social_reaccion' AND related_id = :'R'
     AND title = 'A Rodrigo le encantó tu reserva ❤️' AND body = 'Suntory (Polanco)') = 1);
SELECT public.sm_ok('AM12c cambiar de reacción no manda otro aviso; un emoji inventado se rechaza',
  public.sm_as(:'R', format($q$SELECT public.reaccionar_actividad(%L, 'reserva:6a200000-0000-0000-0000-000000000001', 'antojo')->>'mi_reaccion'$q$, :'C')) = 'antojo'
  AND (SELECT count(*) FROM public.notifications WHERE user_id = :'C' AND type = 'social_reaccion') = 1
  AND public.sm_as(:'R', format($q$SELECT public.reaccionar_actividad(%L, 'reserva:6a200000-0000-0000-0000-000000000001', 'popo')->>'error'$q$, :'C')) = 'reaccion_invalida');
SELECT public.sm_as(:'C', $q$SELECT public.mi_actividad_social()::text$q$) AS mine \gset
SELECT public.sm_ok('AM12d Carlo ve el conteo de reacciones de su reserva',
  (SELECT (i#>>'{reacciones,antojo}')::int FROM jsonb_array_elements(:'mine'::jsonb->'items') i WHERE i->>'clave' = 'reserva:6a200000-0000-0000-0000-000000000001') = 1, :'mine');
SELECT public.sm_ok('AM12e Rodrigo ve su reacción pero no conteos de otros',
  (SELECT i->>'mi_reaccion' = 'antojo' AND NOT i ? 'reacciones'
     FROM jsonb_array_elements(public.sm_as(:'R', format($q$SELECT public.amigo_actividad(%L)::text$q$, :'C'))::jsonb->'items') i
    WHERE i->>'clave' = 'reserva:6a200000-0000-0000-0000-000000000001'));
SELECT public.sm_ok('AM12f la vista propia muestra lo escondido y lo de la última hora (con su "visible desde")',
  (SELECT bool_or(i->>'oculto' = 'true') FROM jsonb_array_elements(:'mine'::jsonb->'items') i)
  AND (SELECT i->>'visible_desde' IS NOT NULL FROM jsonb_array_elements(:'mine'::jsonb->'items') i WHERE i->>'titulo' = 'Reserva de hace una hora'), :'mine');

-- ───── Intentar ver o reaccionar a lo apagado ─────
SELECT public.sm_ok('AM13 Carlo apaga reservas: Rodrigo ya no las ve ni puede reaccionar a ellas',
  public.sm_as(:'C', $q$SELECT public.guardar_privacidad_social('{"reservas": false}')->>'ok'$q$) = 'true'
  AND public.sm_as(:'R', format($q$SELECT public.amigo_actividad(%L)::text$q$, :'C')) LIKE '{"ok": true%' AND public.sm_as(:'R', format($q$SELECT public.amigo_actividad(%L)::text$q$, :'C')) NOT LIKE '%Suntory%'
  AND public.sm_as(:'R', format($q$SELECT public.reaccionar_actividad(%L, 'reserva:6a200000-0000-0000-0000-000000000002', 'fuego')->>'error'$q$, :'C')) = 'no_disponible'
  AND public.sm_as(:'R', format($q$SELECT public.preguntar_actividad(%L, 'reserva:6a200000-0000-0000-0000-000000000002', '¿Qué tal?')->>'error'$q$, :'C')) = 'no_disponible');
SELECT public.sm_ok('AM13b Carlo apaga momentos: la foto deja de verse en storage',
  public.sm_as(:'C', $q$SELECT public.guardar_privacidad_social('{"momentos": false}')->>'ok'$q$) = 'true'
  AND public.sm_as(:'R', $q$SELECT count(*)::text FROM storage.objects WHERE bucket_id = 'travel-moments-private'$q$) = '0');
SELECT public.sm_ok('AM13c tampoco con una clave inventada o escondida',
  public.sm_as(:'R', format($q$SELECT public.reaccionar_actividad(%L, 'visita:6a600000-0000-0000-0000-000000000001', 'fuego')->>'error'$q$, :'C')) = 'no_disponible'
  AND public.sm_as(:'R', format($q$SELECT public.reaccionar_actividad(%L, 'reco:00000000-0000-0000-0000-000000000000', 'fuego')->>'error'$q$, :'C')) = 'no_disponible');

-- ───── Preguntar y responder ─────
SELECT public.sm_as(:'R', format($q$SELECT public.preguntar_actividad(%L, 'reco:6a300000-0000-0000-0000-000000000001', '¿Qué pediste? visita bit.ly/x')->>'id'$q$, :'C')) AS qid \gset
SELECT public.sm_ok('AM14 Rodrigo pregunta por Las Ranitas y a Carlo le llega un aviso sin el texto libre',
  :'qid' ~ '^[0-9a-f-]{36}$'
  AND (SELECT count(*) FROM public.notifications WHERE user_id = :'C' AND type = 'social_pregunta' AND related_id = :'R'
         AND title = 'Rodrigo te preguntó por Cocina Las Ranitas' AND (title || coalesce(body, '')) NOT LIKE '%bit.ly%') = 1, :'qid');
SELECT public.sm_ok('AM14b solo Carlo responde (ni Rodrigo ni un extraño)',
  public.sm_as(:'R', format($q$SELECT public.responder_pregunta_social(%L, 'yo mismo')->>'error'$q$, :'qid')) = 'no_existe'
  AND public.sm_as(:'X', format($q$SELECT public.responder_pregunta_social(%L, 'hack')->>'error'$q$, :'qid')) = 'no_existe'
  AND public.sm_as(:'C', format($q$SELECT public.responder_pregunta_social(%L, 'El mole negro, sin duda')->>'ok'$q$, :'qid')) = 'true');
SELECT public.sm_ok('AM14c a Rodrigo le llega "Carlo respondió tu pregunta" y ve la respuesta en la actividad',
  (SELECT count(*) FROM public.notifications WHERE user_id = :'R' AND type = 'social_respuesta' AND related_id = :'C') = 1
  AND public.sm_as(:'R', format($q$SELECT public.amigo_actividad(%L)::text$q$, :'C')) LIKE '%El mole negro, sin duda%');
SELECT public.sm_ok('AM14d la otra amiga no ve la pregunta de Rodrigo (ni es amiga de Carlo)',
  public.sm_as(:'O', format($q$SELECT public.amigo_actividad(%L)->>'error'$q$, :'C')) = 'privado');

-- ───── Feed "Lo que hacen tus amigos" ─────
SELECT public.sm_as(:'R', $q$SELECT public.amigos_actividad()::text$q$) AS feed \gset
SELECT public.sm_ok('AM15 el feed de Rodrigo junta lo de Carlo y lo de la otra amiga, del más reciente al más viejo',
  :'feed' LIKE '%Café de Tacuba%' AND :'feed' LIKE '%Cocina Las Ranitas%'
  AND (SELECT i->'amigo'->>'nombre' FROM jsonb_array_elements(:'feed'::jsonb) WITH ORDINALITY x(i, n) ORDER BY n LIMIT 1) = 'Otra'
  AND (SELECT bool_and(a.f >= b.f) FROM (SELECT n, i->>'fecha' f FROM jsonb_array_elements(:'feed'::jsonb) WITH ORDINALITY x(i, n)) a
         JOIN (SELECT n, i->>'fecha' f FROM jsonb_array_elements(:'feed'::jsonb) WITH ORDINALITY x(i, n)) b ON b.n = a.n + 1), :'feed');

-- ───── Recomendar ─────
SELECT public.sm_ok('AM16 recomendar valida estrellas y categoría',
  public.sm_as(:'R', $q$SELECT public.recomendar_lugar('Pujol', 6)->>'error'$q$) = 'datos_invalidos'
  AND public.sm_as(:'R', $q$SELECT public.recomendar_lugar('Pujol', 5, 'bar')->>'error'$q$) = 'datos_invalidos'
  AND public.sm_as(:'R', $q$SELECT public.recomendar_lugar('Pujol', 5, 'restaurant', 'CDMX', 'Menú de maíz', NULL, 'javascript:alert(1)')->>'ok'$q$) = 'true');
SELECT public.sm_ok('AM16b una foto que no es de Google Places no se guarda',
  (SELECT photo_ref IS NULL FROM public.social_recomendaciones WHERE user_id = :'R' AND nombre = 'Pujol'));

-- ───── Fin de la amistad: se acaba el acceso ─────
SELECT public.sm_ok('AM17 Rodrigo quita a Carlo',
  public.sm_as(:'R', format($q$SELECT public.quitar_amigo(%L)->>'ok'$q$, :'C')) = 'true');
SELECT public.sm_ok('AM17b ya no ve viajes, actividad, avatar ni objetos',
  public.sm_as(:'R', format($q$SELECT public.amigo_viajes(%L)->>'error'$q$, :'C')) = 'privado'
  AND public.sm_as(:'R', format($q$SELECT public.amigo_actividad(%L)->>'error'$q$, :'C')) = 'privado'
  AND public.sm_as(:'R', $q$SELECT public.amigos_avatares()::text$q$) LIKE '[%' AND public.sm_as(:'R', $q$SELECT public.amigos_avatares()::text$q$) NOT LIKE '%' || :'C' || '%'
  AND public.sm_as(:'R', format($q$SELECT count(*)::text FROM storage.objects WHERE name LIKE '%%%s%%'$q$, :'C')) = '0'
  AND public.sm_as(:'R', $q$SELECT public.amigos_actividad()::text$q$) LIKE '[%' AND public.sm_as(:'R', $q$SELECT public.amigos_actividad()::text$q$) NOT LIKE '%Ranitas%');
SELECT public.sm_ok('AM17c se borran reacciones, preguntas y sus avisos entre los dos',
  NOT EXISTS (SELECT 1 FROM public.social_reacciones WHERE (user_id = :'R' AND owner_id = :'C') OR (user_id = :'C' AND owner_id = :'R'))
  AND NOT EXISTS (SELECT 1 FROM public.social_preguntas WHERE (user_id = :'R' AND owner_id = :'C') OR (user_id = :'C' AND owner_id = :'R'))
  AND NOT EXISTS (SELECT 1 FROM public.notifications WHERE type IN ('social_reaccion', 'social_pregunta', 'social_respuesta')
                   AND user_id IN (:'R', :'C') AND related_id IN (:'R', :'C')));
SELECT public.sm_ok('AM17d y no puede reaccionar con una clave que conocía',
  public.sm_as(:'R', format($q$SELECT public.reaccionar_actividad(%L, 'reco:6a300000-0000-0000-0000-000000000001', 'corazon')->>'error'$q$, :'C')) = 'no_disponible');

-- ───── Baja de cuenta: el barrido por user_id alcanza las tablas nuevas ─────
SELECT public.purge_account_data(:'C'::uuid) IS NOT NULL AS purgado \gset
SELECT public.sm_ok('AM18 purge_account_data borra ajustes, recomendaciones y ocultos de Carlo',
  :'purgado'::boolean
  AND NOT EXISTS (SELECT 1 FROM public.social_privacidad WHERE user_id = :'C')
  AND NOT EXISTS (SELECT 1 FROM public.social_recomendaciones WHERE user_id = :'C')
  AND NOT EXISTS (SELECT 1 FROM public.social_ocultos WHERE user_id = :'C')
  AND NOT EXISTS (SELECT 1 FROM public.social_momentos_compartidos WHERE user_id = :'C'));
