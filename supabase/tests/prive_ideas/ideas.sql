-- Pruebas de las Ideas de la ruleta (prive_ideas / prive_idea_save). Imprime "OK …" o "FALLA …".
-- I1 miembro con sesión Privé, I4 otro miembro (aislamiento), I2 cuenta sin Privé.
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
  ('d1000000-0000-0000-0000-0000000000a1', 'i1-member@example.test'),
  ('d1000000-0000-0000-0000-0000000000a2', 'i2-free@example.test'),
  ('d1000000-0000-0000-0000-0000000000a4', 'i4-member@example.test') ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS public.t_tokens (label text PRIMARY KEY, token text NOT NULL);
REVOKE ALL ON public.t_tokens FROM PUBLIC, anon, authenticated;
DO $$
DECLARE u uuid; r jsonb; pw text := 'Llave de prueba Prive 2026'; lbl text;
BEGIN
  FOREACH lbl IN ARRAY ARRAY['i1', 'i4'] LOOP
    u := CASE lbl WHEN 'i1' THEN 'd1000000-0000-0000-0000-0000000000a1'::uuid ELSE 'd1000000-0000-0000-0000-0000000000a4'::uuid END;
    INSERT INTO public.profiles (id, full_name, email) VALUES (u, 'Miembro ' || lbl, lbl || '@example.test') ON CONFLICT (id) DO NOTHING;
    INSERT INTO public.subscriptions (user_id, status, stripe_subscription_id, stripe_customer_id, current_period_end)
    VALUES (u, 'active', 'sub_' || lbl, 'cus_' || lbl, now() + interval '20 days')
    ON CONFLICT (user_id) DO UPDATE SET status = 'active', current_period_end = now() + interval '20 days';
    PERFORM public.prive_record_paid_period(u, 'in_' || lbl, 'sub_' || lbl, 'cus_' || lbl, now() - interval '100 days', now() - interval '1 day', 19900, 'mxn', 'test');
    PERFORM public.prive_invite_user(u, 'tenure', 'system');
    r := public.prive_accept_invitation(u, NULL);
    r := public.prive_set_password(u, pw, 'ok');
    INSERT INTO auth.sessions (id, user_id) VALUES (('e6' || substr(u::text, 3))::uuid, u) ON CONFLICT DO NOTHING;
    r := public.prive_unlock(u, pw, NULL, 'e6' || substr(u::text, 3));
    IF r->>'token' IS NULL THEN RAISE NOTICE 'FALLA SETUP sin sesión Privé para %: %', lbl, r; END IF;
    INSERT INTO public.t_tokens VALUES (lbl, r->>'token') ON CONFLICT (label) DO UPDATE SET token = EXCLUDED.token;
  END LOOP;
END $$;
CREATE OR REPLACE FUNCTION public.t_ps(_l text DEFAULT 'i1') RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT token FROM public.t_tokens WHERE label = _l $$;
GRANT EXECUTE ON FUNCTION public.t_ps(text) TO authenticated;

-- ───────────── 1. Sin sesión Privé (o con la de otra persona) no hay nada; anon no ejecuta ─────────────
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'd1000000-0000-0000-0000-0000000000a2', false), set_config('request.jwt.claims', '{"sub":"d1000000-0000-0000-0000-0000000000a2","role":"authenticated","session_id":"e6000000-0000-0000-0000-0000000000a2"}', false);
SELECT public.t_err('S1 leer ideas sin sesión Privé', $q$SELECT public.prive_ideas(NULL)$q$, 'PRIVE_');
SELECT public.t_err('S2 guardar sin sesión Privé', $q$SELECT public.prive_idea_save(NULL, 'paris')$q$, 'PRIVE_');
SELECT public.t_err('S3 la sesión Privé de otra persona no sirve', $q$SELECT public.prive_ideas(public.t_ps('i1'))$q$, 'PRIVE_');
SELECT public.t_err('S4 tabla directa: ni leer', $q$SELECT count(*) FROM public.prive_ideas$q$, 'permission denied');
SELECT public.t_err('S5 tabla directa: ni escribir', $q$INSERT INTO public.prive_ideas(user_id, destination_id) SELECT auth.uid(), id FROM public.prive_destinations LIMIT 1$q$, 'permission denied');
RESET ROLE; SET ROLE anon; SELECT set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claims', '{}', false);
SELECT public.t_err('S6 anon no ejecuta prive_ideas', $q$SELECT public.prive_ideas('x')$q$, 'permission denied');
SELECT public.t_err('S7 anon no ejecuta prive_idea_save', $q$SELECT public.prive_idea_save('x', 'paris')$q$, 'permission denied');
SELECT public.t_err('S8 anon no lee la tabla', $q$SELECT count(*) FROM public.prive_ideas$q$, 'permission denied');
RESET ROLE;

-- ───────────── 2. Guardar: solo destinos reales del catálogo, sin duplicar ─────────────
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'd1000000-0000-0000-0000-0000000000a1', false), set_config('request.jwt.claims', '{"sub":"d1000000-0000-0000-0000-0000000000a1","role":"authenticated","session_id":"e6000000-0000-0000-0000-0000000000a1"}', false);
SELECT public.t_ok('G1 guarda París con mood, mes y presupuesto', (public.prive_idea_save(public.t_ps(), 'paris', true, 'the_table', 2, 'high')->>'ok')::boolean);
SELECT public.t_ok('G2 por alias también (cdmx)', (public.prive_idea_save(public.t_ps(), 'cdmx', true, 'celebrations', NULL, NULL)->>'ok')::boolean);
SELECT public.t_ok('G3 destino inventado: NOT_FOUND', public.prive_idea_save(public.t_ps(), 'atlantida')->>'code' = 'NOT_FOUND');
SELECT public.t_ok('G4 un país que no es destino (Francia): NOT_FOUND', public.prive_idea_save(public.t_ps(), 'fr')->>'code' = 'NOT_FOUND');
SELECT public.t_ok('G5 mood inventado: INVALID', public.prive_idea_save(public.t_ps(), 'roma', true, 'vip_only')->>'code' = 'INVALID');
SELECT public.t_ok('G6 mes fuera de rango: INVALID', public.prive_idea_save(public.t_ps(), 'roma', true, NULL, 12)->>'code' = 'INVALID');
SELECT public.t_ok('G7 repetir París no duplica y actualiza el mood', (public.prive_idea_save(public.t_ps(), 'paris', true, 'after_dark', 5, 'top')->>'ok')::boolean
  AND jsonb_array_length(public.prive_ideas(public.t_ps())) = 2);
SELECT public.t_ok('G8 la lista trae nombre del catálogo, mood y mes 0–11→1–12',
  (SELECT i->>'name' = 'París' AND i->>'universe' = 'after_dark' AND (i->>'month')::int = 6 AND i->>'budget' = 'top'
     FROM jsonb_array_elements(public.prive_ideas(public.t_ps())) i WHERE i->>'slug' = 'paris'));
SELECT public.t_ok('G9 lo más reciente primero', (public.prive_ideas(public.t_ps())->0->>'slug') = 'paris');

-- ───────────── 3. Aislamiento: nadie ve las ideas de otro ─────────────
SELECT set_config('request.jwt.claim.sub', 'd1000000-0000-0000-0000-0000000000a4', false), set_config('request.jwt.claims', '{"sub":"d1000000-0000-0000-0000-0000000000a4","role":"authenticated","session_id":"e6000000-0000-0000-0000-0000000000a4"}', false);
SELECT public.t_ok('A1 el otro miembro ve su lista vacía', jsonb_array_length(public.prive_ideas(public.t_ps('i4'))) = 0);
SELECT public.t_ok('A2 quitar París desde la otra cuenta no toca la del primero', (public.prive_idea_save(public.t_ps('i4'), 'paris', false)->>'ok')::boolean);
SELECT set_config('request.jwt.claim.sub', 'd1000000-0000-0000-0000-0000000000a1', false), set_config('request.jwt.claims', '{"sub":"d1000000-0000-0000-0000-0000000000a1","role":"authenticated","session_id":"e6000000-0000-0000-0000-0000000000a1"}', false);
SELECT public.t_ok('A3 el primero sigue con sus 2 ideas', jsonb_array_length(public.prive_ideas(public.t_ps())) = 2);
SELECT public.t_ok('Q1 quitar una idea propia', (public.prive_idea_save(public.t_ps(), 'cdmx', false)->>'saved')::boolean = false
  AND jsonb_array_length(public.prive_ideas(public.t_ps())) = 1);
RESET ROLE;

-- ───────────── 4. Tope y borrado de cuenta ─────────────
INSERT INTO public.prive_ideas (user_id, destination_id)
SELECT 'd1000000-0000-0000-0000-0000000000a4', id FROM public.prive_destinations WHERE is_destination AND active ORDER BY slug LIMIT 60;
CREATE OR REPLACE FUNCTION public.t_dest61() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT slug FROM public.prive_destinations WHERE is_destination AND active ORDER BY slug OFFSET 60 LIMIT 1 $$;
GRANT EXECUTE ON FUNCTION public.t_dest61() TO authenticated;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'd1000000-0000-0000-0000-0000000000a4', false), set_config('request.jwt.claims', '{"sub":"d1000000-0000-0000-0000-0000000000a4","role":"authenticated","session_id":"e6000000-0000-0000-0000-0000000000a4"}', false);
SELECT public.t_ok('L1 con 60 ideas, una nueva: LIMIT', public.prive_idea_save(public.t_ps('i4'), public.t_dest61())->>'code' = 'LIMIT');
SELECT public.t_ok('L2 con 60 ideas, actualizar una que ya está sí se puede', (public.prive_idea_save(public.t_ps('i4'),
  (public.prive_ideas(public.t_ps('i4'))->0->>'slug'), true, 'yacht_sea')->>'ok')::boolean);
RESET ROLE;
DELETE FROM auth.users WHERE id = 'd1000000-0000-0000-0000-0000000000a4';
SELECT public.t_ok('D1 al borrar la cuenta se borran sus ideas', NOT EXISTS (SELECT 1 FROM public.prive_ideas WHERE user_id = 'd1000000-0000-0000-0000-0000000000a4'));
SELECT public.t_ok('R1 RLS activo en la tabla', (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.prive_ideas'::regclass));
