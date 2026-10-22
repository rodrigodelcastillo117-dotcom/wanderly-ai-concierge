-- AUD-06 (cierre de auditoría, grupo reservas) · Evidencia de las reservas IA. No edita la migración
-- ya aplicada 20261023170000_ai_reservations.sql: la extiende. Idempotente.
-- REQUIERE AUTORIZACIÓN DEL DUEÑO PARA APLICARSE EN PRODUCCIÓN (la función está apagada:
-- app_flags.ai_reservations_enabled = false).
--
-- Antes, una reserva pasaba a "confirmed" con que el servicio mandara un JSON con una cita y
-- "verified_sender": true: texto producido por el modelo y afirmado por el propio servicio. Ahora la
-- base de datos exige, por su cuenta (trigger, no solo TypeScript):
--   1. Evidencia del PROVEEDOR guardada antes de clasificar (ai_reservation_inbound_attach): proveedor,
--      id del correo en Resend (puntero para recuperar el original), hash del Message-ID (único: el
--      mismo correo no se procesa dos veces aunque cambien el evento de Svix y el email_id), SHA-256
--      del cuerpo y del .eml crudo, fecha de recepción del proveedor, From, Reply-To, resultados
--      SPF/DKIM/DMARC del proveedor, el texto que escribió el restaurante y la ligadura con la
--      solicitud (token único del hilo o folio + remitente exacto; si cita nuestra solicitud sin cambios).
--      Privacidad: se guarda solo el texto del restaurante (sin lo citado), no el .eml; solo lo lee
--      service_role y se borra con la cuenta (ON DELETE CASCADE). El extracto que ve el usuario sigue
--      siendo el redactado de ai_reservations.venue_reply_excerpt.
--   2. Remitente fuerte recalculado en SQL con esos datos (ai_res_sender_strong, misma regla que
--      core.ts senderAuthentication): DMARC pass alineado al dominio del restaurante, o la dirección
--      exacta con DKIM pass. Lo que diga el servicio ("verified_sender") no cuenta.
--   3. La cita y el número de confirmación aparecen en el texto original guardado.
--   4. Condiciones aceptadas (fecha, hora, personas = las de la reserva; nombre) con su base
--      ("stated" escrito por el restaurante, "thread_quote" solo si el correo cita nuestra solicitud,
--      "reply_token"/"ref_subject" para el nombre) y sin contradicciones.
--   5. Una decisión registrada (ai_reservation_decisions) para ese correo con el id del modelo, la
--      versión de reglas y la salida del clasificador. Decisiones, historial y evidencia no se reescriben.
--   6. El canal "equipo" (confirmación humana) solo lo puede usar ai_reservation_transition con actor
--      'equipo'; apply_reply solo acepta el canal venue_email.

-- ───────────────────────────── 1. Evidencia del correo recibido ─────────────────────────────
ALTER TABLE public.ai_reservation_inbound
  ADD COLUMN IF NOT EXISTS provider             text NOT NULL DEFAULT 'resend',
  ADD COLUMN IF NOT EXISTS message_id_hash      text,
  ADD COLUMN IF NOT EXISTS body_sha256          text,
  ADD COLUMN IF NOT EXISTS raw_sha256           text,
  ADD COLUMN IF NOT EXISTS raw_pointer          text,
  ADD COLUMN IF NOT EXISTS provider_received_at timestamptz,
  ADD COLUMN IF NOT EXISTS from_address         text,
  ADD COLUMN IF NOT EXISTS reply_to             text,
  ADD COLUMN IF NOT EXISTS auth                 jsonb,
  ADD COLUMN IF NOT EXISTS reply_text           text,
  ADD COLUMN IF NOT EXISTS linkage              jsonb,
  ADD COLUMN IF NOT EXISTS sender               jsonb,
  ADD COLUMN IF NOT EXISTS duplicate_of         uuid REFERENCES public.ai_reservation_inbound(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS attached_at          timestamptz;

ALTER TABLE public.ai_reservation_inbound DROP CONSTRAINT IF EXISTS ai_reservation_inbound_status_check;
ALTER TABLE public.ai_reservation_inbound ADD CONSTRAINT ai_reservation_inbound_status_check
  CHECK (status IN ('processing','done','failed','unmatched','late','duplicate'));
ALTER TABLE public.ai_reservation_inbound DROP CONSTRAINT IF EXISTS ai_res_inbound_evidence_shape;
ALTER TABLE public.ai_reservation_inbound ADD CONSTRAINT ai_res_inbound_evidence_shape CHECK (
  provider IN ('resend')
  AND (message_id_hash IS NULL OR message_id_hash ~ '^[0-9a-f]{64}$')
  AND (body_sha256 IS NULL OR body_sha256 ~ '^[0-9a-f]{64}$')
  AND (raw_sha256 IS NULL OR raw_sha256 ~ '^[0-9a-f]{64}$')
  AND (raw_pointer IS NULL OR length(raw_pointer) <= 300)
  AND (from_address IS NULL OR length(from_address) <= 254)
  AND (reply_to IS NULL OR length(reply_to) <= 500)
  AND (reply_text IS NULL OR length(reply_text) <= 8000)
  AND (auth IS NULL OR jsonb_typeof(auth) = 'object')
  AND (linkage IS NULL OR jsonb_typeof(linkage) = 'object')
  AND (sender IS NULL OR jsonb_typeof(sender) = 'object'));
-- Repetición: un Message-ID se procesa una sola vez (además de svix-id y email_id, ya únicos).
CREATE UNIQUE INDEX IF NOT EXISTS ai_reservation_inbound_message ON public.ai_reservation_inbound (message_id_hash)
  WHERE message_id_hash IS NOT NULL;

-- La evidencia, una vez sellada, no cambia (ni con la llave de servicio).
CREATE OR REPLACE FUNCTION public.ai_reservation_inbound_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.attached_at IS NOT NULL AND (
       NEW.attached_at IS DISTINCT FROM OLD.attached_at OR NEW.provider IS DISTINCT FROM OLD.provider
    OR NEW.provider_event_id IS DISTINCT FROM OLD.provider_event_id OR NEW.email_id IS DISTINCT FROM OLD.email_id
    OR NEW.reservation_id IS DISTINCT FROM OLD.reservation_id OR NEW.message_id_hash IS DISTINCT FROM OLD.message_id_hash
    OR NEW.body_sha256 IS DISTINCT FROM OLD.body_sha256 OR NEW.raw_sha256 IS DISTINCT FROM OLD.raw_sha256
    OR NEW.raw_pointer IS DISTINCT FROM OLD.raw_pointer OR NEW.provider_received_at IS DISTINCT FROM OLD.provider_received_at
    OR NEW.from_address IS DISTINCT FROM OLD.from_address OR NEW.reply_to IS DISTINCT FROM OLD.reply_to
    OR NEW.auth IS DISTINCT FROM OLD.auth OR NEW.reply_text IS DISTINCT FROM OLD.reply_text
    OR NEW.linkage IS DISTINCT FROM OLD.linkage OR NEW.sender IS DISTINCT FROM OLD.sender) THEN
    RAISE EXCEPTION 'ai_reservation_inbound: la evidencia del correo recibido no se modifica' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS ai_reservation_inbound_guard ON public.ai_reservation_inbound;
CREATE TRIGGER ai_reservation_inbound_guard BEFORE UPDATE ON public.ai_reservation_inbound
  FOR EACH ROW EXECUTE FUNCTION public.ai_reservation_inbound_guard();

-- ───────────────────────────── 2. Registro de decisiones ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.ai_reservation_decisions (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  reservation_id uuid NOT NULL REFERENCES public.ai_reservations(id) ON DELETE CASCADE,
  inbound_id     uuid NOT NULL REFERENCES public.ai_reservation_inbound(id) ON DELETE CASCADE,
  decision       text NOT NULL CHECK (decision IN ('confirmed','alternative_offered','declined','needs_info','payment_required',
                   'unverified','ambiguous','ignored')),
  why            text CHECK (why IS NULL OR length(why) <= 120),
  model          text CHECK (model IS NULL OR length(model) <= 100),
  rules_version  text CHECK (rules_version IS NULL OR length(rules_version) <= 40),
  -- Salida del clasificador ya validada, lo que comprobaron las reglas y por qué (sin datos de tarjeta:
  -- el texto del restaurante vive en ai_reservation_inbound.reply_text).
  log            jsonb CHECK (log IS NULL OR jsonb_typeof(log) = 'object'),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_reservation_decisions_res ON public.ai_reservation_decisions (reservation_id, created_at);
CREATE INDEX IF NOT EXISTS ai_reservation_decisions_inb ON public.ai_reservation_decisions (inbound_id);
ALTER TABLE public.ai_reservation_decisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_reservation_decisions FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.ai_reservation_decisions TO service_role;

-- Historial y decisiones: solo se agregan filas (el borrado de la cuenta las elimina en cascada).
CREATE OR REPLACE FUNCTION public.ai_res_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION '%: solo se agregan filas; no se reescriben', TG_TABLE_NAME USING ERRCODE = '42501';
END $$;
DROP TRIGGER IF EXISTS ai_reservation_decisions_append_only ON public.ai_reservation_decisions;
CREATE TRIGGER ai_reservation_decisions_append_only BEFORE UPDATE ON public.ai_reservation_decisions
  FOR EACH ROW EXECUTE FUNCTION public.ai_res_append_only();
DROP TRIGGER IF EXISTS ai_reservation_events_append_only ON public.ai_reservation_events;
CREATE TRIGGER ai_reservation_events_append_only BEFORE UPDATE ON public.ai_reservation_events
  FOR EACH ROW EXECUTE FUNCTION public.ai_res_append_only();

-- ───────────────────────────── 3. Reglas en SQL ─────────────────────────────
-- Misma lista que FREEMAIL en core.ts (una prueba de Vitest exige que coincidan).
CREATE OR REPLACE FUNCTION public.ai_res_freemail_domains()
RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY['gmail.com','googlemail.com','hotmail.com','hotmail.es','hotmail.fr','outlook.com','outlook.es','outlook.fr',
    'live.com','live.com.mx','msn.com','yahoo.com','yahoo.com.mx','yahoo.es','yahoo.fr','icloud.com','me.com',
    'aol.com','proton.me','protonmail.com','gmx.com','gmx.de','orange.fr','free.fr','laposte.net','prodigy.net.mx'];
$$;

-- AUD-02 en SQL: remitente fuerte con los resultados del PROVEEDOR (ver core.ts senderAuthentication).
CREATE OR REPLACE FUNCTION public.ai_res_sender_strong(_from text, _venue text, _auth jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE
  re constant text := '^[a-z0-9._%+''-]+@[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$';
  f text := lower(btrim(coalesce(_from, ''))); v text := lower(btrim(coalesce(_venue, '')));
  fd text; vd text; dmarc text; dkim text;
BEGIN
  IF f !~ re OR v !~ re OR jsonb_typeof(_auth) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
  dmarc := lower(btrim(coalesce(_auth->>'dmarc', ''))); dkim := lower(btrim(coalesce(_auth->>'dkim', '')));
  IF dmarc IN ('fail', 'processing_failed') THEN RETURN false; END IF;
  fd := split_part(f, '@', 2); vd := split_part(v, '@', 2);
  IF fd = ANY (public.ai_res_freemail_domains()) OR vd = ANY (public.ai_res_freemail_domains()) THEN
    RETURN f = v AND (dmarc = 'pass' OR dkim = 'pass');
  END IF;
  IF NOT (fd = vd OR right(fd, length(vd) + 1) = '.' || vd) THEN RETURN false; END IF;
  RETURN dmarc = 'pass' OR (f = v AND dkim = 'pass');
END $$;

CREATE OR REPLACE FUNCTION public.ai_res_norm(_t text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT btrim(regexp_replace(lower(translate(normalize(coalesce(_t, ''), NFKC), '‘’“”', '''''""')), '\s+', ' ', 'g'));
$$;

-- Qué le falta a una confirmación por correo para valer. Vacío = suficiente. La usan el trigger,
-- ai_reservation_claim_alternative y ai_reservation_mark_sent.
CREATE OR REPLACE FUNCTION public.ai_res_confirmation_failures(_res_id uuid, _venue_email text, _local text, _party int, _c jsonb, _code text)
RETURNS text[] LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE i public.ai_reservation_inbound; f text[] := ARRAY[]::text[]; v_cond jsonb; k text; b text; v_q text;
BEGIN
  IF jsonb_typeof(_c) IS DISTINCT FROM 'object' THEN RETURN ARRAY['confirmation_missing']; END IF;
  IF _c->>'channel' IS DISTINCT FROM 'venue_email' THEN RETURN ARRAY['channel_not_venue_email']; END IF;
  SELECT * INTO i FROM public.ai_reservation_inbound x
   WHERE x.reservation_id = _res_id AND x.email_id = _c->>'inbound_email_id';
  IF NOT FOUND THEN RETURN ARRAY['inbound_not_found']; END IF;
  IF coalesce(_c->>'inbound_id', '') <> '' AND _c->>'inbound_id' IS DISTINCT FROM i.id::text THEN f := array_append(f, 'inbound_id_mismatch'); END IF;
  IF i.status NOT IN ('processing', 'done') THEN f := array_append(f, 'inbound_status_' || i.status); END IF;
  IF i.attached_at IS NULL OR i.provider IS DISTINCT FROM 'resend' THEN f := array_append(f, 'provider_evidence_missing'); END IF;
  IF i.message_id_hash IS NULL THEN f := array_append(f, 'message_id_missing'); END IF;
  IF i.body_sha256 IS NULL THEN f := array_append(f, 'body_hash_missing'); END IF;
  IF i.provider_received_at IS NULL THEN f := array_append(f, 'received_at_missing'); END IF;
  IF coalesce(btrim(i.reply_text), '') = '' THEN f := array_append(f, 'original_text_missing'); END IF;
  IF NOT public.ai_res_sender_strong(i.from_address, _venue_email, i.auth) THEN f := array_append(f, 'sender_not_strong'); END IF;
  v_q := public.ai_res_norm(_c->>'quote');
  IF length(v_q) < 4 OR position(v_q IN public.ai_res_norm(i.reply_text)) = 0 THEN f := array_append(f, 'quote_not_in_original'); END IF;
  IF _code IS NOT NULL AND position(public.ai_res_norm(_code) IN public.ai_res_norm(i.reply_text)) = 0 THEN
    f := array_append(f, 'code_not_in_original');
  END IF;
  IF jsonb_typeof(_c->'contradictions') IS DISTINCT FROM 'array' OR jsonb_array_length(_c->'contradictions') > 0 THEN
    f := array_append(f, 'contradictions');
  END IF;
  v_cond := _c->'conditions';
  IF jsonb_typeof(v_cond) IS DISTINCT FROM 'object' THEN
    f := array_append(f, 'conditions_missing');
  ELSE
    IF v_cond->'date'->>'value' IS DISTINCT FROM split_part(_local, 'T', 1) THEN f := array_append(f, 'date_condition_mismatch'); END IF;
    IF v_cond->'time'->>'value' IS DISTINCT FROM split_part(_local, 'T', 2) THEN f := array_append(f, 'time_condition_mismatch'); END IF;
    IF v_cond->'party_size'->>'value' IS DISTINCT FROM _party::text THEN f := array_append(f, 'party_condition_mismatch'); END IF;
    FOREACH k IN ARRAY ARRAY['date', 'time', 'party_size', 'name'] LOOP
      b := v_cond->k->>'basis';
      IF b IS NULL OR b NOT IN ('stated', 'thread_quote', 'reply_token', 'ref_subject')
         OR (k <> 'name' AND b IN ('reply_token', 'ref_subject')) THEN
        f := array_append(f, k || '_basis_missing');
      ELSIF b = 'thread_quote' AND coalesce(i.linkage->>'quoted_request', '') <> 'true' THEN
        f := array_append(f, k || '_not_quoted');
      ELSIF b IN ('reply_token', 'ref_subject') AND i.linkage->>'method' IS DISTINCT FROM b THEN
        f := array_append(f, k || '_not_linked');
      END IF;
    END LOOP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ai_reservation_decisions d
                  WHERE d.inbound_id = i.id AND d.reservation_id = _res_id AND d.decision IN ('confirmed', 'alternative_offered')
                    AND length(btrim(coalesce(d.model, ''))) > 0) THEN
    f := array_append(f, 'decision_log_missing');
  END IF;
  RETURN f;
END $$;

-- La regla, aplicada en la base a TODA entrada a "confirmed" (el CHECK original sigue vigente).
CREATE OR REPLACE FUNCTION public.ai_reservations_confirm_evidence()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_f text[];
BEGIN
  IF NEW.status = 'confirmed' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'confirmed') THEN
    IF NEW.confirmation->>'channel' = 'equipo' THEN
      IF nullif(current_setting('aires.actor', true), '') IS DISTINCT FROM 'equipo' THEN
        RAISE EXCEPTION 'ai_reservations: el canal "equipo" solo lo usa una persona del equipo' USING ERRCODE = '23514';
      END IF;
    ELSE
      v_f := public.ai_res_confirmation_failures(NEW.id, NEW.venue_email, NEW.requested_local, NEW.party_size, NEW.confirmation, NEW.confirmation_code);
      IF cardinality(v_f) > 0 THEN
        RAISE EXCEPTION 'ai_reservations: confirmación sin evidencia suficiente del restaurante (%)', array_to_string(v_f, ', ')
          USING ERRCODE = '23514';
      END IF;
      NEW.confirmation := NEW.confirmation || jsonb_build_object('db_checks', jsonb_build_object('version', 'aud06-v1', 'at', now()));
    END IF;
  END IF;
  RETURN NEW;
END $$;
-- El nombre ordena el disparo DESPUÉS de ai_reservations_guard (los BEFORE se disparan por nombre):
-- primero se rechaza quien no es una función del servidor, luego se exige la evidencia.
DROP TRIGGER IF EXISTS ai_reservations_guard_evidence ON public.ai_reservations;
CREATE TRIGGER ai_reservations_guard_evidence BEFORE INSERT OR UPDATE ON public.ai_reservations
  FOR EACH ROW EXECUTE FUNCTION public.ai_reservations_confirm_evidence();

-- ───────────────────────────── 4. Registrar la evidencia (antes de clasificar) ─────────────────────────────
-- _e: {provider:'resend', provider_email_id, message_id, received_at, from_address, reply_to, auth:{spf,dkim,dmarc},
--      reply_text, body_sha256, raw_sha256, raw_pointer, linkage:{method, quoted_request}, sender:{verified, basis, reasons}}.
-- Devuelve {ok, duplicate}: con duplicate = true el correo ya se procesó con otro evento/email_id.
CREATE OR REPLACE FUNCTION public.ai_reservation_inbound_attach(_inbound_id uuid, _e jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  i public.ai_reservation_inbound; v_mid text := lower(btrim(coalesce(_e->>'message_id', ''))); v_hash text; v_dup uuid;
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
  BEGIN
    UPDATE public.ai_reservation_inbound
       SET provider = 'resend', message_id_hash = CASE WHEN v_dup IS NULL THEN v_hash END, duplicate_of = v_dup,
           body_sha256 = _e->>'body_sha256', raw_sha256 = _e->>'raw_sha256', raw_pointer = left(_e->>'raw_pointer', 300),
           provider_received_at = v_at, from_address = left(lower(btrim(_e->>'from_address')), 254), reply_to = left(_e->>'reply_to', 500),
           auth = v_auth, reply_text = left(_e->>'reply_text', 8000),
           linkage = CASE WHEN jsonb_typeof(_e->'linkage') = 'object' THEN _e->'linkage' END,
           sender = CASE WHEN jsonb_typeof(_e->'sender') = 'object' THEN _e->'sender' END,
           attached_at = now(),
           status = CASE WHEN v_dup IS NOT NULL THEN 'duplicate' ELSE status END,
           outcome = CASE WHEN v_dup IS NOT NULL THEN 'duplicate_message_id' ELSE outcome END,
           processed_at = CASE WHEN v_dup IS NOT NULL THEN now() ELSE processed_at END
     WHERE id = i.id;
  EXCEPTION WHEN unique_violation THEN
    -- Otro webhook con el mismo Message-ID ganó la carrera.
    SELECT id INTO v_dup FROM public.ai_reservation_inbound WHERE message_id_hash = v_hash AND id <> i.id LIMIT 1;
    UPDATE public.ai_reservation_inbound
       SET duplicate_of = v_dup, body_sha256 = _e->>'body_sha256', provider_received_at = v_at, attached_at = now(),
           status = 'duplicate', outcome = 'duplicate_message_id', processed_at = now()
     WHERE id = i.id;
  END;
  RETURN jsonb_build_object('ok', true, 'duplicate', v_dup IS NOT NULL, 'duplicate_of', v_dup);
END $$;

CREATE OR REPLACE FUNCTION public.ai_reservation_inbound_finish(_inbound_id uuid, _status text, _outcome text DEFAULT NULL)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.ai_reservation_inbound
     SET status = CASE WHEN _status IN ('done','failed','unmatched','late','duplicate') THEN _status ELSE status END,
         outcome = left(_outcome, 60), processed_at = now()
   WHERE id = _inbound_id;
$$;

-- ───────────────────────────── 5. Aplicar la respuesta (con registro de la decisión) ─────────────────────────────
-- Igual que en 20261023170000 más: el correo debe ser de esta reserva y no repetido; cada decisión
-- queda en ai_reservation_decisions (modelo, reglas, salida del clasificador); "confirmed" solo por
-- el canal venue_email (el trigger exige la evidencia).
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

-- ───────────────────────────── 6. Alterno apartado: misma evidencia ─────────────────────────────
-- Confirmación que quedaría al aceptar un alterno apartado (r ya con requested_local = el alterno).
CREATE OR REPLACE FUNCTION public._ai_res_alt_confirmation(r public.ai_reservations, _alt jsonb)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object('channel', 'venue_email', 'inbound_email_id', _alt->>'inbound_email_id',
    'inbound_id', (SELECT x.id FROM public.ai_reservation_inbound x WHERE x.reservation_id = r.id AND x.email_id = _alt->>'inbound_email_id'),
    'quote', _alt->>'quote', 'verified_sender', true, 'from_domain', _alt->>'from_domain',
    'stated', jsonb_build_object('local', _alt->>'local'), 'conditions', _alt->'conditions',
    'contradictions', coalesce(_alt->'contradictions', '[]'::jsonb), 'via', 'held_alternative');
$$;

CREATE OR REPLACE FUNCTION public.ai_reservation_claim_alternative(_id uuid, _user_id uuid, _index int)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.ai_reservations; v_alt jsonb; v_for timestamptz; v_held boolean; v_fail text[];
BEGIN
  IF NOT public._ai_res_enabled() THEN RETURN jsonb_build_object('ok', false, 'code', 'FEATURE_DISABLED'); END IF;
  SELECT * INTO r FROM public.ai_reservations WHERE id = _id AND user_id = _user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
  IF r.status <> 'needs_user' OR r.reason IS DISTINCT FROM 'alternative_offered' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NO_ALTERNATIVES', 'status', r.status);
  END IF;
  v_alt := r.alternatives -> _index;
  IF v_alt IS NULL OR coalesce(v_alt->>'local', '') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'BAD_INDEX');
  END IF;
  v_for := ((v_alt->>'local') || ':00')::timestamp AT TIME ZONE r.venue_timezone;
  IF v_for < now() + interval '30 minutes' THEN RETURN jsonb_build_object('ok', false, 'code', 'DATE_TOO_SOON'); END IF;
  IF r.send_lock_at IS NOT NULL AND r.send_lock_at > now() - interval '10 minutes' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'IN_PROGRESS');
  END IF;
  PERFORM public._ai_res_actor('usuario', 'El usuario eligió un horario alterno');
  UPDATE public.ai_reservations
     SET send_lock_at = now(),
         evidence = CASE WHEN evidence ? 'original_request' THEN evidence
                         ELSE evidence || jsonb_build_object('original_request', jsonb_build_object('local', requested_local, 'party_size', party_size)) END,
         requested_local = v_alt->>'local', requested_for = v_for,
         chosen_alternative = v_alt || jsonb_build_object('index', _index, 'chosen_at', now())
   WHERE id = _id RETURNING * INTO r;
  PERFORM public._ai_res_actor(NULL, NULL);
  -- "Apartado" solo si el restaurante lo escribió con evidencia suficiente; si no, se le pide confirmar.
  v_held := coalesce((v_alt->>'held')::boolean, false) AND (v_alt->>'verified_sender') = 'true';
  IF v_held THEN
    v_fail := public.ai_res_confirmation_failures(r.id, r.venue_email, r.requested_local, r.party_size,
                public._ai_res_alt_confirmation(r, v_alt), left(nullif(v_alt->>'code', ''), 60));
    v_held := cardinality(v_fail) = 0;
  END IF;
  RETURN jsonb_build_object('ok', true, 'held', v_held, 'hold_failures', to_jsonb(coalesce(v_fail, ARRAY[]::text[])),
                            'reservation', public.ai_reservation_json_internal(r));
END $$;

CREATE OR REPLACE FUNCTION public.ai_reservation_mark_sent(_id uuid, _kind text, _ok boolean, _provider_id text DEFAULT NULL, _error text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_lim jsonb := public.ai_reservation_limits(); r public.ai_reservations; v_fail int; v_alt jsonb; v_exp timestamptz;
  v_conf jsonb; v_code text; v_missing text[];
BEGIN
  IF _kind NOT IN ('request','alternative','reminder','cancellation','thanks') THEN RETURN jsonb_build_object('ok', false, 'code', 'BAD_KIND'); END IF;
  SELECT * INTO r FROM public.ai_reservations WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
  PERFORM public._ai_res_actor('sistema', CASE WHEN _ok THEN 'Correo enviado al restaurante' ELSE 'Falló el envío del correo' END);
  INSERT INTO public.ai_reservation_events (reservation_id, kind, actor, note, data)
  VALUES (_id, CASE WHEN _kind = 'reminder' THEN 'reminder' ELSE 'email_out' END, 'sistema',
          CASE WHEN _ok THEN 'Correo enviado (' || _kind || ')' ELSE 'No se pudo enviar (' || _kind || ')' END,
          jsonb_build_object('kind', _kind, 'ok', _ok, 'provider_id', left(_provider_id, 200)));
  IF _kind IN ('request','alternative') THEN
    IF r.status NOT IN ('awaiting_user_ok','needs_user') OR r.send_lock_at IS NULL THEN
      PERFORM public._ai_res_actor(NULL, NULL);
      RETURN jsonb_build_object('ok', false, 'code', 'NOT_CLAIMED', 'status', r.status);
    END IF;
    IF _ok THEN
      v_exp := least(now() + make_interval(hours => (v_lim->>'expire_after_hours')::int), r.requested_for - interval '30 minutes');
      v_alt := r.chosen_alternative;
      IF _kind = 'alternative' AND coalesce((v_alt->>'held')::boolean, false) AND v_alt->>'verified_sender' = 'true' THEN
        v_conf := public._ai_res_alt_confirmation(r, v_alt);
        v_code := left(nullif(v_alt->>'code', ''), 60);
        v_missing := public.ai_res_confirmation_failures(r.id, r.venue_email, r.requested_local, r.party_size, v_conf, v_code);
      END IF;
      IF v_conf IS NOT NULL AND cardinality(v_missing) = 0 THEN
        -- El restaurante ya había apartado este horario por escrito (con evidencia) y el usuario lo aceptó.
        UPDATE public.ai_reservations
           SET status = 'confirmed', reason = NULL, send_lock_at = NULL, attempts = attempts + 1, sent_at = coalesce(sent_at, now()),
               confirmed_at = now(), confirmation_code = v_code,
               confirmation = v_conf || jsonb_build_object('user_accepted_at', now(), 'at', now()),
               evidence = jsonb_set(evidence, '{outbound}', coalesce(evidence->'outbound', '[]') ||
                 jsonb_build_array(jsonb_build_object('kind', _kind, 'id', left(_provider_id, 200), 'at', now())))
         WHERE id = _id RETURNING * INTO r;
        PERFORM public._ai_res_booking(r);
      ELSE
        UPDATE public.ai_reservations
           SET status = 'sent', reason = NULL, send_lock_at = NULL, attempts = attempts + 1, sent_at = coalesce(sent_at, now()),
               reminder_sent_at = NULL, expires_at = v_exp, last_error = NULL,
               evidence = jsonb_set(evidence, '{outbound}', coalesce(evidence->'outbound', '[]') ||
                 jsonb_build_array(jsonb_build_object('kind', _kind, 'id', left(_provider_id, 200), 'at', now(),
                   'hold_failures', to_jsonb(v_missing))))
         WHERE id = _id RETURNING * INTO r;
      END IF;
    ELSE
      v_fail := coalesce((r.evidence->>'send_failures')::int, 0) + 1;
      UPDATE public.ai_reservations
         SET send_lock_at = NULL, last_error = left(coalesce(_error, 'send_failed'), 300),
             evidence = evidence || jsonb_build_object('send_failures', v_fail),
             status = CASE WHEN v_fail >= 3 AND status = 'awaiting_user_ok' THEN 'failed' ELSE status END,
             reason = CASE WHEN v_fail >= 3 AND status = 'awaiting_user_ok' THEN 'send_failed' ELSE reason END
       WHERE id = _id RETURNING * INTO r;
    END IF;
  ELSE
    UPDATE public.ai_reservations
       SET attempts = attempts + CASE WHEN _ok AND _kind = 'reminder' THEN 1 ELSE 0 END,
           last_error = CASE WHEN _ok THEN last_error ELSE left(coalesce(_error, 'send_failed'), 300) END,
           evidence = CASE WHEN _ok THEN jsonb_set(evidence, '{outbound}', coalesce(evidence->'outbound', '[]') ||
             jsonb_build_array(jsonb_build_object('kind', _kind, 'id', left(_provider_id, 200), 'at', now()))) ELSE evidence END
     WHERE id = _id RETURNING * INTO r;
  END IF;
  PERFORM public._ai_res_actor(NULL, NULL);
  RETURN jsonb_build_object('ok', true, 'status', r.status, 'reservation', public.ai_reservation_json(r));
END $$;

-- ───────────────────────────── 7. Historial de transiciones con su evidencia ─────────────────────────────
CREATE OR REPLACE FUNCTION public.ai_reservations_log()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_notice text[];
BEGIN
  IF TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.ai_reservation_events (reservation_id, kind, from_status, to_status, actor, note, data)
    VALUES (NEW.id, 'transition', CASE WHEN TG_OP = 'UPDATE' THEN OLD.status END, NEW.status,
            coalesce(nullif(current_setting('aires.actor', true), ''), 'sistema'),
            left(nullif(current_setting('aires.note', true), ''), 500),
            jsonb_strip_nulls(jsonb_build_object('reason', NEW.reason,
              'channel', CASE WHEN NEW.status = 'confirmed' THEN NEW.confirmation->>'channel' END,
              'inbound_id', CASE WHEN NEW.status = 'confirmed' THEN NEW.confirmation->>'inbound_id' END,
              'email_id', CASE WHEN NEW.status = 'confirmed' THEN NEW.confirmation->>'inbound_email_id' END,
              'code', CASE WHEN NEW.status = 'confirmed' THEN NEW.confirmation_code END,
              'db_checks', CASE WHEN NEW.status = 'confirmed' THEN NEW.confirmation->'db_checks'->>'version' END)));
    IF NEW.request_id IS NOT NULL THEN
      UPDATE public.concierge_requests SET status = NEW.status WHERE id = NEW.request_id AND type = 'ai_reservation';
    END IF;
    v_notice := public.ai_reservation_notice(NEW.status, NEW.reason, left(NEW.venue_name, 120), NEW.requested_local,
                                             NEW.party_size, NEW.confirmation_code);
    IF v_notice IS NOT NULL THEN
      PERFORM public.notify_once(NEW.user_id, 'ai_reservation', v_notice[1], v_notice[2], NEW.id,
        'ai_res:' || NEW.id || ':' || NEW.status || ':' || coalesce(NEW.reason, '') || ':' || (extract(epoch FROM NEW.status_changed_at))::bigint);
    END IF;
  END IF;
  RETURN NULL;
END $$;

-- ───────────────────────────── Permisos ─────────────────────────────
REVOKE ALL ON FUNCTION public.ai_reservation_inbound_guard(), public.ai_res_append_only(), public.ai_res_freemail_domains(),
  public.ai_res_sender_strong(text, text, jsonb), public.ai_res_norm(text),
  public.ai_res_confirmation_failures(uuid, text, text, int, jsonb, text), public.ai_reservations_confirm_evidence(),
  public.ai_reservation_inbound_attach(uuid, jsonb), public._ai_res_alt_confirmation(public.ai_reservations, jsonb),
  public.ai_reservation_inbound_finish(uuid, text, text), public.ai_reservation_apply_reply(uuid, uuid, jsonb),
  public.ai_reservation_claim_alternative(uuid, uuid, int), public.ai_reservation_mark_sent(uuid, text, boolean, text, text),
  public.ai_reservations_log()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_res_freemail_domains(), public.ai_res_norm(text),
  public.ai_res_sender_strong(text, text, jsonb), public.ai_reservation_inbound_attach(uuid, jsonb),
  public.ai_reservation_inbound_finish(uuid, text, text), public.ai_reservation_apply_reply(uuid, uuid, jsonb),
  public.ai_reservation_claim_alternative(uuid, uuid, int), public.ai_reservation_mark_sent(uuid, text, boolean, text, text)
  TO service_role;
