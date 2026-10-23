-- Pruebas de 20261027130000_prive_sesion_larga (pedido del dueño): contraseña Privé de 8 caracteres y
-- sesión recordada con vigencia deslizante de 365 días que se sigue cerrando al perder el derecho, al
-- cerrar sesión en IATOS, al cambiar/restablecer/reportar la contraseña, con "Cerrar todas mis sesiones",
-- con el bloqueo total y con la revocación. Cada caso imprime "OK <id> …" o "FALLA <id> …".
-- Roles reales: "como usuario" pone los claims del JWT y SET ROLE authenticated; el servidor, service_role.
\set ON_ERROR_STOP off
\pset tuples_only on
RESET ROLE;

DROP SCHEMA IF EXISTS psl CASCADE;
CREATE SCHEMA psl;
GRANT USAGE ON SCHEMA psl TO anon, authenticated, service_role;

CREATE FUNCTION psl.u(n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT ('a7000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid $$;
CREATE FUNCTION psl.sid(n int) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT 'b7000000-0000-0000-0000-' || lpad(n::text, 12, '0') $$;
CREATE FUNCTION psl.ok(name text, cond boolean, detail text DEFAULT NULL) RETURNS text LANGUAGE sql AS $$
  SELECT CASE WHEN coalesce(cond, false) THEN 'OK ' || name ELSE 'FALLA ' || name || ' ' || coalesce(detail, '(sin detalle)') END $$;
-- Contraseña de 8 caracteres (el nuevo mínimo): "Faro20" + 2 dígitos.
CREATE FUNCTION psl.pw(n int) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT 'Faro20' || lpad(n::text, 2, '0') $$;

-- Miembro activo: PRO vigente, 100 días pagados, invitación aceptada y contraseña Privé de 8 caracteres.
CREATE FUNCTION psl.member(n int) RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO auth.users (id, email, email_confirmed_at, raw_user_meta_data)
  VALUES (psl.u(n), 'psl' || n || '@example.test', now(), jsonb_build_object('full_name', 'Psl ' || n)) ON CONFLICT DO NOTHING;
  INSERT INTO public.profiles (id, full_name, email) VALUES (psl.u(n), 'Psl ' || n, 'psl' || n || '@example.test') ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.subscriptions (user_id, status, stripe_subscription_id, stripe_customer_id, current_period_end)
  VALUES (psl.u(n), 'active', 'sub_psl' || n, 'cus_psl' || n, now() + interval '20 days')
  ON CONFLICT (user_id) DO UPDATE SET status = 'active', current_period_end = now() + interval '20 days';
  PERFORM public.prive_record_paid_period(psl.u(n), 'in_psl_' || n, 'sub_psl' || n, 'cus_psl' || n,
    now() - interval '100 days', now() + interval '1 day', 19900, 'mxn', 'test');
  PERFORM public.prive_invite_user(psl.u(n), 'tenure', 'system');
  PERFORM public.prive_accept_invitation(psl.u(n), NULL);
  RETURN public.prive_set_password(psl.u(n), psl.pw(n), 'ok');
END $$;
CREATE FUNCTION psl.auth_login(n int, sid int) RETURNS void LANGUAGE sql AS $$
  INSERT INTO auth.sessions (id, user_id) VALUES (psl.sid(sid)::uuid, psl.u(n)) ON CONFLICT DO NOTHING $$;
-- Desbloqueo + recordar, como lo hace prive-access (service_role) desde 20261027130000.
CREATE FUNCTION psl.open(n int, sid int, pw text DEFAULT NULL, remember boolean DEFAULT true) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE r jsonb; m jsonb;
BEGIN
  SET LOCAL ROLE service_role;
  r := public.prive_unlock(psl.u(n), coalesce(pw, psl.pw(n)), NULL, psl.sid(sid));
  IF remember AND (r->>'ok')::boolean THEN
    m := public.prive_remember_session(psl.u(n), (r->>'session_id')::uuid);
    r := r || jsonb_build_object('remember', m);
  END IF;
  RESET ROLE;
  RETURN r;
END $$;
CREATE FUNCTION psl.req_as(n int, sid int, ps text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', psl.u(n)::text, true),
          set_config('request.jwt.claim.role', 'authenticated', true),
          set_config('request.jwt.claims', jsonb_build_object('sub', psl.u(n), 'role', 'authenticated',
            'aud', 'authenticated', 'exp', extract(epoch FROM now() + interval '50 minutes')::bigint, 'session_id', psl.sid(sid))::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.prive_require(ps);
    v := 'OK';
  EXCEPTION WHEN raise_exception THEN v := SQLERRM;
            WHEN OTHERS THEN v := 'ERROR ' || SQLSTATE || ': ' || SQLERRM;
  END;
  RESET ROLE;
  RETURN v;
END $$;
CREATE FUNCTION psl.row(tok text) RETURNS public.prive_sessions LANGUAGE sql AS $$
  SELECT * FROM public.prive_sessions WHERE token_hash = public.prive_sha256_hex(tok) $$;
CREATE FUNCTION psl.sweep() RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE r jsonb; BEGIN SET LOCAL ROLE service_role; r := public.prive_sweep(); RESET ROLE; RETURN r; END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA psl TO authenticated, service_role;

-- ===================================================================== C · contraseña: 8–72 bytes
SELECT psl.ok('C01 7 bytes → PASSWORD_WEAK; 8 bytes sirve; 72 sirve; 73 no (bcrypt)',
  public.prive_password_problem('Faro202', 'ok') = 'PASSWORD_WEAK'
  AND public.prive_password_problem('Faro2026', 'ok') IS NULL
  AND public.prive_password_problem('Faro2026' || repeat('x', 64), 'ok') IS NULL
  AND public.prive_password_problem('Faro2026' || repeat('x', 65), 'ok') = 'PASSWORD_WEAK'
  AND public.prive_password_problem(repeat('ñ', 4), 'ok') = 'PASSWORD_WEAK');
SELECT psl.ok('C02 lo demás sigue igual: 5 caracteres distintos, filtrada (HIBP) y breach_check válido',
  public.prive_password_problem('aaaabbbb', 'ok') = 'PASSWORD_WEAK'
  AND public.prive_password_problem('Faro2026', 'breached') = 'PASSWORD_BREACHED'
  AND public.prive_password_problem('Faro2026', 'mentira') = 'PASSWORD_WEAK'
  AND public.prive_password_problem('Faro2026', NULL) = 'PASSWORD_WEAK'
  AND public.prive_password_problem(NULL, 'ok') = 'PASSWORD_WEAK');
SELECT psl.member(1) AS m1 \gset
SELECT psl.ok('C03 fijar una contraseña de 8 caracteres funciona (y se guarda solo como bcrypt)',
  (:'m1'::jsonb->>'ok')::boolean
  AND (SELECT password_hash LIKE '$2%' AND password_hash <> psl.pw(1) FROM prive_credentials WHERE user_id = psl.u(1)), :'m1');
SELECT psl.member(2) AS m2 \gset
SET ROLE service_role;
SELECT public.prive_change_password(psl.u(2), psl.pw(2), 'Corta-7', 'ok') AS cp2short \gset
SELECT public.prive_request_reset(psl.u(2)) AS rt2 \gset
SELECT public.prive_complete_reset(psl.u(2), :'rt2', 'Corta-7', 'ok') AS cr2short \gset
RESET ROLE;
SELECT psl.ok('C04 cambiar o restablecer a 7 caracteres → PASSWORD_WEAK',
  :'cp2short'::jsonb->>'code' = 'PASSWORD_WEAK' AND :'cr2short'::jsonb->>'code' = 'PASSWORD_WEAK', :'cp2short' || ' ' || :'cr2short');

-- ===================================================================== V · vigencia larga y deslizante
SELECT psl.auth_login(1, 101);
SELECT psl.open(1, 101) AS o1 \gset
SELECT :'o1'::jsonb->>'token' AS t1 \gset
SELECT psl.ok('V01 sesión recordada: vence a los 365 días y queda marcada como recordada',
  (:'o1'::jsonb->'remember'->>'ok')::boolean
  AND (SELECT remember AND expires_at BETWEEN now() + interval '364 days 23 hours' AND now() + interval '365 days 1 minute' FROM psl.row(:'t1')),
  :'o1');
SELECT psl.ok('V02 el aviso en la app sale una vez (dedup por persona) y la bitácora registra la sesión',
  (SELECT count(*) FROM notifications WHERE user_id = psl.u(1) AND dedup_key = 'prive_remember:' || psl.u(1)::text) = 1
  AND EXISTS (SELECT 1 FROM prive_membership_events WHERE user_id = psl.u(1) AND event = 'session_remembered'));
SELECT psl.auth_login(1, 102);
SELECT psl.open(1, 102) AS o1b \gset
SELECT :'o1b'::jsonb->>'token' AS t1b \gset
SELECT psl.ok('V03 un segundo inicio de sesión NO manda otra notificación',
  (:'o1b'::jsonb->'remember'->>'ok')::boolean
  AND (SELECT count(*) FROM notifications WHERE user_id = psl.u(1) AND dedup_key LIKE 'prive_remember:%') = 1
  AND (SELECT count(*) FROM prive_membership_events WHERE user_id = psl.u(1) AND event = 'session_remembered') = 2);
-- Sin cierre por inactividad de 2 h ni de 7 días.
UPDATE prive_sessions SET last_seen_at = now() - interval '3 hours' WHERE token_hash = public.prive_sha256_hex(:'t1');
SELECT psl.sweep() AS sw1 \gset
SELECT psl.ok('V04 3 h sin uso: sigue abierta (prive_require y barrido)', psl.req_as(1, 101, :'t1') = 'OK' AND (psl.row(:'t1')).revoked_at IS NULL, psl.req_as(1, 101, :'t1'));
UPDATE prive_sessions SET last_seen_at = now() - interval '200 days', expires_at = now() + interval '165 days' WHERE token_hash = public.prive_sha256_hex(:'t1');
SELECT psl.sweep() AS sw2 \gset
SELECT psl.req_as(1, 101, :'t1') AS r1slide \gset
SELECT psl.ok('V05 200 días sin uso: sigue abierta y el uso corre su vencimiento a 365 días desde hoy (deslizante)',
  :'r1slide' = 'OK' AND (psl.row(:'t1')).revoked_at IS NULL
  AND (psl.row(:'t1')).last_seen_at > now() - interval '1 minute'
  AND (psl.row(:'t1')).expires_at BETWEEN now() + interval '364 days 23 hours' AND now() + interval '365 days 1 minute',
  :'r1slide' || ' ' || (psl.row(:'t1')).expires_at::text);
SELECT psl.ok('V06 límites: recordada 365 días sin uso; normal (o NULL) 2 h',
  (SELECT public.prive_session_idle_limit(true) = interval '365 days' AND public.prive_session_idle_limit(false) = interval '2 hours'
          AND public.prive_session_idle_limit(NULL) = interval '2 hours'));
UPDATE prive_sessions SET last_seen_at = now() - interval '366 days', expires_at = now() + interval '1 day' WHERE token_hash = public.prive_sha256_hex(:'t1b');
SELECT psl.req_as(1, 102, :'t1b') AS r1idle \gset
SELECT psl.sweep() AS sw3 \gset
SELECT psl.ok('V07 límite técnico: 366 días sin uso → PRIVE_SESSION_EXPIRED y el barrido la cierra (idle)',
  :'r1idle' = 'PRIVE_SESSION_EXPIRED' AND (psl.row(:'t1b')).revoke_reason = 'idle' AND psl.req_as(1, 102, :'t1b') = 'PRIVE_SESSION_EXPIRED', :'r1idle');
UPDATE prive_sessions SET expires_at = now() - interval '1 second' WHERE token_hash = public.prive_sha256_hex(:'t1');
SELECT psl.req_as(1, 101, :'t1') AS r1exp \gset
SELECT psl.ok('V08 con el vencimiento pasado no revive al usarla', :'r1exp' = 'PRIVE_SESSION_EXPIRED' AND (psl.row(:'t1')).expires_at < now(), :'r1exp');
-- La que pide explícitamente no recordar (remember=false) sigue en 12 h / 2 h.
SELECT psl.auth_login(1, 103);
SELECT (psl.open(1, 103, NULL, false))->>'token' AS t1c \gset
UPDATE prive_sessions SET last_seen_at = now() - interval '3 hours' WHERE token_hash = public.prive_sha256_hex(:'t1c');
SELECT psl.ok('V09 sin recordar (remember=false) sigue en 12 h y 2 h de inactividad',
  NOT (psl.row(:'t1c')).remember AND (psl.row(:'t1c')).expires_at <= now() + interval '12 hours'
  AND psl.req_as(1, 103, :'t1c') = 'PRIVE_SESSION_EXPIRED', psl.req_as(1, 103, :'t1c'));

-- ===================================================================== X · se sigue cerrando
-- X01 al perder PRO (en cada llamada) y en el barrido.
SELECT psl.member(3);
SELECT psl.auth_login(3, 301);
SELECT (psl.open(3, 301))->>'token' AS t3 \gset
SELECT psl.req_as(3, 301, :'t3') AS r3a \gset
UPDATE subscriptions SET current_period_end = now() - interval '1 minute' WHERE user_id = psl.u(3);
SELECT psl.req_as(3, 301, :'t3') AS r3b \gset
SELECT psl.sweep() AS sw4 \gset
UPDATE subscriptions SET current_period_end = now() + interval '20 days' WHERE user_id = psl.u(3);
SELECT psl.ok('X01 recordada: al dejar de ser PRO → PRIVE_NOT_PRO y el barrido la cierra (not_entitled); volver a PRO no la revive',
  :'r3a' = 'OK' AND :'r3b' = 'PRIVE_NOT_PRO' AND (psl.row(:'t3')).revoke_reason = 'not_entitled'
  AND psl.req_as(3, 301, :'t3') = 'PRIVE_SESSION_INVALID', :'r3a' || ' ' || :'r3b' || ' ' || coalesce((psl.row(:'t3')).revoke_reason, 'viva'));
-- X02 al cerrar sesión en IATOS (AUD-01) y en el barrido.
SELECT psl.auth_login(3, 302);
SELECT (psl.open(3, 302))->>'token' AS t3b \gset
SELECT psl.req_as(3, 302, :'t3b') AS r3c \gset
DELETE FROM auth.sessions WHERE id = psl.sid(302)::uuid;
SELECT psl.req_as(3, 302, :'t3b') AS r3d \gset
SELECT psl.sweep() AS sw5 \gset
SELECT psl.ok('X02 recordada: cerrar sesión en IATOS la invalida al instante y el barrido la cierra (auth_session_gone)',
  :'r3c' = 'OK' AND :'r3d' = 'PRIVE_SESSION_INVALID' AND (psl.row(:'t3b')).revoke_reason = 'auth_session_gone', :'r3c' || ' ' || :'r3d');
-- X03 al cambiar la contraseña.
SELECT psl.auth_login(3, 303);
SELECT (psl.open(3, 303))->>'token' AS t3c \gset
SET ROLE service_role; SELECT public.prive_change_password(psl.u(3), psl.pw(3), 'Nueva-psl-3', 'ok') AS cp3 \gset
RESET ROLE;
SELECT psl.ok('X03 recordada: cambiar la contraseña la cierra', (:'cp3'::jsonb->>'ok')::boolean AND psl.req_as(3, 303, :'t3c') = 'PRIVE_SESSION_INVALID', :'cp3');
-- X04 al restablecer la contraseña.
SELECT (psl.open(3, 303, 'Nueva-psl-3'))->>'token' AS t3d \gset
SET ROLE service_role;
SELECT public.prive_request_reset(psl.u(3)) AS rt3 \gset
SELECT public.prive_complete_reset(psl.u(3), :'rt3', 'Otra-psl-3', 'ok') AS cr3 \gset
RESET ROLE;
SELECT psl.ok('X04 recordada: restablecer la contraseña la cierra', (:'cr3'::jsonb->>'ok')::boolean AND psl.req_as(3, 303, :'t3d') = 'PRIVE_SESSION_INVALID', :'cr3');
-- X05 al reportarla comprometida.
SELECT (psl.open(3, 303, 'Otra-psl-3'))->>'token' AS t3e \gset
SELECT psl.req_as(3, 303, :'t3e') AS r3e \gset
SET ROLE service_role; SELECT public.prive_report_compromised(psl.u(3)) AS rc3 \gset
RESET ROLE;
SELECT psl.ok('X05 recordada: "contraseña comprometida" la cierra', :'r3e' = 'OK' AND psl.req_as(3, 303, :'t3e') <> 'OK', :'r3e' || ' ' || psl.req_as(3, 303, :'t3e'));
-- X06 "Cerrar todas mis sesiones".
SELECT psl.member(4);
SELECT psl.auth_login(4, 401);
SELECT psl.auth_login(4, 402);
SELECT (psl.open(4, 401))->>'token' AS t4a \gset
SELECT (psl.open(4, 402))->>'token' AS t4b \gset
SET ROLE service_role; SELECT public.prive_revoke_sessions(psl.u(4), 'user_revoke_all') AS rv4 \gset
RESET ROLE;
SELECT psl.ok('X06 "Cerrar todas mis sesiones" cierra todas las recordadas',
  :'rv4'::int = 2 AND psl.req_as(4, 401, :'t4a') = 'PRIVE_SESSION_INVALID' AND psl.req_as(4, 402, :'t4b') = 'PRIVE_SESSION_INVALID', :'rv4');
-- X07 bloqueo total (15 fallos).
SELECT (psl.open(4, 401))->>'token' AS t4c \gset
SELECT psl.req_as(4, 401, :'t4c') AS r4c \gset
DO $$ DECLARE i int; BEGIN
  FOR i IN 1..15 LOOP
    UPDATE public.prive_credentials SET locked_until = NULL WHERE user_id = psl.u(4);
    PERFORM public.prive_unlock(psl.u(4), 'mala-clave-psl-' || i, NULL, psl.sid(401));
  END LOOP;
END $$;
SELECT psl.ok('X07 recordada: el bloqueo total la cierra',
  :'r4c' = 'OK' AND (SELECT hard_locked FROM prive_credentials WHERE user_id = psl.u(4)) AND psl.req_as(4, 401, :'t4c') <> 'OK',
  :'r4c' || ' ' || psl.req_as(4, 401, :'t4c'));
-- X08 revocación por el dueño.
SELECT psl.member(5);
SELECT psl.auth_login(5, 501);
SELECT (psl.open(5, 501))->>'token' AS t5 \gset
SELECT psl.req_as(5, 501, :'t5') AS r5a \gset
SET ROLE service_role; SELECT public.admin_revoke_prive(psl.u(5), 'admin', 'prueba de revocación', 'dueno') AS rv5 \gset
RESET ROLE;
SELECT psl.ok('X08 recordada: la revocación la cierra (PRIVE_REVOKED en cada llamada)',
  :'r5a' = 'OK' AND (:'rv5'::jsonb->>'sessions_closed')::int = 1 AND psl.req_as(5, 501, :'t5') = 'PRIVE_REVOKED'
  AND (psl.row(:'t5')).revoke_reason = 'membership_revoked', psl.req_as(5, 501, :'t5'));
-- X09 el token de otra cuenta nunca sirve, aunque sea recordado.
SELECT psl.auth_login(1, 104);
SELECT (psl.open(1, 104))->>'token' AS t1d \gset
SELECT psl.member(6);
SELECT psl.auth_login(6, 601);
SELECT psl.ok('X09 una sesión recordada no sirve con la cuenta de otra persona',
  psl.req_as(1, 104, :'t1d') = 'OK' AND psl.req_as(6, 601, :'t1d') = 'PRIVE_SESSION_INVALID');

-- ===================================================================== A · acceso: anon y authenticated
SELECT psl.ok('A01 anon y authenticated no leen prive_sessions ni ejecutan las funciones de servidor',
  NOT has_table_privilege('anon', 'public.prive_sessions', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.prive_sessions', 'SELECT')
  AND NOT has_function_privilege('anon', 'public.prive_remember_session(uuid, uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.prive_remember_session(uuid, uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.prive_session_idle_limit(boolean)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.prive_password_problem(text, text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.prive_require(text)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.prive_require(text)', 'EXECUTE'));
SET ROLE anon;
DO $$ BEGIN
  PERFORM public.prive_remember_session('a7000000-0000-0000-0000-000000000001', gen_random_uuid());
  RAISE NOTICE 'FALLA A02 anon pudo llamar prive_remember_session';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'OK A02 anon no puede llamar prive_remember_session';
END $$;
RESET ROLE;

-- ===================================================================== M · sesiones ya abiertas al aplicar la migración
-- Se recrea el estado de antes: sesiones normales (12 h / 2 h) de una cuenta con derecho.
SELECT psl.member(7);
SELECT psl.auth_login(7, 701);
SELECT psl.auth_login(7, 702);
SELECT (psl.open(7, 701, NULL, false))->>'token' AS m7a \gset
SELECT (psl.open(7, 701, NULL, false))->>'token' AS m7b \gset
SELECT (psl.open(7, 702, NULL, false))->>'token' AS m7c \gset
SELECT (psl.open(7, 701, NULL, false))->>'token' AS m7d \gset
UPDATE prive_sessions SET last_seen_at = now() - interval '10 minutes' WHERE token_hash = public.prive_sha256_hex(:'m7a');
UPDATE prive_sessions SET last_seen_at = now() - interval '3 hours' WHERE token_hash = public.prive_sha256_hex(:'m7b');
DELETE FROM auth.sessions WHERE id = psl.sid(702)::uuid;
UPDATE prive_sessions SET revoked_at = now(), revoke_reason = 'user_lock' WHERE token_hash = public.prive_sha256_hex(:'m7d');
-- Cuántas filas tocaría en esta base (la misma consulta que usa la migración):
SELECT count(*) AS would FROM public.prive_sessions s
 WHERE s.revoked_at IS NULL AND s.expires_at > now()
   AND s.last_seen_at >= now() - public.prive_session_idle_limit(s.remember)
   AND (NOT s.remember OR s.expires_at < s.last_seen_at + public.prive_session_idle_limit(true))
   AND public.prive_auth_session_alive(s.user_id, s.auth_session_id) \gset
\ir ../../migrations/20261027130000_prive_sesion_larga.sql
SELECT psl.ok('M01 la activa pasa a recordada con 365 días desde su último uso; la inactiva, la de Auth cerrada y la revocada no reviven',
  (psl.row(:'m7a')).remember AND (psl.row(:'m7a')).expires_at BETWEEN now() + interval '364 days 23 hours 49 minutes' AND now() + interval '364 days 23 hours 51 minutes'
  AND psl.req_as(7, 701, :'m7a') = 'OK'
  AND NOT (psl.row(:'m7b')).remember AND psl.req_as(7, 701, :'m7b') = 'PRIVE_SESSION_EXPIRED'
  AND NOT (psl.row(:'m7c')).remember
  AND NOT (psl.row(:'m7d')).remember AND (psl.row(:'m7d')).revoked_at IS NOT NULL,
  'would=' || :'would');
SELECT count(*) AS would2 FROM public.prive_sessions s
 WHERE s.revoked_at IS NULL AND s.expires_at > now()
   AND s.last_seen_at >= now() - public.prive_session_idle_limit(s.remember)
   AND (NOT s.remember OR s.expires_at < s.last_seen_at + public.prive_session_idle_limit(true))
   AND public.prive_auth_session_alive(s.user_id, s.auth_session_id) \gset
SELECT (SELECT expires_at FROM psl.row(:'m7a'))::text AS m7exp \gset
\ir ../../migrations/20261027130000_prive_sesion_larga.sql
SELECT psl.ok('M02 idempotente: la segunda pasada no encuentra nada que cambiar y no mueve vencimientos',
  :'would'::int >= 1 AND :'would2'::int = 0 AND (psl.row(:'m7a')).expires_at::text = :'m7exp', 'would=' || :'would' || ' would2=' || :'would2');
SELECT 'INFO M filas que la migración extendería en esta base de prueba antes de aplicarla: ' || :'would';

DROP SCHEMA psl CASCADE;
