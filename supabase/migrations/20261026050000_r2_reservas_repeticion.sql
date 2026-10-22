-- Ronda r2 (segunda auditoría, grupo reservas) · A2-RES-12 (P3): repetición del correo recibido.
-- Idempotente. REQUIERE AUTORIZACIÓN DEL DUEÑO PARA APLICARSE EN PRODUCCIÓN (función apagada).
--
-- Antes: "<a1@casa71.mx>" y "a1@casa71.mx" no se trataban como el mismo Message-ID (lower(btrim()) no
-- quita los < >); el mismo cuerpo con otro Message-ID se procesaba otra vez; y apply_reply aceptaba un
-- segundo resultado para el mismo correo (primero ambiguous y luego confirmed, con 2 decisiones).
-- Ahora (cambio mínimo sobre 20261024170000):
--   * ai_reservation_inbound_attach normaliza el Message-ID (minúsculas, sin espacios ni < >) antes
--     del hash, y marca duplicate_body el mismo cuerpo del mismo remitente para la misma reserva;
--   * ai_reservation_apply_reply exige que el correo siga en 'processing' y que no tenga decisión.

CREATE OR REPLACE FUNCTION public.ai_reservation_inbound_attach(_inbound_id uuid, _e jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  i public.ai_reservation_inbound;
  -- A2-RES-12: "<a1@casa.mx>", " <A1@Casa.mx> " y "a1@casa.mx" son el mismo Message-ID.
  v_mid text := regexp_replace(lower(coalesce(_e->>'message_id', '')), '^[[:space:]<]+|[[:space:]>]+$', '', 'g');
  v_hash text; v_dup uuid; v_dup_body uuid;
  v_at timestamptz; v_auth jsonb;
BEGIN
  SELECT * INTO i FROM public.ai_reservation_inbound WHERE id = _inbound_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
  IF jsonb_typeof(_e) IS DISTINCT FROM 'object' OR _e->>'provider' IS DISTINCT FROM 'resend'
     OR _e->>'provider_email_id' IS DISTINCT FROM i.email_id OR coalesce(_e->>'body_sha256', '') !~ '^[0-9a-f]{64}$'
     OR (_e->>'raw_sha256' IS NOT NULL AND _e->>'raw_sha256' !~ '^[0-9a-f]{64}$') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'BAD_EVIDENCE');
  END IF;
  v_hash := CASE WHEN v_mid <> '' THEN encode(extensions.digest(convert_to(v_mid, 'UTF8'), 'sha256'), 'hex') END;
  IF i.attached_at IS NOT NULL THEN
    -- Reintento del mismo correo: la evidencia debe ser idéntica.
    IF i.body_sha256 IS DISTINCT FROM _e->>'body_sha256' OR coalesce(i.message_id_hash, i.duplicate_of::text, '') <> coalesce(v_hash, i.duplicate_of::text, '') THEN
      RETURN jsonb_build_object('ok', false, 'code', 'EVIDENCE_MISMATCH');
    END IF;
    RETURN jsonb_build_object('ok', true, 'replay', true, 'duplicate', i.status = 'duplicate', 'duplicate_of', i.duplicate_of);
  END IF;
  BEGIN v_at := (_e->>'received_at')::timestamptz; EXCEPTION WHEN others THEN v_at := NULL; END;
  v_auth := CASE WHEN jsonb_typeof(_e->'auth') = 'object' THEN jsonb_build_object(
    'spf', left(_e->'auth'->>'spf', 20), 'dkim', left(_e->'auth'->>'dkim', 20), 'dmarc', left(_e->'auth'->>'dmarc', 20)) END;
  IF v_hash IS NOT NULL THEN
    SELECT id INTO v_dup FROM public.ai_reservation_inbound WHERE message_id_hash = v_hash AND id <> i.id LIMIT 1;
  END IF;
  -- A2-RES-12: el mismo cuerpo del mismo remitente para la misma reserva, con otro Message-ID, es un
  -- reenvío del mismo correo: no se procesa otra vez.
  IF v_dup IS NULL AND i.reservation_id IS NOT NULL THEN
    SELECT x.id INTO v_dup_body FROM public.ai_reservation_inbound x
     WHERE x.reservation_id = i.reservation_id AND x.id <> i.id AND x.attached_at IS NOT NULL
       AND x.body_sha256 = _e->>'body_sha256' AND x.from_address IS NOT DISTINCT FROM left(lower(btrim(_e->>'from_address')), 254)
     ORDER BY x.attached_at LIMIT 1;
  END IF;
  BEGIN
    UPDATE public.ai_reservation_inbound
       SET provider = 'resend', message_id_hash = CASE WHEN v_dup IS NULL THEN v_hash END, duplicate_of = coalesce(v_dup, v_dup_body),
           body_sha256 = _e->>'body_sha256', raw_sha256 = _e->>'raw_sha256', raw_pointer = left(_e->>'raw_pointer', 300),
           provider_received_at = v_at, from_address = left(lower(btrim(_e->>'from_address')), 254), reply_to = left(_e->>'reply_to', 500),
           auth = v_auth, reply_text = left(_e->>'reply_text', 8000),
           linkage = CASE WHEN jsonb_typeof(_e->'linkage') = 'object' THEN _e->'linkage' END,
           sender = CASE WHEN jsonb_typeof(_e->'sender') = 'object' THEN _e->'sender' END,
           attached_at = now(),
           status = CASE WHEN coalesce(v_dup, v_dup_body) IS NOT NULL THEN 'duplicate' ELSE status END,
           outcome = CASE WHEN v_dup IS NOT NULL THEN 'duplicate_message_id' WHEN v_dup_body IS NOT NULL THEN 'duplicate_body' ELSE outcome END,
           processed_at = CASE WHEN coalesce(v_dup, v_dup_body) IS NOT NULL THEN now() ELSE processed_at END
     WHERE id = i.id;
  EXCEPTION WHEN unique_violation THEN
    -- Otro webhook con el mismo Message-ID ganó la carrera.
    SELECT id INTO v_dup FROM public.ai_reservation_inbound WHERE message_id_hash = v_hash AND id <> i.id LIMIT 1;
    UPDATE public.ai_reservation_inbound
       SET duplicate_of = v_dup, body_sha256 = _e->>'body_sha256', provider_received_at = v_at, attached_at = now(),
           status = 'duplicate', outcome = 'duplicate_message_id', processed_at = now()
     WHERE id = i.id;
  END;
  v_dup := coalesce(v_dup, v_dup_body);
  RETURN jsonb_build_object('ok', true, 'duplicate', v_dup IS NOT NULL, 'duplicate_of', v_dup);
END $$;

CREATE OR REPLACE FUNCTION public.ai_reservation_apply_reply(_id uuid, _inbound_id uuid, _d jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.ai_reservations; i public.ai_reservation_inbound; v_out text := _d->>'outcome'; v_to text; v_reason text; v_ev jsonb;
BEGIN
  SELECT * INTO r FROM public.ai_reservations WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
  IF v_out NOT IN ('confirmed','alternative_offered','declined','needs_info','payment_required','unverified','ambiguous','ignored') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'BAD_OUTCOME');
  END IF;
  SELECT * INTO i FROM public.ai_reservation_inbound WHERE id = _inbound_id;
  IF NOT FOUND OR i.reservation_id IS DISTINCT FROM _id THEN
    RAISE EXCEPTION 'ai_reservation_apply_reply: el correo % no es de esta reserva', _inbound_id USING ERRCODE = '22023';
  END IF;
  IF i.status = 'duplicate' THEN
    RAISE EXCEPTION 'ai_reservation_apply_reply: correo repetido (mismo Message-ID)' USING ERRCODE = '22023';
  END IF;
  -- A2-RES-12: un correo recibido sirve para UNA sola decisión (antes: primero ambiguous y luego confirmed).
  IF i.status IS DISTINCT FROM 'processing'
     OR EXISTS (SELECT 1 FROM public.ai_reservation_decisions d WHERE d.inbound_id = _inbound_id) THEN
    RAISE EXCEPTION 'ai_reservation_apply_reply: el correo % ya tiene una decisión (estado %)', _inbound_id, i.status USING ERRCODE = '22023';
  END IF;
  IF v_out = 'confirmed' AND _d->'confirmation'->>'channel' IS DISTINCT FROM 'venue_email' THEN
    RAISE EXCEPTION 'ai_reservation_apply_reply: una respuesta por correo solo confirma por el canal venue_email' USING ERRCODE = '23514';
  END IF;
  INSERT INTO public.ai_reservation_decisions (reservation_id, inbound_id, decision, why, model, rules_version, log)
  VALUES (_id, _inbound_id, v_out, left(_d->>'why', 120), left(nullif(btrim(_d->'log'->>'model'), ''), 100),
          left(_d->'log'->>'rules_version', 40), CASE WHEN jsonb_typeof(_d->'log') = 'object' THEN _d->'log' END);
  v_ev := jsonb_build_object('inbound_id', _inbound_id, 'email_id', left(_d->>'inbound_email_id', 200), 'outcome', v_out,
                             'from_domain', left(_d->>'from_domain', 253), 'verified_sender', coalesce((_d->>'verified_sender')::boolean, false),
                             'quotes', coalesce(_d->'quotes', '[]'::jsonb), 'why', left(_d->>'why', 120), 'at', now());
  PERFORM public._ai_res_actor('restaurante', left('Respuesta del restaurante: ' || v_out, 500));
  INSERT INTO public.ai_reservation_events (reservation_id, kind, actor, note, data)
  VALUES (_id, 'email_in', 'restaurante', 'Respuesta recibida (' || v_out || ')', v_ev - 'quotes');
  IF r.status NOT IN ('sent','venue_replied','needs_user') THEN
    PERFORM public.ai_reservation_inbound_finish(_inbound_id, 'late', v_out);
    UPDATE public.ai_reservations SET evidence = jsonb_set(evidence, '{inbound}', coalesce(evidence->'inbound', '[]') || jsonb_build_array(v_ev)),
           claude_calls = claude_calls + coalesce((_d->>'claude_calls')::int, 0)
     WHERE id = _id;
    PERFORM public._ai_res_actor(NULL, NULL);
    RETURN jsonb_build_object('ok', false, 'code', 'LATE', 'status', r.status);
  END IF;
  v_to := CASE v_out
    WHEN 'confirmed' THEN 'confirmed' WHEN 'alternative_offered' THEN 'needs_user' WHEN 'declined' THEN 'declined'
    WHEN 'needs_info' THEN 'needs_user' WHEN 'payment_required' THEN 'needs_user'
    WHEN 'unverified' THEN 'venue_replied' WHEN 'ambiguous' THEN 'venue_replied' ELSE r.status END;
  v_reason := CASE v_out
    WHEN 'alternative_offered' THEN 'alternative_offered' WHEN 'needs_info' THEN 'needs_info'
    WHEN 'payment_required' THEN 'payment_required' WHEN 'unverified' THEN 'sender_unverified'
    WHEN 'ambiguous' THEN 'ambiguous_reply' WHEN 'declined' THEN 'declined' WHEN 'confirmed' THEN NULL ELSE r.reason END;
  IF r.status = 'needs_user' AND v_to = 'venue_replied' THEN v_to := 'needs_user'; v_reason := r.reason; END IF;
  UPDATE public.ai_reservations
     SET status = v_to, reason = v_reason,
         venue_replied_at = CASE WHEN v_out = 'ignored' THEN venue_replied_at ELSE now() END,
         venue_reply_excerpt = CASE WHEN v_out = 'ignored' THEN venue_reply_excerpt ELSE left(nullif(_d->>'excerpt', ''), 800) END,
         alternatives = CASE WHEN v_out = 'alternative_offered' AND jsonb_typeof(_d->'alternatives') = 'array' THEN _d->'alternatives' ELSE alternatives END,
         chosen_alternative = CASE WHEN v_out = 'alternative_offered' THEN NULL ELSE chosen_alternative END,
         user_options = CASE WHEN v_out IN ('needs_info','payment_required') THEN coalesce(user_options, '{}'::jsonb)
                               || jsonb_build_object('info_requested', left(_d->>'info_requested', 300)) ELSE user_options END,
         confirmation = CASE WHEN v_out = 'confirmed' THEN (_d->'confirmation') || jsonb_build_object('inbound_id', _inbound_id) ELSE confirmation END,
         confirmation_code = CASE WHEN v_out = 'confirmed' THEN left(nullif(_d->'confirmation'->>'code', ''), 60) ELSE confirmation_code END,
         confirmed_at = CASE WHEN v_out = 'confirmed' THEN now() ELSE confirmed_at END,
         claude_calls = claude_calls + coalesce((_d->>'claude_calls')::int, 0),
         evidence = jsonb_set(evidence, '{inbound}', coalesce(evidence->'inbound', '[]') || jsonb_build_array(v_ev))
   WHERE id = _id RETURNING * INTO r;   -- el trigger ai_reservations_confirm_evidence y el CHECK rechazan sin evidencia
  IF v_out = 'confirmed' THEN PERFORM public._ai_res_booking(r); END IF;
  PERFORM public.ai_reservation_inbound_finish(_inbound_id, 'done', v_out);
  PERFORM public._ai_res_actor(NULL, NULL);
  RETURN jsonb_build_object('ok', true, 'status', r.status, 'reason', r.reason, 'reservation', public.ai_reservation_json_internal(r));
END $$;

REVOKE ALL ON FUNCTION public.ai_reservation_inbound_attach(uuid, jsonb), public.ai_reservation_apply_reply(uuid, uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_reservation_inbound_attach(uuid, jsonb), public.ai_reservation_apply_reply(uuid, uuid, jsonb) TO service_role;
