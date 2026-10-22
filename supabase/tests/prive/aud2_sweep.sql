-- Segunda auditoría (grupo prive, P3-4): ¿el barrido cierra en masa si auth.sessions se lee pero falla
-- una columna? Copia de /home/user/audit2/prive/codigo/supabase/tests/prive/aud2_sweep.sql convertida en
-- prueba de regresión (ronda r2, grupo cuentas): imprime OK/FALLA en lugar de INFO.
\set ON_ERROR_STOP off
\pset tuples_only on
CREATE SCHEMA IF NOT EXISTS a4;
CREATE OR REPLACE FUNCTION a4.ok(name text, cond boolean, detail text DEFAULT NULL) RETURNS text LANGUAGE sql AS $$
  SELECT CASE WHEN coalesce(cond, false) THEN 'OK ' || name ELSE 'FALLA ' || name || ' ' || coalesce(detail, '(sin detalle)') END $$;
CREATE OR REPLACE FUNCTION a4.u(n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT ('a4000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid $$;
CREATE OR REPLACE FUNCTION a4.live() RETURNS bigint LANGUAGE sql AS $$
  SELECT count(*) FROM public.prive_sessions WHERE revoked_at IS NULL AND user_id::text LIKE 'a4%' $$;
-- prive_require como la cuenta n con el session_id de su sesión de Auth (b4…n).
CREATE OR REPLACE FUNCTION a4.req(n int) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text; tok text;
BEGIN
  SELECT t INTO tok FROM a4_tokens WHERE k = n;
  PERFORM set_config('request.jwt.claim.sub', a4.u(n)::text, true),
          set_config('request.jwt.claims', jsonb_build_object('sub', a4.u(n), 'role', 'authenticated',
            'session_id', 'b4000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN PERFORM public.prive_require(tok); v := 'OK'; EXCEPTION WHEN OTHERS THEN v := SQLERRM; END;
  RESET ROLE;
  RETURN v;
END $$;
INSERT INTO auth.users (id, email, email_confirmed_at) SELECT a4.u(n), 'sw' || n || '@example.test', now() FROM generate_series(1,3) n;
INSERT INTO public.subscriptions (user_id, status, stripe_subscription_id, stripe_customer_id, current_period_end)
  SELECT a4.u(n), 'active', 'sub_sw' || n, 'cus_sw' || n, now() + interval '20 days' FROM generate_series(1,3) n;
SELECT public.prive_record_paid_period(a4.u(n), 'in_sw' || n, 'sub_sw' || n, 'cus_sw' || n, now() - interval '100 days', now() + interval '1 day', 19900, 'mxn', 'test') FROM generate_series(1,3) n;
SELECT public.prive_invite_user(a4.u(n), 'tenure', 'system') FROM generate_series(1,3) n;
SELECT public.prive_accept_invitation(a4.u(n), NULL) FROM generate_series(1,3) n;
SELECT public.prive_set_password(a4.u(n), 'Sweep-clave-larga-' || n, 'ok') FROM generate_series(1,3) n;
INSERT INTO auth.sessions (id, user_id) SELECT ('b4000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, a4.u(n) FROM generate_series(1,3) n;
CREATE TABLE a4_tokens AS
  SELECT n AS k, public.prive_unlock(a4.u(n), 'Sweep-clave-larga-' || n, NULL, 'b4000000-0000-0000-0000-' || lpad(n::text, 12, '0'))->>'token' AS t
    FROM generate_series(1,3) n;
GRANT SELECT ON a4_tokens TO authenticated;
GRANT USAGE ON SCHEMA a4 TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA a4 TO authenticated;
SELECT a4.live() AS sw0 \gset
SELECT a4.ok('SW0 tres sesiones Privé vivas y válidas antes del barrido', :sw0 = 3 AND a4.req(1) = 'OK', a4.req(1));
BEGIN;
ALTER TABLE auth.users RENAME COLUMN deleted_at TO deleted_at_v2;   -- cambio de esquema de GoTrue (o sin privilegio de columna)
SELECT public.prive_sweep() AS sw1 \gset
SELECT a4.live() AS sw1b \gset
SELECT a4.req(1) AS sw1c \gset
ROLLBACK;
SELECT a4.ok('SW1 auth.sessions legible pero sin la columna deleted_at: el barrido NO cierra sesiones en masa',
  (:'sw1'::jsonb->>'sessions_auth_gone')::int = 0 AND (:'sw1'::jsonb->>'auth_check') = 'skipped_auth_unreadable' AND :sw1b = 3,
  :'sw1' || ' vivas=' || :sw1b);
SELECT a4.ok('SW1b mientras tanto la consulta falla cerrado: prive_require niega el acceso (sin borrar sesiones)',
  :'sw1c' = 'PRIVE_SESSION_INVALID', :'sw1c');
SELECT a4.ok('SW1c al volver el esquema, las mismas sesiones vuelven a servir', a4.req(1) = 'OK' AND a4.live() = 3, a4.req(1));
-- El barrido sigue cerrando la sesión cuya sesión de Auth de verdad terminó (cerrar sesión en IATOS).
DELETE FROM auth.sessions WHERE id = 'b4000000-0000-0000-0000-000000000002'::uuid;
SELECT public.prive_sweep() AS sw2 \gset
SELECT a4.ok('SW2 con el esquema sano, cierra solo la sesión cuya sesión de Auth ya no existe',
  (:'sw2'::jsonb->>'sessions_auth_gone')::int = 1 AND (:'sw2'::jsonb->>'auth_check') = 'ok' AND a4.live() = 2, :'sw2');
DROP TABLE a4_tokens;
DROP SCHEMA a4 CASCADE;
