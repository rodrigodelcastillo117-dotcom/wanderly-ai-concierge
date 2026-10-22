-- PROPUESTA DE REPARACIÓN — NO EJECUTAR SIN REVISIÓN Y APROBACIÓN DEL DUEÑO (IATOS-P1-FREE-02).
-- Devuelve el análisis gratuito SOLO a los candidatos "FUERTE" de diagnostico-cuotas.sql: cuentas sin
-- PRO con trips_analyzed_used = 1 y ningún viaje guardado. Es auditable: cada cambio queda en
-- public.quota_repairs_audit con el valor anterior, el nuevo, el motivo y quién lo hizo.
-- Por seguridad TERMINA EN ROLLBACK: al correrlo tal cual solo muestra lo que haría.
-- Para aplicarlo, revisar la lista y cambiar el ROLLBACK final por COMMIT.

BEGIN;

CREATE TABLE IF NOT EXISTS public.quota_repairs_audit (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL,
  campo text NOT NULL,
  valor_anterior int NOT NULL,
  valor_nuevo int NOT NULL,
  motivo text NOT NULL,
  reparado_por text NOT NULL DEFAULT current_user,
  reparado_en timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.quota_repairs_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.quota_repairs_audit FROM PUBLIC, anon, authenticated;

WITH candidatos AS (
  SELECT ul.user_id
    FROM public.usage_limits ul
   WHERE ul.trips_analyzed_used = 1
     AND NOT EXISTS (SELECT 1 FROM public.trips t WHERE t.user_id = ul.user_id)
     AND NOT EXISTS (
       SELECT 1 FROM public.subscriptions s
        WHERE s.user_id = ul.user_id
          AND s.status IN ('active', 'trialing', 'comped')
          AND (s.status = 'comped' OR s.current_period_end IS NULL OR s.current_period_end > now()))
), auditados AS (
  INSERT INTO public.quota_repairs_audit (user_id, campo, valor_anterior, valor_nuevo, motivo)
  SELECT user_id, 'trips_analyzed_used', 1, 0, 'análisis gratuito descontado sin viaje guardado (fallo previo a reservas)'
    FROM candidatos
  RETURNING user_id
)
UPDATE public.usage_limits ul
   SET trips_analyzed_used = 0
  FROM auditados a
 WHERE ul.user_id = a.user_id
   AND ul.trips_analyzed_used = 1;   -- protección: solo si nadie lo cambió entretanto

-- Lo que haría (revisar antes de cambiar a COMMIT):
SELECT a.user_id, u.email, a.valor_anterior, a.valor_nuevo, a.motivo
  FROM public.quota_repairs_audit a JOIN auth.users u ON u.id = a.user_id
 WHERE a.reparado_en = now();

ROLLBACK;  -- ← cambiar a COMMIT solo con aprobación del dueño
