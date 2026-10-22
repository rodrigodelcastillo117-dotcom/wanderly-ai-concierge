-- Pruebas de IATOS Privé (grupo core): antigüedad, elegibilidad, invitaciones, contraseña,
-- sesiones, bloqueos, concesiones, revocaciones y permisos. La corre run.sh sobre una base desechable.
-- Cada caso imprime "OK <id> …" o "FALLA <id> …". El tiempo se simula moviendo fechas en las filas
-- (como superusuario de la base de prueba), nunca esperando.
\set ON_ERROR_STOP off
\pset tuples_only on
RESET ROLE;

-- ===================================================================== utilidades de prueba
DROP SCHEMA IF EXISTS pt CASCADE;
CREATE SCHEMA pt;
GRANT USAGE ON SCHEMA pt TO anon, authenticated, service_role;
CREATE TABLE pt.secrets (label text PRIMARY KEY, value text NOT NULL);  -- contraseñas y tokens emitidos (para el escaneo final)
GRANT ALL ON pt.secrets TO service_role;

CREATE FUNCTION pt.u(n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT ('a0000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pt.sid(n int) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT 'b0000000-0000-0000-0000-' || lpad(n::text, 12, '0') $$;
CREATE FUNCTION pt.ok(name text, cond boolean, detail text DEFAULT NULL) RETURNS text LANGUAGE sql AS $$
  SELECT CASE WHEN coalesce(cond, false) THEN 'OK ' || name ELSE 'FALLA ' || name || ' ' || coalesce(detail, '(sin detalle)') END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pt TO anon, authenticated, service_role;

CREATE FUNCTION pt.mk_user(n int, nombre text) RETURNS uuid LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO auth.users (id, email, email_confirmed_at, raw_user_meta_data)
  VALUES (pt.u(n), 'prive' || n || '@example.test', now(), jsonb_build_object('full_name', nombre)) ON CONFLICT DO NOTHING;
  INSERT INTO public.profiles (id, full_name, email) VALUES (pt.u(n), nombre, 'prive' || n || '@example.test') ON CONFLICT (id) DO NOTHING;
  RETURN pt.u(n);
END $$;
-- PRO pagado vigente (Stripe activo).
CREATE FUNCTION pt.pro(n int) RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.subscriptions (user_id, status, stripe_subscription_id, stripe_customer_id, current_period_end)
  VALUES (pt.u(n), 'active', 'sub_' || n, 'cus_' || n, now() + interval '20 days')
  ON CONFLICT (user_id) DO UPDATE SET status = 'active', current_period_end = now() + interval '20 days',
    stripe_subscription_id = 'sub_' || n, stripe_customer_id = 'cus_' || n, cancel_at_period_end = false $$;
-- Periodo pagado de "desde hace A días" a "hasta hace B días" (B negativo = en el futuro).
CREATE FUNCTION pt.paid(n int, a numeric, b numeric, inv text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.prive_record_paid_period(pt.u(n), inv, 'sub_' || n, 'cus_' || n,
    now() - make_interval(secs => a * 86400), now() - make_interval(secs => b * 86400), 19900, 'mxn', 'test') $$;
-- r2 (N-02): una invitación por concesión se acepta con el token del correo (como al abrir el enlace).
CREATE FUNCTION pt.accept_link(n int) RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.prive_accept_invitation(pt.u(n),
    public.prive_sha256_hex((SELECT token FROM public.prive_claim_invitation_emails(10, pt.u(n)) LIMIT 1))) $$;
CREATE FUNCTION pt.member(n int, pw text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE r jsonb;
BEGIN
  PERFORM public.prive_invite_user(pt.u(n), 'tenure', 'system');
  r := public.prive_accept_invitation(pt.u(n), NULL);
  IF NOT (r->>'ok')::boolean THEN RETURN r; END IF;
  INSERT INTO pt.secrets VALUES ('pw' || n || ':' || md5(pw), pw) ON CONFLICT DO NOTHING;
  RETURN public.prive_set_password(pt.u(n), pw, 'ok');
END $$;
-- Desbloqueo como lo haría prive-access (service_role) con la sesión de Auth n.
CREATE FUNCTION pt.unlock(n int, pw text, sid int, ip text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE r jsonb;
BEGIN
  INSERT INTO auth.sessions (id, user_id) VALUES (pt.sid(sid)::uuid, pt.u(n)) ON CONFLICT DO NOTHING;
  r := public.prive_unlock(pt.u(n), pw, ip, pt.sid(sid));
  IF r ? 'token' THEN INSERT INTO pt.secrets VALUES ('tok:' || (r->>'session_id'), r->>'token') ON CONFLICT DO NOTHING; END IF;
  RETURN r;
END $$;
-- "Inicia sesión" en el contexto actual (PostgREST pone estos valores con el JWT).
CREATE FUNCTION pt.login(n int, sid int) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.sub', CASE WHEN n IS NULL THEN '' ELSE pt.u(n)::text END, false),
         set_config('request.jwt.claim.role', 'authenticated', false),
         set_config('request.jwt.claims', CASE WHEN n IS NULL THEN '{}' ELSE jsonb_build_object('sub', pt.u(n), 'role', 'authenticated',
           'session_id', CASE WHEN sid IS NULL THEN NULL ELSE pt.sid(sid) END)::text END, false) $$;
-- prive_require como lo llamaría una RPC de contenido: devuelve 'OK' o el código del error.
CREATE FUNCTION pt.req(ps text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.prive_require(ps);
  RETURN 'OK';
EXCEPTION WHEN raise_exception THEN RETURN SQLERRM;
END $$;
-- Requiere como usuario n en la sesión de Auth sid (vuelve a superusuario al terminar).
CREATE FUNCTION pt.req_as(n int, sid int, ps text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  PERFORM pt.login(n, sid);
  SET LOCAL ROLE authenticated;
  v := pt.req(ps);
  RESET ROLE;
  RETURN v;
END $$;
-- Una RPC de contenido declarada STABLE (solo lectura) también debe poder llamar prive_require.
CREATE FUNCTION pt.stable_content(ps text) RETURNS text LANGUAGE plpgsql STABLE AS $$
BEGIN
  PERFORM public.prive_require(ps);
  RETURN 'OK';
EXCEPTION WHEN raise_exception THEN RETURN SQLERRM;
END $$;
CREATE FUNCTION pt.tok(sid_label uuid) RETURNS text LANGUAGE sql AS $$ SELECT value FROM pt.secrets WHERE label = 'tok:' || sid_label $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pt TO anon, authenticated, service_role;

-- Todas las cuentas de prueba (1..60).
SELECT count(*) FROM (SELECT pt.mk_user(n, CASE n WHEN 2 THEN 'Valentina <b>Ruiz</b>' ELSE 'Persona ' || n END) FROM generate_series(1, 60) n) t;

-- ===================================================================== A. antigüedad y elegibilidad
SELECT pt.pro(1); SELECT pt.paid(1, 89, -1, 'in_1');
SELECT pt.pro(2); SELECT pt.paid(2, 90, -1, 'in_2');
SET ROLE service_role;
SELECT count(*) FROM (SELECT * FROM public.prive_evaluate_eligibility(500)) e;
RESET ROLE;
SELECT pt.ok('P01 PRO con 89 días pagados: no elegible, sin invitación',
  public.prive_tenure_days(pt.u(1)) = 89 AND NOT public.prive_is_eligible(pt.u(1))
  AND NOT EXISTS (SELECT 1 FROM prive_memberships WHERE user_id = pt.u(1))
  AND NOT EXISTS (SELECT 1 FROM prive_invitations WHERE user_id = pt.u(1)),
  'tenure=' || public.prive_tenure_days(pt.u(1)));
SELECT pt.ok('P02 PRO con 90 días pagados: elegible e invitado una vez',
  public.prive_tenure_days(pt.u(2)) = 90
  AND (SELECT status FROM prive_memberships WHERE user_id = pt.u(2)) = 'invited'
  AND (SELECT count(*) FROM prive_invitations WHERE user_id = pt.u(2)) = 1
  AND (SELECT count(*) FROM notifications WHERE user_id = pt.u(2) AND dedup_key = 'prive_invite:' || pt.u(2)) = 1
  AND (SELECT member_code ~ '^IP-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$' FROM prive_memberships WHERE user_id = pt.u(2)),
  'tenure=' || public.prive_tenure_days(pt.u(2)));
-- Re-correr el cron: ni otra invitación, ni otro aviso; y el correo sale una sola vez.
SET ROLE service_role;
SELECT count(*) FROM (SELECT * FROM public.prive_evaluate_eligibility(500)) e;
SELECT invitation_id AS inv2, token AS invtok2, email AS invmail2, first_name AS invname2 FROM public.prive_claim_invitation_emails(50, pt.u(2)) \gset
SELECT public.prive_mark_invitation_email(:'inv2', true, 'msg_test_1', NULL);
SELECT count(*) AS reclaim2 FROM public.prive_claim_invitation_emails(50, pt.u(2)) \gset
SELECT count(*) FROM (SELECT * FROM public.prive_evaluate_eligibility(500)) e;
RESET ROLE;
INSERT INTO pt.secrets VALUES ('invtok2a', :'invtok2');
SELECT pt.ok('P03 re-correr el cron no duplica invitación, aviso ni correo',
  (SELECT count(*) FROM prive_invitations WHERE user_id = pt.u(2)) = 1
  AND (SELECT count(*) FROM notifications WHERE user_id = pt.u(2) AND type = 'prive') = 1
  AND (SELECT email_status FROM prive_invitations WHERE user_id = pt.u(2)) = 'sent'
  AND :reclaim2 = 0 AND :'invmail2' = 'prive2@example.test'
  AND (SELECT count(*) FROM prive_membership_events WHERE user_id = pt.u(2) AND event = 'invited') = 1,
  'reclaim=' || :reclaim2);

-- Prueba gratis: factura de $0 (prueba o cupón 100 %) nunca se registra; 120 días en prueba = 0.
INSERT INTO subscriptions (user_id, status, current_period_end, trial_end) VALUES (pt.u(3), 'trialing', now() + interval '5 days', now() + interval '5 days')
  ON CONFLICT (user_id) DO UPDATE SET status = 'trialing', current_period_end = EXCLUDED.current_period_end;
SELECT pt.ok('P04 los días de prueba gratis no cuentan',
  public.prive_record_paid_period(pt.u(3), 'in_3_trial', NULL, NULL, now() - interval '120 days', now() + interval '5 days', 0, 'mxn', 'test')->>'reason' = 'zero_amount'
  AND public.is_pro(pt.u(3)) AND public.prive_tenure_days(pt.u(3)) = 0 AND NOT public.prive_is_eligible(pt.u(3)),
  'tenure=' || public.prive_tenure_days(pt.u(3)));

-- Discontinuos y encimados: [200,170] ∪ [180,150] = 50 días (10 encimados cuentan una vez),
-- + [100,60] = 40, + [10,-20] = solo 10 transcurridos. Total 100.
SELECT pt.pro(4);
SELECT pt.paid(4, 200, 170, 'in_4a'), pt.paid(4, 180, 150, 'in_4b'), pt.paid(4, 100, 60, 'in_4c'), pt.paid(4, 10, -20, 'in_4d');
SELECT pt.ok('P05 periodos discontinuos sumados sin contar dos veces lo encimado (y sin días futuros)',
  public.prive_tenure_days(pt.u(4)) = 100, 'tenure=' || public.prive_tenure_days(pt.u(4)));
-- Mes corto: febrero 2026 (28 días) + marzo (31) + abril (30) = 89 → con el 1 de mayo, 90.
SELECT pt.pro(5);
SELECT public.prive_record_paid_period(pt.u(5), 'in_5_feb', 'sub_5', 'cus_5', '2026-02-01T06:00:00Z', '2026-03-01T06:00:00Z', 19900, 'mxn', 'test'),
       public.prive_record_paid_period(pt.u(5), 'in_5_mar', 'sub_5', 'cus_5', '2026-03-01T06:00:00Z', '2026-04-01T06:00:00Z', 19900, 'mxn', 'test'),
       public.prive_record_paid_period(pt.u(5), 'in_5_abr', 'sub_5', 'cus_5', '2026-04-01T06:00:00Z', '2026-05-01T06:00:00Z', 19900, 'mxn', 'test');
SELECT pt.ok('P05b febrero cuenta sus 28 días reales (feb+mar+abr = 89, no 90)',
  public.prive_tenure_days(pt.u(5)) = 89, 'tenure=' || public.prive_tenure_days(pt.u(5)));
SELECT public.prive_record_paid_period(pt.u(5), 'in_5_may', 'sub_5', 'cus_5', '2026-05-01T06:00:00Z', '2026-06-01T06:00:00Z', 19900, 'mxn', 'test');
SELECT pt.ok('P05c al pagar mayo llega a 120 y es elegible', public.prive_tenure_days(pt.u(5)) = 120 AND public.prive_is_eligible(pt.u(5)),
  'tenure=' || public.prive_tenure_days(pt.u(5)));

-- ===================================================================== B. reembolsos, disputas
-- Miembro activo (95 días en 3 facturas), con sesión Privé abierta.
SELECT pt.pro(6); SELECT pt.paid(6, 95, 60, 'in_6a'), pt.paid(6, 60, 30, 'in_6b'), pt.paid(6, 30, -1, 'in_6c');
SELECT pt.member(6, 'Seis-clave-larga-06');
SELECT (pt.unlock(6, 'Seis-clave-larga-06', 6))->>'token' AS t6 \gset
SET ROLE service_role;
SELECT public.prive_mark_paid_period('in_6b', 'refund_full', 19900) AS r6 \gset
RESET ROLE;
SELECT pt.ok('P06 reembolso total quita sus días y pausa el acceso',
  (:'r6'::jsonb->>'after') = 'refunded' AND public.prive_tenure_days(pt.u(6)) = 65
  AND pt.req_as(6, 6, :'t6') = 'PRIVE_NOT_ELIGIBLE'
  AND (SELECT count(*) FROM prive_sessions WHERE user_id = pt.u(6) AND revoked_at IS NULL) = 0
  AND (SELECT status FROM prive_memberships WHERE user_id = pt.u(6)) = 'active',
  :'r6' || ' req=' || pt.req_as(6, 6, :'t6'));
SELECT public.prive_mark_paid_period('in_6a', 'refund_partial', 5000);
SELECT pt.ok('P06b reembolso parcial: el periodo sigue contando',
  (SELECT status FROM pro_paid_periods WHERE stripe_invoice_id = 'in_6a') = 'partially_refunded' AND public.prive_tenure_days(pt.u(6)) = 65);

SELECT pt.pro(7); SELECT pt.paid(7, 100, 40, 'in_7a'), pt.paid(7, 40, -1, 'in_7b');
SELECT pt.member(7, 'Siete-clave-larga-07');
SELECT (pt.unlock(7, 'Siete-clave-larga-07', 7))->>'token' AS t7 \gset
SELECT public.prive_mark_paid_period('in_7b', 'dispute_opened', NULL);
SELECT pt.req_as(7, 7, :'t7') AS r7a \gset
SELECT public.prive_tenure_days(pt.u(7)) AS d7a \gset
SELECT public.prive_mark_paid_period('in_7b', 'dispute_won', NULL);
SELECT (pt.unlock(7, 'Siete-clave-larga-07', 7))->>'token' AS t7b \gset
SELECT pt.ok('P07 disputa abierta excluye el periodo; ganada lo restaura',
  :'r7a' = 'PRIVE_NOT_ELIGIBLE' AND :d7a = 60 AND public.prive_tenure_days(pt.u(7)) = 100
  AND (SELECT status FROM pro_paid_periods WHERE stripe_invoice_id = 'in_7b') = 'paid'
  AND pt.req_as(7, 7, :'t7b') = 'OK',
  'abierta=' || :'r7a' || ' dias=' || :d7a || ' luego=' || public.prive_tenure_days(pt.u(7)));

SELECT pt.pro(8); SELECT pt.paid(8, 100, 40, 'in_8a'), pt.paid(8, 40, -1, 'in_8b');
SELECT public.prive_mark_paid_period('in_8b', 'refund_partial', 1000), public.prive_mark_paid_period('in_8b', 'dispute_opened', NULL),
       public.prive_mark_paid_period('in_8b', 'dispute_lost', NULL), public.prive_mark_paid_period('in_8b', 'dispute_won', NULL);
SELECT pt.ok('P08 disputa perdida: el periodo deja de contar y no vuelve',
  (SELECT status FROM pro_paid_periods WHERE stripe_invoice_id = 'in_8b') = 'dispute_lost' AND public.prive_tenure_days(pt.u(8)) = 60);
SELECT public.prive_mark_paid_period('in_8a', 'dispute_opened', NULL), public.prive_mark_paid_period('in_8a', 'dispute_won', NULL);
SELECT pt.ok('P08b disputa ganada de un periodo con reembolso parcial vuelve a "partially_refunded" si lo era',
  (SELECT status FROM pro_paid_periods WHERE stripe_invoice_id = 'in_8a') = 'paid'
  AND public.prive_mark_paid_period('nope', 'refund_full', 1)->>'reason' = 'no_period');

-- ===================================================================== C. cancelación, vencimiento, reactivación, fraude
SELECT pt.pro(9); SELECT pt.paid(9, 120, -10, 'in_9');
SELECT pt.member(9, 'Nueve-clave-larga-09');
SELECT (pt.unlock(9, 'Nueve-clave-larga-09', 9))->>'token' AS t9 \gset
UPDATE subscriptions SET cancel_at_period_end = true WHERE user_id = pt.u(9);
SELECT pt.ok('P09 cancelar la renovación con periodo pagado vigente conserva el acceso', pt.req_as(9, 9, :'t9') = 'OK', pt.req_as(9, 9, :'t9'));
UPDATE subscriptions SET current_period_end = now() - interval '1 minute' WHERE user_id = pt.u(9);
SELECT pt.ok('P10 PRO terminado: PRIVE_NOT_PRO aunque la sesión Privé siga viva y la contraseña sea correcta',
  pt.req_as(9, 9, :'t9') = 'PRIVE_NOT_PRO'
  AND (pt.unlock(9, 'Nueve-clave-larga-09', 9))->>'reason' = 'PRIVE_NOT_PRO',
  pt.req_as(9, 9, :'t9'));
SET ROLE service_role; SELECT public.prive_sweep() AS sw10 \gset
RESET ROLE;
SELECT pt.ok('P10b el barrido cierra las sesiones de quien ya no es PRO',
  (SELECT count(*) FROM prive_sessions WHERE user_id = pt.u(9) AND revoked_at IS NULL) = 0
  AND (SELECT revoke_reason FROM prive_sessions WHERE user_id = pt.u(9) ORDER BY created_at LIMIT 1) = 'not_entitled', :'sw10');
SELECT pt.pro(9);
SELECT (pt.unlock(9, 'Nueve-clave-larga-09', 9))->>'token' AS t9b \gset
SELECT pt.ok('P11 reactivar PRO devuelve Privé sin repetir 90 días ni otra invitación',
  pt.req_as(9, 9, :'t9b') = 'OK' AND (SELECT count(*) FROM prive_invitations WHERE user_id = pt.u(9)) = 1
  AND (SELECT status FROM prive_memberships WHERE user_id = pt.u(9)) = 'active');

SET ROLE service_role;
SELECT public.admin_revoke_prive(pt.u(9), 'fraud', 'Contracargos repetidos documentados en Stripe', 'dueno@iatos.test') AS rv9 \gset
SELECT count(*) FROM (SELECT * FROM public.prive_evaluate_eligibility(500)) e;
RESET ROLE;
SELECT pt.ok('P12 revocación por fraude: bloquea aunque haya PRO y 90 días; el cron no re-invita',
  pt.req_as(9, 9, :'t9b') = 'PRIVE_REVOKED' AND (pt.unlock(9, 'Nueve-clave-larga-09', 9))->>'reason' = 'PRIVE_REVOKED'
  AND (SELECT revoke_kind FROM prive_memberships WHERE user_id = pt.u(9)) = 'fraud'
  AND (SELECT count(*) FROM prive_invitations WHERE user_id = pt.u(9) AND accepted_at IS NULL AND revoked_at IS NULL) = 0
  AND (SELECT actor FROM prive_membership_events WHERE user_id = pt.u(9) AND event = 'revoked') = 'admin:dueno@iatos.test', :'rv9');
SELECT pt.pro(10); SELECT pt.paid(10, 100, -1, 'in_10');
SET ROLE service_role;
SELECT public.admin_revoke_prive(pt.u(10), 'fraud', 'Tarjeta robada (caso 123)', 'dueno@iatos.test');
SELECT count(*) FROM (SELECT * FROM public.prive_evaluate_eligibility(500)) e;
RESET ROLE;
SELECT pt.ok('P12b fraude antes de la invitación: la membresía nace revocada y nunca se invita',
  (SELECT status FROM prive_memberships WHERE user_id = pt.u(10)) = 'revoked' AND NOT EXISTS (SELECT 1 FROM prive_invitations WHERE user_id = pt.u(10)));
SET ROLE service_role; SELECT public.admin_restore_prive(pt.u(9), 'Revisión: el caso se resolvió a favor', 'dueno@iatos.test'); RESET ROLE;
SELECT (pt.unlock(9, 'Nueve-clave-larga-09', 9))->>'token' AS t9c \gset
SELECT pt.ok('P12c restaurar por administrador devuelve el acceso (queda en la bitácora)',
  pt.req_as(9, 9, :'t9c') = 'OK' AND EXISTS (SELECT 1 FROM prive_membership_events WHERE user_id = pt.u(9) AND event = 'restored'));

-- ===================================================================== D. cuenta vieja (respaldo de facturas)
INSERT INTO subscriptions (user_id, status, stripe_subscription_id, stripe_customer_id, current_period_end)
VALUES (pt.u(11), 'active', 'sub_11', 'cus_11', now() + interval '10 days') ON CONFLICT (user_id) DO NOTHING;
SET ROLE service_role;
SELECT public.prive_record_paid_period(NULL, 'in_11_' || k, NULL, 'cus_11', ('2025-0' || k || '-05')::timestamptz, ('2025-0' || k || '-05')::timestamptz + interval '31 days', 19900, 'mxn', 'backfill')
  FROM generate_series(1, 4) k;
SELECT public.prive_record_paid_period(NULL, 'in_11_' || k, NULL, 'cus_11', ('2025-0' || k || '-05')::timestamptz, ('2025-0' || k || '-05')::timestamptz + interval '31 days', 19900, 'mxn', 'backfill')
  FROM generate_series(1, 4) k;
SELECT public.prive_record_paid_period(NULL, 'in_11_zero', NULL, 'cus_11', '2025-06-05', '2025-07-05', 0, 'mxn', 'backfill') AS z11 \gset
SELECT count(*) FROM (SELECT * FROM public.prive_evaluate_eligibility(500)) e;
RESET ROLE;
-- 4 facturas de 31 días desde el 5 de cada mes: se enciman 3 días en marzo (feb tiene 28), así que la
-- unión es del 5-ene al 6-may de 2025 = 121 días, no 124.
SELECT pt.ok('P13 cuenta vieja con facturas respaldadas (por cliente de Stripe): 121 días sin contar dos veces, sin duplicar al re-correr, invitada',
  (SELECT count(*) FROM pro_paid_periods WHERE user_id = pt.u(11)) = 4 AND public.prive_tenure_days(pt.u(11)) = 121
  AND (SELECT bool_and(source = 'backfill') FROM pro_paid_periods WHERE user_id = pt.u(11))
  AND (:'z11'::jsonb->>'reason') = 'zero_amount'
  AND (SELECT status FROM prive_memberships WHERE user_id = pt.u(11)) = 'invited',
  'tenure=' || public.prive_tenure_days(pt.u(11)));
SELECT pt.ok('P13b una factura ya ligada a otra cuenta no se mueve',
  public.prive_record_paid_period(pt.u(12), 'in_11_1', NULL, NULL, '2025-01-05', '2025-02-05', 19900, 'mxn', 'backfill')->>'reason' = 'invoice_belongs_to_other_account'
  AND public.prive_record_paid_period(NULL, 'in_x', 'sub_nadie', 'cus_nadie', '2025-01-05', '2025-02-05', 19900, 'mxn', 'backfill')->>'reason' = 'unknown_user');

-- ===================================================================== E. concesiones de administrador
-- Con PRO de cortesía (comped): la cortesía no acumula antigüedad; Privé solo por concesión.
INSERT INTO subscriptions (user_id, status) VALUES (pt.u(13), 'comped') ON CONFLICT (user_id) DO UPDATE SET status = 'comped';
SET ROLE service_role;
SELECT public.admin_grant_prive('PRIVE13@example.test', 'Embajadora de marca 2026', NULL, 'dueno@iatos.test') AS g13 \gset
SELECT public.admin_grant_prive('prive13@example.test', 'Embajadora de marca 2026 (ampliada)', now() + interval '1 year', 'dueno@iatos.test') AS g13b \gset
RESET ROLE;
SELECT pt.ok('P14 concesión con PRO (cortesía): invitada con base "grant" sin antigüedad pagada',
  (:'g13'::jsonb->>'action') = 'invited' AND public.prive_tenure_days(pt.u(13)) = 0
  AND (SELECT basis FROM prive_memberships WHERE user_id = pt.u(13)) = 'grant'
  AND (:'g13b'::jsonb->>'updated')::boolean AND (SELECT count(*) FROM prive_grants WHERE email = 'prive13@example.test') = 1, :'g13');
SET ROLE service_role;
SELECT public.admin_grant_prive('prive14@example.test', 'Invitado especial del dueño', NULL, 'dueno@iatos.test') AS g14 \gset
SELECT count(*) FROM (SELECT * FROM public.prive_evaluate_eligibility(500)) e;
RESET ROLE;
SELECT pt.ok('P15 concesión sin PRO: no se invita y prive_require responde PRIVE_NOT_PRO',
  (:'g14'::jsonb->>'action') = 'pending_pro' AND NOT EXISTS (SELECT 1 FROM prive_memberships WHERE user_id = pt.u(14))
  AND pt.req_as(14, 14, repeat('x', 43)) = 'PRIVE_NOT_PRO', :'g14');
SELECT pt.pro(14);
SET ROLE service_role; SELECT count(*) FROM (SELECT * FROM public.prive_evaluate_eligibility(500)) e; RESET ROLE;
SELECT pt.ok('P15b al volverse PRO, el cron lo invita por la concesión',
  (SELECT basis || ':' || status FROM prive_memberships WHERE user_id = pt.u(14)) = 'grant:invited');
-- Concesión a un correo sin cuenta: se liga al registrarse; y al cambiar de correo a uno concedido.
SET ROLE service_role;
SELECT public.admin_grant_prive('nueva.persona@example.test', 'Socia fundadora', NULL, 'dueno@iatos.test') AS g61 \gset
SELECT public.admin_grant_prive('cambio@example.test', 'Prensa', NULL, 'dueno@iatos.test');
RESET ROLE;
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES (pt.u(61), 'Nueva.Persona@example.test', now());
UPDATE auth.users SET email = 'cambio@example.test' WHERE id = pt.u(15);
-- r2 (N-02): el cambio de correo ya no liga la concesión por sí solo (la confirmación de la fila es la
-- del correo anterior). El dueño la liga al volver a concederla, que busca la cuenta por el correo.
SELECT (SELECT user_id IS NULL FROM prive_grants WHERE email = 'cambio@example.test') AS p16c \gset
SET ROLE service_role;
SELECT public.admin_grant_prive('cambio@example.test', 'Prensa (verificada)', NULL, 'dueno@iatos.test');
RESET ROLE;
SELECT pt.ok('P16 concesión por correo: se aplica al registrarse; al cambiar el correo, solo cuando el dueño la vuelve a conceder',
  (:'g61'::jsonb->>'action') = 'pending_signup'
  AND (SELECT user_id FROM prive_grants WHERE email = 'nueva.persona@example.test') = pt.u(61)
  AND :'p16c'::boolean
  AND (SELECT user_id FROM prive_grants WHERE email = 'cambio@example.test') = pt.u(15)
  AND public.prive_has_grant(pt.u(61)) AND public.prive_has_grant(pt.u(15)));
UPDATE auth.users SET email = 'prive15@example.test' WHERE id = pt.u(15);
-- Vencimiento: concesión de 1 día para un miembro sin antigüedad, con sesión abierta.
SELECT pt.pro(16);
SET ROLE service_role;
SELECT public.admin_grant_prive('prive16@example.test', 'Prueba de vigencia', now() + interval '1 day', 'dueno@iatos.test') AS g16 \gset
RESET ROLE;
SELECT pt.accept_link(16);
SELECT public.prive_set_password(pt.u(16), 'Dieciseis-clave-16', 'ok');
INSERT INTO pt.secrets VALUES ('pw16', 'Dieciseis-clave-16');
SELECT (pt.unlock(16, 'Dieciseis-clave-16', 16))->>'token' AS t16 \gset
SELECT pt.req_as(16, 16, :'t16') AS r16a \gset
UPDATE prive_grants SET valid_from = now() - interval '3 days', valid_until = now() - interval '1 second' WHERE email = 'prive16@example.test';
SET ROLE service_role; SELECT public.prive_sweep(); RESET ROLE;
SELECT pt.ok('P17 la concesión vence: el acceso se pausa (PRIVE_NOT_ELIGIBLE) y el barrido cierra la sesión',
  :'r16a' = 'OK' AND pt.req_as(16, 16, :'t16') = 'PRIVE_NOT_ELIGIBLE'
  AND (SELECT count(*) FROM prive_sessions WHERE user_id = pt.u(16) AND revoked_at IS NULL) = 0, :'r16a');
-- Revocar la concesión de un miembro con sesión.
SELECT (pt.unlock(13, 'x', 13))->>'reason' AS r13 \gset
SELECT pt.accept_link(13);
SELECT public.prive_set_password(pt.u(13), 'Trece-clave-larga-13', 'ok');
INSERT INTO pt.secrets VALUES ('pw13', 'Trece-clave-larga-13');
SELECT (pt.unlock(13, 'Trece-clave-larga-13', 13))->>'token' AS t13 \gset
SELECT pt.req_as(13, 13, :'t13') AS r13a \gset
SET ROLE service_role;
SELECT public.admin_revoke_prive_grant((SELECT id FROM prive_grants WHERE email = 'prive13@example.test'), 'Fin del convenio', 'dueno@iatos.test') AS rg13 \gset
RESET ROLE;
SELECT pt.ok('P18 revocar la concesión cierra sus sesiones y pausa el acceso',
  :'r13' = 'PRIVE_NOT_ACTIVATED' AND :'r13a' = 'OK' AND (:'rg13'::jsonb->>'sessions_closed')::int = 1
  AND pt.req_as(13, 13, :'t13') = 'PRIVE_NOT_ELIGIBLE', :'rg13');

-- ===================================================================== F. invitaciones: reenviar, reenviada, caducada
SELECT pt.pro(17); SELECT pt.paid(17, 100, -1, 'in_17');
SET ROLE service_role;
SELECT count(*) FROM (SELECT * FROM public.prive_evaluate_eligibility(500)) e;
SELECT token AS it17a FROM public.prive_claim_invitation_emails(10, pt.u(17)) \gset
SELECT public.prive_resend_invitation(pt.u(17)) AS rs17 \gset
SELECT token AS it17b FROM public.prive_claim_invitation_emails(10, pt.u(17)) \gset
RESET ROLE;
INSERT INTO pt.secrets VALUES ('it17a', :'it17a'), ('it17b', :'it17b');
SELECT pt.ok('P19 reenviar la invitación: la anterior deja de servir y queda una sola viva',
  (:'rs17'::jsonb->>'ok')::boolean
  AND public.prive_accept_invitation(pt.u(17), public.prive_sha256_hex(:'it17a'))->>'code' = 'INVITATION_EXPIRED'
  AND (SELECT count(*) FROM prive_invitations WHERE user_id = pt.u(17) AND accepted_at IS NULL AND revoked_at IS NULL) = 1, :'rs17');
-- Reenviada a otra cuenta (18): no se acepta, se registra en ambas cuentas.
SELECT pt.pro(18); SELECT pt.paid(18, 100, -1, 'in_18');
SELECT public.prive_accept_invitation(pt.u(18), public.prive_sha256_hex(:'it17b')) AS fw18 \gset
SELECT pt.ok('P20 invitación reenviada usada por otra cuenta: INVITATION_OTHER_ACCOUNT y registrada',
  (:'fw18'::jsonb->>'code') = 'INVITATION_OTHER_ACCOUNT'
  AND (SELECT status FROM prive_memberships WHERE user_id = pt.u(17)) = 'invited'
  AND NOT EXISTS (SELECT 1 FROM prive_memberships WHERE user_id = pt.u(18))
  AND EXISTS (SELECT 1 FROM prive_auth_attempts WHERE user_id = pt.u(18) AND kind = 'accept' AND reason = 'other_account')
  AND EXISTS (SELECT 1 FROM prive_membership_events WHERE user_id = pt.u(17) AND event = 'invitation_used_by_other_account'
              AND details->>'attempted_by' = pt.u(18)::text), :'fw18');
SELECT public.prive_accept_invitation(pt.u(17), public.prive_sha256_hex(:'it17b')) AS ac17 \gset
SELECT public.prive_accept_invitation(pt.u(17), NULL) AS ac17b \gset
SELECT pt.ok('P21 la dueña sí la acepta con el enlace (y aceptar dos veces es inofensivo)',
  (:'ac17'::jsonb->>'ok')::boolean AND (:'ac17b'::jsonb->>'already')::boolean
  AND (SELECT status FROM prive_memberships WHERE user_id = pt.u(17)) = 'active');
-- Caducada (30 días).
SELECT pt.pro(19); SELECT pt.paid(19, 100, -1, 'in_19');
SET ROLE service_role;
SELECT count(*) FROM (SELECT * FROM public.prive_evaluate_eligibility(500)) e;
SELECT token AS it19 FROM public.prive_claim_invitation_emails(10, pt.u(19)) \gset
RESET ROLE;
INSERT INTO pt.secrets VALUES ('it19', :'it19');
UPDATE prive_invitations SET created_at = now() - interval '31 days', expires_at = now() - interval '1 day' WHERE user_id = pt.u(19);
SELECT pt.ok('P22 enlace de invitación caducado: INVITATION_EXPIRED',
  public.prive_accept_invitation(pt.u(19), public.prive_sha256_hex(:'it19'))->>'code' = 'INVITATION_EXPIRED'
  AND public.prive_accept_invitation(pt.u(19), repeat('0', 64))->>'code' = 'NO_INVITATION');
SET ROLE service_role; SELECT public.prive_sweep(); SELECT public.prive_resend_invitation(pt.u(19)) AS rs19 \gset
RESET ROLE;
SELECT pt.ok('P22b el barrido revoca la caducada y la persona puede pedir otra',
  (SELECT count(*) FROM prive_invitations WHERE user_id = pt.u(19) AND revoked_at IS NOT NULL) = 1 AND (:'rs19'::jsonb->>'ok')::boolean
  AND (SELECT count(*) FROM prive_invitations WHERE user_id = pt.u(19) AND accepted_at IS NULL AND revoked_at IS NULL) = 1, :'rs19');
SELECT public.prive_resend_invitation(pt.u(19)), public.prive_resend_invitation(pt.u(19));
SELECT pt.ok('P22c reenviar tiene tope: 3 por día', public.prive_resend_invitation(pt.u(19))->>'code' = 'RATE_LIMITED');
-- Fallo de correo con reintentos: 15 min, 1 h, 6 h, 24 h y se rinde al quinto.
SELECT pt.pro(20); SELECT pt.paid(20, 100, -1, 'in_20');
SET ROLE service_role;
SELECT count(*) FROM (SELECT * FROM public.prive_evaluate_eligibility(500)) e;
SELECT invitation_id AS inv20 FROM public.prive_claim_invitation_emails(10, pt.u(20)) \gset
SELECT public.prive_mark_invitation_email(:'inv20', false, NULL, 'resend_500');
RESET ROLE;
SELECT pt.ok('P23 correo fallido: reintento en 15 min y no antes',
  (SELECT email_status = 'failed' AND email_next_attempt_at BETWEEN now() + interval '14 minutes' AND now() + interval '16 minutes'
     FROM prive_invitations WHERE id = :'inv20')
  AND (SELECT count(*) FROM public.prive_claim_invitation_emails(10, pt.u(20))) = 0);
UPDATE prive_invitations SET email_attempts = 4, email_next_attempt_at = now() - interval '1 second' WHERE id = :'inv20';
SET ROLE service_role;
SELECT count(*) FROM public.prive_claim_invitation_emails(10, pt.u(20));
SELECT public.prive_mark_invitation_email(:'inv20', false, NULL, 'resend_500') AS m20 \gset
RESET ROLE;
UPDATE prive_invitations SET email_next_attempt_at = now() - interval '1 second' WHERE id = :'inv20';
SELECT pt.ok('P23b al quinto intento fallido deja de reintentar',
  (:'m20'::jsonb->>'gave_up')::boolean AND (SELECT count(*) FROM public.prive_claim_invitation_emails(10, pt.u(20))) = 0, :'m20');
SELECT public.prive_accept_invitation(pt.u(20), NULL) AS ac20 \gset
SELECT pt.ok('P23c aceptar sin token desde el aviso de la app funciona (el token no es la autoridad)',
  (:'ac20'::jsonb->>'ok')::boolean AND (SELECT status FROM prive_memberships WHERE user_id = pt.u(20)) = 'active');
SELECT pt.ok('P23d sin PRO no se acepta; sin 90 días tampoco',
  public.prive_accept_invitation(pt.u(21), NULL)->>'code' = 'NOT_PRO'
  AND public.prive_accept_invitation(pt.u(1), NULL)->>'code' = 'NOT_ELIGIBLE');

-- ===================================================================== G. sesiones Privé
SELECT pt.pro(22); SELECT pt.paid(22, 100, -1, 'in_22'); SELECT pt.member(22, 'Veintidos-clave-22');
SELECT (pt.unlock(22, 'Veintidos-clave-22', 221))->>'token' AS t22a \gset
SELECT pt.ok('P24 sesión válida en su sesión de Auth', pt.req_as(22, 221, :'t22a') = 'OK');
SELECT pt.ok('P25 otra sesión de Auth (session_id distinto) → PRIVE_SESSION_INVALID', pt.req_as(22, 222, :'t22a') = 'PRIVE_SESSION_INVALID');
SELECT pt.ok('P25b JWT sin session_id con una sesión ligada → PRIVE_SESSION_INVALID', pt.req_as(22, NULL, :'t22a') = 'PRIVE_SESSION_INVALID');
-- Otro dispositivo: debe desbloquear de nuevo, pero no queda bloqueado.
SELECT (pt.unlock(22, 'Veintidos-clave-22', 222))->>'token' AS t22b \gset
SELECT pt.ok('P26 otro dispositivo desbloquea de nuevo sin bloqueo; las dos sesiones Privé valen a la vez',
  pt.req_as(22, 222, :'t22b') = 'OK' AND pt.req_as(22, 221, :'t22a') = 'OK'
  AND (SELECT failed_count FROM prive_credentials WHERE user_id = pt.u(22)) = 0);
-- Cerrar sesión en IATOS (la fila de auth.sessions desaparece) invalida la sesión Privé ligada.
DELETE FROM auth.sessions WHERE id = pt.sid(221)::uuid;
SELECT pt.ok('P27 sesión de Auth cerrada o vencida → PRIVE_SESSION_INVALID', pt.req_as(22, 221, :'t22a') = 'PRIVE_SESSION_INVALID');
SET ROLE service_role; SELECT public.prive_revoke_sessions(pt.u(22), 'user_revoke_all') AS ra22 \gset
RESET ROLE;
SELECT pt.ok('P28 "cerrar todas" mata las dos sesiones y avisa',
  :ra22 = 2 AND pt.req_as(22, 222, :'t22b') = 'PRIVE_SESSION_INVALID'
  AND EXISTS (SELECT 1 FROM notifications WHERE user_id = pt.u(22) AND dedup_key LIKE 'prive_revoke_all:%'), 'n=' || :ra22);
-- Sexta sesión revoca la más vieja.
SELECT (pt.unlock(22, 'Veintidos-clave-22', 230 + k))->>'session_id' FROM generate_series(1, 6) k;
SELECT pt.ok('P29 la sexta sesión Privé revoca la más vieja (máximo 5 vivas)',
  (SELECT count(*) FROM prive_sessions WHERE user_id = pt.u(22) AND revoked_at IS NULL) = 5
  AND (SELECT revoke_reason FROM prive_sessions WHERE user_id = pt.u(22) AND auth_session_id = pt.sid(231)) = 'session_limit'
  AND (SELECT revoked_at IS NULL FROM prive_sessions WHERE user_id = pt.u(22) AND auth_session_id = pt.sid(236)));
SELECT (pt.unlock(22, 'Veintidos-clave-22', 240))->>'token' AS t22c \gset
UPDATE prive_sessions SET expires_at = now() - interval '1 second' WHERE token_hash = public.prive_sha256_hex(:'t22c');
SELECT pt.ok('P30 sesión Privé vencida (12 h) → PRIVE_SESSION_EXPIRED', pt.req_as(22, 240, :'t22c') = 'PRIVE_SESSION_EXPIRED');
SELECT (pt.unlock(22, 'Veintidos-clave-22', 241))->>'token' AS t22d \gset
UPDATE prive_sessions SET last_seen_at = now() - interval '2 hours 1 minute' WHERE token_hash = public.prive_sha256_hex(:'t22d');
SELECT pt.ok('P30b inactiva más de 2 h → PRIVE_SESSION_EXPIRED', pt.req_as(22, 241, :'t22d') = 'PRIVE_SESSION_EXPIRED');
SELECT (pt.unlock(22, 'Veintidos-clave-22', 242))->>'token' AS t22e \gset
UPDATE prive_sessions SET last_seen_at = now() - interval '5 minutes' WHERE token_hash = public.prive_sha256_hex(:'t22e');
SELECT pt.req_as(22, 242, :'t22e');
SELECT pt.ok('P30c usarla renueva la inactividad (last_seen_at)',
  (SELECT last_seen_at > now() - interval '1 minute' FROM prive_sessions WHERE token_hash = public.prive_sha256_hex(:'t22e')));
SELECT pt.ok('P31 token de sesión de OTRA cuenta → PRIVE_SESSION_INVALID',
  pt.req_as(6, 242, :'t22e') <> 'OK' AND pt.req_as(7, 242, :'t22e') = 'PRIVE_SESSION_INVALID', pt.req_as(7, 242, :'t22e'));
SELECT pt.ok('P32 sin token o sin sesión de IATOS → PRIVE_NO_SESSION',
  pt.req_as(22, 242, NULL) = 'PRIVE_NO_SESSION' AND pt.req_as(NULL, NULL, :'t22e') = 'PRIVE_NO_SESSION');
-- RPC de contenido STABLE y transacción de solo lectura (GET de PostgREST).
UPDATE prive_sessions SET last_seen_at = now() - interval '5 minutes' WHERE token_hash = public.prive_sha256_hex(:'t22e');
SELECT pt.login(22, 242);
SET ROLE authenticated;
SELECT pt.ok('P33 prive_require funciona dentro de una RPC STABLE', pt.stable_content(:'t22e') = 'OK', pt.stable_content(:'t22e'));
RESET ROLE;
UPDATE prive_sessions SET last_seen_at = now() - interval '5 minutes' WHERE token_hash = public.prive_sha256_hex(:'t22e');
SET ROLE authenticated;
BEGIN READ ONLY;
SELECT pt.ok('P33b y en una transacción de solo lectura', pt.req(:'t22e') = 'OK', pt.req(:'t22e'));
COMMIT;
RESET ROLE;
SET ROLE service_role; SELECT public.prive_lock_session(pt.u(22), public.prive_sha256_hex(:'t22e')); RESET ROLE;
SELECT pt.ok('P34 bloquear la sesión de este dispositivo → PRIVE_SESSION_INVALID', pt.req_as(22, 242, :'t22e') = 'PRIVE_SESSION_INVALID');

-- ===================================================================== H. contraseña y fuerza bruta
SELECT pt.pro(23); SELECT pt.paid(23, 100, -1, 'in_23'); SELECT pt.member(23, 'Veintitres-clave-23');
SELECT (pt.unlock(23, 'no-es-la-clave-23', 23))->>'reason' AS u23 \gset
SELECT pt.ok('P35 contraseña incorrecta → WRONG_PASSWORD y cuenta un fallo',
  :'u23' = 'WRONG_PASSWORD' AND (SELECT failed_count FROM prive_credentials WHERE user_id = pt.u(23)) = 1);
SELECT (pt.unlock(23, 'Veintidos-clave-22', 23))->>'reason' AS u23b \gset
SELECT (pt.unlock(23, 'Veintitres-clave-23', 23))->>'ok' AS u23c \gset
SELECT pt.ok('P36 la contraseña de OTRO miembro en mi cuenta no sirve (y la propia sí, y reinicia el contador)',
  :'u23b' = 'WRONG_PASSWORD' AND :'u23c' = 'true' AND (SELECT failed_count FROM prive_credentials WHERE user_id = pt.u(23)) = 0);
-- Escalera 5/8/10/12/15. Entre escalones se "adelanta el reloj" quitando locked_until.
SELECT pt.pro(24); SELECT pt.paid(24, 100, -1, 'in_24'); SELECT pt.member(24, 'Veinticuatro-clave-24');
SELECT (pt.unlock(24, 'Veinticuatro-clave-24', 24))->>'token' AS t24 \gset
CREATE TABLE pt.ladder (n int, reason text, mins numeric);
DO $$
DECLARE r jsonb; i int;
BEGIN
  FOR i IN 1..15 LOOP
    UPDATE public.prive_credentials SET locked_until = NULL WHERE user_id = pt.u(24);
    r := public.prive_unlock(pt.u(24), 'mala-clave-numero-' || i, NULL, pt.sid(24));
    INSERT INTO pt.ladder VALUES (i, r->>'reason', round(extract(epoch FROM ((r->>'locked_until')::timestamptz - now())) / 60));
  END LOOP;
END $$;
SELECT pt.ok('P37 escalera de bloqueos 5→1 min, 8→5 min, 10→15 min, 12→60 min, 15→bloqueo total',
  (SELECT string_agg(n || ':' || reason || coalesce('/' || mins, ''), ' ' ORDER BY n) FROM pt.ladder WHERE reason <> 'WRONG_PASSWORD')
  = '5:LOCKED/1 8:LOCKED/5 10:LOCKED/15 12:LOCKED/60 15:HARD_LOCKED',
  (SELECT string_agg(n || ':' || reason || coalesce('/' || mins, ''), ' ' ORDER BY n) FROM pt.ladder));
-- Durante un bloqueo temporal, ni la contraseña correcta entra y el contador no sube (no se compara el hash).
SELECT pt.pro(25); SELECT pt.paid(25, 100, -1, 'in_25'); SELECT pt.member(25, 'Veinticinco-clave-25');
SELECT pt.unlock(25, 'mala-' || k || '-xxxxxxxx', 25) FROM generate_series(1, 5) k;
SELECT pt.ok('P37b bloqueado: la correcta también se rechaza (LOCKED) sin contar otro fallo',
  (pt.unlock(25, 'Veinticinco-clave-25', 25))->>'reason' = 'LOCKED' AND (SELECT failed_count FROM prive_credentials WHERE user_id = pt.u(25)) = 5);
SELECT pt.ok('P38 bloqueo total: cierra sesiones, avisa y ni la correcta entra',
  (pt.unlock(24, 'Veinticuatro-clave-24', 24))->>'reason' = 'HARD_LOCKED' AND pt.req_as(24, 24, :'t24') = 'PRIVE_SESSION_INVALID'
  AND EXISTS (SELECT 1 FROM notifications WHERE user_id = pt.u(24) AND dedup_key LIKE 'prive_hardlock:%')
  AND (SELECT hard_locked FROM prive_credentials WHERE user_id = pt.u(24)));
UPDATE prive_credentials SET locked_until = NULL, last_failed_at = now() - interval '3 days' WHERE user_id = pt.u(24);
SELECT pt.ok('P38b el bloqueo total no se quita solo con el tiempo',
  (pt.unlock(24, 'Veinticuatro-clave-24', 24))->>'reason' = 'HARD_LOCKED');
SET ROLE service_role; SELECT public.prive_request_reset(pt.u(24)) AS rt24 \gset
SELECT public.prive_complete_reset(pt.u(24), :'rt24', 'Nueva-clave-24-tras-reset', 'ok') AS cr24 \gset
RESET ROLE;
INSERT INTO pt.secrets VALUES ('rt24', :'rt24'), ('pw24b', 'Nueva-clave-24-tras-reset');
SELECT pt.ok('P38c solo el restablecimiento por correo quita el bloqueo total',
  (:'cr24'::jsonb->>'ok')::boolean AND (pt.unlock(24, 'Nueva-clave-24-tras-reset', 24))->>'ok' = 'true'
  AND (pt.unlock(24, 'Veinticuatro-clave-24', 24))->>'reason' = 'WRONG_PASSWORD', :'cr24');
UPDATE prive_credentials SET locked_until = NULL WHERE user_id = pt.u(25);
SELECT (pt.unlock(25, 'Veinticinco-clave-25', 25))->>'notice' AS n25 \gset
SELECT pt.ok('P38d entrar tras ≥ 5 fallos recientes avisa "nuevo acceso a Privé"',
  :'n25' = 'new_access' AND EXISTS (SELECT 1 FROM notifications WHERE user_id = pt.u(25) AND title = 'Nuevo acceso a IATOS Privé'));
-- ip_hash: 30 fallos en la última hora desde la misma ip_hash (otras cuentas) + 1 → bloqueada 60 min.
SELECT pt.pro(26); SELECT pt.paid(26, 100, -1, 'in_26'); SELECT pt.member(26, 'Veintiseis-clave-26');
SELECT pt.pro(27); SELECT pt.paid(27, 100, -1, 'in_27'); SELECT pt.member(27, 'Veintisiete-clave-27');
INSERT INTO prive_auth_attempts (user_id, ip_hash, kind, success, reason, at)
SELECT pt.u(40 + (k % 5)), 'abcdef0123456789', 'unlock', false, 'wrong_password', now() - interval '20 minutes' FROM generate_series(1, 30) k;
SELECT (pt.unlock(26, 'mala-clave-de-26-x', 26, 'abcdef0123456789'))->>'reason' AS u26 \gset
SELECT pt.ok('P39 bloqueo por ip_hash entre cuentas: el fallo 31 bloquea la IP 60 min, también para otra cuenta con la clave correcta',
  :'u26' = 'WRONG_PASSWORD'
  AND (SELECT blocked_until BETWEEN now() + interval '59 minutes' AND now() + interval '61 minutes' FROM prive_ip_blocks WHERE ip_hash = 'abcdef0123456789')
  AND (pt.unlock(27, 'Veintisiete-clave-27', 27, 'abcdef0123456789'))->>'reason' = 'LOCKED'
  AND (pt.unlock(27, 'Veintisiete-clave-27', 27, '0123456789abcdef'))->>'ok' = 'true'
  AND (pt.unlock(27, 'Veintisiete-clave-27', 27, NULL))->>'ok' = 'true');
-- Contraseña comprometida.
SELECT pt.pro(28); SELECT pt.paid(28, 100, -1, 'in_28'); SELECT pt.member(28, 'Veintiocho-clave-28');
SELECT (pt.unlock(28, 'Veintiocho-clave-28', 28))->>'token' AS t28 \gset
SET ROLE service_role; SELECT public.prive_report_compromised(pt.u(28)) AS rc28 \gset
RESET ROLE;
SELECT pt.ok('P40 "mi contraseña está comprometida": debe restablecer y se cierran las sesiones',
  pt.req_as(28, 28, :'t28') = 'PRIVE_SESSION_INVALID' AND (pt.unlock(28, 'Veintiocho-clave-28', 28))->>'reason' = 'MUST_RESET'
  AND public.prive_set_password(pt.u(28), 'Otra-clave-larga-28', 'ok')->>'code' = 'MUST_RESET'
  AND (SELECT status FROM prive_credentials WHERE user_id = pt.u(28)) = 'must_reset', :'rc28');
-- Filtrada, débil, demasiado larga, repetida.
SELECT pt.pro(29); SELECT pt.paid(29, 100, -1, 'in_29');
SELECT public.prive_invite_user(pt.u(29), 'tenure', 'system');
SELECT pt.ok('P41 antes de activar: PRIVE_NOT_ACTIVATED para fijar contraseña o entrar',
  public.prive_set_password(pt.u(29), 'Veintinueve-clave-29', 'ok')->>'code' = 'PRIVE_NOT_ACTIVATED'
  AND (pt.unlock(29, 'x', 29))->>'reason' = 'PRIVE_NOT_ACTIVATED');
SELECT public.prive_accept_invitation(pt.u(29), NULL);
SELECT pt.ok('P42 contraseña filtrada (HIBP) o débil se rechaza al fijarla',
  public.prive_set_password(pt.u(29), 'Password123456', 'breached')->>'code' = 'PASSWORD_BREACHED'
  AND public.prive_set_password(pt.u(29), 'corta-11ch', 'ok')->>'code' = 'PASSWORD_WEAK'
  AND public.prive_set_password(pt.u(29), repeat('ab-cd-ef-', 9), 'ok')->>'code' = 'PASSWORD_WEAK'
  AND public.prive_set_password(pt.u(29), 'aaaabbbbaaaabbbb', 'ok')->>'code' = 'PASSWORD_WEAK'
  AND public.prive_set_password(pt.u(29), 'Veintinueve-clave-29', 'mentira')->>'code' = 'PASSWORD_WEAK'
  AND NOT EXISTS (SELECT 1 FROM prive_credentials WHERE user_id = pt.u(29)));
INSERT INTO pt.secrets VALUES ('pw29', 'Veintinueve-clave-29'), ('pw29b', 'Password123456');
SELECT public.prive_set_password(pt.u(29), 'Veintinueve-clave-29', 'unavailable') AS sp29 \gset
SELECT pt.ok('P43 fijar la contraseña: bcrypt costo 12; la segunda vez PASSWORD_ALREADY_SET',
  (:'sp29'::jsonb->>'ok')::boolean
  AND (SELECT password_hash LIKE '$2a$12$%' AND breach_check = 'unavailable' FROM prive_credentials WHERE user_id = pt.u(29))
  AND public.prive_set_password(pt.u(29), 'Veintinueve-clave-29b', 'ok')->>'code' = 'PASSWORD_ALREADY_SET'
  AND EXISTS (SELECT 1 FROM notifications WHERE user_id = pt.u(29) AND dedup_key = 'prive_pw_set:' || pt.u(29)));
SELECT pt.ok('P43b más de 72 bytes nunca entra (bcrypt truncaría)',
  (pt.unlock(29, 'Veintinueve-clave-29' || repeat('z', 60), 29))->>'reason' = 'WRONG_PASSWORD');
-- Cambiar la contraseña.
SELECT (pt.unlock(29, 'Veintinueve-clave-29', 29))->>'token' AS t29 \gset
SET ROLE service_role;
SELECT public.prive_change_password(pt.u(29), 'no-es-la-anterior', 'Nueva-clave-29-larga', 'ok') AS ch29a \gset
SELECT public.prive_change_password(pt.u(29), 'Veintinueve-clave-29', 'Nueva-clave-29-larga', 'ok') AS ch29b \gset
RESET ROLE;
INSERT INTO pt.secrets VALUES ('pw29c', 'Nueva-clave-29-larga');
SELECT pt.ok('P44 cambiar la contraseña: la anterior equivocada cuenta como fallo; al cambiar se cierran las sesiones',
  (:'ch29a'::jsonb->>'code') = 'WRONG_PASSWORD' AND (:'ch29b'::jsonb->>'ok')::boolean
  AND pt.req_as(29, 29, :'t29') = 'PRIVE_SESSION_INVALID'
  AND (pt.unlock(29, 'Veintinueve-clave-29', 29))->>'reason' = 'WRONG_PASSWORD'
  AND (pt.unlock(29, 'Nueva-clave-29-larga', 29))->>'ok' = 'true'
  AND (SELECT version FROM prive_credentials WHERE user_id = pt.u(29)) = 2, :'ch29a' || ' ' || :'ch29b');
-- Restablecer: un solo uso, 30 min, de esta cuenta.
SET ROLE service_role;
SELECT public.prive_request_reset(pt.u(28)) AS rt28 \gset
SELECT public.prive_request_reset(pt.u(29)) AS rt29 \gset
RESET ROLE;
INSERT INTO pt.secrets VALUES ('rt28', :'rt28'), ('rt29', :'rt29');
SELECT pt.ok('P45 el token de restablecimiento de OTRA cuenta no sirve',
  public.prive_complete_reset(pt.u(28), :'rt29', 'Clave-nueva-para-28', 'ok')->>'code' = 'RESET_INVALID');
SELECT pt.ok('P45b una contraseña débil no gasta el token',
  public.prive_complete_reset(pt.u(28), :'rt28', 'corta', 'ok')->>'code' = 'PASSWORD_WEAK'
  AND (SELECT used_at IS NULL FROM prive_password_resets WHERE token_hash = public.prive_sha256_hex(:'rt28')));
INSERT INTO pt.secrets VALUES ('pw28b', 'Clave-nueva-para-28');
SELECT public.prive_complete_reset(pt.u(28), :'rt28', 'Clave-nueva-para-28', 'ok') AS cr28 \gset
SELECT public.prive_complete_reset(pt.u(28), :'rt28', 'Clave-nueva-para-28b', 'ok') AS cr28b \gset
SELECT pt.ok('P46 restablecer: el token sirve UNA vez y quita el "debe restablecer"',
  (:'cr28'::jsonb->>'ok')::boolean AND (:'cr28b'::jsonb->>'code') = 'RESET_INVALID'
  AND (SELECT status FROM prive_credentials WHERE user_id = pt.u(28)) = 'active'
  AND (pt.unlock(28, 'Clave-nueva-para-28', 28))->>'ok' = 'true');
UPDATE prive_password_resets SET expires_at = now() - interval '1 second' WHERE token_hash = public.prive_sha256_hex(:'rt29');
SELECT pt.ok('P47 el token de restablecimiento vence a los 30 minutos',
  public.prive_complete_reset(pt.u(29), :'rt29', 'Clave-nueva-para-29', 'ok')->>'code' = 'RESET_INVALID'
  AND (SELECT expires_at - created_at FROM prive_password_resets WHERE user_id = pt.u(28) ORDER BY created_at DESC LIMIT 1) = interval '30 minutes');
SET ROLE service_role;
SELECT public.prive_request_reset(pt.u(29)); SELECT public.prive_request_reset(pt.u(29));
RESET ROLE;
DO $$ BEGIN
  PERFORM public.prive_request_reset(pt.u(29));
  RAISE NOTICE 'FALLA P48 se pudieron pedir más de 3 restablecimientos en una hora';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM = 'RATE_LIMITED' THEN RAISE NOTICE 'OK P48 máximo 3 restablecimientos por hora'; ELSE RAISE NOTICE 'FALLA P48 %', SQLERRM; END IF;
END $$;
DO $$ BEGIN
  PERFORM public.prive_request_reset(pt.u(30));
  RAISE NOTICE 'FALLA P48b restablecer sin contraseña';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM = 'NO_PASSWORD' THEN RAISE NOTICE 'OK P48b no se restablece una contraseña que no existe'; ELSE RAISE NOTICE 'FALLA P48b %', SQLERRM; END IF;
END $$;

-- ===================================================================== I. estado, progreso, métricas
SELECT pt.login(23, 23);
SET ROLE authenticated;
SELECT public.prive_status() AS st23 \gset
SELECT pt.login(31, NULL);
SELECT public.prive_status() AS st31 \gset
RESET ROLE;
SELECT pt.ok('P49 prive_status: solo las claves del contrato y ningún secreto (hash, token ni correo)',
  (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(:'st23'::jsonb) k) =
    ARRAY['activated_at','basis','eligible','first_name','has_password','invitation_pending','is_pro','locked_until','member_code',
          'members_requires_prive','membership_status','onboarding','password_status','required_days','tenure_days','welcome_version_seen']
  AND :'st23' !~ '\$2[aby]\$' AND :'st23' !~ '[0-9a-f]{64}' AND :'st23' !~ '[A-Za-z0-9_-]{43}' AND :'st23' !~ '@'
  AND (:'st23'::jsonb->>'membership_status') = 'active' AND (:'st23'::jsonb->>'tenure_days')::int = 100
  AND (:'st23'::jsonb->>'has_password')::boolean AND (:'st23'::jsonb->>'member_code') ~ '^IP-', :'st23');
SELECT pt.ok('P49b prive_status de una cuenta gratis: is_pro=false, 0 días, sin membresía',
  (:'st31'::jsonb->>'is_pro')::boolean = false AND (:'st31'::jsonb->>'tenure_days')::int = 0
  AND (:'st31'::jsonb->>'membership_status') = 'none' AND (:'st31'::jsonb->>'eligible')::boolean = false, :'st31');
SELECT pt.ok('P49c el primer nombre viene del perfil (el HTML se escapa al usarlo en el correo)',
  public.prive_first_name(pt.u(2)) = 'Valentina' AND :'invname2' = 'Valentina');
SET ROLE service_role;
SELECT public.prive_save_progress(pt.u(23), 2, '{"version":1,"step":"universes","completed_at":"2026-10-22T10:00:00Z","nota":"<script>"}') AS sp23 \gset
SELECT public.prive_save_progress(pt.u(23), 1, '{"step":"a b c"}') AS sp23b \gset
SELECT public.prive_save_progress(pt.u(1), 1, NULL) AS sp1 \gset
RESET ROLE;
SELECT pt.ok('P50 guardar progreso: solo claves conocidas, la versión de bienvenida no retrocede y requiere membresía',
  (:'sp23'::jsonb->'onboarding') = '{"version":1,"step":"universes","completed_at":"2026-10-22T10:00:00Z"}'::jsonb
  AND (:'sp23b'::jsonb->>'code') = 'INVALID' AND (:'sp1'::jsonb->>'code') = 'PRIVE_NOT_ELIGIBLE'
  AND public.prive_save_progress(pt.u(23), 1, NULL)->>'welcome_version_seen' = '2', :'sp23');
SELECT public.prive_log_event(pt.u(23), 'home_view', '{"surface":"home","plan":"pro"}') AS le1 \gset
SELECT public.prive_log_event(pt.u(23), 'password_set', '{}') AS le2 \gset
SELECT pt.ok('P51 prive_log_event: un evento válido se guarda, uno fuera de la lista no rompe nada',
  :'le1' AND NOT :'le2'
  AND (SELECT count(*) FROM prive_events WHERE user_id = pt.u(23)) = 1);
UPDATE prive_auth_attempts SET at = now() - interval '31 days' WHERE user_id = pt.u(23);
SET ROLE service_role; SELECT public.prive_sweep() AS sw \gset
RESET ROLE;
SELECT pt.ok('P52 el barrido purga intentos de más de 30 días', NOT EXISTS (SELECT 1 FROM prive_auth_attempts WHERE user_id = pt.u(23)), :'sw');

-- ===================================================================== J. permisos y secretos
-- Ninguna función Privé ni de administración es ejecutable por anon; por authenticated solo
-- prive_require y prive_status. Todas las tablas con RLS y sin privilegios para anon/authenticated.
SELECT pt.ok('P53 anon no ejecuta ninguna función Privé',
  NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
               WHERE n.nspname = 'public' AND (p.proname LIKE 'prive\_%' OR p.proname LIKE 'admin\_%prive%' OR p.proname = 'apply_prive_grant')
                 AND has_function_privilege('anon', p.oid, 'EXECUTE')),
  (SELECT string_agg(p.proname, ',') FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname LIKE 'prive\_%' AND has_function_privilege('anon', p.oid, 'EXECUTE')));
-- (Integración con el grupo catalog, contrato §5: además, las RPC de contenido de Privé —todas empiezan
-- con prive_require(_ps)—, el adelanto prive_teaser, las solicitudes propias y los paneles admin_*
-- que validan public.admins por dentro. Cualquier otra función expuesta es una falla.)
SELECT pt.ok('P54 authenticated solo ejecuta prive_require, prive_status y las RPC de catálogo del contrato',
  (SELECT string_agg(p.proname, ',' ORDER BY p.proname) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND (p.proname LIKE 'prive\_%' OR p.proname LIKE 'admin\_%prive%' OR p.proname = 'apply_prive_grant')
      AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
      AND p.proname NOT IN ('prive_teaser','prive_home','prive_destination','prive_universe','prive_experience','prive_search',
        'prive_for_you','prive_confirm_adult','prive_save','prive_saved','prive_add_to_trip','prive_track','prive_request_create',
        'prive_request_cancel','prive_my_requests','prive_request_transition','admin_prive_requests','admin_prive_metrics',
        -- The Privé Key (20261024310000): todas empiezan con prive_require(_ps); el panel valida public.admins.
        'prive_key_save','prive_key_plans','prive_key_add_to_trip','prive_key_archive','prive_key_track','prive_key_taste_save',
        'admin_prive_key_metrics',
        -- privevalor (contrato prive_reimagined): RPC de contenido con prive_require(_ps), la vista previa
        -- (solo registra un evento con auth.uid()) y el panel admin_* que valida public.admins por dentro.
        'prive_drops','prive_drop','prive_radar','prive_radar_save','prive_radar_delete','prive_value_summary','prive_value_save',
        'prive_value_delete','prive_insider_index','prive_insider','prive_before_you_go','prive_tip_save','prive_tip_add_to_trip',
        'prive_passport','prive_passport_save','prive_passport_delete','prive_value_track','prive_preview_track',
        'admin_prive_product_metrics',
        -- THE PRIVATE EDITION (equipo edition): lectura del miembro; cada una empieza con prive_require(_ps)
        -- (lo comprueba E43 en supabase/tests/edition/edition.sql).
        'prive_edition_library','prive_edition_issue','prive_edition_article','prive_edition_world_brief','prive_edition_prefs',
        'prive_edition_prefs_save','prive_edition_save','prive_edition_saved','prive_edition_log_download','prive_edition_status')) = 'prive_require,prive_status',
  (SELECT string_agg(p.proname, ',' ORDER BY p.proname) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname LIKE 'prive\_%' AND has_function_privilege('authenticated', p.oid, 'EXECUTE')));
SELECT pt.ok('P55 todas las funciones Privé SECURITY DEFINER tienen search_path fijo',
  NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
               WHERE n.nspname = 'public' AND (p.proname LIKE 'prive\_%' OR p.proname LIKE 'admin\_%prive%') AND p.prosecdef
                 AND NOT EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%')));
SELECT pt.ok('P56 tablas Privé: RLS encendida y sin privilegios para anon/authenticated',
  (SELECT bool_and(c.relrowsecurity) AND NOT bool_or(has_table_privilege('anon', c.oid, 'SELECT') OR has_table_privilege('authenticated', c.oid, 'SELECT')
          OR has_table_privilege('authenticated', c.oid, 'INSERT') OR has_table_privilege('authenticated', c.oid, 'UPDATE')
          OR has_table_privilege('authenticated', c.oid, 'DELETE'))
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND (c.relname LIKE 'prive\_%' OR c.relname = 'pro_paid_periods'))
  AND (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r' AND (c.relname LIKE 'prive\_%' OR c.relname = 'pro_paid_periods')) >= 11);
-- Llamadas directas reales.
SELECT pt.login(23, 23);
SET ROLE authenticated;
DO $$
DECLARE f text; denied int := 0; allowed text := '';
BEGIN
  FOREACH f IN ARRAY ARRAY[
    $q$SELECT public.prive_unlock(auth.uid(), 'x', NULL, NULL)$q$, $q$SELECT public.prive_set_password(auth.uid(), 'x', 'ok')$q$,
    $q$SELECT public.prive_accept_invitation(auth.uid(), NULL)$q$, $q$SELECT public.prive_tenure_days(auth.uid())$q$,
    $q$SELECT public.prive_entitled(auth.uid())$q$, $q$SELECT public.prive_has_grant(auth.uid())$q$,
    $q$SELECT public.prive_request_reset(auth.uid())$q$, $q$SELECT public.prive_complete_reset(auth.uid(), 'x', 'y', 'ok')$q$,
    $q$SELECT public.prive_change_password(auth.uid(), 'x', 'y', 'ok')$q$, $q$SELECT public.prive_report_compromised(auth.uid())$q$,
    $q$SELECT public.prive_revoke_sessions(auth.uid(), 'x')$q$, $q$SELECT public.prive_lock_session(auth.uid(), 'x')$q$,
    $q$SELECT public.prive_save_progress(auth.uid(), 1, NULL)$q$, $q$SELECT * FROM public.prive_evaluate_eligibility(1)$q$,
    $q$SELECT public.prive_sweep()$q$, $q$SELECT * FROM public.prive_claim_invitation_emails(1, NULL)$q$,
    $q$SELECT public.prive_mark_invitation_email(gen_random_uuid(), true, NULL, NULL)$q$, $q$SELECT public.prive_resend_invitation(auth.uid())$q$,
    $q$SELECT public.prive_record_paid_period(auth.uid(), 'in_hack', NULL, NULL, now() - interval '200 days', now(), 100, 'mxn', 'webhook')$q$,
    $q$SELECT public.prive_mark_paid_period('in_hack', 'dispute_won', 0)$q$,
    $q$SELECT public.admin_grant_prive('yo@example.test', 'porque sí', NULL, 'yo mismo')$q$,
    $q$SELECT public.admin_revoke_prive(auth.uid(), 'admin', 'xxx', 'yyy')$q$, $q$SELECT public.admin_restore_prive(auth.uid(), 'xxx', 'yyy')$q$,
    $q$SELECT public.admin_revoke_prive_grant(gen_random_uuid(), 'xxx', 'yyy')$q$, $q$SELECT public.prive_log_event(auth.uid(), 'home_view', '{}')$q$,
    $q$SELECT public.prive_invite_user(auth.uid(), 'grant', 'system')$q$, $q$SELECT public.prive_access_code(auth.uid())$q$,
    $q$SELECT public.prive_first_name(auth.uid())$q$, $q$SELECT public.prive_sha256_hex('x')$q$,
    $q$SELECT count(*) FROM public.prive_credentials$q$, $q$SELECT count(*) FROM public.prive_sessions$q$,
    $q$SELECT count(*) FROM public.pro_paid_periods$q$, $q$INSERT INTO public.pro_paid_periods (user_id, period, source) VALUES (auth.uid(), tstzrange(now() - interval '1 year', now()), 'test')$q$,
    $q$UPDATE public.prive_memberships SET status = 'active'$q$, $q$INSERT INTO public.prive_grants (email, reason, granted_by) VALUES ('a@b.c', 'xxx', 'yyy')$q$]
  LOOP
    BEGIN
      EXECUTE f;
      allowed := allowed || ' | ' || f;
    EXCEPTION WHEN insufficient_privilege THEN denied := denied + 1;
    END;
  END LOOP;
  IF allowed = '' THEN RAISE NOTICE 'OK P57 authenticated: % llamadas directas a funciones y tablas internas denegadas', denied;
  ELSE RAISE NOTICE 'FALLA P57 permitidas:%', allowed; END IF;
END $$;
RESET ROLE;
SET ROLE anon;
DO $$ BEGIN
  PERFORM public.prive_status();
  RAISE NOTICE 'FALLA P58 anon ejecuta prive_status';
EXCEPTION WHEN insufficient_privilege THEN
  BEGIN
    PERFORM public.prive_require('x');
    RAISE NOTICE 'FALLA P58 anon ejecuta prive_require';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'OK P58 anon no ejecuta prive_status ni prive_require';
  END;
END $$;
RESET ROLE;
-- Ninguna contraseña ni token emitido en estas pruebas aparece en claro en ninguna tabla (public y auth).
DO $$
DECLARE c record; s record; hits text := ''; n int; scanned int := 0;
BEGIN
  FOR c IN SELECT table_schema, table_name, column_name FROM information_schema.columns
            WHERE table_schema IN ('public', 'auth') AND data_type IN ('text', 'character varying', 'jsonb', 'json')
              AND table_name IN (SELECT table_name FROM information_schema.tables WHERE table_type = 'BASE TABLE' AND table_schema IN ('public', 'auth'))
  LOOP
    scanned := scanned + 1;
    FOR s IN SELECT label, value FROM pt.secrets LOOP
      EXECUTE format('SELECT count(*) FROM %I.%I WHERE strpos(%I::text, $1) > 0', c.table_schema, c.table_name, c.column_name)
        INTO n USING s.value;
      IF n > 0 THEN hits := hits || format(' %s.%s.%s(%s)', c.table_schema, c.table_name, c.column_name, s.label); END IF;
    END LOOP;
  END LOOP;
  IF hits = '' AND (SELECT count(*) FROM pt.secrets) >= 20 THEN
    RAISE NOTICE 'OK P59 % contraseñas/tokens emitidos: ninguno en claro en % columnas de public y auth', (SELECT count(*) FROM pt.secrets), scanned;
  ELSE RAISE NOTICE 'FALLA P59 encontrados:% (secretos=%)', hits, (SELECT count(*) FROM pt.secrets); END IF;
END $$;
SELECT pt.ok('P60 las contraseñas están como bcrypt y los tokens como SHA-256',
  (SELECT bool_and(password_hash ~ '^\$2[aby]\$12\$') FROM prive_credentials)
  AND (SELECT bool_and(token_hash ~ '^[0-9a-f]{64}$') FROM prive_sessions)
  AND (SELECT bool_and(token_hash ~ '^[0-9a-f]{64}$') FROM prive_invitations)
  AND (SELECT bool_and(token_hash ~ '^[0-9a-f]{64}$') FROM prive_password_resets));
-- La bitácora nunca guarda contraseñas ni tokens (ya cubierto por P59) ni el correo de la persona.
SELECT pt.ok('P61 la bitácora de membresía no guarda correos de usuarios',
  NOT EXISTS (SELECT 1 FROM prive_membership_events e WHERE e.details::text ~ '@example\.test'));
-- Borrado de cuenta: purge_account_data limpia todo lo Privé de esa persona.
SET ROLE service_role; SELECT public.purge_account_data(pt.u(23)) AS pg23 \gset
RESET ROLE;
SELECT pt.ok('P62 borrar la cuenta borra su membresía, contraseña, sesiones e intentos',
  NOT EXISTS (SELECT 1 FROM prive_memberships WHERE user_id = pt.u(23)) AND NOT EXISTS (SELECT 1 FROM prive_credentials WHERE user_id = pt.u(23))
  AND NOT EXISTS (SELECT 1 FROM prive_sessions WHERE user_id = pt.u(23)) AND NOT EXISTS (SELECT 1 FROM pro_paid_periods WHERE user_id = pt.u(23)));

DROP SCHEMA pt CASCADE;
