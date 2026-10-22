-- Datos de PRUEBA para scripts/edition/e2e-real.mjs sobre un Postgres LOCAL con todas las migraciones
-- (nunca producción). Crea cuentas ficticias y deja el Nº 01 tal como está en la siembra (pending_review):
-- la aprobación y publicación las hace la prueba desde el panel /dashboard/admin/edicion.
--   1 FREE · 2 PRO sin Privé (30 días) · 3 miembro Privé con sesión Privé y un viaje a CDMX · 90 admin.
\set ON_ERROR_STOP on
RESET ROLE;
DROP SCHEMA IF EXISTS e2e CASCADE;
CREATE SCHEMA e2e;
CREATE TABLE e2e.tokens (who int PRIMARY KEY, token text NOT NULL, expires_at timestamptz);
CREATE FUNCTION e2e.u(n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT ('e2e00000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
CREATE FUNCTION e2e.sid(n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT ('e2e5e550-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;

DO $$
DECLARE n int; nombre text; r jsonb; pw text;
BEGIN
  FOREACH n IN ARRAY ARRAY[1, 2, 3, 90] LOOP
    nombre := CASE n WHEN 1 THEN 'Fernanda Gratis' WHEN 2 THEN 'Pablo Pro' WHEN 3 THEN 'Valentina Prueba' ELSE 'Editora Admin' END;
    INSERT INTO auth.users (id, email, email_confirmed_at, raw_user_meta_data)
    VALUES (e2e.u(n), 'e2e' || n || '@example.test', now(), jsonb_build_object('full_name', nombre)) ON CONFLICT DO NOTHING;
    INSERT INTO public.profiles (id, full_name, email) VALUES (e2e.u(n), nombre, 'e2e' || n || '@example.test') ON CONFLICT (id) DO NOTHING;
    -- Sesión de Auth real (auth.sessions) a la que se ata la sesión Privé (como supabase/tests/prive_key).
    INSERT INTO auth.sessions (id, user_id) VALUES (e2e.sid(n), e2e.u(n)) ON CONFLICT DO NOTHING;
  END LOOP;
  -- PRO (2 y 3) con periodos pagados: 30 días (no elegible) y 120 días (elegible).
  FOREACH n IN ARRAY ARRAY[2, 3] LOOP
    INSERT INTO public.subscriptions (user_id, status, stripe_subscription_id, stripe_customer_id, current_period_end)
    VALUES (e2e.u(n), 'active', 'sub_e2e' || n, 'cus_e2e' || n, now() + interval '20 days')
    ON CONFLICT (user_id) DO UPDATE SET status = 'active', current_period_end = now() + interval '20 days';
    PERFORM public.prive_record_paid_period(e2e.u(n), 'in_e2e' || n, 'sub_e2e' || n, 'cus_e2e' || n,
      now() - make_interval(days => CASE n WHEN 2 THEN 30 ELSE 120 END), now() + interval '5 days', 19900, 'mxn', 'test');
  END LOOP;
  -- Miembro Privé completo: invitación, contraseña Privé y desbloqueo (token real de prive_unlock).
  pw := 'Edicion-Privada-E2E-Segura!';
  PERFORM public.prive_invite_user(e2e.u(3), 'tenure', 'system');
  r := public.prive_accept_invitation(e2e.u(3), NULL);
  r := public.prive_set_password(e2e.u(3), pw, 'ok');
  r := public.prive_unlock(e2e.u(3), pw, NULL, e2e.sid(3)::text);
  IF NOT (r ? 'token') THEN RAISE EXCEPTION 'sin token Privé: %', r; END IF;
  INSERT INTO e2e.tokens (who, token, expires_at) VALUES (3, r->>'token', (r->>'expires_at')::timestamptz);
  -- Admin del panel editorial (sin Privé: el panel no la exige).
  INSERT INTO public.admins (user_id) VALUES (e2e.u(90)) ON CONFLICT DO NOTHING;
  -- Próximo viaje del miembro (para Flight Edition y la guía práctica del Insider).
  INSERT INTO public.trips (user_id, destino, pais_destino, fecha_salida, fecha_regreso, status)
  VALUES (e2e.u(3), 'Ciudad de México, México', 'México', (now() AT TIME ZONE 'America/Mexico_City')::date + 8, (now() AT TIME ZONE 'America/Mexico_City')::date + 11, 'planning');
END $$;

SELECT 'TOKEN3=' || token || ' EXP3=' || coalesce(expires_at::text, '') FROM e2e.tokens WHERE who = 3;
SELECT 'ISSUE=' || slug || ':' || status FROM public.edition_issues;
SELECT 'ARTICLES=' || count(*) FILTER (WHERE status = 'pending_review') || '/' || count(*) FROM public.edition_articles;
SELECT 'IMAGES_PENDING=' || count(*) FILTER (WHERE license_status = 'pending') FROM public.edition_images;
-- Onboarding terminado (si no, el panel y el dashboard mandan al recorrido de bienvenida).
INSERT INTO public.user_onboarding_state (user_id, completed_onboarding, completed_at, current_step)
SELECT e2e.u(n), true, now(), 5 FROM unnest(ARRAY[1, 2, 3, 90]) n ON CONFLICT (user_id) DO UPDATE SET completed_onboarding = true;
-- Bienvenida y guía de Privé ya vistas (como un miembro que ya entró antes).
UPDATE public.prive_memberships SET welcome_version_seen = 1,
  onboarding = jsonb_build_object('version', 1, 'step', 5, 'completed_at', now()) WHERE user_id = e2e.u(3);
