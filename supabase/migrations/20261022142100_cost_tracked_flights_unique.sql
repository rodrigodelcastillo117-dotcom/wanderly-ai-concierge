-- C-01 (IATOS-044): un vuelo seguido sin fecha podía duplicarse en cada llamada porque Postgres trata
-- los NULL como distintos en un UNIQUE, y cada duplicado activo costaba una búsqueda de SerpApi cada
-- 15 minutos. Ahora (user_id, flight, flight_date) es único con NULLS NOT DISTINCT (PG15+).
-- Antes de crear la restricción se borran SOLO duplicados que ya están inactivos (filas viejas sin
-- fecha que 20261022132000 apagó). De cada grupo se conserva una fila: la activa si la hay, si no la
-- más reciente. Nunca se borra un vuelo activo ni el único registro de un vuelo. Idempotente.

WITH ranked AS (
  SELECT id, active,
         row_number() OVER (PARTITION BY user_id, flight, flight_date
                            ORDER BY active DESC, created_at DESC, id DESC) AS rn
    FROM public.tracked_flights
   WHERE flight_date IS NULL
)
DELETE FROM public.tracked_flights t
 USING ranked r
 WHERE t.id = r.id AND r.rn > 1 AND NOT r.active;

-- Si quedara un duplicado ACTIVO (no debería: 132000 apagó todas las filas sin fecha) no se borra
-- nada a ciegas: la migración se detiene con un mensaje claro para revisarlo a mano.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.tracked_flights WHERE flight_date IS NULL
              GROUP BY user_id, flight HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'tracked_flights: hay vuelos sin fecha duplicados y activos; apágalos antes de crear la restricción única';
  END IF;
END $$;

ALTER TABLE public.tracked_flights DROP CONSTRAINT IF EXISTS tracked_flights_user_id_flight_flight_date_key;
ALTER TABLE public.tracked_flights DROP CONSTRAINT IF EXISTS tracked_flights_user_flight_date_uniq;
ALTER TABLE public.tracked_flights ADD CONSTRAINT tracked_flights_user_flight_date_uniq
  UNIQUE NULLS NOT DISTINCT (user_id, flight, flight_date);
