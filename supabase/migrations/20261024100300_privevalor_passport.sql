-- IATOS Privé · privevalor 4/6 · THE PRIVÉ PASSPORT (Doc B §12).
--  * Registro VOLUNTARIO y privado del miembro: destinos visitados, experiencias realizadas, favoritas,
--    deseos y recuerdos. Sin coordenadas, sin columna de "compartir": nada se comparte (no hay forma de
--    publicar itinerarios ni ubicaciones). Solo el dueño lee y escribe (RPC con prive_require + RLS).
--  * Tarjeta: nombre, Member Since (activación de Privé), número de miembro no sensible (member_code ya
--    existente, IP-XXXX-XXXX), antigüedad y estado. SIN niveles por riqueza o consumo.
--  * "Founding Member" solo con un criterio explícito: haber activado Privé en o antes de la fecha de corte
--    que fija el dueño en app_flags.prive_founding_cutoff (un JSON con la fecha "AAAA-MM-DD"). Mientras
--    la fecha no exista (null), NADIE aparece como fundador.
-- Idempotente.

CREATE TABLE IF NOT EXISTS public.prive_passport_entries (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL,
  kind           text NOT NULL CHECK (kind IN ('visitado','experiencia','favorito','deseo','recuerdo')),
  destination_id uuid REFERENCES public.prive_destinations(id),
  place_label    text CHECK (place_label IS NULL OR length(btrim(place_label)) BETWEEN 2 AND 120),
  title          text NOT NULL CHECK (length(btrim(title)) BETWEEN 2 AND 120),
  note           text CHECK (note IS NULL OR length(note) <= 1000),
  experience_id  uuid REFERENCES public.prive_experiences(id) ON DELETE SET NULL,
  trip_id        uuid,
  happened_on    date,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT prive_passport_place CHECK (destination_id IS NOT NULL OR place_label IS NOT NULL OR experience_id IS NOT NULL),
  -- Lo vivido no tiene fecha futura (un deseo puede llevar la fecha en que se sueña ir).
  CONSTRAINT prive_passport_dates CHECK (happened_on IS NULL OR kind = 'deseo' OR happened_on <= (created_at AT TIME ZONE 'UTC')::date + 1),
  CONSTRAINT prive_passport_no_card_numbers CHECK (NOT public.prive_has_card_number(concat_ws(' ', place_label, title, note)))
);
CREATE INDEX IF NOT EXISTS prive_passport_user ON public.prive_passport_entries (user_id, kind, happened_on DESC);

ALTER TABLE public.prive_passport_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS prive_passport_owner ON public.prive_passport_entries;
CREATE POLICY prive_passport_owner ON public.prive_passport_entries FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
REVOKE ALL ON public.prive_passport_entries FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.prive_passport_entries TO service_role;

INSERT INTO public.app_flags (key, value, note) VALUES
  ('prive_founding_cutoff', 'null'::jsonb,
   'Privé Passport: fecha de corte (JSON "AAAA-MM-DD") de "Founding Member" = activó Privé en o antes de esa fecha. null = nadie es fundador.')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.prive_founding_cutoff()
RETURNS date LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v jsonb;
BEGIN
  SELECT value INTO v FROM public.app_flags WHERE key = 'prive_founding_cutoff';
  IF v IS NULL OR jsonb_typeof(v) <> 'string' OR (v #>> '{}') !~ '^\d{4}-\d{2}-\d{2}$' THEN RETURN NULL; END IF;
  RETURN (v #>> '{}')::date;
EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.prive_founding_cutoff() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prive_founding_cutoff() TO service_role;

CREATE OR REPLACE FUNCTION public.prive_passport_json(p public.prive_passport_entries)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object('id', p.id, 'kind', p.kind, 'title', p.title, 'note', p.note,
    'place', p.place_label, 'happened_on', p.happened_on, 'trip_id', p.trip_id, 'created_at', p.created_at,
    'destination', (SELECT jsonb_build_object('slug', d.slug, 'es', d.name_es, 'en', d.name_en, 'country', d.iso_country)
                      FROM public.prive_destinations d WHERE d.id = p.destination_id),
    'experience', (SELECT jsonb_build_object('slug', e.slug, 'name', e.name) FROM public.prive_experiences e WHERE e.id = p.experience_id)));
$$;
REVOKE ALL ON FUNCTION public.prive_passport_json(public.prive_passport_entries) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.prive_passport(_ps text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid; m public.prive_memberships; v_cut date;
BEGIN
  v_uid := public.prive_require(_ps);
  SELECT * INTO m FROM public.prive_memberships WHERE user_id = v_uid;
  v_cut := public.prive_founding_cutoff();
  RETURN jsonb_build_object(
    'member', jsonb_strip_nulls(jsonb_build_object(
      'first_name', public.prive_first_name(v_uid),
      'member_code', m.member_code,
      'member_since', m.activated_at,
      'tenure_days', CASE WHEN m.activated_at IS NOT NULL THEN greatest(0, current_date - (m.activated_at AT TIME ZONE 'America/Mexico_City')::date) END,
      'status', m.status,
      'founding_member', (v_cut IS NOT NULL AND m.activated_at IS NOT NULL AND (m.activated_at AT TIME ZONE 'America/Mexico_City')::date <= v_cut),
      'founding_cutoff', v_cut)),
    'stats', (SELECT jsonb_build_object(
        'visitado', count(*) FILTER (WHERE kind = 'visitado'), 'experiencia', count(*) FILTER (WHERE kind = 'experiencia'),
        'favorito', count(*) FILTER (WHERE kind = 'favorito'), 'deseo', count(*) FILTER (WHERE kind = 'deseo'),
        'recuerdo', count(*) FILTER (WHERE kind = 'recuerdo'),
        'countries', (SELECT count(DISTINCT d.iso_country) FROM public.prive_passport_entries p2
                        JOIN public.prive_destinations d ON d.id = p2.destination_id
                       WHERE p2.user_id = v_uid AND p2.kind IN ('visitado','experiencia','recuerdo')))
        FROM public.prive_passport_entries WHERE user_id = v_uid),
    'entries', (SELECT coalesce(jsonb_agg(public.prive_passport_json(p) ORDER BY p.happened_on DESC NULLS LAST, p.created_at DESC), '[]')
                  FROM public.prive_passport_entries p WHERE p.user_id = v_uid));
END $$;

CREATE OR REPLACE FUNCTION public.prive_passport_save(_ps text, _entry jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid; v_id uuid; r public.prive_passport_entries; v_dest uuid; v_exp uuid; v_trip uuid;
BEGIN
  v_uid := public.prive_require(_ps);
  IF jsonb_typeof(_entry) <> 'object' THEN RETURN jsonb_build_object('ok', false, 'code', 'INVALID'); END IF;
  v_id := CASE WHEN (_entry->>'id') ~ '^[0-9a-f-]{36}$' THEN (_entry->>'id')::uuid END;
  v_dest := CASE WHEN _entry->>'destination' IS NOT NULL THEN public.prive_resolve_destination(_entry->>'destination') END;
  SELECT id INTO v_exp FROM public.prive_experiences
   WHERE id = CASE WHEN (_entry->>'experience_id') ~ '^[0-9a-f-]{36}$' THEN (_entry->>'experience_id')::uuid END AND active;
  v_trip := CASE WHEN (_entry->>'trip_id') ~ '^[0-9a-f-]{36}$' THEN (_entry->>'trip_id')::uuid END;
  IF v_trip IS NOT NULL AND NOT public.has_trip_access(v_trip, v_uid) THEN RETURN jsonb_build_object('ok', false, 'code', 'TRIP_NOT_FOUND'); END IF;
  IF v_id IS NULL AND (SELECT count(*) FROM public.prive_passport_entries WHERE user_id = v_uid) >= 500 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'LIMIT');
  END IF;
  BEGIN
    IF v_id IS NULL THEN
      INSERT INTO public.prive_passport_entries (user_id, kind, destination_id, place_label, title, note, experience_id, trip_id, happened_on)
      VALUES (v_uid, _entry->>'kind', v_dest, nullif(left(btrim(_entry->>'place'), 120), ''), left(btrim(_entry->>'title'), 120),
        nullif(left(_entry->>'note', 1000), ''), v_exp, v_trip, (_entry->>'happened_on')::date)
      RETURNING * INTO r;
    ELSE
      UPDATE public.prive_passport_entries SET kind = coalesce(_entry->>'kind', kind), destination_id = coalesce(v_dest, destination_id),
        place_label = coalesce(nullif(left(btrim(_entry->>'place'), 120), ''), place_label), title = coalesce(left(btrim(_entry->>'title'), 120), title),
        note = CASE WHEN _entry ? 'note' THEN nullif(left(_entry->>'note', 1000), '') ELSE note END,
        happened_on = CASE WHEN _entry ? 'happened_on' THEN (_entry->>'happened_on')::date ELSE happened_on END, updated_at = now()
      WHERE id = v_id AND user_id = v_uid RETURNING * INTO r;
      IF r.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
    END IF;
  EXCEPTION WHEN check_violation OR not_null_violation OR invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID');
  END;
  IF v_id IS NULL THEN PERFORM public.prive_value_log(v_uid, 'passport_entry_added', NULL, r.destination_id, r.kind, 'my_prive'); END IF;
  RETURN jsonb_build_object('ok', true, 'entry', public.prive_passport_json(r));
END $$;

CREATE OR REPLACE FUNCTION public.prive_passport_delete(_ps text, _id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid; n int;
BEGIN
  v_uid := public.prive_require(_ps);
  DELETE FROM public.prive_passport_entries WHERE id = _id AND user_id = v_uid;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN jsonb_build_object('ok', n = 1);
END $$;

REVOKE ALL ON FUNCTION public.prive_passport(text), public.prive_passport_save(text, jsonb), public.prive_passport_delete(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prive_passport(text), public.prive_passport_save(text, jsonb), public.prive_passport_delete(text, uuid) TO authenticated, service_role;
