-- Resultado del chequeo diario de servicios externos (función health-check, programada con
-- pg_cron). Solo los administradores pueden leerlo; solo el servidor escribe.
CREATE TABLE IF NOT EXISTS public.health_checks (
  id bigserial PRIMARY KEY,
  ran_at timestamptz NOT NULL DEFAULT now(),
  ok boolean NOT NULL,
  results jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS health_checks_ran_at_idx ON public.health_checks (ran_at DESC);

ALTER TABLE public.health_checks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.health_checks FROM anon, authenticated;
GRANT SELECT ON public.health_checks TO authenticated;
GRANT ALL ON public.health_checks TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.health_checks_id_seq TO service_role;

DROP POLICY IF EXISTS health_checks_admin_read ON public.health_checks;
CREATE POLICY health_checks_admin_read ON public.health_checks
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.admins a WHERE a.user_id = auth.uid()));
