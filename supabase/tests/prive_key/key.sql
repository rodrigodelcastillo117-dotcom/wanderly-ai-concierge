-- Pruebas de THE PRIVÉ KEY. Imprime "OK …" o "FALLA …". U1 miembro con sesión Privé, U2 cuenta sin Privé,
-- U3 equipo (admins), U4 otro miembro (para aislamiento).
\set ON_ERROR_STOP off
\pset tuples_only on
RESET ROLE;

CREATE OR REPLACE FUNCTION public.t_err(_label text, _sql text, _expect text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE _sql;
  RAISE NOTICE 'FALLA % (no hubo error)', _label;
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM ~* _expect THEN RAISE NOTICE 'OK % [%]', _label, left(SQLERRM, 90);
  ELSE RAISE NOTICE 'FALLA % (error inesperado: %)', _label, SQLERRM; END IF;
END $$;
CREATE OR REPLACE FUNCTION public.t_ok(_label text, _cond boolean, _detail text DEFAULT '') RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF coalesce(_cond, false) THEN RAISE NOTICE 'OK % %', _label, _detail; ELSE RAISE NOTICE 'FALLA % %', _label, _detail; END IF;
END $$;
GRANT EXECUTE ON FUNCTION public.t_err(text, text, text), public.t_ok(text, boolean, text) TO anon, authenticated, service_role;

INSERT INTO auth.users(id, email) VALUES
  ('d0000000-0000-0000-0000-0000000000a1', 'k1-member@example.test'),
  ('d0000000-0000-0000-0000-0000000000a2', 'k2-free@example.test'),
  ('d0000000-0000-0000-0000-0000000000a3', 'k3-admin@example.test'),
  ('d0000000-0000-0000-0000-0000000000a4', 'k4-member@example.test') ON CONFLICT DO NOTHING;
INSERT INTO public.admins(user_id) VALUES ('d0000000-0000-0000-0000-0000000000a3') ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS public.t_tokens (label text PRIMARY KEY, token text NOT NULL);
REVOKE ALL ON public.t_tokens FROM PUBLIC, anon, authenticated;
DO $$
DECLARE u uuid; r jsonb; pw text := 'Llave de prueba Prive 2026'; lbl text;
BEGIN
  FOREACH lbl IN ARRAY ARRAY['k1', 'k4'] LOOP
    u := CASE lbl WHEN 'k1' THEN 'd0000000-0000-0000-0000-0000000000a1'::uuid ELSE 'd0000000-0000-0000-0000-0000000000a4'::uuid END;
    INSERT INTO public.profiles (id, full_name, email) VALUES (u, 'Miembro ' || lbl, lbl || '@example.test') ON CONFLICT (id) DO NOTHING;
    INSERT INTO public.subscriptions (user_id, status, stripe_subscription_id, stripe_customer_id, current_period_end)
    VALUES (u, 'active', 'sub_' || lbl, 'cus_' || lbl, now() + interval '20 days')
    ON CONFLICT (user_id) DO UPDATE SET status = 'active', current_period_end = now() + interval '20 days';
    PERFORM public.prive_record_paid_period(u, 'in_' || lbl, 'sub_' || lbl, 'cus_' || lbl, now() - interval '100 days', now() - interval '1 day', 19900, 'mxn', 'test');
    PERFORM public.prive_invite_user(u, 'tenure', 'system');
    r := public.prive_accept_invitation(u, NULL);
    r := public.prive_set_password(u, pw, 'ok');
    r := public.prive_unlock(u, pw, NULL, NULL);
    IF r->>'token' IS NULL THEN RAISE NOTICE 'FALLA SETUP sin sesión Privé para %: %', lbl, r; END IF;
    INSERT INTO public.t_tokens VALUES (lbl, r->>'token') ON CONFLICT (label) DO UPDATE SET token = EXCLUDED.token;
  END LOOP;
END $$;
CREATE OR REPLACE FUNCTION public.t_ps(_l text DEFAULT 'k1') RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT token FROM public.t_tokens WHERE label = _l $$;
GRANT EXECUTE ON FUNCTION public.t_ps(text) TO authenticated;
CREATE OR REPLACE FUNCTION public.t_dest(_slug text) RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT id FROM public.prive_destinations WHERE slug = _slug $$;
INSERT INTO public.trips(id, user_id, destino) VALUES
  ('d0000000-0000-0000-0000-00000000aa01', 'd0000000-0000-0000-0000-0000000000a1', 'Ciudad de México'),
  ('d0000000-0000-0000-0000-00000000aa04', 'd0000000-0000-0000-0000-0000000000a4', 'París') ON CONFLICT DO NOTHING;
INSERT INTO public.prive_experiences (id, slug, destination_id, universe, subcategory, name, website, booking_url, sources, why_fact_es, data_state, verified_at, operating_status, lat, lng)
VALUES ('f0000000-0000-0000-0000-000000000001', 'cdmx-k-cena', public.t_dest('cdmx'), 'the_table', 'cocina_de_autor', 'K Cena',
  'https://example.test/cena', 'https://example.test/cena/reservar', '["https://example.test/cena"]', 'Hecho con fuente.', 'CURADO', now() - interval '3 days', 'abierto', 19.43, -99.19),
  ('f0000000-0000-0000-0000-000000000002', 'cdmx-k-bar', public.t_dest('cdmx'), 'after_dark', 'mezcaleria', 'K Bar',
  'https://example.test/bar', NULL, '["https://example.test/bar"]', 'Hecho con fuente.', 'CURADO', now() - interval '3 days', 'abierto', 19.42, -99.16)
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.prive_experiences (id, slug, destination_id, universe, subcategory, name, data_state)
VALUES ('f0000000-0000-0000-0000-000000000003', 'cdmx-k-pendiente', public.t_dest('cdmx'), 'after_dark', 'club', 'K Pendiente', 'PENDIENTE') ON CONFLICT (id) DO NOTHING;

-- ───────────── 1. Sin sesión Privé no hay nada ─────────────
SET ROLE authenticated; SELECT set_config('request.jwt.claim.role', 'authenticated', false);
SELECT set_config('request.jwt.claim.sub', 'd0000000-0000-0000-0000-0000000000a2', false);
SELECT public.t_err('K1 guardar sin sesión', $q$SELECT public.prive_key_save(NULL, '{"mode":"key","tier":"signature","steps":[{"experience_id":"f0000000-0000-0000-0000-000000000001"}]}')$q$, 'PRIVE_');
SELECT public.t_err('K2 leer planes sin sesión', $q$SELECT public.prive_key_plans('x')$q$, 'PRIVE_');
SELECT public.t_err('K3 al viaje sin sesión', $q$SELECT public.prive_key_add_to_trip(NULL, gen_random_uuid(), gen_random_uuid())$q$, 'PRIVE_');
SELECT public.t_err('K4 recorrido sin sesión', $q$SELECT public.prive_key_track(NULL, 'key_open')$q$, 'PRIVE_');
SELECT public.t_err('K5 gustos sin sesión', $q$SELECT public.prive_key_taste_save(NULL, '{}', true)$q$, 'PRIVE_');
SELECT public.t_err('K6 sesión ajena no sirve', $q$SELECT public.prive_key_plans(public.t_ps('k1'))$q$, 'PRIVE_');
SELECT public.t_err('K7 escribir la tabla directo', $q$INSERT INTO public.prive_key_plans(user_id, mode, tier, steps) VALUES (auth.uid(), 'key', 'signature', '[{}]')$q$, 'permission denied');
SELECT public.t_err('K8 leer el recorrido directo', $q$SELECT count(*) FROM public.prive_key_events$q$, 'permission denied');
SELECT public.t_err('K9 panel solo para el equipo', $q$SELECT public.admin_prive_key_metrics(30)$q$, 'solo el equipo');
RESET ROLE; SET ROLE anon; SELECT set_config('request.jwt.claim.sub', '', false);
SELECT public.t_err('K10 anon no ejecuta', $q$SELECT public.prive_key_plans('x')$q$, 'permission denied');
RESET ROLE;

-- ───────────── 2. Guardar: solo referencias del catálogo ─────────────
SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub', 'd0000000-0000-0000-0000-0000000000a1', false);
SELECT public.t_ok('S1 guarda un plan válido', (public.prive_key_save(public.t_ps(), jsonb_build_object('mode', 'key', 'tier', 'signature', 'wish', 'Aniversario en CDMX',
  'destination', 'cdmx', 'party_size', 2, 'budget', jsonb_build_object('amount', 10000, 'currency', 'MXN'),
  'steps', jsonb_build_array(
    jsonb_build_object('experience_id', 'f0000000-0000-0000-0000-000000000001', 'date', '2026-11-20', 'start', '20:00', 'end', '22:30',
      'start_iso', '2026-11-20T20:00:00-06:00', 'intent', 'cena', 'time_status', 'horario_por_confirmar',
      'name', 'Confirmado VIP', 'state', 'CONFIRMADO', 'status', 'reservado'),
    jsonb_build_object('experience_id', 'f0000000-0000-0000-0000-000000000002', 'start', '22:45', 'intent', 'lounge', 'transfer_min', 15))))->>'ok')::boolean);
RESET ROLE;
SELECT public.t_ok('S2 lo que manda el cliente de más (nombre, estado, "reservado") no se guarda',
  (SELECT steps::text !~* '(Confirmado VIP|CONFIRMADO|reservado|"name")' FROM public.prive_key_plans WHERE user_id = 'd0000000-0000-0000-0000-0000000000a1' ORDER BY created_at DESC LIMIT 1));
SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub', 'd0000000-0000-0000-0000-0000000000a1', false);
SELECT public.t_ok('S3 experiencia inexistente: rechazo', public.prive_key_save(public.t_ps(), '{"mode":"key","tier":"insider","steps":[{"experience_id":"f0000000-0000-0000-0000-0000000000ff"}]}')->>'code' = 'UNKNOWN_EXPERIENCE');
SELECT public.t_ok('S4 experiencia PENDIENTE: rechazo', public.prive_key_save(public.t_ps(), '{"mode":"key","tier":"insider","steps":[{"experience_id":"f0000000-0000-0000-0000-000000000003"}]}')->>'code' = 'UNKNOWN_EXPERIENCE');
SELECT public.t_ok('S5 nivel o modo inventado: rechazo', public.prive_key_save(public.t_ps(), '{"mode":"vip","tier":"platinum","steps":[{"experience_id":"f0000000-0000-0000-0000-000000000001"}]}')->>'code' = 'INVALID');
SELECT public.t_ok('S6 sin pasos: rechazo', public.prive_key_save(public.t_ps(), '{"mode":"key","tier":"signature","steps":[]}')->>'code' = 'INVALID');
SELECT public.t_err('S7 ni el dueño lee la tabla directo (solo RPC)', $q$SELECT count(*) FROM public.prive_key_plans$q$, 'permission denied');

-- ───────────── 3. Mis planes: nombres del catálogo y seguimiento honesto ─────────────
SELECT public.t_ok('P1 el plan trae el nombre REAL del catálogo y estado propuesta',
  (SELECT p->'steps'->0->'experience'->>'name' = 'K Cena' AND p->'steps'->0->>'follow_up' = 'propuesta'
     FROM jsonb_array_elements(public.prive_key_plans(public.t_ps())) p LIMIT 1));

-- ───────────── 4. Al viaje: itinerario existente, sin reservar, sin duplicar ─────────────
RESET ROLE;
CREATE OR REPLACE FUNCTION public.t_plan() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM public.prive_key_plans WHERE user_id = 'd0000000-0000-0000-0000-0000000000a1' ORDER BY created_at LIMIT 1 $$;
GRANT EXECUTE ON FUNCTION public.t_plan() TO authenticated;
SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub', 'd0000000-0000-0000-0000-0000000000a1', false);
SELECT public.t_ok('T1 viaje ajeno: no', public.prive_key_add_to_trip(public.t_ps(), public.t_plan(), 'd0000000-0000-0000-0000-00000000aa04')->>'code' = 'TRIP_NOT_FOUND');
SELECT public.t_ok('T2 agrega los 2 pasos al viaje', (public.prive_key_add_to_trip(public.t_ps(), public.t_plan(), 'd0000000-0000-0000-0000-00000000aa01')->>'added')::int = 2);
SELECT public.t_ok('T3 repetir no duplica', (public.prive_key_add_to_trip(public.t_ps(), public.t_plan(), 'd0000000-0000-0000-0000-00000000aa01')->>'already')::boolean);
RESET ROLE;
SELECT public.t_ok('T4 en el itinerario como pendiente de Privé, nunca confirmado',
  (SELECT count(*) = 2 AND bool_and(status = 'pending' AND provider = 'iatos_prive' AND raw_payload->>'template' = 'prive_key_signature')
     FROM public.bookings WHERE trip_id = 'd0000000-0000-0000-0000-00000000aa01'));
SELECT public.t_ok('T5 la hora sugerida del plan llega al viaje', (SELECT start_at = '2026-11-20T20:00:00-06:00'::timestamptz FROM public.bookings
  WHERE trip_id = 'd0000000-0000-0000-0000-00000000aa01' AND title = 'K Cena'));
SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub', 'd0000000-0000-0000-0000-0000000000a1', false);
SELECT public.t_ok('T6 seguimiento: en el viaje sin reservar',
  (SELECT p->>'status' = 'en_viaje' AND p->'steps'->0->>'follow_up' = 'en_viaje_sin_reservar' FROM jsonb_array_elements(public.prive_key_plans(public.t_ps())) p LIMIT 1));
SELECT public.t_ok('T7 tras solicitarlo: estado real de la solicitud', (public.prive_request_create(public.t_ps(), 'f0000000-0000-0000-0000-000000000001')->>'ok')::boolean
  AND (SELECT p->'steps'->0->>'follow_up' = 'solicitado' FROM jsonb_array_elements(public.prive_key_plans(public.t_ps())) p LIMIT 1));
RESET ROLE;
-- Marcar "confirmado" SIN evidencia es imposible en la base (prive_confirm_has_evidence): The Key no puede mostrarlo.
SELECT public.t_err('T8 "confirmado" sin evidencia lo bloquea la base', $q$UPDATE public.concierge_requests SET status = 'confirmado_externamente', external_confirmation = NULL
  WHERE user_id = 'd0000000-0000-0000-0000-0000000000a1'$q$, 'prive_confirm_has_evidence|solo cambia con prive_request_transition');
SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub', 'd0000000-0000-0000-0000-0000000000a1', false);

-- ───────────── 5. Aislamiento entre miembros ─────────────
SELECT set_config('request.jwt.claim.sub', 'd0000000-0000-0000-0000-0000000000a4', false);
SELECT public.t_ok('I1 otro miembro no ve mis planes (RPC)', jsonb_array_length(public.prive_key_plans(public.t_ps('k4'))) = 0);
SELECT public.t_err('I2 otro miembro no lee la tabla', $q$SELECT count(*) FROM public.prive_key_plans$q$, 'permission denied');
SELECT public.t_ok('I3 otro miembro no puede mover mi plan a su viaje', public.prive_key_add_to_trip(public.t_ps('k4'), public.t_plan(), 'd0000000-0000-0000-0000-00000000aa04')->>'code' = 'NOT_FOUND');
SELECT public.t_ok('I4 ni archivarlo', (public.prive_key_archive(public.t_ps('k4'), public.t_plan())->>'ok')::boolean = false);

-- ───────────── 6. Recorrido sin texto libre ─────────────
SELECT set_config('request.jwt.claim.sub', 'd0000000-0000-0000-0000-0000000000a1', false);
SELECT public.t_ok('E1 evento válido', public.prive_key_track(public.t_ps(), 'first_option', '{"ms": 1840, "mode": "key", "destination": "cdmx", "wish": "texto privado"}'));
SELECT public.t_ok('E2 evento inventado: no', NOT public.prive_key_track(public.t_ps(), 'reserva_confirmada'));
SELECT public.t_ok('E3 recorrido del día 90', public.prive_key_track(public.t_ps(), 'world_ready_open', '{"ms": 95000}'));
SELECT public.t_ok('E4 ms fuera de rango se descarta', public.prive_key_track(public.t_ps(), 'first_option', '{"ms": 999999999999}'));
RESET ROLE;
SELECT public.t_ok('E5 no guarda texto libre ni ms absurdos',
  (SELECT bool_and(row_to_json(e)::text !~ 'texto privado') AND count(*) FILTER (WHERE event = 'first_option' AND ms IS NULL) = 1 FROM public.prive_key_events e));

-- ───────────── 7. Gustos rápidos y consentimiento ─────────────
SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub', 'd0000000-0000-0000-0000-0000000000a1', false);
SELECT public.t_ok('G1 gustos sin permiso: se guardan', (public.prive_key_taste_save(public.t_ps(), '{"loves":["alta_cocina","noche","inventado"],"budget":"premium"}', false)->>'ok')::boolean);
RESET ROLE;
SELECT public.t_ok('G2 sin permiso, el Travel DNA NO ordena Privé', (public.prive_user_signals('d0000000-0000-0000-0000-0000000000a1')->>'dna_consent')::boolean = false);
SELECT public.t_ok('G3 solo códigos conocidos', (SELECT estilo_comida = ARRAY['michelin'] AND actividades_tarde = ARRAY['nocturna'] AND nivel_presupuesto = 'premium'
  FROM public.ai_user_preferences WHERE user_id = 'd0000000-0000-0000-0000-0000000000a1'));
SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub', 'd0000000-0000-0000-0000-0000000000a1', false);
SELECT public.t_ok('G4 con permiso', (public.prive_key_taste_save(public.t_ps(), '{"loves":["mar"]}', true)->>'ok')::boolean);
RESET ROLE;
SELECT public.t_ok('G5 con permiso, ordena: afinidad a la mesa y a la noche',
  (SELECT (s->>'dna_consent')::boolean AND (s->'affinity'->>'the_table')::int = 20 AND (s->'affinity'->>'after_dark')::int = 20
     FROM public.prive_user_signals('d0000000-0000-0000-0000-0000000000a1') s));
SELECT public.t_ok('G6 agrega sin borrar', (SELECT 'michelin' = ANY (estilo_comida) AND 'playas' = ANY (actividades_tarde) AND 'nocturna' = ANY (actividades_tarde)
  FROM public.ai_user_preferences WHERE user_id = 'd0000000-0000-0000-0000-0000000000a1'));

-- ───────────── 8. Corrección: dna_consent de la guía de inicio sí se guarda ─────────────
SELECT public.t_ok('D1 save_progress conserva dna_consent=false', ((public.prive_save_progress('d0000000-0000-0000-0000-0000000000a4', NULL, '{"dna_consent": false, "step": 2}'))->'onboarding'->>'dna_consent') = 'false');
SELECT public.t_ok('D2 save_progress conserva dna_consent=true', ((public.prive_save_progress('d0000000-0000-0000-0000-0000000000a4', NULL, '{"dna_consent": true}'))->'onboarding'->>'dna_consent') = 'true');
SELECT public.t_ok('D2b y entonces el Travel DNA sí puede ordenar Privé', (public.prive_user_signals('d0000000-0000-0000-0000-0000000000a4')->>'dna_consent')::boolean);
SELECT public.t_ok('D3 dna_consent no booleano: inválido', public.prive_save_progress('d0000000-0000-0000-0000-0000000000a4', NULL, '{"dna_consent": "si"}')->>'code' = 'INVALID');

-- ───────────── 9. Archivar y panel ─────────────
SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub', 'd0000000-0000-0000-0000-0000000000a1', false);
SELECT public.t_ok('A1 archivar lo quita de Mis planes', (public.prive_key_archive(public.t_ps(), public.t_plan())->>'ok')::boolean AND jsonb_array_length(public.prive_key_plans(public.t_ps())) = 0);
SELECT set_config('request.jwt.claim.sub', 'd0000000-0000-0000-0000-0000000000a3', false);
SELECT public.t_ok('M1 panel del equipo: tiempo a primera opción y recorrido de 2 minutos',
  (SELECT (m->>'first_option_ms_p50')::numeric = 1840 AND (m->>'world_ready_within_2min_pct')::numeric = 100 AND (m->>'plans_in_trips')::int = 1 AND (m->>'ai_cost_usd')::int = 0
     FROM public.admin_prive_key_metrics(30) m));
RESET ROLE;
DROP FUNCTION IF EXISTS public.t_plan();
