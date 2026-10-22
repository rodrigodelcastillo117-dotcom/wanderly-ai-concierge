-- profiles.tier es solo informativo: el acceso PRO lo deciden subscriptions + is_pro (y
-- get_access_state). Por un valor por defecto 'pro' (corregido en 20261022140000) y un UPDATE
-- antiguo (20260529075926), hay cuentas cuyo tier no coincide con su plan real.
--
-- Esta migración NO cambia ninguna cuenta: solo crea la bitácora y dos funciones (solo
-- service_role) para corregir de forma auditable y reversible cuando el dueño lo autorice:
--   SELECT * FROM public.sync_profile_tier(true);    -- vista previa: qué cambiaría
--   SELECT * FROM public.sync_profile_tier(false);   -- aplica y deja cada cambio en la bitácora
--   SELECT public.revert_profile_tier('<batch_id>'); -- deshace exactamente ese lote
-- Ni sincronizar ni revertir otorga o quita acceso: no tocan subscriptions. Idempotente.

COMMENT ON COLUMN public.profiles.tier IS
  'Informativo. No usar para dar acceso: la fuente autorizada es subscriptions vía is_pro().';

CREATE TABLE IF NOT EXISTS public.profiles_tier_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  batch_id uuid NOT NULL,
  profile_id uuid NOT NULL,
  old_tier text,
  new_tier text,
  is_pro_at_change boolean NOT NULL,
  reason text NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  reverted_at timestamptz
);
ALTER TABLE public.profiles_tier_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.profiles_tier_audit FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.profiles_tier_audit TO service_role;
CREATE INDEX IF NOT EXISTS profiles_tier_audit_batch_idx ON public.profiles_tier_audit (batch_id);

CREATE OR REPLACE FUNCTION public.sync_profile_tier(_dry_run boolean DEFAULT true)
RETURNS TABLE (batch_id uuid, profile_id uuid, old_tier text, new_tier text, is_pro boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_batch uuid := gen_random_uuid();
BEGIN
  RETURN QUERY
  WITH target AS (
    SELECT p.id, p.tier AS old_t,
           CASE WHEN public.is_pro(p.id) THEN 'pro' ELSE 'free' END AS new_t,
           public.is_pro(p.id) AS pro
    FROM public.profiles p
  )
  SELECT v_batch, t.id, t.old_t, t.new_t, t.pro
  FROM target t
  WHERE t.old_t IS DISTINCT FROM t.new_t;

  IF _dry_run THEN
    RETURN;
  END IF;

  INSERT INTO public.profiles_tier_audit (batch_id, profile_id, old_tier, new_tier, is_pro_at_change, reason)
  SELECT v_batch, p.id, p.tier,
         CASE WHEN public.is_pro(p.id) THEN 'pro' ELSE 'free' END,
         public.is_pro(p.id),
         'sync_profile_tier: alinear tier informativo con is_pro'
  FROM public.profiles p
  WHERE p.tier IS DISTINCT FROM (CASE WHEN public.is_pro(p.id) THEN 'pro' ELSE 'free' END);

  UPDATE public.profiles p
     SET tier = a.new_tier
    FROM public.profiles_tier_audit a
   WHERE a.batch_id = v_batch AND a.profile_id = p.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.revert_profile_tier(_batch_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  n integer;
BEGIN
  UPDATE public.profiles p
     SET tier = a.old_tier
    FROM public.profiles_tier_audit a
   WHERE a.batch_id = _batch_id AND a.reverted_at IS NULL AND a.profile_id = p.id;
  GET DIAGNOSTICS n = ROW_COUNT;
  UPDATE public.profiles_tier_audit SET reverted_at = now()
   WHERE batch_id = _batch_id AND reverted_at IS NULL;
  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_profile_tier(boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.revert_profile_tier(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_profile_tier(boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.revert_profile_tier(uuid) TO service_role;
