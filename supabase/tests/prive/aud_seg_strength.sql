-- Auditoría de cierre (grupo seguridad): fortalecimiento de prive_require. Lo corre run.sh después de
-- prive.sql en la misma base (con sus propias copias de los ayudantes pt.*). La mutación M2 (quitar "AND s.user_id = v_uid")
-- pasaba las 89 pruebas porque P31 también choca con la liga a la sesión de Auth y con la versión de
-- la credencial. Aquí esas dos defensas se neutralizan para probar sola la de la cuenta dueña del token.
-- prive.sql borra su esquema pt al final: aquí van copias mínimas de sus ayudantes (esquema ptseg). Los
-- usuarios y credenciales que dejó prive.sql (22 y 7, miembros activos) siguen en la base.
DROP SCHEMA IF EXISTS ptseg CASCADE;
CREATE SCHEMA ptseg;
CREATE FUNCTION ptseg.u(n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT ('a0000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid $$;
CREATE FUNCTION ptseg.sid(n int) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT 'b0000000-0000-0000-0000-' || lpad(n::text, 12, '0') $$;
CREATE FUNCTION ptseg.ok(name text, cond boolean, detail text DEFAULT NULL) RETURNS text LANGUAGE sql AS $$
  SELECT CASE WHEN coalesce(cond, false) THEN 'OK ' || name ELSE 'FALLA ' || name || ' ' || coalesce(detail, '(sin detalle)') END $$;
CREATE FUNCTION ptseg.req(ps text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN PERFORM public.prive_require(ps); RETURN 'OK';
EXCEPTION WHEN raise_exception THEN RETURN SQLERRM; END $$;
CREATE FUNCTION ptseg.req_as(n int, sid int, ps text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', ptseg.u(n)::text, false), set_config('request.jwt.claim.role', 'authenticated', false),
          set_config('request.jwt.claims', jsonb_build_object('sub', ptseg.u(n), 'role', 'authenticated',
            'session_id', CASE WHEN sid IS NULL THEN NULL ELSE ptseg.sid(sid) END)::text, false);
  SET LOCAL ROLE authenticated;
  v := ptseg.req(ps);
  RESET ROLE;
  RETURN v;
END $$;
GRANT USAGE ON SCHEMA ptseg TO authenticated; GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA ptseg TO authenticated;
INSERT INTO auth.sessions (id, user_id) VALUES (ptseg.sid(299)::uuid, ptseg.u(22)) ON CONFLICT DO NOTHING;
SELECT public.prive_unlock(ptseg.u(22), 'Veintidos-clave-22', NULL, ptseg.sid(299))->>'token' AS tseg \gset
UPDATE prive_sessions SET auth_session_id = NULL WHERE token_hash = public.prive_sha256_hex(:'tseg');
SELECT ptseg.ok('PS1 sesión Privé sin liga de Auth: su dueño entra (flujo legítimo)', ptseg.req_as(22, NULL, :'tseg') = 'OK', ptseg.req_as(22, NULL, :'tseg'));
UPDATE prive_sessions SET credential_version = (SELECT version FROM prive_credentials WHERE user_id = ptseg.u(7))
 WHERE token_hash = public.prive_sha256_hex(:'tseg');
SELECT ptseg.ok('PS2 el mismo token en OTRA cuenta (misma versión de credencial, sin liga de Auth) → PRIVE_SESSION_INVALID',
  ptseg.req_as(7, NULL, :'tseg') = 'PRIVE_SESSION_INVALID', ptseg.req_as(7, NULL, :'tseg'));
DROP SCHEMA ptseg CASCADE;
