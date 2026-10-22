-- T-P2-1 (segunda auditoría, grupo transversal): amistad con consentimiento, código rotable,
-- bloqueo y avisos de invitación acotados. Imprime "OK …" o "FALLA …". Requiere run.sh.
-- Usuarios (ids 6c…): 1 Ana (dueña del código) · 2 Beto (extraño con el código de Ana)
--                      3 Caro (amiga de Ana que se invita a viajes) · 4 Dani (invitada por enlace)
\set ON_ERROR_STOP off
\pset tuples_only on
RESET ROLE;

CREATE OR REPLACE FUNCTION public.tc_ok(_label text, _cond boolean, _detail text DEFAULT '') RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF coalesce(_cond, false) THEN RAISE NOTICE 'OK % %', _label, _detail; ELSE RAISE NOTICE 'FALLA % %', _label, _detail; END IF;
END $$;
-- Ejecuta q como el usuario (rol authenticated) y devuelve el texto o ERR:<mensaje>.
CREATE OR REPLACE FUNCTION public.tc_as(_uid uuid, _q text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', _uid::text, false), set_config('request.jwt.claim.role', 'authenticated', false);
  SET LOCAL ROLE authenticated;
  EXECUTE _q INTO v;
  RESET ROLE;
  RETURN coalesce(v, '<null>');
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  RETURN 'ERR:' || SQLERRM;
END $$;
GRANT EXECUTE ON FUNCTION public.tc_ok(text, boolean, text), public.tc_as(uuid, text) TO authenticated;

INSERT INTO auth.users(id, email) VALUES
  ('6c000000-0000-0000-0000-000000000001', 'tc-ana@example.test'),
  ('6c000000-0000-0000-0000-000000000002', 'tc-beto@example.test'),
  ('6c000000-0000-0000-0000-000000000003', 'tc-caro@example.test'),
  ('6c000000-0000-0000-0000-000000000004', 'tc-dani@example.test')
ON CONFLICT DO NOTHING;
INSERT INTO public.profiles(id) SELECT id FROM auth.users WHERE id::text LIKE '6c000000-%' ON CONFLICT DO NOTHING;
UPDATE public.profiles SET full_name = 'Ana Secreta' WHERE id = '6c000000-0000-0000-0000-000000000001';
UPDATE public.profiles SET full_name = 'bit.ly/premio-iatos Beto' WHERE id = '6c000000-0000-0000-0000-000000000002';
UPDATE public.profiles SET full_name = 'Caro <script>' WHERE id = '6c000000-0000-0000-0000-000000000003';
INSERT INTO public.trips(id, user_id, destino) VALUES
  ('6c100000-0000-0000-0000-000000000001', '6c000000-0000-0000-0000-000000000002', 'Viaje del atacante: abre bit.ly/premio-iatos'),
  ('6c100000-0000-0000-0000-000000000002', '6c000000-0000-0000-0000-000000000001', 'Lisboa');
INSERT INTO public.friendships(requester_id, addressee_id, status) VALUES
  ('6c000000-0000-0000-0000-000000000001', '6c000000-0000-0000-0000-000000000003', 'accepted');

SELECT invite_code AS code_ana FROM public.profiles WHERE id = '6c000000-0000-0000-0000-000000000001' \gset

-- ───── Solicitud, no amistad ─────
SELECT public.tc_as('6c000000-0000-0000-0000-000000000002', format($q$SELECT public.agregar_amigo_por_codigo(%L)::text$q$, :'code_ana')) AS r1 \gset
SELECT public.tc_ok('SC1 con solo el código, Beto queda como solicitud pendiente',
  (SELECT string_agg(status, ',') FROM public.friendships WHERE requester_id = '6c000000-0000-0000-0000-000000000002' AND addressee_id = '6c000000-0000-0000-0000-000000000001') = 'pending'
  AND NOT EXISTS (SELECT 1 FROM public.friendships WHERE status = 'accepted' AND '6c000000-0000-0000-0000-000000000002' IN (requester_id, addressee_id)),
  :'r1');
SELECT public.tc_ok('SC1b la respuesta no revela el id de Ana', position('6c000000-0000-0000-0000-000000000001' IN :'r1') = 0, :'r1');
SELECT public.tc_ok('SC2 Ana recibe un aviso friend_request',
  (SELECT count(*) FROM public.notifications WHERE user_id = '6c000000-0000-0000-0000-000000000001' AND type = 'friend_request' AND related_id = '6c000000-0000-0000-0000-000000000002') = 1);
SELECT public.tc_ok('SC2b el aviso no lleva texto libre que forme un enlace',
  NOT EXISTS (SELECT 1 FROM public.notifications WHERE user_id = '6c000000-0000-0000-0000-000000000001' AND type = 'friend_request'
               AND (title || ' ' || coalesce(body, '')) ~* '(https?:|www\.|[a-z0-9-]+\.[a-z]{2,}/|bit\.ly)'),
  (SELECT title || ' / ' || body FROM public.notifications WHERE user_id = '6c000000-0000-0000-0000-000000000001' AND type = 'friend_request' LIMIT 1));
SELECT public.tc_ok('SC3 con la solicitud pendiente Beto NO ve el perfil de Ana',
  public.tc_as('6c000000-0000-0000-0000-000000000002', $q$SELECT public.amigo_perfil('6c000000-0000-0000-0000-000000000001')->>'error'$q$) = 'privado');
-- Reintentos: no se multiplican los avisos.
SELECT public.tc_as('6c000000-0000-0000-0000-000000000002', format($q$SELECT public.agregar_amigo_por_codigo(%L)::text$q$, :'code_ana')) FROM generate_series(1, 5);
SELECT public.tc_ok('SC4 cinco reintentos no generan más avisos',
  (SELECT count(*) FROM public.notifications WHERE user_id = '6c000000-0000-0000-0000-000000000001' AND type = 'friend_request') = 1);

-- Ana ve la solicitud y la rechaza.
SELECT public.tc_ok('SC5 Ana ve la solicitud recibida',
  public.tc_as('6c000000-0000-0000-0000-000000000001', $q$SELECT jsonb_array_length(public.solicitudes_amistad()->'recibidas')::text$q$) = '1');
SELECT public.tc_ok('SC5b Beto no recibe el nombre de Ana en sus enviadas',
  position('Ana' IN public.tc_as('6c000000-0000-0000-0000-000000000002', $q$SELECT public.solicitudes_amistad()::text$q$)) = 0);
SELECT public.tc_ok('SC6 Ana rechaza',
  public.tc_as('6c000000-0000-0000-0000-000000000001', $q$SELECT public.responder_solicitud_amistad('6c000000-0000-0000-0000-000000000002', false)->>'ok'$q$) = 'true');
SELECT public.tc_as('6c000000-0000-0000-0000-000000000002', format($q$SELECT public.agregar_amigo_por_codigo(%L)::text$q$, :'code_ana'));
SELECT public.tc_ok('SC7 tras el rechazo, Beto no puede volver a pedir ni avisar enseguida',
  NOT EXISTS (SELECT 1 FROM public.friendships WHERE requester_id = '6c000000-0000-0000-0000-000000000002' AND status IN ('pending', 'accepted'))
  AND (SELECT count(*) FROM public.notifications WHERE user_id = '6c000000-0000-0000-0000-000000000001' AND type = 'friend_request') <= 1);
SELECT public.tc_ok('SC7b Beto no puede borrar el rechazo para saltarse la espera',
  public.tc_as('6c000000-0000-0000-0000-000000000002', $q$WITH d AS (DELETE FROM public.friendships WHERE requester_id = '6c000000-0000-0000-0000-000000000002' RETURNING 1) SELECT count(*)::text FROM d$q$) = '0');

-- Aceptar: solo quien recibe.
RESET ROLE;
DELETE FROM public.friendships WHERE requester_id = '6c000000-0000-0000-0000-000000000002';
DELETE FROM public.notifications WHERE user_id = '6c000000-0000-0000-0000-000000000001' AND type = 'friend_request';
SELECT public.tc_as('6c000000-0000-0000-0000-000000000002', format($q$SELECT public.agregar_amigo_por_codigo(%L)::text$q$, :'code_ana'));
SELECT public.tc_ok('SC8 Beto no puede aceptar su propia solicitud',
  public.tc_as('6c000000-0000-0000-0000-000000000002', $q$SELECT public.responder_solicitud_amistad('6c000000-0000-0000-0000-000000000001', true)->>'ok'$q$) = 'false');
SELECT public.tc_as('6c000000-0000-0000-0000-000000000001', $q$SELECT public.responder_solicitud_amistad('6c000000-0000-0000-0000-000000000002', true)->>'ok'$q$) AS r9 \gset
-- (la verificación va en otra sentencia: la misma sentencia no ve lo que escribió la función)
SELECT public.tc_ok('SC9 Ana acepta y quedan amigos',
  :'r9' = 'true'
  AND EXISTS (SELECT 1 FROM public.friendships WHERE requester_id = '6c000000-0000-0000-0000-000000000002' AND addressee_id = '6c000000-0000-0000-0000-000000000001' AND status = 'accepted'));
SELECT public.tc_ok('SC9b Beto recibe el aviso de aceptación',
  (SELECT count(*) FROM public.notifications WHERE user_id = '6c000000-0000-0000-0000-000000000002' AND type = 'friend_accepted') = 1);

-- Quitar al amigo: no vuelve a entrar al instante.
SELECT public.tc_ok('SC10 Ana quita a Beto',
  public.tc_as('6c000000-0000-0000-0000-000000000001', $q$SELECT public.quitar_amigo('6c000000-0000-0000-0000-000000000002')->>'ok'$q$) = 'true');
SELECT public.tc_as('6c000000-0000-0000-0000-000000000002', format($q$SELECT public.agregar_amigo_por_codigo(%L)::text$q$, :'code_ana'));
SELECT public.tc_ok('SC11 tras quitarlo, el mismo código solo crea una solicitud pendiente (no la amistad)',
  NOT EXISTS (SELECT 1 FROM public.friendships WHERE status = 'accepted' AND '6c000000-0000-0000-0000-000000000002' IN (requester_id, addressee_id))
  AND public.tc_as('6c000000-0000-0000-0000-000000000002', $q$SELECT public.amigo_perfil('6c000000-0000-0000-0000-000000000001')->>'error'$q$) = 'privado');

-- Bloquear.
SELECT public.tc_ok('SC12 Ana bloquea a Beto',
  public.tc_as('6c000000-0000-0000-0000-000000000001', $q$SELECT public.bloquear_usuario('6c000000-0000-0000-0000-000000000002')->>'ok'$q$) = 'true');
RESET ROLE;
DELETE FROM public.notifications WHERE user_id = '6c000000-0000-0000-0000-000000000001' AND type = 'friend_request';
SELECT public.tc_as('6c000000-0000-0000-0000-000000000002', format($q$SELECT public.agregar_amigo_por_codigo(%L)::text$q$, :'code_ana'));
SELECT public.tc_ok('SC13 bloqueado: Beto no crea solicitud ni aviso',
  NOT EXISTS (SELECT 1 FROM public.friendships WHERE requester_id = '6c000000-0000-0000-0000-000000000002')
  AND NOT EXISTS (SELECT 1 FROM public.notifications WHERE user_id = '6c000000-0000-0000-0000-000000000001' AND type = 'friend_request'));
SELECT public.tc_ok('SC13b Beto no ve ni puede borrar el bloqueo',
  public.tc_as('6c000000-0000-0000-0000-000000000002', $q$SELECT count(*)::text FROM public.friendships$q$) = '0'
  AND public.tc_as('6c000000-0000-0000-0000-000000000002', $q$WITH d AS (DELETE FROM public.friendships RETURNING 1) SELECT count(*)::text FROM d$q$) = '0'
  AND EXISTS (SELECT 1 FROM public.friendships WHERE requester_id = '6c000000-0000-0000-0000-000000000001' AND addressee_id = '6c000000-0000-0000-0000-000000000002' AND status = 'blocked'));
SELECT public.tc_as('6c000000-0000-0000-0000-000000000001', $q$SELECT public.desbloquear_usuario('6c000000-0000-0000-0000-000000000002')->>'ok'$q$) AS r13 \gset
SELECT public.tc_ok('SC13c Ana puede desbloquear',
  :'r13' = 'true'
  AND NOT EXISTS (SELECT 1 FROM public.friendships WHERE requester_id = '6c000000-0000-0000-0000-000000000001' AND addressee_id = '6c000000-0000-0000-0000-000000000002'));

-- Rotar el código.
SELECT public.tc_as('6c000000-0000-0000-0000-000000000001', $q$SELECT public.regenerar_codigo_invitacion()->>'codigo'$q$) AS code_nuevo \gset
SELECT public.tc_ok('SC14 Ana rota su código (RPC nueva) y el nuevo es distinto',
  :'code_nuevo' ~ '^[A-Z0-9]{8}$' AND :'code_nuevo' <> :'code_ana'
  AND (SELECT invite_code FROM public.profiles WHERE id = '6c000000-0000-0000-0000-000000000001') = :'code_nuevo', :'code_nuevo');
SELECT public.tc_ok('SC15 el código viejo ya no sirve',
  public.tc_as('6c000000-0000-0000-0000-000000000004', format($q$SELECT public.agregar_amigo_por_codigo(%L)->>'error'$q$, :'code_ana')) = 'codigo_invalido');
SELECT public.tc_ok('SC15b sigue sin poder cambiarse a mano',
  public.tc_as('6c000000-0000-0000-0000-000000000001', $q$WITH u AS (UPDATE public.profiles SET invite_code = 'ZZZZ9999' WHERE id = '6c000000-0000-0000-0000-000000000001' RETURNING 1) SELECT count(*)::text FROM u$q$) LIKE 'ERR:%');
SELECT public.tc_ok('SC15c anon no puede rotar códigos',
  NOT has_function_privilege('anon', 'public.regenerar_codigo_invitacion()', 'EXECUTE'));

-- Solicitud recíproca: si Ana ya había pedido, el código de Dani las conecta (las dos quisieron).
SELECT invite_code AS code_dani FROM public.profiles WHERE id = '6c000000-0000-0000-0000-000000000004' \gset
SELECT public.tc_as('6c000000-0000-0000-0000-000000000001', format($q$SELECT public.agregar_amigo_por_codigo(%L)::text$q$, :'code_dani'));
SELECT public.tc_ok('SC16 Dani usa el código de Ana sobre la solicitud de Ana: quedan amigas',
  public.tc_as('6c000000-0000-0000-0000-000000000004', format($q$SELECT public.agregar_amigo_por_codigo(%L)->>'estado'$q$, :'code_nuevo')) = 'amigos');

-- ───── invitar_amigo_viaje: avisos acotados y sin texto del remitente ─────
SELECT count(*) FROM (SELECT public.tc_as('6c000000-0000-0000-0000-000000000001',
  $q$SELECT public.invitar_amigo_viaje('6c100000-0000-0000-0000-000000000002', '6c000000-0000-0000-0000-000000000003')::text$q$) FROM generate_series(1, 25)) s;
SELECT public.tc_ok('SC17 25 invitaciones al mismo viaje = 1 aviso',
  (SELECT count(*) FROM public.notifications WHERE user_id = '6c000000-0000-0000-0000-000000000003' AND type = 'trip_invite') = 1,
  (SELECT count(*)::text FROM public.notifications WHERE user_id = '6c000000-0000-0000-0000-000000000003' AND type = 'trip_invite'));
-- Caro rechaza y Ana reinvita en bucle: no vuelve a avisar en 7 días.
SELECT count(*) FROM (SELECT public.tc_as('6c000000-0000-0000-0000-000000000003', $q$SELECT public.rechazar_invitacion_viaje('6c100000-0000-0000-0000-000000000002')::text$q$),
                             public.tc_as('6c000000-0000-0000-0000-000000000001', $q$SELECT public.invitar_amigo_viaje('6c100000-0000-0000-0000-000000000002', '6c000000-0000-0000-0000-000000000003')::text$q$)
                        FROM generate_series(1, 5)) s;
SELECT public.tc_ok('SC18 rechazar y reinvitar 5 veces no multiplica los avisos',
  (SELECT count(*) FROM public.notifications WHERE user_id = '6c000000-0000-0000-0000-000000000003' AND type = 'trip_invite') = 1);
-- El viaje del atacante (destino con enlace): el aviso no copia el destino.
INSERT INTO public.friendships(requester_id, addressee_id, status) VALUES ('6c000000-0000-0000-0000-000000000002', '6c000000-0000-0000-0000-000000000003', 'accepted');
SELECT public.tc_as('6c000000-0000-0000-0000-000000000002', $q$SELECT public.invitar_amigo_viaje('6c100000-0000-0000-0000-000000000001', '6c000000-0000-0000-0000-000000000003')::text$q$);
SELECT public.tc_ok('SC19 el aviso no lleva el destino ni el nombre con enlace del remitente',
  NOT EXISTS (SELECT 1 FROM public.notifications WHERE user_id = '6c000000-0000-0000-0000-000000000003' AND type = 'trip_invite'
               AND (title || ' ' || coalesce(body, '')) ~* '(https?:|www\.|[a-z0-9-]+\.[a-z]{2,}/|bit\.ly|atacante|<)'),
  (SELECT string_agg(title || ' / ' || body, ' | ') FROM public.notifications WHERE user_id = '6c000000-0000-0000-0000-000000000003' AND type = 'trip_invite'));
SELECT public.tc_ok('SC19b la invitación sigue funcionando (fila pendiente creada)',
  EXISTS (SELECT 1 FROM public.trip_collaborators WHERE trip_id = '6c100000-0000-0000-0000-000000000001' AND user_id = '6c000000-0000-0000-0000-000000000003' AND status = 'pending'));

DROP FUNCTION public.tc_ok(text, boolean, text);
DROP FUNCTION public.tc_as(uuid, text);
