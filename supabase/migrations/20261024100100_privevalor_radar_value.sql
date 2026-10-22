-- IATOS Privé · privevalor 2/6 · THE PRIVILEGE RADAR (Doc B §7) + THE VALUE OF YOUR PRIVÉ.
--  * El radar se monta sobre la Bóveda existente (user_vault_benefits y, cuando exista, vault_items del
--    equipo boveda): solo lee NOMBRES y NIVELES de programas y tarjetas; nunca números de socio ni de
--    tarjeta. Nada de esta migración guarda un número de tarjeta (CHECK prive_has_card_number).
--  * Estados: posible (sugerido por coincidencia de marca; NO es elegibilidad) · por_comprobar · verificado
--    (exige cómo se verificó) · utilizado (exige haberlo verificado antes y la fecha de uso).
--  * El valor separa ahorro comprobado (precio de referencia + precio pagado + evidencia), estimado
--    (referencia con fuente), potencial y valor sin ahorro. El ahorro es una columna CALCULADA
--    (referencia − pagado): nadie escribe un ahorro a mano. Nunca se suman monedas distintas.
-- Filas solo del dueño: RLS por user_id como defensa en profundidad, y sin permisos directos para
-- authenticated (todo pasa por RPC con prive_require: solo miembros Privé con sesión).
-- Idempotente.

CREATE TABLE IF NOT EXISTS public.prive_radar_items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL,
  drop_id           uuid REFERENCES public.prive_drops(id) ON DELETE SET NULL,
  program_label     text NOT NULL CHECK (length(btrim(program_label)) BETWEEN 2 AND 80),
  benefit_es        text NOT NULL CHECK (length(btrim(benefit_es)) BETWEEN 3 AND 300),
  state             text NOT NULL DEFAULT 'posible' CHECK (state IN ('posible','por_comprobar','verificado','utilizado')),
  source_url        text CHECK (source_url IS NULL OR source_url ~ '^https://'),
  conditions_note   text CHECK (conditions_note IS NULL OR length(conditions_note) <= 600),
  verification_note text CHECK (verification_note IS NULL OR length(verification_note) <= 400),
  verified_at       timestamptz,
  used_at           date,
  trip_id           uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT prive_radar_verified_has_evidence CHECK (state NOT IN ('verificado','utilizado')
    OR (verified_at IS NOT NULL AND coalesce(length(btrim(verification_note)), 0) >= 3)),
  CONSTRAINT prive_radar_used_has_date CHECK (state <> 'utilizado' OR used_at IS NOT NULL),
  CONSTRAINT prive_radar_no_card_numbers CHECK (NOT public.prive_has_card_number(concat_ws(' ', program_label, benefit_es, conditions_note, verification_note)))
);
CREATE UNIQUE INDEX IF NOT EXISTS prive_radar_user_drop ON public.prive_radar_items (user_id, drop_id) WHERE drop_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS prive_radar_user ON public.prive_radar_items (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.prive_value_entries (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL,
  kind              text NOT NULL CHECK (kind IN ('comprobado','estimado','potencial','sin_ahorro')),
  title             text NOT NULL CHECK (length(btrim(title)) BETWEEN 2 AND 120),
  currency          char(3) CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  reference_amount  numeric(12,2) CHECK (reference_amount IS NULL OR reference_amount > 0),
  paid_amount       numeric(12,2) CHECK (paid_amount IS NULL OR paid_amount >= 0),
  savings_amount    numeric(12,2) GENERATED ALWAYS AS (reference_amount - paid_amount) STORED,
  reference_source  text CHECK (reference_source IS NULL OR length(reference_source) <= 300),
  evidence_note     text CHECK (evidence_note IS NULL OR length(evidence_note) <= 400),
  non_monetary_note text CHECK (non_monetary_note IS NULL OR length(non_monetary_note) <= 300),
  radar_item_id     uuid REFERENCES public.prive_radar_items(id) ON DELETE SET NULL,
  drop_id           uuid REFERENCES public.prive_drops(id) ON DELETE SET NULL,
  trip_id           uuid,
  occurred_on       date,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT prive_value_amounts_pair CHECK ((reference_amount IS NULL) = (paid_amount IS NULL)
    AND (reference_amount IS NULL OR (currency IS NOT NULL AND reference_amount > paid_amount))),
  CONSTRAINT prive_value_kind_rules CHECK (CASE kind
    -- comprobado: referencia y pagado reales, con la fuente de la referencia y la evidencia (recibo, folio…)
    WHEN 'comprobado' THEN reference_amount IS NOT NULL AND coalesce(length(btrim(reference_source)), 0) >= 3
                           AND coalesce(length(btrim(evidence_note)), 0) >= 3
    -- estimado: referencia con fuente; no hay evidencia del pago
    WHEN 'estimado'   THEN reference_amount IS NOT NULL AND coalesce(length(btrim(reference_source)), 0) >= 3
    -- potencial: montos solo con fuente. Que esté ligado a una oportunidad o a un beneficio del radar lo
    -- exige prive_value_save (no un CHECK: al borrar el beneficio, el FK pone NULL y el trigger
    -- prive_radar_orphan_potentials borra el potencial huérfano en vez de romper el borrado).
    WHEN 'potencial'  THEN (reference_amount IS NULL OR coalesce(length(btrim(reference_source)), 0) >= 3)
    -- valor sin ahorro: experiencia organizada; nunca montos
    WHEN 'sin_ahorro' THEN reference_amount IS NULL AND currency IS NULL AND coalesce(length(btrim(non_monetary_note)), 0) >= 3
  END),
  CONSTRAINT prive_value_no_card_numbers CHECK (NOT public.prive_has_card_number(concat_ws(' ', title, reference_source, evidence_note, non_monetary_note)))
);
CREATE INDEX IF NOT EXISTS prive_value_user ON public.prive_value_entries (user_id, created_at DESC);

-- Un ahorro potencial existe solo mientras exista el beneficio u oportunidad que lo origina.
CREATE OR REPLACE FUNCTION public.prive_radar_orphan_potentials()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM public.prive_value_entries
   WHERE user_id = OLD.user_id AND kind = 'potencial' AND radar_item_id IS NULL AND drop_id IS NULL;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.prive_radar_orphan_potentials() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS prive_radar_orphan_potentials ON public.prive_radar_items;
CREATE TRIGGER prive_radar_orphan_potentials AFTER DELETE ON public.prive_radar_items
  FOR EACH ROW EXECUTE FUNCTION public.prive_radar_orphan_potentials();

ALTER TABLE public.prive_radar_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prive_value_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS prive_radar_owner ON public.prive_radar_items;
CREATE POLICY prive_radar_owner ON public.prive_radar_items FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS prive_value_owner ON public.prive_value_entries;
CREATE POLICY prive_value_owner ON public.prive_value_entries FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
REVOKE ALL ON public.prive_radar_items, public.prive_value_entries FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.prive_radar_items, public.prive_value_entries TO service_role;

CREATE OR REPLACE FUNCTION public.prive_radar_json(i public.prive_radar_items)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object('id', i.id, 'drop_id', i.drop_id,
    'drop_slug', (SELECT slug FROM public.prive_drops WHERE id = i.drop_id),
    'drop_status', (SELECT effective_status FROM public.prive_drops_v WHERE id = i.drop_id),
    'program', i.program_label, 'benefit', i.benefit_es, 'state', i.state, 'source_url', i.source_url,
    'conditions', i.conditions_note, 'verification_note', i.verification_note, 'verified_at', i.verified_at,
    'used_at', i.used_at, 'trip_id', i.trip_id, 'updated_at', i.updated_at));
$$;
REVOKE ALL ON FUNCTION public.prive_radar_json(public.prive_radar_items) FROM PUBLIC, anon, authenticated;

-- El radar: programas de la Bóveda (sin números), beneficios que el miembro sigue, y sugerencias
-- POSIBLE BENEFICIO de Drops cuyo programa coincide por nombre. La coincidencia de marca NO es
-- elegibilidad: cada sugerencia trae sus condiciones y fuente para comprobarla.
CREATE OR REPLACE FUNCTION public.prive_radar(_ps text, _destination text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid; v_dest uuid;
BEGIN
  v_uid := public.prive_require(_ps);
  v_dest := CASE WHEN _destination IS NOT NULL THEN public.prive_resolve_destination(_destination) END;
  RETURN jsonb_build_object(
    'programs', (SELECT coalesce(jsonb_agg(DISTINCT jsonb_strip_nulls(jsonb_build_object('kind', p.kind, 'label', p.label, 'tier', p.tier))), '[]')
                   FROM public.prive_vault_programs(v_uid) p),
    'items', (SELECT coalesce(jsonb_agg(public.prive_radar_json(i) ORDER BY i.updated_at DESC), '[]')
                FROM public.prive_radar_items i WHERE i.user_id = v_uid),
    'suggestions', (SELECT coalesce(jsonb_agg(s.j ORDER BY s.slug), '[]') FROM (
        SELECT DISTINCT ON (d.id) d.slug,
               public.prive_drop_json(d, ARRAY['boveda']) || jsonb_build_object('matched_program', p.label, 'suggested_state', 'posible') AS j
          FROM public.prive_drops_v d
          JOIN public.prive_vault_programs(v_uid) p ON public.prive_program_matches(p.norm, d.program_match)
         WHERE d.effective_status IN ('activo','por_verificar')
           AND d.drop_type IN ('beneficio_lealtad','beneficio_tarjeta','beneficio_iatos','tarifa_publicada','promocion_publica','oferta_temporal')
           AND (v_dest IS NULL OR d.destination_id IS NULL OR public.prive_destination_root(d.destination_id) = public.prive_destination_root(v_dest))
           AND NOT EXISTS (SELECT 1 FROM public.prive_radar_items i WHERE i.user_id = v_uid AND i.drop_id = d.id)
         ORDER BY d.id, p.label) s));
END $$;

-- Guardar o mover un beneficio del radar. Reglas de transición:
--   · cualquier estado → posible / por_comprobar;
--   · → verificado exige verification_note (cómo y con quién se comprobó); fija verified_at;
--   · → utilizado exige que ya estuviera verificado (o se verifique en la misma llamada) y used_at.
CREATE OR REPLACE FUNCTION public.prive_radar_save(_ps text, _item jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid; v_id uuid; v_old public.prive_radar_items; v_drop public.prive_drops_v; v_state text; v_trip uuid;
  v_note text; v_verified timestamptz; r public.prive_radar_items;
BEGIN
  v_uid := public.prive_require(_ps);
  IF jsonb_typeof(_item) <> 'object' THEN RETURN jsonb_build_object('ok', false, 'code', 'INVALID'); END IF;
  v_id := CASE WHEN (_item->>'id') ~ '^[0-9a-f-]{36}$' THEN (_item->>'id')::uuid END;
  IF v_id IS NOT NULL THEN
    SELECT * INTO v_old FROM public.prive_radar_items WHERE id = v_id AND user_id = v_uid;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
  END IF;
  IF (_item->>'drop_id') ~ '^[0-9a-f-]{36}$' THEN
    SELECT * INTO v_drop FROM public.prive_drops_v WHERE id = (_item->>'drop_id')::uuid AND effective_status IN ('activo','por_verificar','vencido');
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'DROP_NOT_FOUND'); END IF;
  END IF;
  v_state := coalesce(_item->>'state', v_old.state, 'posible');
  IF v_state NOT IN ('posible','por_comprobar','verificado','utilizado') THEN RETURN jsonb_build_object('ok', false, 'code', 'INVALID_STATE'); END IF;
  v_note := coalesce(nullif(btrim(_item->>'verification_note'), ''), v_old.verification_note);
  v_verified := v_old.verified_at;
  IF v_state = 'verificado' AND (v_verified IS NULL OR v_old.state NOT IN ('verificado','utilizado')) THEN v_verified := now(); END IF;
  IF v_state IN ('verificado','utilizado') AND coalesce(length(btrim(v_note)), 0) < 3 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'VERIFICATION_REQUIRED');
  END IF;
  IF v_state = 'utilizado' AND v_verified IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'VERIFY_FIRST');
  END IF;
  IF v_state IN ('posible','por_comprobar') THEN v_verified := NULL; END IF;
  v_trip := CASE WHEN (_item->>'trip_id') ~ '^[0-9a-f-]{36}$' THEN (_item->>'trip_id')::uuid ELSE v_old.trip_id END;
  IF v_trip IS NOT NULL AND NOT public.has_trip_access(v_trip, v_uid) THEN RETURN jsonb_build_object('ok', false, 'code', 'TRIP_NOT_FOUND'); END IF;
  BEGIN
    IF v_id IS NULL THEN
      INSERT INTO public.prive_radar_items (user_id, drop_id, program_label, benefit_es, state, source_url, conditions_note,
        verification_note, verified_at, used_at, trip_id)
      VALUES (v_uid, v_drop.id,
        left(coalesce(nullif(btrim(_item->>'program'), ''), v_drop.provider_name), 80),
        left(coalesce(nullif(btrim(_item->>'benefit'), ''), v_drop.benefit_es), 300),
        v_state, coalesce(_item->>'source_url', v_drop.source_url),
        left(coalesce(_item->>'conditions', v_drop.conditions_es), 600), v_note, v_verified,
        CASE WHEN v_state = 'utilizado' THEN coalesce((_item->>'used_at')::date, current_date) END, v_trip)
      ON CONFLICT (user_id, drop_id) WHERE drop_id IS NOT NULL DO UPDATE SET state = EXCLUDED.state,
        verification_note = EXCLUDED.verification_note, verified_at = EXCLUDED.verified_at, used_at = EXCLUDED.used_at,
        trip_id = EXCLUDED.trip_id, updated_at = now()
      RETURNING * INTO r;
    ELSE
      UPDATE public.prive_radar_items SET
        program_label = left(coalesce(nullif(btrim(_item->>'program'), ''), program_label), 80),
        benefit_es = left(coalesce(nullif(btrim(_item->>'benefit'), ''), benefit_es), 300),
        state = v_state, verification_note = v_note, verified_at = v_verified,
        used_at = CASE WHEN v_state = 'utilizado' THEN coalesce((_item->>'used_at')::date, used_at, current_date) END,
        conditions_note = left(coalesce(_item->>'conditions', conditions_note), 600),
        trip_id = v_trip, updated_at = now()
      WHERE id = v_id AND user_id = v_uid RETURNING * INTO r;
    END IF;
  EXCEPTION WHEN check_violation OR invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID');
  END;
  IF v_old.id IS NULL OR v_old.state IS DISTINCT FROM r.state THEN
    PERFORM public.prive_value_log(v_uid, 'radar_state_change', r.drop_id, NULL, r.state, 'radar');
  END IF;
  RETURN jsonb_build_object('ok', true, 'item', public.prive_radar_json(r));
END $$;

CREATE OR REPLACE FUNCTION public.prive_radar_delete(_ps text, _id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid; n int;
BEGIN
  v_uid := public.prive_require(_ps);
  DELETE FROM public.prive_radar_items WHERE id = _id AND user_id = v_uid;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN jsonb_build_object('ok', n = 1);
END $$;

-- ───────────────────────────── THE VALUE OF YOUR PRIVÉ ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.prive_value_json(v public.prive_value_entries)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object('id', v.id, 'kind', v.kind, 'title', v.title, 'currency', v.currency,
    'reference_amount', v.reference_amount, 'paid_amount', v.paid_amount, 'savings_amount', v.savings_amount,
    'reference_source', v.reference_source, 'evidence_note', v.evidence_note, 'non_monetary_note', v.non_monetary_note,
    'radar_item_id', v.radar_item_id, 'drop_id', v.drop_id, 'trip_id', v.trip_id, 'occurred_on', v.occurred_on, 'created_at', v.created_at));
$$;
REVOKE ALL ON FUNCTION public.prive_value_json(public.prive_value_entries) FROM PUBLIC, anon, authenticated;

-- Resumen: totales por tipo Y por moneda (nunca se mezclan tipos ni monedas), entradas, y el valor
-- organizado sin ahorro (planes Privé agregados a viajes) contado aparte, sin convertirlo en dinero.
CREATE OR REPLACE FUNCTION public.prive_value_summary(_ps text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid;
BEGIN
  v_uid := public.prive_require(_ps);
  RETURN jsonb_build_object(
    'totals', (SELECT coalesce(jsonb_object_agg(kind, per_currency), '{}') FROM (
        SELECT kind, jsonb_agg(jsonb_build_object('currency', currency, 'amount', total, 'count', n) ORDER BY currency) AS per_currency
          FROM (SELECT kind, currency, sum(savings_amount) AS total, count(*) AS n FROM public.prive_value_entries
                 WHERE user_id = v_uid AND kind IN ('comprobado','estimado','potencial') AND savings_amount IS NOT NULL
                 GROUP BY kind, currency) t GROUP BY kind) k),
    'entries', (SELECT coalesce(jsonb_agg(public.prive_value_json(v) ORDER BY coalesce(v.occurred_on, v.created_at::date) DESC, v.created_at DESC), '[]')
                  FROM public.prive_value_entries v WHERE v.user_id = v_uid),
    'organized_plans', (SELECT count(DISTINCT coalesce(b.raw_payload->>'plan_group', b.id::text)) FROM public.bookings b
                         WHERE b.user_id = v_uid AND b.provider = 'iatos_prive'),
    'radar', (SELECT jsonb_build_object('posible', count(*) FILTER (WHERE state = 'posible'),
                'por_comprobar', count(*) FILTER (WHERE state = 'por_comprobar'),
                'verificado', count(*) FILTER (WHERE state = 'verificado'),
                'utilizado', count(*) FILTER (WHERE state = 'utilizado'))
                FROM public.prive_radar_items WHERE user_id = v_uid));
END $$;

CREATE OR REPLACE FUNCTION public.prive_value_save(_ps text, _entry jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid; r public.prive_value_entries; v_trip uuid; v_radar uuid; v_drop uuid;
BEGIN
  v_uid := public.prive_require(_ps);
  IF jsonb_typeof(_entry) <> 'object' THEN RETURN jsonb_build_object('ok', false, 'code', 'INVALID'); END IF;
  v_trip := CASE WHEN (_entry->>'trip_id') ~ '^[0-9a-f-]{36}$' THEN (_entry->>'trip_id')::uuid END;
  IF v_trip IS NOT NULL AND NOT public.has_trip_access(v_trip, v_uid) THEN RETURN jsonb_build_object('ok', false, 'code', 'TRIP_NOT_FOUND'); END IF;
  -- Solo beneficios propios del radar; solo Drops publicables o vencidos (no retirados).
  SELECT id INTO v_radar FROM public.prive_radar_items
   WHERE id = CASE WHEN (_entry->>'radar_item_id') ~ '^[0-9a-f-]{36}$' THEN (_entry->>'radar_item_id')::uuid END AND user_id = v_uid;
  SELECT id INTO v_drop FROM public.prive_drops_v
   WHERE id = CASE WHEN (_entry->>'drop_id') ~ '^[0-9a-f-]{36}$' THEN (_entry->>'drop_id')::uuid END
     AND effective_status IN ('activo','por_verificar','vencido');
  IF _entry->>'kind' = 'potencial' AND v_radar IS NULL AND v_drop IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID');
  END IF;
  BEGIN
    INSERT INTO public.prive_value_entries (user_id, kind, title, currency, reference_amount, paid_amount, reference_source,
      evidence_note, non_monetary_note, radar_item_id, drop_id, trip_id, occurred_on)
    VALUES (v_uid, _entry->>'kind', left(btrim(_entry->>'title'), 120), upper(nullif(_entry->>'currency', '')),
      (_entry->>'reference_amount')::numeric, (_entry->>'paid_amount')::numeric, left(_entry->>'reference_source', 300),
      left(_entry->>'evidence_note', 400), left(_entry->>'non_monetary_note', 300), v_radar, v_drop, v_trip,
      (_entry->>'occurred_on')::date)
    RETURNING * INTO r;
  EXCEPTION WHEN check_violation OR not_null_violation OR invalid_text_representation OR invalid_datetime_format
             OR datetime_field_overflow OR numeric_value_out_of_range THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID');
  END;
  PERFORM public.prive_value_log(v_uid, 'value_entry_added', r.id, NULL, r.kind, 'my_prive');
  RETURN jsonb_build_object('ok', true, 'entry', public.prive_value_json(r));
END $$;

CREATE OR REPLACE FUNCTION public.prive_value_delete(_ps text, _id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid; n int;
BEGIN
  v_uid := public.prive_require(_ps);
  DELETE FROM public.prive_value_entries WHERE id = _id AND user_id = v_uid;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN jsonb_build_object('ok', n = 1);
END $$;

REVOKE ALL ON FUNCTION public.prive_radar(text, text), public.prive_radar_save(text, jsonb), public.prive_radar_delete(text, uuid),
  public.prive_value_summary(text), public.prive_value_save(text, jsonb), public.prive_value_delete(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prive_radar(text, text), public.prive_radar_save(text, jsonb), public.prive_radar_delete(text, uuid),
  public.prive_value_summary(text), public.prive_value_save(text, jsonb), public.prive_value_delete(text, uuid) TO authenticated, service_role;
