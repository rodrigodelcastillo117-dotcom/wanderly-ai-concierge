-- Pruebas SQL de THE PRIVATE EDITION (equipo edition). Las corre run.sh sobre una base desechable con TODAS
-- las migraciones. Cada caso imprime "OK <id> …" o "FALLA <id> …". Nunca producción.
\set ON_ERROR_STOP off
\pset tuples_only on
RESET ROLE;

DROP SCHEMA IF EXISTS et CASCADE;
CREATE SCHEMA et;
GRANT USAGE ON SCHEMA et TO anon, authenticated, service_role;
CREATE TABLE et.tokens (who int PRIMARY KEY, token text NOT NULL);
GRANT ALL ON et.tokens TO authenticated, service_role;

CREATE FUNCTION et.u(n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT ('e0000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid $$;
CREATE FUNCTION et.sid(n int) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT 'f0000000-0000-0000-0000-' || lpad(n::text, 12, '0') $$;
CREATE FUNCTION et.ok(name text, cond boolean, detail text DEFAULT NULL) RETURNS text LANGUAGE sql AS $$
  SELECT CASE WHEN coalesce(cond, false) THEN 'OK ' || name ELSE 'FALLA ' || name || ' ' || coalesce(detail, '(sin detalle)') END $$;
CREATE FUNCTION et.mk_user(n int, nombre text) RETURNS uuid LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO auth.users (id, email, email_confirmed_at, raw_user_meta_data)
  VALUES (et.u(n), 'edi' || n || '@example.test', now(), jsonb_build_object('full_name', nombre)) ON CONFLICT DO NOTHING;
  INSERT INTO public.profiles (id, full_name, email) VALUES (et.u(n), nombre, 'edi' || n || '@example.test') ON CONFLICT (id) DO NOTHING;
  RETURN et.u(n);
END $$;
CREATE FUNCTION et.pro(n int) RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.subscriptions (user_id, status, stripe_subscription_id, stripe_customer_id, current_period_end)
  VALUES (et.u(n), 'active', 'sub_e' || n, 'cus_e' || n, now() + interval '20 days')
  ON CONFLICT (user_id) DO UPDATE SET status = 'active', current_period_end = now() + interval '20 days' $$;
CREATE FUNCTION et.paid(n int, days int) RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.prive_record_paid_period(et.u(n), 'in_e' || n, 'sub_e' || n, 'cus_e' || n,
    now() - make_interval(days => days), now() + interval '5 days', 19900, 'mxn', 'test') $$;
-- Miembro Privé completo con sesión Privé (token guardado en et.tokens).
CREATE FUNCTION et.member(n int) RETURNS text LANGUAGE plpgsql AS $$
DECLARE r jsonb; pw text := 'Edicion-Privada-' || n || '-Segura!';
BEGIN
  PERFORM et.pro(n); PERFORM et.paid(n, 120);
  PERFORM public.prive_invite_user(et.u(n), 'tenure', 'system');
  r := public.prive_accept_invitation(et.u(n), NULL);
  r := public.prive_set_password(et.u(n), pw, 'ok');
  INSERT INTO auth.sessions (id, user_id) VALUES (et.sid(n)::uuid, et.u(n)) ON CONFLICT DO NOTHING;
  r := public.prive_unlock(et.u(n), pw, NULL, et.sid(n));
  IF NOT (r ? 'token') THEN RETURN 'sin token: ' || r::text; END IF;
  INSERT INTO et.tokens (who, token) VALUES (n, r->>'token') ON CONFLICT (who) DO UPDATE SET token = EXCLUDED.token;
  RETURN 'ok';
END $$;
CREATE FUNCTION et.tok(n int) RETURNS text LANGUAGE sql STABLE AS $$ SELECT coalesce((SELECT t.token FROM et.tokens t WHERE t.who = $1), repeat('x', 43)) $$;
CREATE FUNCTION et.login(n int) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.sub', CASE WHEN n IS NULL THEN '' ELSE et.u(n)::text END, false),
         set_config('request.jwt.claim.role', 'authenticated', false),
         set_config('request.jwt.claims', CASE WHEN n IS NULL THEN '{}' ELSE jsonb_build_object('sub', et.u(n), 'role', 'authenticated',
           'session_id', et.sid(n))::text END, false) $$;
-- Ejecuta SQL como el usuario n (rol authenticated); devuelve el resultado como texto o el mensaje de error.
CREATE FUNCTION et.as_user(n int, q text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text; d text;
BEGIN
  PERFORM et.login(n);
  SET LOCAL ROLE authenticated;
  EXECUTE q INTO v;
  RESET ROLE;
  RETURN v;
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS d = PG_EXCEPTION_DETAIL;
  RESET ROLE;
  RETURN 'ERR:' || SQLERRM || coalesce(' ' || nullif(d, ''), '');
END $$;
-- Como admin (usuario 90).
CREATE FUNCTION et.as_admin(q text) RETURNS text LANGUAGE sql AS $$ SELECT et.as_user(90, q) $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA et TO anon, authenticated, service_role;

-- Cuentas: 1 FREE · 2 PRO con 30 días (sin Privé) · 3 y 4 miembros Privé · 90 admin (sin Privé).
SELECT count(*) FROM (SELECT et.mk_user(n, 'Persona ' || n) FROM unnest(ARRAY[1, 2, 3, 4, 90]) n) t;
SELECT et.pro(2); SELECT et.paid(2, 30);
SELECT et.member(3) AS m3 \gset
SELECT et.member(4) AS m4 \gset
INSERT INTO public.admins (user_id) VALUES (et.u(90)) ON CONFLICT DO NOTHING;
SELECT et.ok('E00 preparación: dos miembros Privé con sesión', :'m3' = 'ok' AND :'m4' = 'ok', :'m3' || ' / ' || :'m4');

-- ───────────── A. acceso de lectura en el servidor ─────────────
SELECT et.ok('E01 FREE no lee la revista por API directa (PRIVE_NOT_PRO)',
  et.as_user(1, $q$SELECT public.prive_edition_issue('$q$ || repeat('a', 43) || $q$')::text$q$) LIKE 'ERR:PRIVE_NOT_PRO%',
  et.as_user(1, $q$SELECT public.prive_edition_issue('$q$ || repeat('a', 43) || $q$')::text$q$));
SELECT et.ok('E02 PRO sin 90 días tampoco (PRIVE_NOT_ELIGIBLE)',
  et.as_user(2, $q$SELECT public.prive_edition_library('$q$ || repeat('a', 43) || $q$')::text$q$) LIKE 'ERR:PRIVE_NOT_ELIGIBLE%',
  et.as_user(2, $q$SELECT public.prive_edition_library('$q$ || repeat('a', 43) || $q$')::text$q$));
SELECT et.ok('E03 miembro sin sesión Privé válida: PRIVE_SESSION_INVALID',
  et.as_user(3, $q$SELECT public.prive_edition_issue('$q$ || repeat('z', 43) || $q$')::text$q$) LIKE 'ERR:PRIVE_SESSION_INVALID%');
SELECT et.ok('E04 nadie lee las tablas de contenido directamente (ni miembro ni FREE)',
  et.as_user(3, 'SELECT count(*)::text FROM public.edition_articles') LIKE 'ERR:permission denied%'
  AND et.as_user(1, 'SELECT count(*)::text FROM public.edition_sources') LIKE 'ERR:permission denied%'
  AND et.as_user(3, 'SELECT count(*)::text FROM public.edition_images') LIKE 'ERR:permission denied%'
  AND et.as_user(3, 'SELECT count(*)::text FROM public.edition_issues') LIKE 'ERR:permission denied%');
SET ROLE anon;
SELECT et.ok('E05 anon no ejecuta las RPC', (SELECT has_function_privilege('anon', 'public.prive_edition_issue(text, text)', 'EXECUTE')) = false);
RESET ROLE;
SELECT et.ok('E06 borradores pendientes: el miembro no ve ningún número',
  et.as_user(3, format('SELECT public.prive_edition_issue(%L)->>''found''', et.tok(3))) = 'false'
  AND et.as_user(3, format('SELECT jsonb_array_length(public.prive_edition_library(%L)->''issues'')::text', et.tok(3))) = '0',
  et.as_user(3, format('SELECT public.prive_edition_issue(%L)::text', et.tok(3))));
SELECT et.ok('E07 artículo no aprobado no se sirve por slug',
  et.as_user(3, format('SELECT public.prive_edition_article(%L, %L)->>''found''', et.tok(3), 'cdmx-fin-de-semana-gran-premio')) = 'false');

-- prive_edition_status (20261025110000): estado honesto de la revista para FOR YOU sin exponer piezas.
SELECT et.ok('E45 sin número publicado el miembro ve solo el estado: en revisión, sin títulos ni piezas',
  et.as_user(3, format('SELECT (public.prive_edition_status(%L)->''latest'')::text', et.tok(3))) = 'null'
  AND et.as_user(3, format('SELECT public.prive_edition_status(%L)->>''in_review''', et.tok(3))) = 'true'
  AND et.as_user(3, format('SELECT public.prive_edition_status(%L)->>''published_count''', et.tok(3))) = '0'
  AND et.as_user(3, format('SELECT string_agg(k, '','' ORDER BY k) FROM jsonb_object_keys(public.prive_edition_status(%L)) k', et.tok(3)))
      = 'generated_at,in_review,latest,next_scheduled_for,prefs_saved,published_count'
  AND et.as_user(3, format('SELECT public.prive_edition_status(%L)::text', et.tok(3))) NOT LIKE '%cdmx%'
  AND et.as_user(3, format('SELECT public.prive_edition_status(%L)::text', et.tok(3))) NOT LIKE '%n01-noviembre%',
  et.as_user(3, format('SELECT public.prive_edition_status(%L)::text', et.tok(3))));
SELECT et.ok('E45b FREE, PRO sin Privé, sesión inválida y anon no obtienen ni el estado',
  et.as_user(1, $q$SELECT public.prive_edition_status('$q$ || repeat('a', 43) || $q$')::text$q$) LIKE 'ERR:PRIVE_NOT_PRO%'
  AND et.as_user(2, $q$SELECT public.prive_edition_status('$q$ || repeat('a', 43) || $q$')::text$q$) LIKE 'ERR:PRIVE_NOT_ELIGIBLE%'
  AND et.as_user(3, $q$SELECT public.prive_edition_status('$q$ || repeat('z', 43) || $q$')::text$q$) LIKE 'ERR:PRIVE_SESSION_INVALID%'
  AND NOT has_function_privilege('anon', 'public.prive_edition_status(text)', 'EXECUTE'));
SELECT et.ok('E45c correcciones de siembra aplicadas una sola vez (firma sin «borrador», Nobel confirmado y vinculado como fuente primaria)',
  (SELECT byline->>'es' FROM public.edition_articles WHERE slug = 'carta-del-editor-n01') = 'Dirección editorial de IATOS Privé'
  AND (SELECT version FROM public.edition_articles WHERE slug = 'carta-del-editor-n01') = 2
  AND (SELECT verification FROM public.edition_sources WHERE key = 'nobel_econ_2026') LIKE 'Página oficial leída el 22-oct-2026%'
  AND (SELECT count(*) FROM public.edition_reviews WHERE note LIKE 'Corrección de siembra (20261025110000)%') = 1
  AND EXISTS (SELECT 1 FROM public.edition_article_sources l JOIN public.edition_articles a ON a.id = l.article_id JOIN public.edition_sources x ON x.id = l.source_id
              WHERE a.slug = 'banxico-pausa-6-50' AND x.key = 'nobel_econ_2026'),
  (SELECT byline::text || ' v' || version FROM public.edition_articles WHERE slug = 'carta-del-editor-n01'));

-- ───────────── B. panel: solo admins ─────────────
SELECT et.ok('E08 un miembro no abre el panel (EDITION_NOT_ADMIN)',
  et.as_user(3, 'SELECT public.edition_admin_overview()::text') LIKE 'ERR:EDITION_NOT_ADMIN%'
  AND et.as_user(1, $q$SELECT public.edition_admin_preview(NULL)::text$q$) LIKE 'ERR:EDITION_NOT_ADMIN%');
SELECT et.ok('E09 el admin ve los 16 borradores en revisión y la vista previa',
  et.as_admin($q$SELECT jsonb_array_length(public.edition_admin_overview()->'articles')::text$q$) = '16'
  AND et.as_admin($q$SELECT (public.edition_admin_preview(NULL)->>'preview')$q$) = 'true'
  AND et.as_admin($q$SELECT jsonb_array_length(public.edition_admin_preview(NULL)->'articles')::text$q$) = '16');
SELECT et.ok('E10 un no-admin no puede marcar fuentes ni licencias',
  et.as_user(3, $q$SELECT public.edition_record_link_check('f1_calendar_2026', 'ok', 200)::text$q$) LIKE 'ERR:EDITION_NOT_ADMIN%'
  AND et.as_user(3, $q$SELECT public.edition_admin_image_license('img_reloj', 'approve', NULL)::text$q$) LIKE 'ERR:EDITION_NOT_ADMIN%');

-- ───────────── C. reglas editoriales que la base hace cumplir ─────────────
SELECT et.ok('E11 imagen sin licencia aprobada bloquea la aprobación',
  et.as_admin($q$SELECT public.edition_admin_article_transition('monaco-yacht-show-2026', 'approve')::text$q$) LIKE 'ERR:EDITION_CHECKS_FAILED%');
-- Aprobar licencias (todas menos la del reloj, que queda pendiente para E14).
SELECT count(*) FROM (SELECT et.as_admin(format($q$SELECT public.edition_admin_image_license(%L, 'approve', 'Pexels verificado')::text$q$, key))
  FROM public.edition_images WHERE key <> 'img_reloj') t;
SELECT et.ok('E12 fuente rota bloquea la aprobación',
  et.as_admin($q$SELECT public.edition_record_link_check('yachtbuyer_mys', 'broken', 404)::text$q$) = 'true'
  AND et.as_admin($q$SELECT public.edition_admin_article_transition('monaco-yacht-show-2026', 'approve')::text$q$) LIKE 'ERR:EDITION_CHECKS_FAILED%broken_source:yachtbuyer_mys%');
SELECT et.as_admin($q$SELECT public.edition_record_link_check('yachtbuyer_mys', 'ok', 200)::text$q$);
SELECT et.ok('E13 con fuentes sanas y licencias aprobadas, se aprueba',
  et.as_admin($q$SELECT public.edition_admin_article_transition('monaco-yacht-show-2026', 'approve', NULL, NULL, 'Dirección editorial')->>'ok'$q$) = 'true');
SELECT et.ok('E14 la imagen del reloj sigue sin licencia: su artículo no se aprueba',
  et.as_admin($q$SELECT public.edition_admin_article_transition('watches-and-wonders-2027', 'approve')::text$q$) LIKE 'ERR:EDITION_CHECKS_FAILED%image_not_licensed:img_reloj%');
INSERT INTO public.edition_images (key, provider, url, illustrative, depicts_es, alt_es)
VALUES ('img_sin_licencia', 'licensed_third_party', 'https://example.com/foto.jpg', false, 'Foto de prensa sin términos', 'Foto sin licencia')
ON CONFLICT (key) DO NOTHING;
SELECT et.ok('E15 imagen sin licencia/crédito no se puede aprobar; bloquear exige nota',
  et.as_admin($q$SELECT public.edition_admin_image_license('img_sin_licencia', 'approve', NULL)::text$q$) LIKE 'ERR:EDITION_LICENSE_INCOMPLETE%'
  AND et.as_admin($q$SELECT public.edition_admin_image_license('img_reloj', 'block', '')::text$q$) LIKE 'ERR:EDITION_NOTE_REQUIRED%');
-- Enlace comercial falso: un enlace "oficial" a un dominio que no es fuente del artículo.
SELECT et.ok('E16 enlace oficial a un dominio sin fuente se bloquea (enlace comercial falso)',
  et.as_admin($q$SELECT public.edition_admin_article_update('art-basel-miami-beach-2026', '{"actions":[{"kind":"official_link","url":"https://boletos-baratos.example.com/artbasel","label":{"es":"Boletos"}}]}'::jsonb, 'prueba')->'checks'->>'blocking'$q$) LIKE '%action_link_without_source:boletos-baratos.example.com%'
  AND et.as_admin($q$SELECT public.edition_admin_article_transition('art-basel-miami-beach-2026', 'approve')::text$q$) LIKE 'ERR:EDITION_CHECKS_FAILED%');
SELECT et.ok('E17 pieza sensible con una sola fuente no se aprueba',
  et.as_admin($q$SELECT public.edition_admin_article_update('brief-banxico-24-septiembre', '{"sources":[{"key":"banxico_anuncios","used_for":"x"}]}'::jsonb, 'prueba')->'checks'->>'blocking'$q$) LIKE '%sensitive_needs_two_sources%');
SELECT et.as_admin($q$SELECT public.edition_admin_article_update('brief-banxico-24-septiembre', '{"sources":[{"key":"banxico_anuncios","used_for":"Decisión"},{"key":"bbva_agenda_2026","used_for":"Fecha"}]}'::jsonb, 'restaurar')->>'ok'$q$);
SELECT et.ok('E18 breve con hecho de hace más de 90 días se bloquea (no historia presentada como nueva)',
  et.as_admin($q$SELECT public.edition_admin_article_update('brief-delta-aeromexico-tribunal', '{"fact_date":"2025-01-10"}'::jsonb, 'prueba')->'checks'->>'blocking'$q$) LIKE '%brief_fact_too_old%');
SELECT et.as_admin($q$SELECT public.edition_admin_article_update('brief-delta-aeromexico-tribunal', '{"fact_date":"2026-08-21"}'::jsonb, 'restaurar')->>'ok'$q$);
SELECT et.ok('E19 rechazar exige nota y deja el motivo',
  et.as_admin($q$SELECT public.edition_admin_article_transition('ue-ia-alto-riesgo-2027', 'reject')::text$q$) LIKE 'ERR:EDITION_NOTE_REQUIRED%'
  AND et.as_admin($q$SELECT public.edition_admin_article_transition('ue-ia-alto-riesgo-2027', 'reject', 'Confirmar fechas en EUR-Lex')->'article'->>'status'$q$) = 'rejected');

-- ───────────── D. publicación del número ─────────────
SELECT et.ok('E20 un número sin contenido suficiente no se aprueba',
  et.as_admin($q$SELECT public.edition_admin_issue_transition('n01-noviembre-2026', 'approve')::text$q$) LIKE 'ERR:EDITION_CHECKS_FAILED%not_enough_content%');
-- Aprobar las piezas que pasan las reglas (menos el artículo de IA rechazado y el del reloj sin licencia).
SELECT count(*) FROM (SELECT et.as_admin(format($q$SELECT public.edition_admin_article_transition(%L, 'approve')->>'ok'$q$, slug))
  FROM public.edition_articles WHERE status = 'pending_review' AND slug NOT IN ('watches-and-wonders-2027', 'art-basel-miami-beach-2026')) t;
SELECT et.as_admin($q$SELECT public.edition_admin_issue_transition('n01-noviembre-2026', 'approve')->>'ok'$q$) AS iss_appr \gset
SELECT et.as_admin($q$SELECT public.edition_admin_issue_transition('n01-noviembre-2026', 'publish')->>'ok'$q$) AS iss_pub \gset
SELECT et.ok('E21 número aprobado y publicado: publica solo lo aprobado',
  :'iss_appr' = 'true' AND :'iss_pub' = 'true'
  AND (SELECT count(*) FROM public.edition_articles WHERE status = 'published') = 13
  AND (SELECT status FROM public.edition_articles WHERE slug = 'watches-and-wonders-2027') = 'pending_review',
  :'iss_appr' || ' ' || :'iss_pub' || ' ' || (SELECT string_agg(slug || '=' || status, ', ') FROM public.edition_articles));
SELECT et.ok('E22 el miembro lee el número publicado (13 piezas) y nada pendiente o rechazado',
  et.as_user(3, format('SELECT jsonb_array_length(public.prive_edition_issue(%L)->''articles'')::text', et.tok(3))) = '13'
  AND et.as_user(3, format('SELECT (public.prive_edition_issue(%L)->''articles'')::text', et.tok(3))) NOT LIKE '%watches-and-wonders-2027%'
  AND et.as_user(3, format('SELECT (public.prive_edition_issue(%L)->''articles'')::text', et.tok(3))) NOT LIKE '%ue-ia-alto-riesgo-2027%'
  AND et.as_user(3, format('SELECT public.prive_edition_article(%L, %L)->>''found''', et.tok(3), 'watches-and-wonders-2027')) = 'false');
SELECT et.ok('E46 publicado el número, el estado da su portada (slug y número) y deja de decir «en revisión»',
  et.as_user(4, format('SELECT public.prive_edition_status(%L)->''latest''->>''slug''', et.tok(4))) = 'n01-noviembre-2026'
  AND et.as_user(4, format('SELECT public.prive_edition_status(%L)->>''published_count''', et.tok(4))) = '1'
  AND et.as_user(4, format('SELECT public.prive_edition_status(%L)->>''in_review''', et.tok(4))) = 'false',
  et.as_user(4, format('SELECT public.prive_edition_status(%L)::text', et.tok(4))));
SELECT et.ok('E23 el lector no recibe notas internas ni estado editorial',
  et.as_user(3, format('SELECT public.prive_edition_issue(%L)::text', et.tok(3))) NOT LIKE '%editor_notes%'
  AND et.as_user(3, format('SELECT public.prive_edition_issue(%L)::text', et.tok(3))) NOT LIKE '%"status"%'
  AND et.as_user(3, format('SELECT public.prive_edition_issue(%L)::text', et.tok(3))) NOT LIKE '%verification%');
SELECT et.ok('E24 cada artículo publicado llega con fuentes (URL, entidad, fecha de consulta)',
  et.as_user(3, format($q$SELECT bool_and(jsonb_array_length(a->'sources') > 0 OR a->>'format' = 'letter')::text FROM jsonb_array_elements(public.prive_edition_issue(%L)->'articles') a$q$, et.tok(3))) = 'true'
  AND et.as_user(3, format($q$SELECT bool_and(s ? 'url' AND s ? 'consulted_at' AND s ? 'entity' AND s ? 'reuse_rights')::text FROM jsonb_array_elements(public.prive_edition_issue(%L)->'articles') a, jsonb_array_elements(a->'sources') s$q$, et.tok(3))) = 'true');

-- Imagen bloqueada DESPUÉS de publicar: desaparece del cuerpo y del mapa de imágenes al instante.
SELECT et.as_admin($q$SELECT public.edition_admin_image_license('img_yate_mar', 'block', 'El autor retiró la foto')->>'ok'$q$);
SELECT et.ok('E25 imagen sin licencia (bloqueada) nunca se sirve: ni en el cuerpo ni en el mapa',
  et.as_user(3, format($q$SELECT (public.prive_edition_article(%L, 'monaco-yacht-show-2026'))::text$q$, et.tok(3))) NOT LIKE '%img_yate_mar%'
  AND et.as_user(3, format($q$SELECT (public.prive_edition_issue(%L)->'images')::text$q$, et.tok(3))) NOT LIKE '%img_yate_mar%'
  AND et.as_user(3, format($q$SELECT (public.prive_edition_issue(%L)->'images') ? 'img_monaco_puerto' $q$, et.tok(3)))::boolean);

-- ───────────── E. World Brief y vigencias ─────────────
SELECT et.ok('E26 World Brief: solo breves vigentes, ordenados por fecha del hecho',
  et.as_user(3, format($q$SELECT jsonb_array_length(public.prive_edition_world_brief(%L)->'items')::text$q$, et.tok(3)))::int >= 1
  AND et.as_user(3, format($q$SELECT bool_and(i->>'format' = 'brief' AND i ? 'fact_date')::text FROM jsonb_array_elements(public.prive_edition_world_brief(%L)->'items') i$q$, et.tok(3))) = 'true');
UPDATE public.edition_articles SET valid_until = public.edition_today() - 1 WHERE slug = 'brief-inegi-viajeros-agosto-2026';
SELECT et.ok('E27 un breve vencido sale del World Brief y se cuenta como vencido',
  et.as_user(3, format($q$SELECT (public.prive_edition_world_brief(%L)->'items')::text$q$, et.tok(3))) NOT LIKE '%brief-inegi-viajeros-agosto-2026%'
  AND et.as_user(3, format($q$SELECT (public.prive_edition_world_brief(%L)->>'expired_count')$q$, et.tok(3)))::int >= 1
  AND et.as_user(3, format($q$SELECT a->>'expired' FROM jsonb_array_elements(public.prive_edition_issue(%L)->'articles') a WHERE a->>'slug' = 'brief-inegi-viajeros-agosto-2026'$q$, et.tok(3))) = 'true');

-- ───────────── F. corregir, retirar, programar ─────────────
SELECT et.ok('E28 un artículo publicado no se edita en silencio: se corrige con nota pública',
  et.as_admin($q$SELECT public.edition_admin_article_update('pga-tour-los-cabos-2026', '{"dek":{"es":"x"}}'::jsonb)::text$q$) LIKE 'ERR:EDITION_USE_CORRECT%'
  AND et.as_admin($q$SELECT public.edition_admin_article_correct('pga-tour-los-cabos-2026', '{"dek":{"es":"El torneo se juega del 5 al 8 de noviembre."}}'::jsonb, '')::text$q$) LIKE 'ERR:EDITION_NOTE_REQUIRED%'
  AND et.as_admin($q$SELECT public.edition_admin_article_correct('pga-tour-los-cabos-2026', '{"dek":{"es":"El torneo se juega del 5 al 8 de noviembre."}}'::jsonb, 'Se precisó la entradilla.')->>'ok'$q$) = 'true'
  AND et.as_user(4, format($q$SELECT public.prive_edition_article(%L, 'pga-tour-los-cabos-2026')->'article'->'correction'->>'note'$q$, et.tok(4))) = 'Se precisó la entradilla.');
SELECT et.ok('E29 retirar exige nota; el lector recibe solo el aviso de retiro',
  et.as_admin($q$SELECT public.edition_admin_article_transition('brief-delta-aeromexico-tribunal', 'retract')::text$q$) LIKE 'ERR:EDITION_NOTE_REQUIRED%'
  AND et.as_admin($q$SELECT public.edition_admin_article_transition('brief-delta-aeromexico-tribunal', 'retract', 'El DOT reabrió el caso.')->'article'->>'status'$q$) = 'retracted'
  AND et.as_user(3, format($q$SELECT public.prive_edition_article(%L, 'brief-delta-aeromexico-tribunal')->'retracted'->>'note'$q$, et.tok(3))) = 'El DOT reabrió el caso.'
  AND et.as_user(3, format($q$SELECT public.prive_edition_article(%L, 'brief-delta-aeromexico-tribunal')::text$q$, et.tok(3))) NOT LIKE '%"body"%'
  AND et.as_user(3, format($q$SELECT (public.prive_edition_issue(%L)->'retracted')::text$q$, et.tok(3))) LIKE '%brief-delta-aeromexico-tribunal%');
-- Programar: el artículo rechazado vuelve, se aprueba (sin reloj) y se programa a futuro.
SELECT et.as_admin($q$SELECT public.edition_admin_article_update('ue-ia-alto-riesgo-2027', '{"editor_notes":"Fechas confirmadas"}'::jsonb)->>'ok'$q$);
SELECT et.as_admin($q$SELECT public.edition_admin_article_transition('ue-ia-alto-riesgo-2027', 'approve')->>'ok'$q$);
SELECT et.ok('E30 programado: invisible antes de su hora, visible después (sin cron)',
  et.as_admin(format($q$SELECT public.edition_admin_article_transition('ue-ia-alto-riesgo-2027', 'schedule', NULL, %L::timestamptz)->'article'->>'status'$q$, now() + interval '2 days')) = 'scheduled'
  AND et.as_user(3, format($q$SELECT public.prive_edition_article(%L, 'ue-ia-alto-riesgo-2027')->>'found'$q$, et.tok(3))) = 'false');
UPDATE public.edition_articles SET scheduled_for = now() - interval '1 minute' WHERE slug = 'ue-ia-alto-riesgo-2027';
SELECT et.ok('E30b llegada la hora, el lector lo ve',
  et.as_user(3, format($q$SELECT public.prive_edition_article(%L, 'ue-ia-alto-riesgo-2027')->>'found'$q$, et.tok(3))) = 'true');

-- ───────────── G. preferencias, guardados y descargas: del dueño ─────────────
SELECT et.ok('E31 preferencias con consentimiento guardan intereses e intensidad',
  et.as_user(3, format($q$SELECT public.prive_edition_prefs_save(%L, '{"edition_kind":"mi_mezcla","personalization_consent":true,"interests":{"gastronomia":3,"golf":1},"excluded":["finanzas_y_mercados"],"language":"en","reading_minutes":15,"section_order":["world_brief","portada"]}'::jsonb)->'interests'->>'gastronomia'$q$, et.tok(3))) = '3');
SELECT et.ok('E32 sin consentimiento no se guardan intereses',
  et.as_user(4, format($q$SELECT public.prive_edition_prefs_save(%L, '{"personalization_consent":false,"interests":{"gastronomia":3}}'::jsonb)->>'interests'$q$, et.tok(4))) = '{}');
SELECT et.ok('E33 intereses fuera de la lista o intensidad inválida se rechazan',
  et.as_user(3, format($q$SELECT public.prive_edition_prefs_save(%L, '{"personalization_consent":true,"interests":{"mujer":2}}'::jsonb)::text$q$, et.tok(3))) LIKE 'ERR:EDITION_BAD_PREFS%'
  AND et.as_user(3, format($q$SELECT public.prive_edition_prefs_save(%L, '{"personalization_consent":true,"interests":{"golf":7}}'::jsonb)::text$q$, et.tok(3))) LIKE 'ERR:EDITION_BAD_PREFS%');
SELECT et.ok('E34 RLS: cada quien ve solo sus preferencias; nadie escribe directo',
  et.as_user(4, 'SELECT count(*)::text FROM public.edition_member_prefs') = '1'
  AND et.as_user(4, format('SELECT count(*)::text FROM public.edition_member_prefs WHERE user_id = %L', et.u(3))) = '0'
  AND et.as_user(4, format($q$INSERT INTO public.edition_member_prefs (user_id) VALUES (%L) RETURNING 'x'$q$, et.u(3))) LIKE 'ERR:permission denied%'
  AND et.as_user(4, format($q$UPDATE public.edition_member_prefs SET language = 'es' WHERE user_id = %L RETURNING 'x'$q$, et.u(3))) LIKE 'ERR:permission denied%');
SELECT et.ok('E35 guardados (Reading List): del dueño; FREE no puede',
  et.as_user(3, format($q$SELECT public.prive_edition_save(%L, 'merida-guadalajara-mesa-mexicana', true)->>'ok'$q$, et.tok(3))) = 'true'
  AND et.as_user(3, format($q$SELECT jsonb_array_length(public.prive_edition_saved(%L)->'items')::text$q$, et.tok(3))) = '1'
  AND et.as_user(4, format($q$SELECT jsonb_array_length(public.prive_edition_saved(%L)->'items')::text$q$, et.tok(4))) = '0'
  AND et.as_user(4, 'SELECT count(*)::text FROM public.edition_saves') = '0'
  AND et.as_user(1, $q$SELECT public.prive_edition_save('$q$ || repeat('a', 43) || $q$', 'merida-guadalajara-mesa-mexicana', true)::text$q$) LIKE 'ERR:PRIVE_NOT_PRO%'
  AND et.as_user(4, format($q$INSERT INTO public.edition_saves (user_id, article_id) SELECT %L, id FROM public.edition_articles LIMIT 1 RETURNING 'x'$q$, et.u(4))) LIKE 'ERR:permission denied%');
SELECT et.ok('E36 no se puede guardar un artículo no publicado',
  et.as_user(3, format($q$SELECT public.prive_edition_save(%L, 'watches-and-wonders-2027', true)->>'code'$q$, et.tok(3))) = 'EDITION_NOT_FOUND');
SELECT et.ok('E37 descargas: registro propio y medible',
  et.as_user(3, format($q$SELECT public.prive_edition_log_download(%L, 'n01-noviembre-2026', 'pdf', 'issue', 13, 9, 2400000, 3100, 'es')::text$q$, et.tok(3))) = 'true'
  AND et.as_user(4, 'SELECT count(*)::text FROM public.edition_downloads') = '0'
  AND et.as_user(3, 'SELECT count(*)::text FROM public.edition_downloads') = '1');

-- ───────────── H. sesión, retiro del número, borrado de cuenta ─────────────
UPDATE public.prive_sessions SET expires_at = now() - interval '1 minute' WHERE user_id = et.u(4);
SELECT et.ok('E38 sesión Privé vencida: PRIVE_SESSION_EXPIRED',
  et.as_user(4, format('SELECT public.prive_edition_issue(%L)::text', et.tok(4))) LIKE 'ERR:PRIVE_SESSION_EXPIRED%');
SELECT et.ok('E39 el admin sigue viendo todo en el panel (bitácora con cada acción)',
  (SELECT count(*) FROM public.edition_reviews WHERE action IN ('approve','publish','correct','retract','license_approve','license_block','reject','schedule')) >= 15);
-- Borrado de cuenta: lo del miembro se va, el contenido se queda.
SELECT public.purge_account_data(et.u(3));
SELECT et.ok('E40 purge_account_data borra preferencias, guardados y descargas, y conserva la revista',
  NOT EXISTS (SELECT 1 FROM public.edition_member_prefs WHERE user_id = et.u(3))
  AND NOT EXISTS (SELECT 1 FROM public.edition_saves WHERE user_id = et.u(3))
  AND NOT EXISTS (SELECT 1 FROM public.edition_downloads WHERE user_id = et.u(3))
  AND (SELECT count(*) FROM public.edition_articles) = 16);
SELECT et.as_admin($q$SELECT public.edition_admin_issue_transition('n01-noviembre-2026', 'retract', 'Prueba de retiro')->'issue'->'retracted'->>'note'$q$) AS iss_ret \gset
SELECT et.ok('E41 retirar el número completo deja solo avisos',
  :'iss_ret' = 'Prueba de retiro' AND (SELECT count(*) FROM public.edition_articles WHERE status = 'published') = 0, :'iss_ret');
SELECT et.ok('E42 ninguna tabla de contenido tiene columna user_id (borrar a un editor no borra artículos)',
  NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'user_id'
              AND table_name IN ('edition_sources','edition_images','edition_issues','edition_articles','edition_article_sources')));
SELECT et.ok('E43 toda RPC prive_edition_* empieza con v_uid := public.prive_require(_ps) (sin sesión Privé no sale nada)',
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname LIKE 'prive\_edition\_%') = 10
  AND NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname LIKE 'prive\_edition\_%'
    AND (regexp_replace(p.prosrc, '^\s*DECLARE[^;]*(;[^;]*)*?BEGIN\s*', '', 's') !~ '^v_uid := public\.prive_require\(_ps\);' OR NOT p.prosecdef
         OR NOT EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%'))));
SELECT et.ok('E44 funciones del panel: no las ejecuta anon; las de edición exigen admins por dentro',
  NOT has_function_privilege('anon', 'public.edition_admin_overview()', 'EXECUTE')
  AND (SELECT bool_and(p.prosrc LIKE '%edition_admin_require()%') FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname LIKE 'edition\_admin\_%' AND p.proname <> 'edition_admin_require'));
