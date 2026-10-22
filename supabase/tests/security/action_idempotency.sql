-- AUD-SEG-05: claves de idempotencia de acciones confirmadas (migración 20261024200000). Lo corre
-- run.sh. Cada línea imprime "OK <id> …" o "FALLA <id> …". Ids propios: usuario a9….
\set ON_ERROR_STOP off
\pset tuples_only on
RESET ROLE;
SELECT CASE WHEN (public.action_idem_claim('a9000000-0000-0000-0000-000000000001','concierge-action','k_1234567890abcdef')->>'state') = 'new'
            THEN 'OK IK1 clave nueva: se puede ejecutar' ELSE 'FALLA IK1' END;
SELECT CASE WHEN (public.action_idem_claim('a9000000-0000-0000-0000-000000000001','concierge-action','k_1234567890abcdef')->>'state') = 'running'
            THEN 'OK IK2 mismo intento en curso: running (no se ejecuta dos veces)' ELSE 'FALLA IK2' END;
SELECT public.action_idem_finish('a9000000-0000-0000-0000-000000000001','concierge-action','k_1234567890abcdef',
  '{"status":200,"body":{"ok":true,"request":{"id":"folio-1"}}}'::jsonb);
SELECT CASE WHEN r->>'state' = 'done' AND r#>>'{response,body,request,id}' = 'folio-1'
            THEN 'OK IK3 reintento tras terminar: devuelve la respuesta guardada (mismo folio)' ELSE 'FALLA IK3 ' || r::text END
  FROM (SELECT public.action_idem_claim('a9000000-0000-0000-0000-000000000001','concierge-action','k_1234567890abcdef') r) x;
SELECT CASE WHEN (public.action_idem_claim('a9000000-0000-0000-0000-000000000002','concierge-action','k_1234567890abcdef')->>'state') = 'new'
             AND (public.action_idem_claim('a9000000-0000-0000-0000-000000000001','concierge-chat-action','k_1234567890abcdef')->>'state') = 'new'
            THEN 'OK IK4 la clave es por usuario y por función' ELSE 'FALLA IK4' END;
-- Falla: se libera y se puede reintentar.
SELECT public.action_idem_claim('a9000000-0000-0000-0000-000000000001','concierge-action','k_fallida_0000000001');
SELECT public.action_idem_finish('a9000000-0000-0000-0000-000000000001','concierge-action','k_fallida_0000000001', NULL);
SELECT CASE WHEN (public.action_idem_claim('a9000000-0000-0000-0000-000000000001','concierge-action','k_fallida_0000000001')->>'state') = 'new'
            THEN 'OK IK5 una acción fallida libera la clave' ELSE 'FALLA IK5' END;
-- Un intento que murió a medias (más de 10 min "en curso") se puede volver a apartar.
UPDATE action_idempotency SET updated_at = now() - interval '11 minutes' WHERE idem_key = 'k_fallida_0000000001';
SELECT CASE WHEN (public.action_idem_claim('a9000000-0000-0000-0000-000000000001','concierge-action','k_fallida_0000000001')->>'state') = 'new'
            THEN 'OK IK6 un intento colgado más de 10 min se puede retomar' ELSE 'FALLA IK6' END;
SELECT CASE WHEN (public.action_idem_claim('a9000000-0000-0000-0000-000000000001','concierge-action','corta')->>'state') = 'invalid'
             AND (public.action_idem_claim('a9000000-0000-0000-0000-000000000001','Mal Scope','k_1234567890abcdef')->>'state') = 'invalid'
            THEN 'OK IK7 claves o funciones mal formadas no se aceptan' ELSE 'FALLA IK7' END;
-- Limpieza de claves viejas (7 días).
INSERT INTO action_idempotency(user_id,scope,idem_key,status,created_at) VALUES
  ('a9000000-0000-0000-0000-000000000001','concierge-action','k_vieja_00000000001','done', now() - interval '8 days');
SELECT public.action_idem_claim('a9000000-0000-0000-0000-000000000001','concierge-action','k_otra_000000000001');
SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM action_idempotency WHERE idem_key = 'k_vieja_00000000001')
            THEN 'OK IK8 las claves de más de 7 días se borran' ELSE 'FALLA IK8' END;
-- Permisos: solo service_role.
SET ROLE authenticated; SELECT set_config('request.jwt.claim.role','authenticated',false);
SELECT set_config('request.jwt.claim.sub','a9000000-0000-0000-0000-000000000001',false);
DO $$ BEGIN
  BEGIN PERFORM public.action_idem_claim('a9000000-0000-0000-0000-000000000001','x1','k_1234567890abcdef'); RAISE NOTICE 'FALLA IK9 authenticated aparta claves';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'OK IK9 authenticated no ejecuta action_idem_claim [permission denied]'; END;
  BEGIN PERFORM public.action_idem_finish('a9000000-0000-0000-0000-000000000001','x1','k_1234567890abcdef', '{}'::jsonb); RAISE NOTICE 'FALLA IK10 authenticated cierra claves';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'OK IK10 authenticated no ejecuta action_idem_finish [permission denied]'; END;
  BEGIN PERFORM 1 FROM public.action_idempotency; RAISE NOTICE 'FALLA IK11 authenticated lee la tabla';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'OK IK11 authenticated no lee action_idempotency [permission denied]'; END;
END $$;
RESET ROLE;
-- El borrado de cuenta la cubre (purge_account_data recorre las tablas con user_id).
INSERT INTO auth.users(id,email) VALUES ('a9000000-0000-0000-0000-000000000001','aud-idem@example.test') ON CONFLICT DO NOTHING;
SELECT public.purge_account_data('a9000000-0000-0000-0000-000000000001');
SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM action_idempotency WHERE user_id = 'a9000000-0000-0000-0000-000000000001')
            THEN 'OK IK12 borrar la cuenta borra sus claves' ELSE 'FALLA IK12' END;
