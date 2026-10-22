-- IATOS-114: el usuario no puede crear ni cambiar el estado de solicitudes al concierge; el
-- servidor sí. Imprime "OK …" o "FALLA …".
\set ON_ERROR_STOP off
\pset tuples_only on
RESET ROLE;
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
  ('c1140000-0000-0000-0000-000000000001','cr-user@example.test',now()) ON CONFLICT DO NOTHING;
INSERT INTO concierge_requests(id,user_id,type,title,status) VALUES
  ('c1140000-0000-0000-0000-0000000000aa','c1140000-0000-0000-0000-000000000001','members_reservation','Mesa','pending')
  ON CONFLICT DO NOTHING;
SET ROLE authenticated; SELECT set_config('request.jwt.claim.role','authenticated',false);
SELECT set_config('request.jwt.claim.sub','c1140000-0000-0000-0000-000000000001',false);
DO $$ BEGIN
  UPDATE concierge_requests SET status='confirmed' WHERE id='c1140000-0000-0000-0000-0000000000aa';
  RAISE NOTICE 'FALLA CR1 el usuario pudo cambiar el estado';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'OK CR1 el usuario no puede cambiar el estado [permission denied]';
END $$;
DO $$ BEGIN
  INSERT INTO concierge_requests(user_id,type,title,status) VALUES ('c1140000-0000-0000-0000-000000000001','members_reservation','Falsa','confirmed');
  RAISE NOTICE 'FALLA CR2 el usuario pudo crear una solicitud confirmada';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'OK CR2 el usuario no puede insertar [permission denied]';
END $$;
SELECT CASE WHEN count(*)=1 THEN 'OK CR3 el usuario sigue viendo su solicitud' ELSE 'FALLA CR3 no ve su solicitud' END
  FROM concierge_requests WHERE id='c1140000-0000-0000-0000-0000000000aa';
RESET ROLE; SET ROLE service_role;
UPDATE concierge_requests SET status='in_progress' WHERE id='c1140000-0000-0000-0000-0000000000aa';
SELECT CASE WHEN status='in_progress' THEN 'OK CR4 el servidor sí actualiza el estado' ELSE 'FALLA CR4' END
  FROM concierge_requests WHERE id='c1140000-0000-0000-0000-0000000000aa';
RESET ROLE;
