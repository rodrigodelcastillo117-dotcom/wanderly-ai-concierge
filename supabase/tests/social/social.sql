-- Pruebas de Social (perfil de amigo, viajes juntos, saludos). Imprime "OK …" o "FALLA …".
-- Requiere run.sh (todas las migraciones). Usuarios:
--   A Rodrigo (yo) · B Carlo (amigo) · C extraño · D solicitud pendiente · E amigo que se borra
--   F amigo sin Travel DNA · X dueño de un viaje de grupo
\set ON_ERROR_STOP off
\pset tuples_only on
RESET ROLE;

CREATE OR REPLACE FUNCTION public.t_err(_label text, _sql text, _expect text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE _sql;
  RAISE NOTICE 'FALLA % (no hubo error)', _label;
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM ~* _expect THEN RAISE NOTICE 'OK % [%]', _label, left(SQLERRM, 90);
  ELSE RAISE NOTICE 'FALLA % (error inesperado: %)', _label, SQLERRM; END IF;
END $$;
CREATE OR REPLACE FUNCTION public.t_ok(_label text, _cond boolean, _detail text DEFAULT '') RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF coalesce(_cond, false) THEN RAISE NOTICE 'OK % %', _label, _detail; ELSE RAISE NOTICE 'FALLA % %', _label, _detail; END IF;
END $$;
GRANT EXECUTE ON FUNCTION public.t_err(text, text, text), public.t_ok(text, boolean, text) TO anon, authenticated, service_role;
-- Para leer como servidor lo que un cliente no puede ver (conteos de avisos y saludos).
CREATE OR REPLACE FUNCTION public.t_count(_sql text) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n bigint; BEGIN EXECUTE _sql INTO n; RETURN n; END $$;
GRANT EXECUTE ON FUNCTION public.t_count(text) TO authenticated;

-- ───────────── Datos de prueba (como servidor) ─────────────
INSERT INTO auth.users(id, email) VALUES
  ('5a000000-0000-0000-0000-00000000000a', 'rodrigo@example.test'),
  ('5b000000-0000-0000-0000-00000000000b', 'carlo-secreto@example.test'),
  ('5c000000-0000-0000-0000-00000000000c', 'extrano@example.test'),
  ('5d000000-0000-0000-0000-00000000000d', 'pendiente@example.test'),
  ('5e000000-0000-0000-0000-00000000000e', 'examigo@example.test'),
  ('5f000000-0000-0000-0000-00000000000f', 'sindna@example.test'),
  ('59000000-0000-0000-0000-000000000009', 'grupo@example.test')
ON CONFLICT DO NOTHING;
UPDATE profiles SET full_name = 'Rodrigo del Castillo', username = 'rodrigo', ciudad_origen = 'Monterrey'
 WHERE id = '5a000000-0000-0000-0000-00000000000a';
UPDATE profiles SET full_name = 'Carlo Bianchi', username = 'carlo', avatar_url = 'https://cdn.example.test/carlo.png',
       ciudad_origen = 'Guadalajara', pais_origen = 'México', fecha_nacimiento = '1991-07-14', nationality = 'Italiana',
       loyalty_programs = '[{"programa":"Club Premier","numero":"CP-998877"}]', food_dna = '{"secreto":"FOODDNA-SECRETO"}'
 WHERE id = '5b000000-0000-0000-0000-00000000000b';
UPDATE profiles SET full_name = 'Ex Amigo' WHERE id = '5e000000-0000-0000-0000-00000000000e';
UPDATE profiles SET full_name = 'Fer Sin DNA' WHERE id = '5f000000-0000-0000-0000-00000000000f';

INSERT INTO friendships(requester_id, addressee_id, status) VALUES
  ('5a000000-0000-0000-0000-00000000000a', '5b000000-0000-0000-0000-00000000000b', 'accepted'),
  ('5d000000-0000-0000-0000-00000000000d', '5a000000-0000-0000-0000-00000000000a', 'pending'),
  ('5e000000-0000-0000-0000-00000000000e', '5a000000-0000-0000-0000-00000000000a', 'accepted'),
  ('5a000000-0000-0000-0000-00000000000a', '5f000000-0000-0000-0000-00000000000f', 'accepted')
ON CONFLICT DO NOTHING;

INSERT INTO trips(id, user_id, destino, pais_destino, fecha_salida, fecha_regreso, cover_image_url) VALUES
  -- T1 de A con B aceptado (pasado)          → juntos
  ('5a100000-0000-0000-0000-000000000001', '5a000000-0000-0000-0000-00000000000a', 'Roma', 'Italia', current_date - 200, current_date - 193, 'https://cdn.example.test/roma.jpg'),
  -- T2 de B con A aceptado (futuro)          → juntos
  ('5b100000-0000-0000-0000-000000000002', '5b000000-0000-0000-0000-00000000000b', 'Tokio', 'Japón', current_date + 40, current_date + 50, NULL),
  -- T3 de A con B pendiente                  → NO
  ('5a100000-0000-0000-0000-000000000003', '5a000000-0000-0000-0000-00000000000a', 'Cancún', 'México', current_date + 90, current_date + 95, NULL),
  -- T4 de X con A y B aceptados (pasado)     → juntos
  ('59100000-0000-0000-0000-000000000004', '59000000-0000-0000-0000-000000000009', 'Madrid', 'España', current_date - 400, current_date - 395, NULL),
  -- T5 solo de B (pasado)                    → lugar de B, no juntos
  ('5b100000-0000-0000-0000-000000000005', '5b000000-0000-0000-0000-00000000000b', 'Oaxaca', 'México', current_date - 30, current_date - 25, NULL),
  -- T6 solo de B (futuro)                    → ni lugar ni juntos (no se revela)
  ('5b100000-0000-0000-0000-000000000006', '5b000000-0000-0000-0000-00000000000b', 'Lisboa', 'Portugal', current_date + 10, current_date + 15, NULL),
  -- T7 de C con A aceptado, B no             → NO
  ('5c100000-0000-0000-0000-000000000007', '5c000000-0000-0000-0000-00000000000c', 'Bogotá', 'Colombia', current_date - 60, current_date - 55, NULL);
INSERT INTO trip_collaborators(trip_id, user_id, invited_by, status) VALUES
  ('5a100000-0000-0000-0000-000000000001', '5b000000-0000-0000-0000-00000000000b', '5a000000-0000-0000-0000-00000000000a', 'accepted'),
  ('5b100000-0000-0000-0000-000000000002', '5a000000-0000-0000-0000-00000000000a', '5b000000-0000-0000-0000-00000000000b', 'accepted'),
  ('5a100000-0000-0000-0000-000000000003', '5b000000-0000-0000-0000-00000000000b', '5a000000-0000-0000-0000-00000000000a', 'pending'),
  ('59100000-0000-0000-0000-000000000004', '5a000000-0000-0000-0000-00000000000a', '59000000-0000-0000-0000-000000000009', 'accepted'),
  ('59100000-0000-0000-0000-000000000004', '5b000000-0000-0000-0000-00000000000b', '59000000-0000-0000-0000-000000000009', 'accepted'),
  ('5c100000-0000-0000-0000-000000000007', '5a000000-0000-0000-0000-00000000000a', '5c000000-0000-0000-0000-00000000000c', 'accepted');

INSERT INTO ai_user_preferences(user_id, ritmo_viaje, nivel_presupuesto, estilo_comida, actividades_tarde, hospedaje_preferencias,
                                restricciones_alimentarias, deal_breakers, mejor_viaje_descripcion, perfil_ia) VALUES
  ('5a000000-0000-0000-0000-00000000000a', 'equilibrado', 'premium', '{foodie,michelin}', '{museos,nocturna}', '{boutique}',
   '{}', '{masificados}', 'Mi mejor viaje', '{"estilo_dominante":"Curador urbano"}'),
  ('5b000000-0000-0000-0000-00000000000b', 'equilibrado', 'ultra', '{foodie,restricciones}', '{museos,playas}', '{boutique,resort_ai}',
   '{Sin gluten}', '{mal_internet}', 'TEXTO-PRIVADO-DE-CARLO', '{"estilo_dominante":"Explorador gastronómico","evitar":["SECRETO-EVITAR"]}')
ON CONFLICT (user_id) DO NOTHING;
-- B y C son miembros Privé vigentes (PRO + cortesía + membresía activa); F es PRO sin Privé.
INSERT INTO subscriptions (user_id, status, stripe_subscription_id, stripe_customer_id, current_period_end) VALUES
  ('5b000000-0000-0000-0000-00000000000b', 'active', 'sub_soc_b', 'cus_soc_b', now() + interval '20 days'),
  ('5c000000-0000-0000-0000-00000000000c', 'active', 'sub_soc_c', 'cus_soc_c', now() + interval '20 days'),
  ('5f000000-0000-0000-0000-00000000000f', 'active', 'sub_soc_f', 'cus_soc_f', now() + interval '20 days')
ON CONFLICT (user_id) DO NOTHING;
INSERT INTO prive_grants (email, user_id, reason, granted_by) VALUES
  ('carlo-secreto@example.test', '5b000000-0000-0000-0000-00000000000b', 'prueba social', 'test'),
  ('extrano@example.test', '5c000000-0000-0000-0000-00000000000c', 'prueba social', 'test');
INSERT INTO prive_memberships (user_id, status, basis, member_code, activated_at) VALUES
  ('5b000000-0000-0000-0000-00000000000b', 'active', 'grant', 'IP-SCRT-CDGX', now() - interval '3 days'),
  ('5c000000-0000-0000-0000-00000000000c', 'active', 'grant', 'IP-XTRN-CDGZ', now() - interval '3 days')
ON CONFLICT (user_id) DO NOTHING;
SELECT public.t_ok('Q0 preparación: B y C con Privé vigente, F sin', public.prive_entitled('5b000000-0000-0000-0000-00000000000b')
  AND public.prive_entitled('5c000000-0000-0000-0000-00000000000c') AND NOT public.prive_entitled('5f000000-0000-0000-0000-00000000000f'));
INSERT INTO travel_profiles(user_id, destinos_visitados, destinos_pendientes, descripcion_personal) VALUES
  ('5a000000-0000-0000-0000-00000000000a', '{cdmx}', '{Japón,Perú}', NULL),
  ('5b000000-0000-0000-0000-00000000000b', '{CDMX}', '{japón,Islandia}', 'DESCRIPCION-PRIVADA')
ON CONFLICT (user_id) DO NOTHING;

-- ───────────── 1. Acceso ─────────────
SET ROLE anon; SELECT set_config('request.jwt.claim.sub', '', false);
SELECT public.t_err('R1 anon no llama amigo_perfil', $q$SELECT public.amigo_perfil('5b000000-0000-0000-0000-00000000000b')$q$, 'permission denied');
SELECT public.t_err('R2 anon no llama saludar_amigo', $q$SELECT public.saludar_amigo('5b000000-0000-0000-0000-00000000000b')$q$, 'permission denied');
SELECT public.t_err('R3 anon no llama amigos_resumen', $q$SELECT public.amigos_resumen()$q$, 'permission denied');
RESET ROLE;
SET ROLE authenticated; SELECT set_config('request.jwt.claim.role', 'authenticated', false);
SELECT set_config('request.jwt.claim.sub', '5a000000-0000-0000-0000-00000000000a', false);
SELECT public.t_err('R4 cliente no llama ayudantes internos', $q$SELECT * FROM public._social_lugares('5b000000-0000-0000-0000-00000000000b')$q$, 'permission denied');
SELECT public.t_err('R5 cliente no llama _social_en_comun', $q$SELECT public._social_en_comun('5b000000-0000-0000-0000-00000000000b','5c000000-0000-0000-0000-00000000000c')$q$, 'permission denied');
SELECT public.t_err('R6 cliente no lee social_pokes', $q$SELECT count(*) FROM public.social_pokes$q$, 'permission denied');
SELECT public.t_err('R7 cliente no inserta saludos directo', $q$INSERT INTO public.social_pokes(user_id, friend_id) VALUES ('5a000000-0000-0000-0000-00000000000a','5b000000-0000-0000-0000-00000000000b')$q$, 'permission denied');
SELECT public.t_err('R8 cliente no inserta avisos a otro', $q$INSERT INTO public.notifications(user_id, type, title) VALUES ('5b000000-0000-0000-0000-00000000000b','social_poke','falso')$q$, 'row-level security');
SELECT public.t_err('R9 sigue sin leer el perfil del amigo directo', $q$DO $d$ BEGIN IF (SELECT count(*) FROM public.profiles WHERE id='5b000000-0000-0000-0000-00000000000b') > 0 THEN RAISE EXCEPTION 'vio fila'; END IF; RAISE EXCEPTION 'cero filas'; END $d$$q$, 'cero filas');

-- ───────────── 2. Perfil del amigo ─────────────
CREATE TEMP TABLE t_p AS SELECT public.amigo_perfil('5b000000-0000-0000-0000-00000000000b') AS j;
SELECT public.t_ok('P1 amigo aceptado ve el perfil', (SELECT (j->>'ok')::boolean FROM t_p));
SELECT public.t_ok('P2 trae nombre, avatar y ciudad', (SELECT j->'amigo'->>'full_name' = 'Carlo Bianchi'
  AND j->'amigo'->>'avatar_url' = 'https://cdn.example.test/carlo.png' AND j->'amigo'->>'ciudad_origen' = 'Guadalajara' FROM t_p));
SELECT public.t_ok('P3 el perfil trae solo campos permitidos',
  (SELECT array_agg(k ORDER BY k) FROM t_p, jsonb_object_keys(j->'amigo') k) = '{avatar_url,ciudad_origen,full_name,id,is_prive,pais_origen,username}',
  (SELECT array_agg(k ORDER BY k)::text FROM t_p, jsonb_object_keys(j->'amigo') k));
SELECT public.t_ok('P4 no filtra datos sensibles ni textos privados',
  (SELECT j::text !~* 'IP-SCRT|grant|prueba social|carlo-secreto|1991-07-14|Italiana|CP-998877|FOODDNA|Sin gluten|mal_internet|TEXTO-PRIVADO|SECRETO-EVITAR|DESCRIPCION-PRIVADA|ultra|restricciones|email|fecha_nacimiento|nationality|loyalty' FROM t_p),
  (SELECT left(j::text, 0) FROM t_p));
SELECT public.t_ok('P5 Travel DNA del amigo (sin restricciones)', (SELECT j->'dna'->>'estilo' = 'Explorador gastronómico'
  AND j->'dna'->'comida' = '["foodie"]' AND j->'dna'->>'ritmo' = 'equilibrado' FROM t_p), (SELECT (j->'dna')::text FROM t_p));
SELECT public.t_ok('P6 amigos desde', (SELECT j->>'amigos_desde' IS NOT NULL FROM t_p));

SELECT public.t_ok('P7 extraño → privado', public.amigo_perfil('5c000000-0000-0000-0000-00000000000c')->>'error' = 'privado');
SELECT public.t_ok('P8 solicitud pendiente → privado', public.amigo_perfil('5d000000-0000-0000-0000-00000000000d')->>'error' = 'privado');
SELECT public.t_ok('P9 id que no existe → misma respuesta privado', public.amigo_perfil('00000000-0000-0000-0000-0000000000ff')->>'error' = 'privado');
SELECT public.t_ok('P10 mi propio id → eres_tu', public.amigo_perfil('5a000000-0000-0000-0000-00000000000a')->>'error' = 'eres_tu');
SELECT public.t_ok('P11 privado no trae nada más', (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(public.amigo_perfil('5c000000-0000-0000-0000-00000000000c')) k) = '{error,ok}');

-- ───────────── 2b. Sello Privé ─────────────
SELECT public.t_ok('Q1 amigo Privé vigente → is_prive true', (SELECT (j->'amigo'->>'is_prive')::boolean FROM t_p));
SELECT public.t_ok('Q2 yo no soy Privé → yo_prive false', (SELECT NOT (j->>'yo_prive')::boolean FROM t_p));
SELECT public.t_ok('Q3 amigo sin Privé → is_prive false', NOT (public.amigo_perfil('5f000000-0000-0000-0000-00000000000f')->'amigo'->>'is_prive')::boolean);
SELECT public.t_ok('Q4 un extraño Privé no deja saber que lo es', public.amigo_perfil('5c000000-0000-0000-0000-00000000000c')::text !~ 'prive'
  AND public.amigo_perfil('5c000000-0000-0000-0000-00000000000c') = '{"ok": false, "error": "privado"}'::jsonb);
SELECT public.t_err('Q5 cliente no llama _social_is_prive', $q$SELECT public._social_is_prive('5c000000-0000-0000-0000-00000000000c')$q$, 'permission denied');
SELECT public.t_err('Q6 cliente no llama prive_entitled de otro', $q$SELECT public.prive_entitled('5c000000-0000-0000-0000-00000000000c')$q$, 'permission denied');
RESET ROLE;
UPDATE public.prive_memberships SET status = 'revoked', revoked_at = now(), revoke_kind = 'other', revoke_reason = 'prueba' WHERE user_id = '5b000000-0000-0000-0000-00000000000b';
SET ROLE authenticated;
SELECT public.t_ok('Q7 membresía revocada → el sello se apaga', NOT (public.amigo_perfil('5b000000-0000-0000-0000-00000000000b')->'amigo'->>'is_prive')::boolean);
RESET ROLE;
UPDATE public.prive_memberships SET status = 'active', revoked_at = NULL, revoke_kind = NULL, revoke_reason = NULL WHERE user_id = '5b000000-0000-0000-0000-00000000000b';
SET ROLE authenticated;

-- ───────────── 3. Viajes juntos y lugares ─────────────
SELECT public.t_ok('V1 3 viajes juntos (míos, suyos y de grupo)', (SELECT (j->>'viajes_juntos_total')::int = 3 FROM t_p));
SELECT public.t_ok('V2 son T1, T2 y T4', (SELECT array_agg(v->>'destino' ORDER BY v->>'destino') FROM t_p, jsonb_array_elements(j->'viajes_juntos') v) = '{Madrid,Roma,Tokio}',
  (SELECT array_agg(v->>'destino')::text FROM t_p, jsonb_array_elements(j->'viajes_juntos') v));
SELECT public.t_ok('V3 invitación pendiente y viaje ajeno no cuentan', (SELECT j::text !~ 'Cancún|Bogotá' FROM t_p));
SELECT public.t_ok('V4 viaje junto trae portada', (SELECT bool_or(v->>'cover_image_url' = 'https://cdn.example.test/roma.jpg') FROM t_p, jsonb_array_elements(j->'viajes_juntos') v));
SELECT public.t_ok('V5 lugares de B: terminados + declarados', (SELECT array_agg(l->>'ciudad' ORDER BY l->>'ciudad') FROM t_p, jsonb_array_elements(j->'lugares') l) = '{CDMX,Madrid,Oaxaca,Roma}',
  (SELECT array_agg(l->>'ciudad')::text FROM t_p, jsonb_array_elements(j->'lugares') l));
SELECT public.t_ok('V6 su viaje futuro (Lisboa) no se revela', (SELECT j::text !~ 'Lisboa|Portugal' FROM t_p));
SELECT public.t_ok('V7 los lugares no traen fechas', (SELECT bool_and((SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(l) k) = '{ciudad,pais}') FROM t_p, jsonb_array_elements(j->'lugares') l));

-- ───────────── 4. En común ─────────────
SELECT public.t_ok('C1 comida/tardes/hospedaje en común', (SELECT j->'en_comun'->'comida' = '["foodie"]' AND j->'en_comun'->'tardes' = '["museos"]'
  AND j->'en_comun'->'hospedaje' = '["boutique"]' AND (j->'en_comun'->>'mismo_ritmo')::boolean AND NOT (j->'en_comun'->>'mismo_presupuesto')::boolean FROM t_p),
  (SELECT (j->'en_comun')::text FROM t_p));
SELECT public.t_ok('C2 destinos en común (CDMX sin importar mayúsculas, Roma y Madrid)',
  (SELECT j->'en_comun'->'destinos' = '["Madrid", "Roma", "cdmx"]' OR j->'en_comun'->'destinos' = '["CDMX", "Madrid", "Roma"]' FROM t_p), (SELECT (j->'en_comun'->'destinos')::text FROM t_p));
SELECT public.t_ok('C3 sueños en común: solo Japón (no Perú ni Islandia)', (SELECT jsonb_array_length(j->'en_comun'->'suenos') = 1
  AND lower(j->'en_comun'->'suenos'->>0) = 'japón' FROM t_p), (SELECT (j->'en_comun'->'suenos')::text FROM t_p));
SELECT public.t_ok('C4 afinidad con datos suficientes', (SELECT (j->'en_comun'->>'afinidad')::int BETWEEN 1 AND 100 FROM t_p), (SELECT j->'en_comun'->>'afinidad' FROM t_p));
SELECT public.t_ok('C5 amigo sin Travel DNA → afinidad nula (no 0 %)',
  public.amigo_perfil('5f000000-0000-0000-0000-00000000000f')->'en_comun'->'afinidad' = 'null'::jsonb
  AND NOT (public.amigo_perfil('5f000000-0000-0000-0000-00000000000f')->'en_comun'->>'amigo_tiene_dna')::boolean);

-- ───────────── 5. Resumen de la lista ─────────────
CREATE TEMP TABLE t_r AS SELECT public.amigos_resumen() AS j;
SELECT public.t_ok('L1 resumen: B, E y F (no C ni D)', (SELECT array_agg(x->>'amigo_id' ORDER BY x->>'amigo_id') FROM t_r, jsonb_array_elements(j) x)
  = '{5b000000-0000-0000-0000-00000000000b,5e000000-0000-0000-0000-00000000000e,5f000000-0000-0000-0000-00000000000f}');
SELECT public.t_ok('L2 resumen cuenta 3 viajes juntos con B', (SELECT (x->>'viajes_juntos')::int = 3 FROM t_r, jsonb_array_elements(j) x WHERE x->>'amigo_id' LIKE '5b%'));
SELECT public.t_ok('L3 resumen sin datos sensibles', (SELECT j::text !~* 'secreto|ultra|1991|Lisboa|IP-' FROM t_r));
SELECT public.t_ok('L4 resumen: B Privé, F no; C (extraño Privé) no aparece', (SELECT bool_and(CASE WHEN x->>'amigo_id' LIKE '5b%' THEN (x->>'is_prive')::boolean ELSE NOT (x->>'is_prive')::boolean END)
  AND NOT bool_or(x->>'amigo_id' LIKE '5c%') FROM t_r, jsonb_array_elements(j) x));

-- ───────────── 6. Saludos ─────────────
SELECT public.t_ok('S1 A saluda a B', public.saludar_amigo('5b000000-0000-0000-0000-00000000000b', 'saludo')->>'ok' = 'true');
SELECT public.t_ok('S2 a B le llega un aviso con plantilla fija', public.t_count($q$SELECT count(*) FROM notifications WHERE user_id='5b000000-0000-0000-0000-00000000000b'
  AND type='social_poke' AND related_id='5a000000-0000-0000-0000-00000000000a' AND title='¡Rodrigo te mandó un saludo! ✈️'$q$) = 1);
CREATE TEMP TABLE t_s2 AS SELECT public.saludar_amigo('5b000000-0000-0000-0000-00000000000b', 'brindis') AS j;
SELECT public.t_ok('S3 segundo saludo en menos de 24 h → muy_pronto', (SELECT j->>'error' = 'muy_pronto' AND (j->>'proximo')::timestamptz > now() + interval '23 hours' FROM t_s2));
SELECT public.t_ok('S4 sigue habiendo un solo aviso', public.t_count($q$SELECT count(*) FROM notifications WHERE user_id='5b000000-0000-0000-0000-00000000000b' AND type='social_poke'$q$) = 1);
SELECT public.t_ok('S5 el perfil dice cuándo se puede volver', (SELECT NOT (j->'saludos'->>'puedo')::boolean AND j->'saludos'->>'proximo' IS NOT NULL
  FROM (SELECT public.amigo_perfil('5b000000-0000-0000-0000-00000000000b') j) x));
SELECT public.t_ok('S6 a un extraño no → no_son_amigos', public.saludar_amigo('5c000000-0000-0000-0000-00000000000c')->>'error' = 'no_son_amigos'
  AND public.t_count($q$SELECT count(*) FROM notifications WHERE user_id='5c000000-0000-0000-0000-00000000000c'$q$) = 0);
SELECT public.t_ok('S7 a una solicitud pendiente no', public.saludar_amigo('5d000000-0000-0000-0000-00000000000d')->>'error' = 'no_son_amigos');
SELECT public.t_ok('S8 a mí mismo no', public.saludar_amigo('5a000000-0000-0000-0000-00000000000a')->>'error' = 'no_son_amigos');
SELECT public.t_ok('S9 gesto inventado → gesto_invalido', public.saludar_amigo('5f000000-0000-0000-0000-00000000000f', '<script>')->>'error' = 'gesto_invalido');

-- B devuelve el saludo
SELECT set_config('request.jwt.claim.sub', '5b000000-0000-0000-0000-00000000000b', false);
SELECT public.t_ok('S10 B ve el saludo por devolver', (public.amigo_perfil('5a000000-0000-0000-0000-00000000000a')->'saludos'->>'por_devolver')::boolean);
CREATE TEMP TABLE t_s11 AS SELECT public.saludar_amigo('5a000000-0000-0000-0000-00000000000a', 'devuelta') AS j;
SELECT public.t_ok('S11 B devuelve el saludo (su límite es aparte)', (SELECT j->>'ok' = 'true' AND j->>'gesto' = 'devuelta' AND (j->>'total')::int = 2 FROM t_s11));
SELECT public.t_ok('S12 aviso a A: te devolvió el saludo + contador', public.t_count($q$SELECT count(*) FROM notifications WHERE user_id='5a000000-0000-0000-0000-00000000000a'
  AND type='social_poke' AND title='Carlo te devolvió el saludo 👋' AND body='Ya van 2 saludos entre ustedes.'$q$) = 1);
SELECT public.t_ok('S13 "devuelta" sin nada que devolver se manda como saludo',
  public.saludar_amigo('5a000000-0000-0000-0000-00000000000a', 'devuelta')->>'error' = 'muy_pronto');
SELECT set_config('request.jwt.claim.sub', '5a000000-0000-0000-0000-00000000000a', false);

-- Pasaron 25 h: A puede volver a saludar
RESET ROLE;
UPDATE public.social_pokes SET created_at = created_at - interval '25 hours' WHERE user_id = '5a000000-0000-0000-0000-00000000000a';
SET ROLE authenticated;
SELECT public.t_ok('S14 después de 24 h se puede de nuevo', public.saludar_amigo('5b000000-0000-0000-0000-00000000000b', 'maleta')->>'ok' = 'true'
  AND public.t_count($q$SELECT count(*) FROM notifications WHERE user_id='5b000000-0000-0000-0000-00000000000b' AND title='Rodrigo ya quiere hacer maleta contigo 🧳'$q$) = 1);

-- ───────────── 7. Fin de la amistad ─────────────
SELECT public.t_ok('E0 A saluda a E', public.saludar_amigo('5e000000-0000-0000-0000-00000000000e')->>'ok' = 'true');
SELECT set_config('request.jwt.claim.sub', '5e000000-0000-0000-0000-00000000000e', false);
SELECT public.t_ok('E1 E le devuelve', public.saludar_amigo('5a000000-0000-0000-0000-00000000000a', 'devuelta')->>'ok' = 'true');
SELECT set_config('request.jwt.claim.sub', '5a000000-0000-0000-0000-00000000000a', false);
DELETE FROM public.friendships WHERE requester_id = '5e000000-0000-0000-0000-00000000000e' AND addressee_id = '5a000000-0000-0000-0000-00000000000a';
SELECT public.t_ok('E2 A borró la amistad (RLS lo permite)', public.t_count($q$SELECT count(*) FROM friendships WHERE requester_id='5e000000-0000-0000-0000-00000000000e'$q$) = 0);
SELECT public.t_ok('E3 examigo → privado', public.amigo_perfil('5e000000-0000-0000-0000-00000000000e')->>'error' = 'privado');
SELECT public.t_ok('E4 se borran los saludos entre los dos', public.t_count($q$SELECT count(*) FROM social_pokes WHERE '5e000000-0000-0000-0000-00000000000e' IN (user_id, friend_id)$q$) = 0);
SELECT public.t_ok('E5 y sus avisos en ambas bandejas', public.t_count($q$SELECT count(*) FROM notifications WHERE type='social_poke'
  AND ((user_id='5e000000-0000-0000-0000-00000000000e') OR (user_id='5a000000-0000-0000-0000-00000000000a' AND related_id='5e000000-0000-0000-0000-00000000000e'))$q$) = 0);
SELECT public.t_ok('E6 los demás saludos siguen', public.t_count($q$SELECT count(*) FROM social_pokes WHERE '5b000000-0000-0000-0000-00000000000b' IN (user_id, friend_id)$q$) = 3);
SELECT public.t_ok('E7 ya no se le puede saludar', public.saludar_amigo('5e000000-0000-0000-0000-00000000000e')->>'error' = 'no_son_amigos');
RESET ROLE;

-- ───────────── 8. Baja de cuenta ─────────────
SET ROLE service_role;
SELECT public.t_ok('D1 purge_account_data(B) corre', (public.purge_account_data('5b000000-0000-0000-0000-00000000000b')->>'ok')::boolean);
RESET ROLE;
SELECT public.t_ok('D2 no quedan saludos de/para B', (SELECT count(*) FROM public.social_pokes WHERE '5b000000-0000-0000-0000-00000000000b' IN (user_id, friend_id)) = 0);
SELECT public.t_ok('D3 ni avisos de saludo de B en la bandeja de A', (SELECT count(*) FROM public.notifications WHERE user_id = '5a000000-0000-0000-0000-00000000000a'
  AND related_id = '5b000000-0000-0000-0000-00000000000b') = 0);
