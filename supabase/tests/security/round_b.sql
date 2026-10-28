-- Pruebas de las migraciones 2026102214600x (grupo sec2, ronda b): Members = PRO, integridad de
-- reembolsos/disputas y borrado de cuenta reanudable. Las corre run.sh después de hardening.sql.
-- Cada línea imprime "OK <id> …" o "FALLA <id> …". Ids propios (7…).
\set ON_ERROR_STOP off
\pset tuples_only on
RESET ROLE;
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
  ('71000000-0000-0000-0000-000000000001','b-free@example.test',now()),
  ('72000000-0000-0000-0000-000000000002','b-pro@example.test',now()),
  ('73000000-0000-0000-0000-000000000003','b-comped@example.test',now()),
  ('74000000-0000-0000-0000-000000000004','b-trial@example.test',now()),
  ('75000000-0000-0000-0000-000000000005','b-trialexp@example.test',now()),
  ('76000000-0000-0000-0000-000000000006','b-legacy@example.test',now()),
  ('77000000-0000-0000-0000-000000000007','b-admin@example.test',now()),
  ('78000000-0000-0000-0000-000000000008','b-refund@example.test',now()),
  ('79000000-0000-0000-0000-000000000009','b-grant@example.test',now()+interval '1 minute'),  -- r2 N-01: correo comprobado con el enlace
  ('7a000000-0000-0000-0000-00000000000a','b-delete@example.test',now()),
  ('7b000000-0000-0000-0000-00000000000b','b-other@example.test',now())
ON CONFLICT DO NOTHING;
INSERT INTO subscriptions(user_id,status,stripe_subscription_id,stripe_customer_id,current_period_end) VALUES
  ('72000000-0000-0000-0000-000000000002','active','sub_bpro','cus_bpro',now()+interval '20 days'),
  ('73000000-0000-0000-0000-000000000003','comped',NULL,NULL,NULL),
  ('74000000-0000-0000-0000-000000000004','trialing',NULL,NULL,now()+interval '10 days'),
  ('75000000-0000-0000-0000-000000000005','trialing',NULL,NULL,now()-interval '1 day'),
  ('78000000-0000-0000-0000-000000000008','active','sub_brefund','cus_brefund',now()+interval '25 days'),
  ('79000000-0000-0000-0000-000000000009','active','sub_bgrant','cus_bgrant',now()+interval '25 days'),
  ('7a000000-0000-0000-0000-00000000000a','active','sub_bdelete','cus_bdelete',now()+interval '25 days')
ON CONFLICT (user_id) DO UPDATE SET status=EXCLUDED.status, stripe_subscription_id=EXCLUDED.stripe_subscription_id,
  stripe_customer_id=EXCLUDED.stripe_customer_id, current_period_end=EXCLUDED.current_period_end;
UPDATE subscriptions SET stripe_event_created = now() - interval '1 hour' WHERE user_id='78000000-0000-0000-0000-000000000008';
INSERT INTO comp_grants(email) VALUES ('b-grant@example.test') ON CONFLICT DO NOTHING;
-- Desbloqueo heredado (la contraseña comprometida, sin caducidad) y uno vigente.
INSERT INTO nightlife_access(user_id,confirmed_adult,password_unlocked,password_unlocked_at) VALUES
  ('76000000-0000-0000-0000-000000000006',true,true,now()-interval '30 days'),
  ('72000000-0000-0000-0000-000000000002',true,true,now()-interval '30 days')
ON CONFLICT (user_id) DO UPDATE SET password_unlocked=true, password_access_expires_at=NULL;
INSERT INTO nightlife_premium(ciudad,ciudad_display,pais,categoria,nombre,address,website,descripcion,active) VALUES
  ('zz-ciudad-a','Ciudad A','País A','cabaret','Lugar Secreto Uno','1 Rue Privada','https://uno.example','desc',true),
  ('zz-ciudad-a','Ciudad A','País A','cabaret','Lugar Secreto Dos','2 Rue Privada','https://dos.example','desc',true),
  ('zz-ciudad-a','Ciudad A','País A','jazz_lounge','Lugar Secreto Tres','3 Rue Privada',NULL,NULL,true),
  ('zz-ciudad-b','Ciudad B','País B','speakeasy','Lugar Secreto Cuatro','4 Chome',NULL,NULL,true),
  ('zz-ciudad-b','Ciudad B','País B','speakeasy','Inactivo','x',NULL,NULL,false);
INSERT INTO admins(user_id) VALUES ('77000000-0000-0000-0000-000000000007') ON CONFLICT DO NOTHING;

-- ===== Members = PRO =====
-- Consulta de solo lectura para el dueño (docs/ops/LEEME.md): quién perdería el acceso.
SELECT CASE WHEN string_agg(u.email, ',' ORDER BY u.email) = 'b-legacy@example.test'
            THEN 'OK MB0 la consulta de "quién pierde acceso" lista solo al desbloqueado sin PRO'
            ELSE 'FALLA MB0 '||coalesce(string_agg(u.email, ',' ORDER BY u.email),'(nadie)') END
  FROM public.nightlife_access na JOIN auth.users u ON u.id = na.user_id
 WHERE na.password_unlocked AND NOT public.is_pro(na.user_id) AND u.email LIKE 'b-%';

SET ROLE authenticated; SELECT set_config('request.jwt.claim.role','authenticated',false);
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000001',false);
SELECT CASE WHEN NOT members_access() AND (SELECT count(*) FROM nightlife_premium)=0
            THEN 'OK MB1 gratis: sin acceso y RLS no devuelve lugares' ELSE 'FALLA MB1' END;
-- Auditoría 10 (#14 / Privé P1-3, migración 20261029010000): el adelanto cuenta solo lo que PRO vería (con
-- fuente). Las filas zz de nightlife_premium (sin fuente, como las viejas de la IA) ya no se prometen; las
-- categorías y conteos del adelanto con lugares curados los prueba members_more (C5–C8).
SELECT CASE WHEN count(*)=0
            THEN 'OK MB2 gratis: el adelanto no promete lugares sin fuente (ni inactivos)' ELSE 'FALLA MB2 '||count(*) END
  FROM members_teaser() WHERE ciudad LIKE 'zz-%';
SELECT CASE WHEN (SELECT string_agg(a, ',') FROM unnest((SELECT proargnames FROM pg_proc WHERE proname='members_teaser')) a WHERE a <> 'p_ciudad')
                 = 'ciudad,ciudad_display,pais,categoria,venues'
            THEN 'OK MB3 el adelanto no expone nombre, dirección, sitio ni coordenadas' ELSE 'FALLA MB3' END;
SELECT CASE WHEN (members_access_state()->>'access')::boolean = false AND members_access_state()->>'via' IS NULL
            THEN 'OK MB4 estado gratis: access=false' ELSE 'FALLA MB4 '||members_access_state()::text END;
SELECT set_config('request.jwt.claim.sub','72000000-0000-0000-0000-000000000002',false);
SELECT CASE WHEN members_access() AND (SELECT count(*) FROM nightlife_premium WHERE ciudad LIKE 'zz-%')=4 AND members_access_state()->>'via'='plan'
            THEN 'OK MB5 PRO pagado: acceso completo' ELSE 'FALLA MB5' END;
SELECT set_config('request.jwt.claim.sub','73000000-0000-0000-0000-000000000003',false);
SELECT CASE WHEN members_access() THEN 'OK MB6 cortesía (comped): acceso' ELSE 'FALLA MB6' END;
SELECT set_config('request.jwt.claim.sub','74000000-0000-0000-0000-000000000004',false);
SELECT CASE WHEN members_access() THEN 'OK MB7 prueba vigente: acceso' ELSE 'FALLA MB7' END;
SELECT set_config('request.jwt.claim.sub','75000000-0000-0000-0000-000000000005',false);
SELECT CASE WHEN NOT members_access() THEN 'OK MB8 prueba vencida: sin acceso' ELSE 'FALLA MB8' END;
SELECT set_config('request.jwt.claim.sub','76000000-0000-0000-0000-000000000006',false);
SELECT CASE WHEN NOT members_access() AND (SELECT count(*) FROM nightlife_premium)=0
            THEN 'OK MB9 desbloqueo heredado sin caducidad (contraseña comprometida): ya no cuenta' ELSE 'FALLA MB9' END;
UPDATE nightlife_access SET password_access_expires_at = now() + interval '1 year' WHERE user_id='76000000-0000-0000-0000-000000000006';
RESET ROLE;
SELECT CASE WHEN password_access_expires_at IS NULL THEN 'OK MB10 el cliente no puede ponerse caducidad' ELSE 'FALLA MB10' END
  FROM nightlife_access WHERE user_id='76000000-0000-0000-0000-000000000006';
-- Contraseña temporal encendida (hardening.sql la dejó vigente): el desbloqueo vale hasta su caducidad.
SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','76000000-0000-0000-0000-000000000006',false);
SELECT 'desbloqueo: '||(unlock_members_access('clave-de-prueba-local')->>'ok');
SELECT CASE WHEN members_access() AND members_access_state()->>'via'='password'
            THEN 'OK MB11 contraseña temporal vigente: acceso hasta su caducidad' ELSE 'FALLA MB11' END;
RESET ROLE;
SET ROLE service_role; SELECT disable_members_password(true); RESET ROLE;
SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','76000000-0000-0000-0000-000000000006',false);
SELECT CASE WHEN NOT members_access() AND unlock_members_access('clave-de-prueba-local')->>'error'='no_configurado'
            THEN 'OK MB12 apagar la contraseña corta los accesos que dio' ELSE 'FALLA MB12' END;
RESET ROLE;
SET ROLE anon;
DO $$ BEGIN PERFORM * FROM members_teaser() WHERE ciudad LIKE 'zz-%'; RAISE NOTICE 'FALLA MB13 anon ve el adelanto';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'OK MB13 anon no ejecuta members_teaser'; END $$;
RESET ROLE;

-- ===== Reembolsos y disputas: revoke_paid_access =====
SET ROLE service_role; SELECT set_config('request.jwt.claim.sub','',false), set_config('request.jwt.claim.role','service_role',false);
SELECT CASE WHEN r->>'reason'='revoked' AND (r->'before'->>'is_pro')::boolean AND NOT (r->'after'->>'is_pro')::boolean
            THEN 'OK PB1 reembolso total sin otro derecho: sin acceso (before/after)' ELSE 'FALLA PB1 '||r::text END
  FROM (SELECT revoke_paid_access('sub_brefund','cus_brefund',now(),'charge.refunded') r) t;
SELECT CASE WHEN r->>'reason'='kept_comped_grant' AND (r->'after'->>'is_pro')::boolean
            THEN 'OK PB2 reembolso total con cortesía autorizada: conserva acceso' ELSE 'FALLA PB2 '||r::text END
  FROM (SELECT revoke_paid_access('sub_bgrant','cus_bgrant',now(),'charge.refunded') r) t;
SELECT CASE WHEN r->>'reason'='comped' THEN 'OK PB3 fila comped intacta' ELSE 'FALLA PB3 '||r::text END
  FROM (SELECT revoke_paid_access('sub_bgrant','cus_bgrant',now(),'charge.refunded') r) t;
SELECT CASE WHEN r->>'reason'='other_entitlement' AND (r->'after'->>'is_pro')::boolean
            THEN 'OK PB4 reembolso de otra suscripción del mismo cliente: no toca la vigente' ELSE 'FALLA PB4 '||r::text END
  FROM (SELECT revoke_paid_access('sub_vieja_bpro','cus_bpro',now(),'charge.refunded') r) t;
SELECT CASE WHEN r->>'reason'='no_row' THEN 'OK PB5 sin fila: no crea nada' ELSE 'FALLA PB5' END
  FROM (SELECT revoke_paid_access('sub_x','cus_x',now(),'x') r) t;
-- Fuera de orden: un invoice.paid VIEJO llega después del reembolso con status active → se ignora.
SELECT CASE WHEN r->>'reason'='stale_event' THEN 'OK PB6 invoice.paid tardío (anterior al reembolso) no devuelve PRO' ELSE 'FALLA PB6 '||r::text END
  FROM (SELECT apply_stripe_subscription('78000000-0000-0000-0000-000000000008','cus_brefund','sub_brefund','active',NULL,
         now()+interval '25 days',false,'price_x','MXN',now()-interval '30 minutes') r) t;
SELECT CASE WHEN notify_admins('dispute:evt_b1','Disputa abierta','x')=1 AND notify_admins('dispute:evt_b1','Disputa abierta','x')=0
            THEN 'OK PB7 aviso a admins una sola vez por evento' ELSE 'FALLA PB7' END;
RESET ROLE;
SELECT CASE WHEN NOT is_pro('78000000-0000-0000-0000-000000000008') THEN 'OK PB8 tras todo, la cuenta reembolsada sigue sin PRO' ELSE 'FALLA PB8' END;
SET ROLE authenticated; SELECT set_config('request.jwt.claim.role','authenticated',false);
DO $$ BEGIN PERFORM revoke_paid_access('sub_bpro','cus_bpro',now(),'x'); RAISE NOTICE 'FALLA PB9 cliente revocó acceso';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'OK PB9 revoke_paid_access/notify_admins solo service_role'; END $$;
RESET ROLE;

-- ===== Borrado de cuenta reanudable =====
SET ROLE service_role; SELECT set_config('request.jwt.claim.role','service_role',false);
SELECT start_account_deletion('7a000000-0000-0000-0000-00000000000a') AS req \gset
SELECT CASE WHEN start_account_deletion('7a000000-0000-0000-0000-00000000000a') = :'req'
             AND (SELECT count(*) FROM deletion_request_steps WHERE request_id=:'req')=5
             AND (SELECT stripe_customer_id FROM deletion_requests WHERE id=:'req')='cus_bdelete'
            THEN 'OK DB1 solicitud única con 5 pasos y el cliente de Stripe guardado' ELSE 'FALLA DB1' END;
INSERT INTO stripe_payment_events(event_id,type,action,account_id) VALUES ('evt_bdel','charge.refunded','revoked','7a000000-0000-0000-0000-00000000000a');
SELECT purge_account_data('7a000000-0000-0000-0000-00000000000a');
RESET ROLE;
DELETE FROM auth.users WHERE id='7a000000-0000-0000-0000-00000000000a';
SELECT CASE WHEN (SELECT count(*) FROM deletion_requests WHERE account_id='7a000000-0000-0000-0000-00000000000a')=1
             AND (SELECT count(*) FROM stripe_payment_events WHERE event_id='evt_bdel')=1
             AND (SELECT count(*) FROM subscriptions WHERE user_id='7a000000-0000-0000-0000-00000000000a')=0
            THEN 'OK DB2 el purge borra la suscripción pero conserva la bitácora de borrado y de pagos' ELSE 'FALLA DB2' END;
SET ROLE service_role;
SELECT CASE WHEN is_deleted_stripe_customer('cus_bdelete') AND NOT is_deleted_stripe_customer('cus_bpro')
            THEN 'OK DB3 el webhook reconoce el cliente de una cuenta borrada' ELSE 'FALLA DB3' END;
SELECT CASE WHEN r->>'reason'='user_not_found' THEN 'OK DB4 webhook tardío con metadata de la cuenta borrada: no escribe' ELSE 'FALLA DB4 '||r::text END
  FROM (SELECT apply_stripe_subscription('7a000000-0000-0000-0000-00000000000a','cus_bdelete','sub_bdelete','active',NULL,
         now()+interval '25 days',false,'p','MXN',now()) r) t;
SELECT CASE WHEN r->>'reason'='unknown_user' THEN 'OK DB5 webhook tardío solo con customer: no escribe' ELSE 'FALLA DB5 '||r::text END
  FROM (SELECT apply_stripe_subscription(NULL,'cus_bdelete','sub_bdelete','active',NULL,now()+interval '25 days',false,'p','MXN',now()) r) t;
SELECT CASE WHEN r->>'reason'='no_row' THEN 'OK DB6 reembolso tardío de la cuenta borrada: no crea filas' ELSE 'FALLA DB6' END
  FROM (SELECT revoke_paid_access('sub_bdelete','cus_bdelete',now(),'charge.refunded') r) t;
DO $$ BEGIN
  INSERT INTO subscriptions(user_id,status,stripe_customer_id) VALUES ('7b000000-0000-0000-0000-00000000000b','active','cus_bdelete');
  RAISE NOTICE 'FALLA DB7 otra cuenta adoptó el cliente borrado';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'OK DB7 otra cuenta no puede adoptar el cliente de una cuenta borrada';
END $$;
RESET ROLE;
SELECT CASE WHEN count(*)=0 THEN 'OK DB8 nada recreado para la cuenta borrada' ELSE 'FALLA DB8' END
  FROM subscriptions WHERE user_id='7a000000-0000-0000-0000-00000000000a' OR stripe_customer_id='cus_bdelete';
SET ROLE authenticated;
DO $$ BEGIN PERFORM * FROM deletion_requests; RAISE NOTICE 'FALLA DB9 cliente lee deletion_requests';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'OK DB9 deletion_requests/steps solo service_role'; END $$;
RESET ROLE;
