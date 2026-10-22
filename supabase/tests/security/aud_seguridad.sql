-- Auditoría de cierre (grupo seguridad, 2026-10-24): barrido del esquema final y ataques con roles
-- reales. Lo corre run.sh después de las demás pruebas. Cada línea imprime "OK <id> …" o "FALLA <id> …".
-- Ids propios: usuarios a5…/a6…, viajes a7…. Ver docs/iatos/cierre/SEGURIDAD.md.
\set ON_ERROR_STOP off
\pset tuples_only on
RESET ROLE;

-- ===== Inventario: reglas que cualquier migración futura debe respetar =====
SELECT CASE WHEN count(*) = 0 THEN 'OK SG1 todas las tablas de public tienen RLS'
            ELSE 'FALLA SG1 sin RLS: ' || string_agg(c.relname, ',') END
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind IN ('r','p') AND NOT c.relrowsecurity;

SELECT CASE WHEN count(*) = 0 THEN 'OK SG2 toda función SECURITY DEFINER fija search_path'
            ELSE 'FALLA SG2 sin search_path: ' || string_agg(p.proname, ',') END
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.prosecdef
   AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, '{}')) c WHERE c LIKE 'search_path=%');

SELECT CASE WHEN count(*) = 0 THEN 'OK SG3 ninguna función SECURITY DEFINER es ejecutable por PUBLIC'
            ELSE 'FALLA SG3 PUBLIC ejecuta: ' || string_agg(p.proname, ',') END
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.prosecdef
   AND EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE');

SELECT CASE WHEN coalesce(string_agg(p.proname, ',' ORDER BY p.proname), '') = 'public_plan_config'
            THEN 'OK SG4 anon solo ejecuta public_plan_config entre las SECURITY DEFINER'
            ELSE 'FALLA SG4 anon ejecuta: ' || string_agg(p.proname, ',' ORDER BY p.proname) END
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.prosecdef AND has_function_privilege('anon', p.oid, 'EXECUTE');

-- Lista revisada a mano (tabla de SEGURIDAD.md): cada una valida auth.uid(), admins o la sesión Privé.
-- Una función SECURITY DEFINER nueva que llegue a authenticated sin revisarse hace fallar esta línea.
WITH allowed(f) AS (VALUES ('aceptar_invitacion_viaje'),('admin_cost_metrics'),('admin_metrics'),('admin_prive_metrics'),
  ('admin_prive_requests'),('agregar_amigo_por_codigo'),('booking_intent_confirm'),('claim_referral'),('compatibilidad_viaje'),
  ('friend_profiles'),('get_access_state'),('has_trip_access'),('invitar_amigo_viaje'),('is_trip_collaborator'),('is_trip_owner'),
  ('members_access'),('members_access_state'),('members_cities'),('members_teaser'),('members_venues'),('prive_add_to_trip'),
  ('prive_confirm_adult'),('prive_destination'),('prive_experience'),('prive_for_you'),('prive_home'),('prive_my_requests'),
  ('prive_request_cancel'),('prive_request_create'),('prive_request_transition'),('prive_require'),('prive_save'),('prive_saved'),
  ('prive_search'),('prive_status'),('prive_teaser'),('prive_track'),('prive_universe'),('public_plan_config'),
  ('rechazar_invitacion_viaje'),('unlock_members_access')),
got AS (SELECT DISTINCT p.proname f FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND p.prosecdef AND has_function_privilege('authenticated', p.oid, 'EXECUTE'))
SELECT CASE WHEN NOT EXISTS (SELECT f FROM got EXCEPT SELECT f FROM allowed)
            THEN 'OK SG5 authenticated solo ejecuta las ' || (SELECT count(*) FROM got) || ' SECURITY DEFINER revisadas'
            ELSE 'FALLA SG5 sin revisar: ' || (SELECT string_agg(f, ',') FROM (SELECT f FROM got EXCEPT SELECT f FROM allowed) x) END;

SELECT CASE WHEN count(*) = 0 THEN 'OK SG6 toda vista expuesta a clientes usa security_invoker'
            ELSE 'FALLA SG6 vistas que saltan RLS: ' || string_agg(c.relname, ',') END
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind IN ('v','m')
   AND NOT coalesce('security_invoker=true' = ANY (c.reloptions), false)
   AND (has_table_privilege('anon', c.oid, 'SELECT') OR has_table_privilege('authenticated', c.oid, 'SELECT'));

-- Toda política de escritura de un cliente sobre una tabla con trip_id debe exigir acceso al viaje en
-- WITH CHECK (o, si no tiene WITH CHECK, en USING, que Postgres reutiliza). Excepciones revisadas:
-- affiliate_clicks (métrica propia, no se muestra a nadie más).
SELECT CASE WHEN count(*) = 0 THEN 'OK SG7 escrituras con trip_id exigen acceso al viaje'
            ELSE 'FALLA SG7 sin acceso al viaje: ' || string_agg(DISTINCT p.tablename || '.' || p.policyname, ', ') END
  FROM pg_policies p
 WHERE p.schemaname = 'public' AND p.cmd IN ('INSERT','UPDATE','ALL')
   AND p.tablename IN (SELECT c.table_name FROM information_schema.columns c WHERE c.table_schema = 'public' AND c.column_name = 'trip_id')
   AND p.tablename <> 'affiliate_clicks'
   AND coalesce(p.with_check, p.qual, '') !~ '(has_trip_access|is_trip_owner)';

SELECT CASE WHEN count(*) FILTER (WHERE NOT public) = 2 AND count(*) FILTER (WHERE id IN ('recibos','trip-documents') AND public) = 0
            THEN 'OK SG8 recibos y trip-documents son privados' ELSE 'FALLA SG8' END
  FROM storage.buckets WHERE id IN ('recibos','trip-documents','journal-photos','travel-moments');

-- ===== Datos: dueño (a5), colaborador expulsado (a6) y extraño (a6…2) =====
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
  ('a5000000-0000-0000-0000-000000000001','aud-owner@example.test',now()),
  ('a6000000-0000-0000-0000-000000000001','aud-excollab@example.test',now()),
  ('a6000000-0000-0000-0000-000000000002','aud-stranger@example.test',now())
ON CONFLICT DO NOTHING;
INSERT INTO trips(id,user_id,destino) VALUES
  ('a7000000-0000-0000-0000-000000000001','a5000000-0000-0000-0000-000000000001','Viaje del dueño'),
  ('a7000000-0000-0000-0000-000000000002','a6000000-0000-0000-0000-000000000001','Viaje propio del ex colaborador')
ON CONFLICT DO NOTHING;
INSERT INTO trip_collaborators(trip_id,user_id,role,invited_by,status) VALUES
  ('a7000000-0000-0000-0000-000000000001','a6000000-0000-0000-0000-000000000001','editor','a5000000-0000-0000-0000-000000000001','accepted')
ON CONFLICT DO NOTHING;
INSERT INTO trip_journal_entries(id,trip_id,author_id,text) VALUES
  ('a8000000-0000-0000-0000-000000000001','a7000000-0000-0000-0000-000000000001','a6000000-0000-0000-0000-000000000001','nota del colaborador'),
  ('a8000000-0000-0000-0000-000000000002','a7000000-0000-0000-0000-000000000002','a6000000-0000-0000-0000-000000000001','nota en su propio viaje')
ON CONFLICT DO NOTHING;
INSERT INTO storage.objects(bucket_id,name,owner_id) VALUES
  ('recibos','a5000000-0000-0000-0000-000000000001/recibo.pdf','a5000000-0000-0000-0000-000000000001'),
  ('trip-documents','a7000000-0000-0000-0000-000000000001/pasaporte.pdf','a5000000-0000-0000-0000-000000000001');
-- El dueño expulsa al colaborador.
DELETE FROM trip_collaborators WHERE trip_id='a7000000-0000-0000-0000-000000000001' AND user_id='a6000000-0000-0000-0000-000000000001';

SET ROLE authenticated; SELECT set_config('request.jwt.claim.role','authenticated',false);
SELECT set_config('request.jwt.claim.sub','a6000000-0000-0000-0000-000000000001',false);

-- SJ1/SJ2 con filtro (lo que manda PostgREST): la política SELECT ya bloquea, se dejan como regresión.
UPDATE trip_journal_entries SET text = 'reescrita tras la expulsión' WHERE id = 'a8000000-0000-0000-0000-000000000001';
UPDATE trip_journal_entries SET trip_id = 'a7000000-0000-0000-0000-000000000001' WHERE id = 'a8000000-0000-0000-0000-000000000002';
RESET ROLE;
SELECT CASE WHEN text = 'nota del colaborador' THEN 'OK SJ1 el ex colaborador ya no reescribe notas del viaje ajeno (con filtro)'
            ELSE 'FALLA SJ1 nota reescrita tras la expulsión: ' || text END
  FROM trip_journal_entries WHERE id = 'a8000000-0000-0000-0000-000000000001';
SELECT CASE WHEN trip_id = 'a7000000-0000-0000-0000-000000000002' THEN 'OK SJ2 no se mueve una nota al viaje de otra persona (con filtro)'
            ELSE 'FALLA SJ2 nota movida al viaje ' || trip_id END
  FROM trip_journal_entries WHERE id = 'a8000000-0000-0000-0000-000000000002';
-- SJ5/SJ6 (AUD-SEG-01): un UPDATE SIN filtro no pide permiso de SELECT, así que solo cuenta la política
-- UPDATE. Antes era "author_id = auth.uid()" y nada más: el ex colaborador reescribía sus notas del viaje
-- del que lo sacaron y movía todas sus notas a un viaje ajeno.
SET ROLE authenticated;
UPDATE trip_journal_entries SET text = 'sin filtro';
RESET ROLE;
SELECT CASE WHEN text = 'nota del colaborador' THEN 'OK SJ5 UPDATE sin filtro no toca notas de un viaje sin acceso'
            ELSE 'FALLA SJ5 nota del viaje ajeno reescrita sin filtro: ' || text END
  FROM trip_journal_entries WHERE id = 'a8000000-0000-0000-0000-000000000001';
UPDATE trip_journal_entries SET text = 'nota en su propio viaje' WHERE id = 'a8000000-0000-0000-0000-000000000002';
SET ROLE authenticated;
UPDATE trip_journal_entries SET trip_id = 'a7000000-0000-0000-0000-000000000001';
RESET ROLE;
SELECT CASE WHEN trip_id = 'a7000000-0000-0000-0000-000000000002' THEN 'OK SJ6 UPDATE sin filtro no mueve notas a un viaje ajeno'
            ELSE 'FALLA SJ6 nota movida sin filtro al viaje ' || trip_id END
  FROM trip_journal_entries WHERE id = 'a8000000-0000-0000-0000-000000000002';

-- SJ3 (flujo legítimo): el autor con acceso sí edita su nota.
SET ROLE authenticated;
UPDATE trip_journal_entries SET text = 'editada por su autor' WHERE id = 'a8000000-0000-0000-0000-000000000002';
RESET ROLE;
SELECT CASE WHEN text = 'editada por su autor' THEN 'OK SJ3 el autor con acceso edita su nota' ELSE 'FALLA SJ3 ' || text END
  FROM trip_journal_entries WHERE id = 'a8000000-0000-0000-0000-000000000002';

-- SJ4: el ex colaborador sigue pudiendo BORRAR lo que escribió (derecho sobre su contenido).
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','a6000000-0000-0000-0000-000000000001',false);
SELECT CASE WHEN count(*) = 0 THEN 'OK SJ4 el ex colaborador ya no ve el diario ajeno' ELSE 'FALLA SJ4 ve ' || count(*) END
  FROM trip_journal_entries WHERE trip_id = 'a7000000-0000-0000-0000-000000000001';

-- SS1/SS2: almacenamiento privado entre cuentas.
SELECT CASE WHEN count(*) = 0 THEN 'OK SS1 un extraño no ve recibos de otra cuenta' ELSE 'FALLA SS1' END
  FROM storage.objects WHERE bucket_id = 'recibos';
SELECT CASE WHEN count(*) = 0 THEN 'OK SS2 el ex colaborador ya no ve los documentos del viaje' ELSE 'FALLA SS2' END
  FROM storage.objects WHERE bucket_id = 'trip-documents';
-- SS3: subir a la carpeta de otro usuario en recibos o en la de un viaje ajeno: negado.
INSERT INTO storage.objects(bucket_id,name,owner_id) VALUES ('recibos','a5000000-0000-0000-0000-000000000001/plantado.pdf','a6000000-0000-0000-0000-000000000001');
INSERT INTO storage.objects(bucket_id,name,owner_id) VALUES ('trip-documents','a7000000-0000-0000-0000-000000000001/plantado.pdf','a6000000-0000-0000-0000-000000000001');
INSERT INTO storage.objects(bucket_id,name,owner_id) VALUES ('trip-documents','a7000000-0000-0000-0000-000000000002/../a7000000-0000-0000-0000-000000000001/x.pdf','a6000000-0000-0000-0000-000000000001');
RESET ROLE;
SELECT CASE WHEN count(*) = 0 THEN 'OK SS3 no se planta un archivo en la carpeta de otro (ni con ../)' ELSE 'FALLA SS3 ' || string_agg(name, ',') END
  FROM storage.objects WHERE name LIKE '%plantado%' OR name LIKE '%..%';

-- SR1: las funciones de administración niegan a un usuario normal.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','a6000000-0000-0000-0000-000000000002',false);
DO $$ BEGIN
  BEGIN PERFORM public.admin_metrics(); RAISE NOTICE 'FALLA SR1 admin_metrics'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.admin_cost_metrics(30); RAISE NOTICE 'FALLA SR1 admin_cost_metrics'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.admin_prive_requests(NULL); RAISE NOTICE 'FALLA SR1 admin_prive_requests'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.admin_prive_metrics(30); RAISE NOTICE 'FALLA SR1 admin_prive_metrics'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.prive_request_transition(gen_random_uuid(), 'cancelado', NULL, NULL, NULL, NULL); RAISE NOTICE 'FALLA SR1 prive_request_transition'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.booking_intent_confirm(gen_random_uuid(), '{}'::jsonb); RAISE NOTICE 'FALLA SR1 booking_intent_confirm'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT 'OK SR1 funciones de equipo niegan a un usuario normal (ningún aviso de error arriba)';
-- SR2: los oráculos de relación no responden por terceros.
SELECT CASE WHEN NOT public.is_trip_owner('a7000000-0000-0000-0000-000000000001','a5000000-0000-0000-0000-000000000001')
             AND NOT public.has_trip_access('a7000000-0000-0000-0000-000000000001','a5000000-0000-0000-0000-000000000001')
            THEN 'OK SR2 is_trip_owner/has_trip_access no responden por otra cuenta' ELSE 'FALLA SR2' END;
-- SR3: get_access_state ignora el _user_id ajeno cuando hay sesión.
SELECT CASE WHEN (public.get_access_state('a5000000-0000-0000-0000-000000000001')->>'plan') IS NOT NULL
            THEN 'OK SR3 get_access_state responde por la sesión, no por el parámetro' ELSE 'FALLA SR3' END;
-- SR4: el perfil completo (correo, nacimiento) de otra cuenta no es legible.
SELECT CASE WHEN count(*) = 0 THEN 'OK SR4 no se leen perfiles ajenos' ELSE 'FALLA SR4' END
  FROM profiles WHERE id <> 'a6000000-0000-0000-0000-000000000002'::uuid;
RESET ROLE;

-- ===== Fortalecimiento (CALIDAD_PRUEBAS.md, mutaciones M3/M3B que ninguna prueba detectaba) =====
-- SX: lectura cruzada en las tablas personales. Antes nada fallaba si una política SELECT "own" se
-- volvía USING (true) (mutación M3B en expenses).
INSERT INTO ai_user_preferences(user_id) VALUES ('a5000000-0000-0000-0000-000000000001') ON CONFLICT DO NOTHING;
INSERT INTO behavioral_insights(user_id,action) VALUES ('a5000000-0000-0000-0000-000000000001','x');
INSERT INTO bookings(user_id,title,provider,category) VALUES ('a5000000-0000-0000-0000-000000000001','Hotel X','manual','hotel');
INSERT INTO concierge_conversations(user_id) VALUES ('a5000000-0000-0000-0000-000000000001');
INSERT INTO expenses(user_id,amount,category) VALUES ('a5000000-0000-0000-0000-000000000001',100,'comida');
INSERT INTO fixer_escalations(user_id) VALUES ('a5000000-0000-0000-0000-000000000001');
INSERT INTO notifications(user_id,title) VALUES ('a5000000-0000-0000-0000-000000000001','aviso privado');
INSERT INTO push_subscriptions(user_id,endpoint,p256dh,auth) VALUES ('a5000000-0000-0000-0000-000000000001','https://push.example/a5','k','a');
INSERT INTO recomendaciones(user_id) VALUES ('a5000000-0000-0000-0000-000000000001');
INSERT INTO travel_moments(user_id,image_url) VALUES ('a5000000-0000-0000-0000-000000000001','https://x.example/a.jpg');
INSERT INTO travel_profiles(user_id) VALUES ('a5000000-0000-0000-0000-000000000001') ON CONFLICT DO NOTHING;
INSERT INTO user_vault_benefits(user_id) VALUES ('a5000000-0000-0000-0000-000000000001') ON CONFLICT DO NOTHING;
INSERT INTO user_visits(user_id,place_name) VALUES ('a5000000-0000-0000-0000-000000000001','Lugar');
INSERT INTO visited_places(user_id,name,place_id) VALUES ('a5000000-0000-0000-0000-000000000001','Lugar','pid-a5');
CREATE TEMP VIEW aud_personal WITH (security_invoker = true) AS
  SELECT 'ai_user_preferences' t, count(*) n FROM ai_user_preferences WHERE user_id = 'a5000000-0000-0000-0000-000000000001'
  UNION ALL SELECT 'behavioral_insights', count(*) FROM behavioral_insights WHERE user_id = 'a5000000-0000-0000-0000-000000000001'
  UNION ALL SELECT 'bookings', count(*) FROM bookings WHERE user_id = 'a5000000-0000-0000-0000-000000000001'
  UNION ALL SELECT 'concierge_conversations', count(*) FROM concierge_conversations WHERE user_id = 'a5000000-0000-0000-0000-000000000001'
  UNION ALL SELECT 'expenses', count(*) FROM expenses WHERE user_id = 'a5000000-0000-0000-0000-000000000001'
  UNION ALL SELECT 'fixer_escalations', count(*) FROM fixer_escalations WHERE user_id = 'a5000000-0000-0000-0000-000000000001'
  UNION ALL SELECT 'notifications', count(*) FROM notifications WHERE user_id = 'a5000000-0000-0000-0000-000000000001'
  UNION ALL SELECT 'push_subscriptions', count(*) FROM push_subscriptions WHERE user_id = 'a5000000-0000-0000-0000-000000000001'
  UNION ALL SELECT 'recomendaciones', count(*) FROM recomendaciones WHERE user_id = 'a5000000-0000-0000-0000-000000000001'
  UNION ALL SELECT 'travel_moments', count(*) FROM travel_moments WHERE user_id = 'a5000000-0000-0000-0000-000000000001'
  UNION ALL SELECT 'travel_profiles', count(*) FROM travel_profiles WHERE user_id = 'a5000000-0000-0000-0000-000000000001'
  UNION ALL SELECT 'user_vault_benefits', count(*) FROM user_vault_benefits WHERE user_id = 'a5000000-0000-0000-0000-000000000001'
  UNION ALL SELECT 'user_visits', count(*) FROM user_visits WHERE user_id = 'a5000000-0000-0000-0000-000000000001'
  UNION ALL SELECT 'visited_places', count(*) FROM visited_places WHERE user_id = 'a5000000-0000-0000-0000-000000000001'
  UNION ALL SELECT 'profiles', count(*) FROM profiles WHERE id = 'a5000000-0000-0000-0000-000000000001';
GRANT SELECT ON aud_personal TO authenticated, anon;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','a5000000-0000-0000-0000-000000000001',false);
SELECT CASE WHEN count(*) FILTER (WHERE n = 0) = 0 THEN 'OK SX1 el dueño ve sus ' || count(*) || ' tablas personales (flujo legítimo)'
            ELSE 'FALLA SX1 el dueño no ve: ' || string_agg(t, ',') FILTER (WHERE n = 0) END FROM aud_personal;
SELECT set_config('request.jwt.claim.sub','a6000000-0000-0000-0000-000000000002',false);
SELECT CASE WHEN count(*) FILTER (WHERE n > 0) = 0
             AND (SELECT count(*) FROM trips WHERE user_id = 'a5000000-0000-0000-0000-000000000001') = 0
            THEN 'OK SX2 un extraño no lee ninguna de las ' || count(*) || ' tablas personales ajenas ni sus viajes'
            ELSE 'FALLA SX2 lectura cruzada en: ' || coalesce(string_agg(t, ',') FILTER (WHERE n > 0), 'trips') END FROM aud_personal;
SET ROLE anon; SELECT set_config('request.jwt.claim.role','anon',false); SELECT set_config('request.jwt.claim.sub','',false);
DO $$ DECLARE v text; BEGIN
  SELECT string_agg(t, ',') FILTER (WHERE n > 0) INTO v FROM aud_personal;
  RAISE NOTICE '%', CASE WHEN v IS NULL THEN 'OK SX3 anon no lee ninguna tabla personal' ELSE 'FALLA SX3 anon lee: ' || v END;
  BEGIN
    PERFORM count(*) FROM trips;
    RAISE NOTICE '%', CASE WHEN (SELECT count(*) FROM trips) = 0 THEN 'OK SX4 anon no lee viajes' ELSE 'FALLA SX4 anon lee viajes' END;
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'OK SX4 anon no lee viajes [permiso negado]';
  END;
END $$;
RESET ROLE; SELECT set_config('request.jwt.claim.role','authenticated',false);

-- SC: una invitación PENDIENTE no da acceso al viaje (mutación M3: is_trip_collaborator sin
-- status = 'accepted' pasaba todas las pruebas).
INSERT INTO trip_collaborators(trip_id,user_id,role,invited_by,status) VALUES
  ('a7000000-0000-0000-0000-000000000001','a6000000-0000-0000-0000-000000000002','editor','a5000000-0000-0000-0000-000000000001','pending')
ON CONFLICT DO NOTHING;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','a6000000-0000-0000-0000-000000000002',false);
SELECT CASE WHEN (SELECT count(*) FROM trips WHERE id = 'a7000000-0000-0000-0000-000000000001') = 0
             AND (SELECT count(*) FROM trip_journal_entries WHERE trip_id = 'a7000000-0000-0000-0000-000000000001') = 0
             AND NOT public.has_trip_access('a7000000-0000-0000-0000-000000000001', 'a6000000-0000-0000-0000-000000000002')
            THEN 'OK SC1 invitación pendiente: no ve el viaje ni su diario' ELSE 'FALLA SC1 la invitación pendiente ya da acceso' END;
UPDATE trips SET destino = 'cambiado por invitado pendiente' WHERE id = 'a7000000-0000-0000-0000-000000000001';
SELECT public.aceptar_invitacion_viaje('a7000000-0000-0000-0000-000000000001');
SELECT CASE WHEN (SELECT count(*) FROM trips WHERE id = 'a7000000-0000-0000-0000-000000000001' AND destino = 'Viaje del dueño') = 1
            THEN 'OK SC2 al aceptar ve el viaje; antes de aceptar no pudo cambiarlo' ELSE 'FALLA SC2' END;
RESET ROLE;
