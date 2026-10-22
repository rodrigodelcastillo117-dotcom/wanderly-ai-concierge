-- "Sube un viaje que ya hiciste" (grupo avatar-viajes). Idempotente.
--
-- La persona sube boletos, pases de abordar y confirmaciones de hotel; la IA los lee
-- (parse-trip-file, con validación estricta) y, tras revisar y editar en pantalla, el viaje se guarda
-- con LOS PRECIOS QUE PAGÓ (moneda tal cual del documento), aunque ya haya pasado.
--
-- · trips.fuente       'plan' (lo armó IATOS) | 'documento' (importado de sus documentos).
-- · trips.realizado    true si el viaje ya terminó al importarlo.
-- · trips.pagado_total / pagado_moneda: total pagado según los documentos (null si no aparece: no se
--   inventa). total_estimado sigue en MXN para el resto de la app (null si no hay tipo de cambio).
-- · status sigue siendo 'listo' (producción tiene trips_status_chk = analizando|listo|error).
-- · trip_import_refs: números de vuelo+fecha, PNR y confirmaciones ya importados → sin duplicados.
-- · import_past_trip(): guarda todo en una transacción (con candado por persona).

ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS fuente text NOT NULL DEFAULT 'plan';
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS realizado boolean NOT NULL DEFAULT false;
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS pagado_total numeric(14, 2);
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS pagado_moneda text;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'trips_fuente_chk') THEN
    ALTER TABLE public.trips ADD CONSTRAINT trips_fuente_chk CHECK (fuente IN ('plan', 'documento'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'trips_pagado_chk') THEN
    ALTER TABLE public.trips ADD CONSTRAINT trips_pagado_chk CHECK (
      (pagado_total IS NULL OR pagado_total >= 0)
      AND (pagado_moneda IS NULL OR pagado_moneda ~ '^[A-Z]{3}$'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.trip_import_refs (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL,
  trip_id    uuid NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  ref        text NOT NULL CHECK (ref ~ '^(PNR|VUELO|HOTEL|RESERVA):[A-Z0-9:/.-]{3,60}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT trip_import_refs_unique UNIQUE (user_id, ref)
);
CREATE INDEX IF NOT EXISTS idx_trip_import_refs_trip ON public.trip_import_refs (trip_id);
ALTER TABLE public.trip_import_refs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.trip_import_refs FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.trip_import_refs FROM authenticated;
GRANT SELECT ON public.trip_import_refs TO authenticated;
GRANT ALL ON public.trip_import_refs TO service_role;
DROP POLICY IF EXISTS trip_import_refs_select_own ON public.trip_import_refs;
CREATE POLICY trip_import_refs_select_own ON public.trip_import_refs FOR SELECT TO authenticated USING (user_id = auth.uid());

-- Guarda un viaje importado. p_trip trae los campos ya revisados por la persona; p_refs las llaves de
-- duplicado que calculó la app (lib/tripImport.ts) — aquí se normalizan y validan otra vez.
-- Regresa {"ok":true,"trip_id":…} o {"ok":false,"code":"duplicado","trip_id":…,"ref":…}
-- / {"ok":false,"code":"invalido","campo":…}.
CREATE OR REPLACE FUNCTION public.import_past_trip(p_trip jsonb, p_refs text[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_refs text[];
  v_dup record;
  v_destino text := btrim(coalesce(p_trip->>'destino', ''));
  v_salida date;
  v_regreso date;
  v_viajeros integer;
  v_pagado numeric;
  v_moneda text := upper(nullif(btrim(coalesce(p_trip->>'pagado_moneda', '')), ''));
  v_total numeric;
  v_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Inicia sesión' USING ERRCODE = '42501'; END IF;
  IF p_trip IS NULL OR jsonb_typeof(p_trip) <> 'object' THEN RETURN jsonb_build_object('ok', false, 'code', 'invalido', 'campo', 'viaje'); END IF;
  IF length(v_destino) NOT BETWEEN 1 AND 200 THEN RETURN jsonb_build_object('ok', false, 'code', 'invalido', 'campo', 'destino'); END IF;
  BEGIN
    v_salida := nullif(p_trip->>'fecha_salida', '')::date;
    v_regreso := nullif(p_trip->>'fecha_regreso', '')::date;
  EXCEPTION WHEN others THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalido', 'campo', 'fechas');
  END;
  IF v_salida IS NULL OR (v_regreso IS NOT NULL AND v_regreso < v_salida)
     OR v_salida < date '1990-01-01' OR v_salida > current_date + 730 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalido', 'campo', 'fechas');
  END IF;
  v_viajeros := coalesce(nullif(p_trip->>'num_viajeros', '')::numeric::integer, 1);
  IF v_viajeros NOT BETWEEN 1 AND 20 THEN RETURN jsonb_build_object('ok', false, 'code', 'invalido', 'campo', 'num_viajeros'); END IF;
  v_pagado := nullif(p_trip->>'pagado_total', '')::numeric;
  IF (v_pagado IS NOT NULL AND (v_pagado < 0 OR v_pagado > 100000000)) OR (v_moneda IS NOT NULL AND v_moneda !~ '^[A-Z]{3}$')
     OR (v_pagado IS NOT NULL AND v_moneda IS NULL) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalido', 'campo', 'pagado');
  END IF;
  v_total := nullif(p_trip->>'total_estimado', '')::numeric;
  IF v_total IS NOT NULL AND (v_total < 0 OR v_total > 100000000) THEN v_total := NULL; END IF;
  IF jsonb_typeof(coalesce(p_trip->'vuelos_json', '[]')) <> 'array' OR jsonb_array_length(coalesce(p_trip->'vuelos_json', '[]')) > 40
     OR jsonb_typeof(coalesce(p_trip->'hospedaje_json', '[]')) <> 'array' OR jsonb_array_length(coalesce(p_trip->'hospedaje_json', '[]')) > 40
     OR jsonb_typeof(coalesce(p_trip->'itinerario_json', '{}')) <> 'object' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalido', 'campo', 'detalle');
  END IF;

  SELECT coalesce(array_agg(DISTINCT r), '{}') INTO v_refs
    FROM (SELECT upper(btrim(x)) AS r FROM unnest(coalesce(p_refs, '{}')) x) s
   WHERE r ~ '^(PNR|VUELO|HOTEL|RESERVA):[A-Z0-9:/.-]{3,60}$';
  IF array_length(v_refs, 1) > 60 THEN v_refs := v_refs[1:60]; END IF;

  -- Mismo boleto/reserva dos veces = el mismo viaje: candado por persona y búsqueda de las llaves
  -- (en importaciones anteriores y en los códigos de confirmación de sus otros viajes).
  PERFORM pg_advisory_xact_lock(hashtextextended('trip-import:' || v_uid::text, 0));
  SELECT r.trip_id, r.ref INTO v_dup FROM public.trip_import_refs r
   WHERE r.user_id = v_uid AND r.ref = ANY (v_refs) LIMIT 1;
  IF NOT FOUND THEN
    SELECT t.id AS trip_id, k.ref INTO v_dup
      FROM public.trips t
      CROSS JOIN LATERAL (
        SELECT e FROM jsonb_array_elements(CASE WHEN jsonb_typeof(t.vuelos_json) = 'array' THEN t.vuelos_json ELSE '[]' END) e
        UNION ALL
        SELECT e FROM jsonb_array_elements(CASE WHEN jsonb_typeof(t.hospedaje_json) = 'array' THEN t.hospedaje_json ELSE '[]' END) e
      ) items
      JOIN LATERAL (SELECT unnest(v_refs) AS ref) k
        ON split_part(k.ref, ':', 1) IN ('PNR', 'HOTEL', 'RESERVA')
       AND upper(btrim(items.e->>'confirmacion')) = substr(k.ref, position(':' IN k.ref) + 1)
     WHERE t.user_id = v_uid
     LIMIT 1;
  END IF;
  IF v_dup.trip_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'duplicado', 'trip_id', v_dup.trip_id, 'ref', v_dup.ref);
  END IF;

  INSERT INTO public.trips (
    user_id, destino, pais_destino, ciudad_origen, fecha_salida, fecha_regreso, num_viajeros,
    total_estimado, moneda, status, fuente, realizado, pagado_total, pagado_moneda,
    analisis_ai, vuelos_json, hospedaje_json, cruceros_json, restaurantes_json, tours_json, itinerario_json
  ) VALUES (
    v_uid, v_destino, left(nullif(btrim(coalesce(p_trip->>'pais_destino', '')), ''), 120),
    left(nullif(btrim(coalesce(p_trip->>'ciudad_origen', '')), ''), 120), v_salida, v_regreso, v_viajeros,
    v_total, 'MXN', 'listo', 'documento', coalesce(v_regreso, v_salida) < current_date, v_pagado, v_moneda,
    left(nullif(p_trip->>'analisis_ai', ''), 4000),
    coalesce(p_trip->'vuelos_json', '[]'), coalesce(p_trip->'hospedaje_json', '[]'), '[]', '[]', '[]',
    coalesce(p_trip->'itinerario_json', '{}')
  ) RETURNING id INTO v_id;

  INSERT INTO public.trip_import_refs (user_id, trip_id, ref)
  SELECT v_uid, v_id, r FROM unnest(v_refs) r
  ON CONFLICT (user_id, ref) DO NOTHING;

  RETURN jsonb_build_object('ok', true, 'trip_id', v_id, 'realizado', coalesce(v_regreso, v_salida) < current_date);
END;
$$;
REVOKE ALL ON FUNCTION public.import_past_trip(jsonb, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_past_trip(jsonb, text[]) TO authenticated, service_role;
