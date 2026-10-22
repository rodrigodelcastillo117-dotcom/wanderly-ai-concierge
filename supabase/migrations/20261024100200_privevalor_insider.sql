-- IATOS Privé · privevalor 3/6 · THE INSIDER'S NOTEBOOK + BEFORE YOU GO (Doc B §8).
--  * Consejos por destino que valgan la pena (cuándo ir, qué reservar antes, vestimenta, transporte,
--    costumbres, seguridad práctica, errores frecuentes…), cada uno con fuente https, nombre de la fuente y
--    la fecha en que se revisó; los que dependen de una fecha (p. ej. una regla temporal de un museo)
--    llevan valid_until y desaparecen solos.
--  * BEFORE YOU GO: las cinco cosas que conviene saber antes de llegar, para el próximo viaje real del
--    miembro (sus propios viajes; el destino se resuelve con el catálogo de destinos Privé).
--  * Guardar un consejo y agregarlo a las notas del viaje: se agrega a trips.tips_personalizados (la
--    sección "Tips de tu concierge" del viaje) con su fuente, sin duplicar; el guardado conserva el
--    vínculo por si un re-análisis del viaje reescribe esos tips (se puede volver a agregar).
-- Contenido solo para miembros (RPC con prive_require). Guardados solo del dueño.
-- Idempotente.

CREATE TABLE IF NOT EXISTS public.prive_insider_tips (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug              text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]{3,80}$'),
  destination_id    uuid NOT NULL REFERENCES public.prive_destinations(id),
  category          text NOT NULL CHECK (category IN ('cuando_viajar','donde_alojarse','reservar_antes','restaurantes','vestimenta',
                      'transporte','costumbres','seguridad','errores','temporada','itinerario','ocasiones','llegada','documentos')),
  title_es          text NOT NULL CHECK (length(btrim(title_es)) BETWEEN 3 AND 120),
  title_en          text CHECK (title_en IS NULL OR length(btrim(title_en)) BETWEEN 3 AND 120),
  body_es           text NOT NULL CHECK (length(btrim(body_es)) BETWEEN 10 AND 700),
  body_en           text CHECK (body_en IS NULL OR length(btrim(body_en)) BETWEEN 10 AND 700),
  before_you_go     boolean NOT NULL DEFAULT false,
  rank              smallint NOT NULL DEFAULT 50 CHECK (rank BETWEEN 1 AND 99),
  traveler_types    text[] NOT NULL DEFAULT '{}',
  months            smallint[] CHECK (months IS NULL OR months <@ ARRAY[1,2,3,4,5,6,7,8,9,10,11,12]::smallint[]),
  valid_until       date,
  source_url        text NOT NULL CHECK (source_url ~ '^https://'),
  source_name       text NOT NULL CHECK (length(btrim(source_name)) BETWEEN 2 AND 160),
  source_checked_at date NOT NULL,
  verified_by       text NOT NULL CHECK (length(btrim(verified_by)) BETWEEN 2 AND 80),
  status            text NOT NULL DEFAULT 'publicado' CHECK (status IN ('publicado','borrador','retirado')),
  import_batch      text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT prive_tip_checked_not_future CHECK (source_checked_at <= (created_at AT TIME ZONE 'UTC')::date + 1)
);
CREATE INDEX IF NOT EXISTS prive_tips_dest ON public.prive_insider_tips (destination_id, rank);

CREATE TABLE IF NOT EXISTS public.prive_saved_tips (
  user_id          uuid NOT NULL,
  tip_id           uuid NOT NULL REFERENCES public.prive_insider_tips(id) ON DELETE CASCADE,
  trip_id          uuid,
  added_to_trip_at timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, tip_id)
);

ALTER TABLE public.prive_insider_tips ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prive_saved_tips ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS prive_saved_tips_owner ON public.prive_saved_tips;
CREATE POLICY prive_saved_tips_owner ON public.prive_saved_tips FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
REVOKE ALL ON public.prive_insider_tips, public.prive_saved_tips FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.prive_insider_tips, public.prive_saved_tips TO service_role;

-- Publicable hoy: publicado y no vencido (fecha local del destino). stale = fuente revisada hace > 180 días.
CREATE OR REPLACE VIEW public.prive_insider_tips_v AS
SELECT t.*, d.slug AS destination_slug, d.name_es AS destination_name_es, d.name_en AS destination_name_en,
  public.prive_destination_root(t.destination_id) AS root_id,
  (t.source_checked_at < (now() AT TIME ZONE coalesce(d.timezone, 'America/Mexico_City'))::date - 180) AS stale
FROM public.prive_insider_tips t JOIN public.prive_destinations d ON d.id = t.destination_id
WHERE t.status = 'publicado'
  AND (t.valid_until IS NULL OR t.valid_until >= (now() AT TIME ZONE coalesce(d.timezone, 'America/Mexico_City'))::date);
REVOKE ALL ON public.prive_insider_tips_v FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.prive_insider_tips_v TO service_role;

CREATE OR REPLACE FUNCTION public.prive_tip_json(t public.prive_insider_tips_v, _uid uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object('id', t.id, 'slug', t.slug, 'category', t.category,
    'destination', jsonb_build_object('slug', t.destination_slug, 'es', t.destination_name_es, 'en', t.destination_name_en),
    'title', jsonb_build_object('es', t.title_es, 'en', t.title_en), 'body', jsonb_build_object('es', t.body_es, 'en', t.body_en),
    'before_you_go', t.before_you_go, 'rank', t.rank, 'traveler_types', to_jsonb(t.traveler_types), 'months', to_jsonb(t.months),
    'valid_until', t.valid_until, 'source', jsonb_build_object('url', t.source_url, 'name', t.source_name, 'checked_at', t.source_checked_at),
    'stale', t.stale,
    'saved', EXISTS (SELECT 1 FROM public.prive_saved_tips s WHERE s.user_id = _uid AND s.tip_id = t.id),
    'added_to_trip', (SELECT s.trip_id FROM public.prive_saved_tips s WHERE s.user_id = _uid AND s.tip_id = t.id AND s.added_to_trip_at IS NOT NULL)));
$$;
REVOKE ALL ON FUNCTION public.prive_tip_json(public.prive_insider_tips_v, uuid) FROM PUBLIC, anon, authenticated;

-- prive_trip_destination (texto libre del viaje → destino) vive en 20261024100000_privevalor_drops.sql.

-- Próximos viajes propios (o compartidos) que no han terminado, para "agregar al viaje".
CREATE OR REPLACE FUNCTION public.prive_member_trips(_uid uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', t.id, 'destino', left(t.destino, 80), 'fecha_salida', t.fecha_salida,
           'fecha_regreso', t.fecha_regreso, 'destination_slug', (SELECT slug FROM public.prive_destinations WHERE id = public.prive_trip_destination(t.destino))))
           ORDER BY t.fecha_salida NULLS LAST, t.created_at DESC), '[]')
    FROM (SELECT * FROM public.trips t WHERE public.has_trip_access(t.id, _uid)
            AND (t.fecha_regreso IS NULL OR t.fecha_regreso >= current_date) ORDER BY t.fecha_salida NULLS LAST LIMIT 12) t;
$$;
REVOKE ALL ON FUNCTION public.prive_member_trips(uuid) FROM PUBLIC, anon, authenticated;

-- Índice del cuaderno: destinos con consejos publicados.
CREATE OR REPLACE FUNCTION public.prive_insider_index(_ps text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid;
BEGIN
  v_uid := public.prive_require(_ps);
  RETURN jsonb_build_object(
    'destinations', (SELECT coalesce(jsonb_agg(x ORDER BY x->>'es'), '[]') FROM (
        SELECT jsonb_build_object('slug', t.destination_slug, 'es', t.destination_name_es, 'en', t.destination_name_en,
                 'tips', count(*), 'before_you_go', count(*) FILTER (WHERE t.before_you_go),
                 'last_checked', max(t.source_checked_at)) AS x
          FROM public.prive_insider_tips_v t GROUP BY t.destination_slug, t.destination_name_es, t.destination_name_en) q),
    'saved', (SELECT count(*) FROM public.prive_saved_tips s JOIN public.prive_insider_tips_v t ON t.id = s.tip_id WHERE s.user_id = v_uid),
    'trips', public.prive_member_trips(v_uid));
END $$;

-- Cuaderno de un destino: todos sus consejos (incluye los de sus barrios y los del destino raíz).
CREATE OR REPLACE FUNCTION public.prive_insider(_ps text, _destination text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid; v_dest uuid; d public.prive_destinations;
BEGIN
  v_uid := public.prive_require(_ps);
  v_dest := public.prive_resolve_destination(_destination);
  SELECT * INTO d FROM public.prive_destinations WHERE id = v_dest;
  IF NOT FOUND THEN RETURN jsonb_build_object('found', false); END IF;
  RETURN jsonb_build_object('found', true,
    'destination', jsonb_build_object('slug', d.slug, 'es', d.name_es, 'en', d.name_en),
    'tips', (SELECT coalesce(jsonb_agg(public.prive_tip_json(t, v_uid) ORDER BY t.rank, t.slug), '[]')
               FROM public.prive_insider_tips_v t
              WHERE t.destination_id = v_dest OR t.root_id = public.prive_destination_root(v_dest)),
    'trips', public.prive_member_trips(v_uid));
END $$;

-- Las cinco cosas antes de llegar. Sin _trip: el próximo viaje propio que no ha empezado (o en curso).
CREATE OR REPLACE FUNCTION public.prive_before_you_go(_ps text, _trip uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid; t public.trips; v_dest uuid; v_root uuid; d public.prive_destinations; v_tips jsonb;
BEGIN
  v_uid := public.prive_require(_ps);
  IF _trip IS NOT NULL THEN
    IF NOT public.has_trip_access(_trip, v_uid) THEN RETURN jsonb_build_object('trip', NULL, 'code', 'TRIP_NOT_FOUND'); END IF;
    SELECT * INTO t FROM public.trips WHERE id = _trip;
  ELSE
    SELECT * INTO t FROM public.trips x WHERE x.user_id = v_uid AND x.fecha_salida IS NOT NULL
       AND coalesce(x.fecha_regreso, x.fecha_salida) >= current_date AND public.prive_trip_destination(x.destino) IS NOT NULL
     ORDER BY x.fecha_salida LIMIT 1;
  END IF;
  IF t.id IS NULL THEN RETURN jsonb_build_object('trip', NULL); END IF;
  v_dest := public.prive_trip_destination(t.destino);
  v_root := public.prive_destination_root(v_dest);
  SELECT * INTO d FROM public.prive_destinations WHERE id = v_dest;
  SELECT coalesce(jsonb_agg(public.prive_tip_json(v, v_uid) ORDER BY q.o), '[]') INTO v_tips FROM (
    SELECT x.id, row_number() OVER (ORDER BY (NOT x.before_you_go), x.rank, x.slug) AS o
      FROM public.prive_insider_tips_v x
     WHERE v_dest IS NOT NULL AND (x.destination_id = v_dest OR x.root_id = v_root) AND NOT x.stale
       AND (x.months IS NULL OR t.fecha_salida IS NULL OR extract(month FROM t.fecha_salida)::smallint = ANY (x.months))) q
    JOIN public.prive_insider_tips_v v ON v.id = q.id
   WHERE q.o <= 5;
  RETURN jsonb_build_object(
    'trip', jsonb_strip_nulls(jsonb_build_object('id', t.id, 'destino', left(t.destino, 80), 'fecha_salida', t.fecha_salida,
              'fecha_regreso', t.fecha_regreso, 'days_until', CASE WHEN t.fecha_salida IS NOT NULL THEN t.fecha_salida - current_date END)),
    'destination', CASE WHEN d.id IS NOT NULL THEN jsonb_build_object('slug', d.slug, 'es', d.name_es, 'en', d.name_en) END,
    'tips', v_tips);
END $$;

CREATE OR REPLACE FUNCTION public.prive_tip_save(_ps text, _tip uuid, _saved boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid; v_dest uuid;
BEGIN
  v_uid := public.prive_require(_ps);
  SELECT destination_id INTO v_dest FROM public.prive_insider_tips_v WHERE id = _tip;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
  IF _saved THEN
    INSERT INTO public.prive_saved_tips (user_id, tip_id) VALUES (v_uid, _tip) ON CONFLICT DO NOTHING;
    PERFORM public.prive_value_log(v_uid, 'tip_saved', _tip, v_dest, NULL, 'insider');
  ELSE
    DELETE FROM public.prive_saved_tips WHERE user_id = v_uid AND tip_id = _tip;
  END IF;
  RETURN jsonb_build_object('ok', true, 'saved', _saved);
END $$;

-- Agregar a las notas del viaje ("Tips de tu concierge"): una línea con la fuente y la fecha de revisión.
CREATE OR REPLACE FUNCTION public.prive_tip_add_to_trip(_ps text, _tip uuid, _trip uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid; t public.prive_insider_tips_v; v_line text; v_tips jsonb; v_added boolean := false;
BEGIN
  v_uid := public.prive_require(_ps);
  IF _trip IS NULL OR NOT public.has_trip_access(_trip, v_uid) THEN RETURN jsonb_build_object('ok', false, 'code', 'TRIP_NOT_FOUND'); END IF;
  SELECT * INTO t FROM public.prive_insider_tips_v WHERE id = _tip;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
  v_line := 'Privé · ' || t.title_es || ': ' || t.body_es || ' (Fuente: ' || t.source_name || ', revisada el '
            || to_char(t.source_checked_at, 'DD/MM/YYYY') || ')';
  SELECT CASE WHEN jsonb_typeof(tips_personalizados) = 'array' THEN tips_personalizados ELSE '[]'::jsonb END
    INTO v_tips FROM public.trips WHERE id = _trip FOR UPDATE;
  IF NOT v_tips @> jsonb_build_array(v_line) THEN
    IF jsonb_array_length(v_tips) >= 60 THEN RETURN jsonb_build_object('ok', false, 'code', 'TRIP_NOTES_FULL'); END IF;
    UPDATE public.trips SET tips_personalizados = v_tips || jsonb_build_array(v_line) WHERE id = _trip;
    v_added := true;
  END IF;
  INSERT INTO public.prive_saved_tips (user_id, tip_id, trip_id, added_to_trip_at) VALUES (v_uid, _tip, _trip, now())
  ON CONFLICT (user_id, tip_id) DO UPDATE SET trip_id = EXCLUDED.trip_id, added_to_trip_at = EXCLUDED.added_to_trip_at;
  PERFORM public.prive_value_log(v_uid, 'tip_added_to_trip', _tip, t.destination_id, NULL, 'trip');
  RETURN jsonb_build_object('ok', true, 'added', v_added, 'already_present', NOT v_added);
END $$;

REVOKE ALL ON FUNCTION public.prive_insider_index(text), public.prive_insider(text, text), public.prive_before_you_go(text, uuid),
  public.prive_tip_save(text, uuid, boolean), public.prive_tip_add_to_trip(text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prive_insider_index(text), public.prive_insider(text, text), public.prive_before_you_go(text, uuid),
  public.prive_tip_save(text, uuid, boolean), public.prive_tip_add_to_trip(text, uuid, uuid) TO authenticated, service_role;

-- Carga de la curaduría (como prive_import_batch): solo servidor, ensayo por omisión, upsert por slug,
-- rechazo por fila con motivo.
CREATE OR REPLACE FUNCTION public.prive_insider_import_batch(p_rows jsonb, p_batch text, p_dry_run boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r jsonb; v_dest uuid; n_ins int := 0; n_upd int := 0; v_rej jsonb := '[]'; v_report jsonb; v_new boolean;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' AND session_user NOT IN ('postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'prive_insider_import_batch: solo el servidor' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_rows) <> 'array' THEN RAISE EXCEPTION 'prive_insider_import_batch: se espera un arreglo'; END IF;
  BEGIN
    FOR r IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
      BEGIN
        v_dest := public.prive_resolve_destination(r->>'destination_slug');
        IF v_dest IS NULL THEN RAISE EXCEPTION 'destino % no está en el catálogo', r->>'destination_slug'; END IF;
        v_new := NOT EXISTS (SELECT 1 FROM public.prive_insider_tips WHERE slug = r->>'slug');
        INSERT INTO public.prive_insider_tips AS x (slug, destination_id, category, title_es, title_en, body_es, body_en, before_you_go, rank,
          traveler_types, months, valid_until, source_url, source_name, source_checked_at, verified_by, status, import_batch)
        VALUES (r->>'slug', v_dest, r->>'category', r->>'title_es', r->>'title_en', r->>'body_es', r->>'body_en',
          coalesce((r->>'before_you_go')::boolean, false), coalesce((r->>'rank')::smallint, 50),
          ARRAY(SELECT jsonb_array_elements_text(CASE WHEN jsonb_typeof(r->'traveler_types') = 'array' THEN r->'traveler_types' ELSE '[]' END)),
          CASE WHEN jsonb_typeof(r->'months') = 'array' THEN ARRAY(SELECT m::smallint FROM jsonb_array_elements_text(r->'months') m) END,
          (r->>'valid_until')::date, r->>'source_url', r->>'source_name', (r->>'source_checked_at')::date, r->>'verified_by',
          coalesce(r->>'status', 'publicado'), p_batch)
        ON CONFLICT (slug) DO UPDATE SET destination_id = EXCLUDED.destination_id, category = EXCLUDED.category,
          title_es = EXCLUDED.title_es, title_en = EXCLUDED.title_en, body_es = EXCLUDED.body_es, body_en = EXCLUDED.body_en,
          before_you_go = EXCLUDED.before_you_go, rank = EXCLUDED.rank, traveler_types = EXCLUDED.traveler_types,
          months = EXCLUDED.months, valid_until = EXCLUDED.valid_until, source_url = EXCLUDED.source_url,
          source_name = EXCLUDED.source_name, source_checked_at = EXCLUDED.source_checked_at, verified_by = EXCLUDED.verified_by,
          status = EXCLUDED.status, import_batch = EXCLUDED.import_batch, updated_at = now();
        IF v_new THEN n_ins := n_ins + 1; ELSE n_upd := n_upd + 1; END IF;
      EXCEPTION WHEN OTHERS THEN
        v_rej := v_rej || jsonb_build_array(jsonb_build_object('slug', r->>'slug', 'reason', SQLERRM));
      END;
    END LOOP;
    v_report := jsonb_build_object('batch', p_batch, 'dry_run', p_dry_run, 'inserted', n_ins, 'updated', n_upd, 'rejected', v_rej);
    IF p_dry_run THEN RAISE EXCEPTION 'PRIVE_DRY_RUN_ROLLBACK'; END IF;
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'PRIVE_DRY_RUN_ROLLBACK' THEN RAISE; END IF;
  END;
  RETURN v_report;
END $$;
REVOKE ALL ON FUNCTION public.prive_insider_import_batch(jsonb, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prive_insider_import_batch(jsonb, text, boolean) TO service_role;
