-- Concierge 2.0: configuración de modelos y tope opcional del Modo exigente. Cada bloque truena si
-- algo no cuadra; imprime "OK …".
\set ON_ERROR_STOP 1
SET client_min_messages = notice;

INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('c2c20000-0000-0000-0000-000000000001', 'iato-exigente@test.mx', now()) ON CONFLICT DO NOTHING;

DO $$
DECLARE r jsonb; u uuid := 'c2c20000-0000-0000-0000-000000000001';
BEGIN
  r := public.concierge_runtime_config(u);
  IF r->'models'->>'fast_model' IS NULL OR r->'models'->>'smart_model' IS NULL THEN RAISE EXCEPTION 'K1 %', r; END IF;
  IF jsonb_typeof(r->'exigente'->'limit') <> 'null' OR (r->'exigente'->>'used')::int <> 0 THEN RAISE EXCEPTION 'K1b %', r; END IF;
  RAISE NOTICE 'OK K1 modelos sembrados y Modo exigente sin tope (como hoy)';

  -- Mensajes exigentes de hoy: reservas confirmadas con llave x:. Las normales (s:) y las no confirmadas no cuentan.
  INSERT INTO public.quota_reservations (user_id, kind, request_key, status, counted, plan) VALUES
    (u, 'concierge', 'x:1', 'COMMITTED', false, 'pro'), (u, 'concierge', 'x:2', 'COMMITTED', false, 'pro'),
    (u, 'concierge', 'x:3', 'RELEASED', false, 'pro'), (u, 'concierge', 's:1', 'COMMITTED', false, 'pro');
  INSERT INTO public.quota_reservations (user_id, kind, request_key, status, counted, plan, created_at) VALUES
    (u, 'concierge', 'x:ayer', 'COMMITTED', false, 'pro', now() - interval '2 days');
  UPDATE public.app_flags SET value = '20'::jsonb WHERE key = 'concierge_exigente_daily_limit';
  r := public.concierge_runtime_config(u);
  IF (r->'exigente'->>'limit')::int <> 20 OR (r->'exigente'->>'used')::int <> 2 THEN RAISE EXCEPTION 'K2 %', r; END IF;
  RAISE NOTICE 'OK K2 cuenta solo los mensajes exigentes confirmados de hoy (2 de 20)';

  -- Un valor que no es número se trata como "sin tope" (un typo no bloquea a nadie).
  UPDATE public.app_flags SET value = '"veinte"'::jsonb WHERE key = 'concierge_exigente_daily_limit';
  r := public.concierge_runtime_config(u);
  IF jsonb_typeof(r->'exigente'->'limit') <> 'null' THEN RAISE EXCEPTION 'K3 %', r; END IF;
  RAISE NOTICE 'OK K3 tope inválido = sin tope';
  UPDATE public.app_flags SET value = 'null'::jsonb WHERE key = 'concierge_exigente_daily_limit';
END $$;

-- Solo el servidor (service_role) la ejecuta; un usuario no puede leer app_flags ni la función.
SET ROLE authenticated;
DO $$ BEGIN
  PERFORM public.concierge_runtime_config('c2c20000-0000-0000-0000-000000000001');
  RAISE EXCEPTION 'FALLA K4 un usuario pudo ejecutar concierge_runtime_config';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'OK K4 un usuario no puede ejecutar concierge_runtime_config [permission denied]';
END $$;
DO $$ BEGIN
  PERFORM 1 FROM public.app_flags;
  RAISE EXCEPTION 'FALLA K5 un usuario pudo leer app_flags';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'OK K5 un usuario no puede leer app_flags [permission denied]';
END $$;
RESET ROLE;
SET ROLE service_role;
DO $$ BEGIN
  IF public.concierge_runtime_config(NULL) IS NULL THEN RAISE EXCEPTION 'K6'; END IF;
  RAISE NOTICE 'OK K6 service_role la ejecuta';
END $$;
RESET ROLE;
