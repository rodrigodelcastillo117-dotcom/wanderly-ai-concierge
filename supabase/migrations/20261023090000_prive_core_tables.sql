-- IATOS Privé · "The 90-Day Invitation" (grupo core) · 1/4: tablas.
-- Contrato: scratchpad/prive/prive_contract.md §1. Diseño y política: docs/iatos/IATOS_PRIVE_MEMBERSHIP_POLICY.md
-- y docs/iatos/IATOS_PRIVE_INVITATIONS.md.
--
-- Reglas comunes a todas las tablas de este archivo:
--   * RLS encendida y SIN políticas: anon y authenticated no leen ni escriben nada directo. Todo pasa
--     por funciones SECURITY DEFINER (las que el contrato expone a authenticated son solo
--     prive_require y prive_status; el resto es de service_role, que usan las funciones de Edge).
--   * Ningún secreto en claro: contraseñas solo como bcrypt (pgcrypto), tokens solo como SHA-256.
--   * Idempotente: se puede volver a correr sin efectos.
-- Reutiliza: subscriptions + is_pro (PRO vigente), notify_once (avisos sin duplicados), app_flags.

-- 1) Periodos PAGADOS de PRO (antigüedad). Una fila por factura de Stripe con monto > 0: las facturas
--    de prueba o con cupón del 100 % tienen monto 0 y nunca se registran, así que la prueba no cuenta.
CREATE TABLE IF NOT EXISTS public.pro_paid_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_invoice_id text UNIQUE,
  stripe_subscription_id text,
  stripe_customer_id text,
  period tstzrange NOT NULL CHECK (NOT isempty(period) AND lower(period) IS NOT NULL AND upper(period) IS NOT NULL),
  amount_paid int,
  currency text,
  status text NOT NULL DEFAULT 'paid'
    CHECK (status IN ('paid', 'partially_refunded', 'refunded', 'disputed', 'dispute_lost')),
  source text NOT NULL CHECK (source IN ('webhook', 'backfill', 'test')),
  -- Estado que tenía antes de abrirse una disputa (para restaurarlo si se gana).
  status_before_dispute text CHECK (status_before_dispute IS NULL OR status_before_dispute IN ('paid', 'partially_refunded')),
  amount_refunded int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pro_paid_periods_user_idx ON public.pro_paid_periods (user_id);
ALTER TABLE public.pro_paid_periods ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pro_paid_periods FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.pro_paid_periods TO service_role;

-- 2) Membresía Privé (una por cuenta). member_code es público y no sensible (va en la tarjeta).
CREATE TABLE IF NOT EXISTS public.prive_memberships (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('invited', 'active', 'revoked')),
  basis text NOT NULL CHECK (basis IN ('tenure', 'grant')),
  eligible_at timestamptz,
  invited_at timestamptz,
  activated_at timestamptz,
  member_code text UNIQUE CHECK (member_code IS NULL OR member_code ~ '^IP-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$'),
  revoked_at timestamptz,
  revoke_kind text CHECK (revoke_kind IS NULL OR revoke_kind IN ('fraud', 'admin', 'other')),
  revoke_reason text,
  welcome_version_seen int NOT NULL DEFAULT 0,
  onboarding jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.prive_memberships ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.prive_memberships FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.prive_memberships TO service_role;

-- 3) Bitácora de la membresía (auditoría). details nunca lleva contraseñas, tokens ni hashes.
CREATE TABLE IF NOT EXISTS public.prive_membership_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  event text NOT NULL,
  actor text NOT NULL DEFAULT 'system' CHECK (actor IN ('system', 'user') OR actor LIKE 'admin:%'),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS prive_membership_events_user_idx ON public.prive_membership_events (user_id, at DESC);
ALTER TABLE public.prive_membership_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.prive_membership_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.prive_membership_events TO service_role;

-- 4) Concesiones de Privé por administrador (D4): con motivo, vigencia, quién y revocación.
CREATE TABLE IF NOT EXISTS public.prive_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL CHECK (email = lower(email) AND email LIKE '%@%'),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  reason text NOT NULL CHECK (length(btrim(reason)) >= 3),
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_until timestamptz,
  granted_by text NOT NULL CHECK (length(btrim(granted_by)) >= 3),
  revoked_at timestamptz,
  revoked_by text,
  revoke_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (valid_until IS NULL OR valid_until > valid_from)
);
CREATE INDEX IF NOT EXISTS prive_grants_email_idx ON public.prive_grants (email);
CREATE INDEX IF NOT EXISTS prive_grants_user_idx ON public.prive_grants (user_id);
ALTER TABLE public.prive_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.prive_grants FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.prive_grants TO service_role;

-- 5) Invitaciones. El token viaja solo en el fragmento de la URL (#t=…) y aquí solo su SHA-256.
CREATE TABLE IF NOT EXISTS public.prive_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '30 days',
  accepted_at timestamptz,
  revoked_at timestamptz,
  email_status text NOT NULL DEFAULT 'pending' CHECK (email_status IN ('pending', 'sent', 'failed', 'skipped')),
  email_attempts int NOT NULL DEFAULT 0,
  email_last_error text,
  email_next_attempt_at timestamptz DEFAULT now(),
  email_sent_at timestamptz,
  provider_message_id text
);
-- Una sola invitación viva (ni aceptada ni revocada) por persona. La caducidad se revisa al usarla
-- (un índice parcial no puede depender de now()); prive_sweep revoca las caducadas.
CREATE UNIQUE INDEX IF NOT EXISTS prive_invitations_one_live
  ON public.prive_invitations (user_id) WHERE accepted_at IS NULL AND revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS prive_invitations_email_due
  ON public.prive_invitations (email_next_attempt_at) WHERE email_status IN ('pending', 'failed') AND accepted_at IS NULL AND revoked_at IS NULL;
ALTER TABLE public.prive_invitations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.prive_invitations FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.prive_invitations TO service_role;

-- 6) Contraseña Privé individual (bcrypt, costo 12). version sube con cada cambio: las sesiones de
--    una versión anterior dejan de valer.
CREATE TABLE IF NOT EXISTS public.prive_credentials (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  password_hash text NOT NULL CHECK (password_hash LIKE '$2%'),
  version int NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'must_reset')),
  breach_check text CHECK (breach_check IS NULL OR breach_check IN ('ok', 'unavailable', 'generated')),
  set_at timestamptz NOT NULL DEFAULT now(),
  changed_at timestamptz,
  failed_count int NOT NULL DEFAULT 0,
  locked_until timestamptz,
  hard_locked boolean NOT NULL DEFAULT false,
  last_failed_at timestamptz
);
ALTER TABLE public.prive_credentials ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.prive_credentials FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.prive_credentials TO service_role;

-- 7) Sesiones Privé (D7): 32 bytes aleatorios en el cliente; aquí solo su SHA-256.
CREATE TABLE IF NOT EXISTS public.prive_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  auth_session_id text,
  credential_version int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoke_reason text
);
CREATE INDEX IF NOT EXISTS prive_sessions_live_idx ON public.prive_sessions (user_id, created_at) WHERE revoked_at IS NULL;
ALTER TABLE public.prive_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.prive_sessions FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.prive_sessions TO service_role;

-- 8) Intentos (desbloqueo, alta, cambio, restablecimiento, aceptación). Se purgan a los 30 días.
--    ip_hash = sha256(ip || PRIVE_IP_SALT || día UTC) recortado a 16 hex (D8): no es la IP.
CREATE TABLE IF NOT EXISTS public.prive_auth_attempts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  ip_hash text CHECK (ip_hash IS NULL OR ip_hash ~ '^[0-9a-f]{16}$'),
  kind text NOT NULL CHECK (kind IN ('unlock', 'set', 'change', 'reset', 'accept')),
  success boolean NOT NULL,
  reason text,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS prive_auth_attempts_user_idx ON public.prive_auth_attempts (user_id, at DESC);
CREATE INDEX IF NOT EXISTS prive_auth_attempts_ip_idx ON public.prive_auth_attempts (ip_hash, at DESC) WHERE ip_hash IS NOT NULL;
ALTER TABLE public.prive_auth_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.prive_auth_attempts FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.prive_auth_attempts TO service_role;

-- 8b) Bloqueos por ip_hash (> 30 fallos en una hora entre todas las cuentas → 60 min).
CREATE TABLE IF NOT EXISTS public.prive_ip_blocks (
  ip_hash text PRIMARY KEY CHECK (ip_hash ~ '^[0-9a-f]{16}$'),
  blocked_until timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.prive_ip_blocks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.prive_ip_blocks FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.prive_ip_blocks TO service_role;

-- 9) Restablecimiento por correo: token de un solo uso, 30 minutos, solo su SHA-256.
CREATE TABLE IF NOT EXISTS public.prive_password_resets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '30 minutes',
  used_at timestamptz
);
CREATE INDEX IF NOT EXISTS prive_password_resets_user_idx ON public.prive_password_resets (user_id, created_at DESC);
ALTER TABLE public.prive_password_resets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.prive_password_resets FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.prive_password_resets TO service_role;

-- 10) Métricas: la tabla la crea el grupo catalog con EXACTAMENTE estas columnas
--     (docs/iatos/IATOS_PRIVE_MODELO_DE_DATOS.md §7). IF NOT EXISTS: la migración que corra primero
--     la crea y la otra no la toca.
CREATE TABLE IF NOT EXISTS public.prive_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  event text NOT NULL CHECK (event IN ('home_view','city_view','card_impression','detail_open','save','unsave',
        'compare','external_click','request_created','request_confirmed','request_cancelled',
        'iato_pick_shown','iato_pick_opened','signature_interest','route_calc','stale_shown')),
  experience_id uuid, destination_id uuid, trip_id uuid,
  surface text CHECK (surface IN ('home','city','iato','search','trip','favoritos')),
  plan text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.prive_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.prive_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.prive_events TO service_role;

-- 11) Interruptor de D1: Members Only sigue siendo beneficio PRO (false) hasta que el dueño decida.
INSERT INTO public.app_flags (key, value, note) VALUES
  ('members_requires_prive', 'false'::jsonb, 'D1 Privé: mover Members Only detrás de Privé (decisión del dueño; hoy no cambia members_access)')
ON CONFLICT (key) DO NOTHING;
