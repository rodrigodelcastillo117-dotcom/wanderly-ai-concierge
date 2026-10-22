-- Reclamo de alertas de precio con FOR UPDATE SKIP LOCKED (igual que claim_tracked_flights).
-- Antes price-watch-cron leía las 40 más atrasadas con un SELECT simple: dos corridas encimadas (un
-- reintento de pg_cron, una corrida manual) procesaban las mismas alertas, gastaban dos veces la
-- búsqueda de SerpApi y podían repetir el aviso. Ahora cada corrida recibe un conjunto distinto y una
-- alerta recién reclamada no vuelve a salir hasta que pase p_min_gap. Idempotente.

ALTER TABLE public.price_watches ADD COLUMN IF NOT EXISTS claimed_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_price_watches_claim
  ON public.price_watches (last_checked_at NULLS FIRST) WHERE active;

CREATE OR REPLACE FUNCTION public.claim_price_watches(
  p_limit integer DEFAULT 40,
  p_min_gap interval DEFAULT interval '6 hours'
) RETURNS SETOF public.price_watches
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_limit integer := least(greatest(coalesce(p_limit, 0), 0), 200);
  v_tomorrow date := (now() AT TIME ZONE 'UTC')::date + 1;
BEGIN
  IF v_limit = 0 THEN
    RETURN;
  END IF;

  -- Viajes que ya salieron (o salen mañana): ya no hay nada que vigilar.
  UPDATE public.price_watches w SET active = false
   WHERE w.id IN (SELECT x.id FROM public.price_watches x
                   WHERE x.active AND x.departure_date < v_tomorrow
                   FOR UPDATE SKIP LOCKED);

  RETURN QUERY
  WITH due AS (
    SELECT x.id
      FROM public.price_watches x
     WHERE x.active
       AND x.departure_date >= v_tomorrow
       AND (x.claimed_at IS NULL OR x.claimed_at <= now() - coalesce(p_min_gap, interval '0'))
     ORDER BY x.last_checked_at NULLS FIRST, x.departure_date
     LIMIT v_limit
     FOR UPDATE SKIP LOCKED
  )
  UPDATE public.price_watches w
     SET claimed_at = now()
    FROM due
   WHERE w.id = due.id
  RETURNING w.*;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_price_watches(integer, interval) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_price_watches(integer, interval) TO service_role;
