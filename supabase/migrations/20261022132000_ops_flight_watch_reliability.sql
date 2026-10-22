-- Vigilancia de vuelos confiable (auditoría C-02, C-03, C-04, C-06, C-07).
-- Antes: un error del proveedor, una llave faltante o una fecha equivocada quedaban marcados como
-- "revisado" (last_checked_at), la fecha se calculaba con "hoy" en UTC y dos corridas encimadas
-- podían procesar y avisar el mismo cambio dos veces. Idempotente: se puede correr más de una vez.

-- 1) Columnas de observabilidad. last_checked_at se conserva por compatibilidad y ahora significa
--    "última consulta con datos" (igual que last_successful_check_at).
ALTER TABLE public.tracked_flights
  ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_successful_check_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_provider_status text,
  ADD COLUMN IF NOT EXISTS check_error text,
  ADD COLUMN IF NOT EXISTS consecutive_failures integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_notified_fingerprint text,
  -- Última hora estimada que SÍ se avisó: los cambios se miden contra ella (anti-rebote).
  ADD COLUMN IF NOT EXISTS last_notified_estimated text,
  -- Salida y llegada esperadas (si el proveedor trae zona horaria): cada 15 min solo desde 6 h
  -- antes de salir; 3 h después de la llegada se deja de vigilar.
  ADD COLUMN IF NOT EXISTS departure_at timestamptz,
  ADD COLUMN IF NOT EXISTS arrival_at timestamptz;

ALTER TABLE public.tracked_flights DROP CONSTRAINT IF EXISTS tracked_flights_last_provider_status_check;
ALTER TABLE public.tracked_flights ADD CONSTRAINT tracked_flights_last_provider_status_check
  CHECK (last_provider_status IS NULL OR last_provider_status IN ('ok', 'no_data', 'date_mismatch', 'provider_error', 'quota'));
ALTER TABLE public.tracked_flights DROP CONSTRAINT IF EXISTS tracked_flights_check_error_len;
ALTER TABLE public.tracked_flights ADD CONSTRAINT tracked_flights_check_error_len
  CHECK (check_error IS NULL OR length(check_error) <= 300);

-- El historial no distingue intentos de éxitos: se copia solo como intento.
UPDATE public.tracked_flights SET last_attempt_at = last_checked_at
 WHERE last_attempt_at IS NULL AND last_checked_at IS NOT NULL;

-- 2) Filas viejas sin fecha: se consultaban con "hoy" en UTC para siempre (y se duplicaban porque
--    NULL no choca en el UNIQUE). Se apagan; track-flight ya exige fecha.
UPDATE public.tracked_flights SET active = false WHERE active AND flight_date IS NULL;

CREATE INDEX IF NOT EXISTS idx_tracked_flights_due
  ON public.tracked_flights (flight_date, last_attempt_at NULLS FIRST) WHERE active;

-- 3) Cada cuánto se puede volver a consultar un vuelo (control de costo de SerpApi):
--    - del día anterior al siguiente de su fecha (cubre todas las zonas horarias): cada corrida
--      (p_min_gap); pero si ya sabemos que sale en más de 6 h, cada hora;
--    - en 2 o 3 días: cada 3 h;  - a más de 3 días: cada 6 h (el estado casi nunca cambia).
--    Tras 3 fallas seguidas espera al menos 30 min, y tras 6, 1 h.
DROP FUNCTION IF EXISTS public.tracked_flight_gap(date, date, integer, interval);
CREATE OR REPLACE FUNCTION public.tracked_flight_gap(
  p_flight_date date, p_today date, p_failures integer, p_min_gap interval,
  p_departure_at timestamptz DEFAULT NULL, p_now timestamptz DEFAULT NULL
) RETURNS interval
LANGUAGE sql IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT greatest(
    CASE WHEN p_flight_date <= p_today + 1 THEN
              CASE WHEN p_departure_at IS NOT NULL AND p_now IS NOT NULL AND p_departure_at > p_now + interval '6 hours'
                   THEN interval '1 hour' ELSE p_min_gap END
         WHEN p_flight_date <= p_today + 3 THEN interval '3 hours'
         ELSE interval '6 hours' END,
    CASE WHEN coalesce(p_failures, 0) >= 6 THEN interval '1 hour'
         WHEN coalesce(p_failures, 0) >= 3 THEN interval '30 minutes'
         ELSE interval '0' END);
$$;
REVOKE ALL ON FUNCTION public.tracked_flight_gap(date, date, integer, interval, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tracked_flight_gap(date, date, integer, interval, timestamptz, timestamptz) TO service_role;

-- 4) Reclamo de vuelos pendientes. Bloquea con FOR UPDATE SKIP LOCKED y marca last_attempt_at en la
--    misma sentencia: dos corridas simultáneas reciben conjuntos distintos, y un vuelo recién
--    reclamado no vuelve a estar pendiente hasta que pase su intervalo. Primero los más próximos
--    (ventana de ±1 día), luego los que llevan más tiempo sin intento.
CREATE OR REPLACE FUNCTION public.claim_tracked_flights(
  p_limit integer DEFAULT 50,
  p_min_gap interval DEFAULT interval '10 minutes'
) RETURNS SETOF public.tracked_flights
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'UTC')::date;
  v_limit integer := least(greatest(coalesce(p_limit, 0), 0), 200);
BEGIN
  IF v_limit = 0 THEN
    RETURN;
  END IF;

  -- Retira lo que ya no tiene caso vigilar: sin fecha (legado), fecha ya pasada (más de un día) o
  -- 3 h después de la llegada. SKIP LOCKED para no esperar a otra corrida.
  UPDATE public.tracked_flights t SET active = false
   WHERE t.id IN (
     SELECT x.id FROM public.tracked_flights x
      WHERE x.active
        AND (x.flight_date IS NULL
             OR x.flight_date < v_today - 1
             OR (x.arrival_at IS NOT NULL AND x.arrival_at < now() - interval '3 hours'))
      FOR UPDATE SKIP LOCKED);

  RETURN QUERY
  WITH due AS (
    SELECT x.id
      FROM public.tracked_flights x
     WHERE x.active
       AND x.flight_date >= v_today - 1
       AND (x.last_attempt_at IS NULL
            OR x.last_attempt_at <= now() - public.tracked_flight_gap(x.flight_date, v_today, x.consecutive_failures, p_min_gap, x.departure_at, now()))
     ORDER BY (x.flight_date > v_today + 1), x.last_attempt_at NULLS FIRST, x.flight_date
     LIMIT v_limit
     FOR UPDATE SKIP LOCKED
  )
  UPDATE public.tracked_flights t
     SET last_attempt_at = now()
    FROM due
   WHERE t.id = due.id
  RETURNING t.*;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_tracked_flights(integer, interval) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_tracked_flights(integer, interval) TO service_role;
