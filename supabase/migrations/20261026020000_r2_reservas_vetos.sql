-- Ronda r2 (segunda auditoría, grupo reservas) · A2-RES-02 (P2): negaciones y cancelaciones.
-- Idempotente. REQUIERE AUTORIZACIÓN DEL DUEÑO PARA APLICARSE EN PRODUCCIÓN (función apagada).
--
-- Antes, con el modelo diciendo "confirmed", "Su reserva aún no está confirmada.", "Your confirmed
-- booking has been cancelled." o "Sua reserva não está confirmada." quedaban confirmed: la base solo
-- comprobaba que la cita estuviera en el texto. Ahora la base veta por su cuenta (misma regla que
-- evidence.ts NEGATED_CONFIRM_RE / CANCELLED_RE):
--   * negación de la confirmación: una palabra de negación seguida, en la misma frase y a menos de
--     cinco palabras, de una raíz de confirmar/reservar/apartar/agendar/registrar/book/hold;
--   * cancelación: "cancelada", "cancelled", "annulée", "cancelamento"… (sin contar las frases de
--     política: "política de cancelación", "free cancellation", "en caso de cancelación");
--   * y solo acepta decisiones tomadas con las reglas r2 (ai_res_rules_versions): una edge function
--     vieja, desplegada antes que esta corrección, no puede confirmar.

-- Texto plegado: minúsculas, sin acentos, apóstrofos rectos, espacios simples.
CREATE OR REPLACE FUNCTION public.ai_res_fold(_t text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT btrim(regexp_replace(lower(translate(coalesce(_t, ''), 'ÁÉÍÓÚÀÈÌÒÙÂÊÎÔÛÃÕÄËÏÖÜÇÑáéíóúàèìòùâêîôûãõäëïöüçñ’‘´`', 'AEIOUAEIOUAEIOUAOAEIOUCNaeiouaeiouaeiouaoaeioucn''''''''')), '\s+', ' ', 'g'));
$$;

CREATE OR REPLACE FUNCTION public.ai_res_reply_vetoes(_t text)
RETURNS text[] LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE
  t text := public.ai_res_fold(_t);
  v text[] := ARRAY[]::text[];
  neg constant text := '(^|[^a-z0-9''])(no|nao|not|never|nunca|jamas|jamais|pas|non|sin|sem|without|ne|cannot|unable|n''[a-z]+|[a-z]+n''t)( +[^ .,;:!?¿¡]+){0,4} +(confirm|reserv|apart|agend|registr|book|held|hold)';
  policy constant text := '((politica|politique|policy|condiciones|conditions|terminos|terms|reglas|regles|en caso de|in case of|en cas d''|em caso de) *(de +|d''|of +)?(cancelacion|cancellation|annulation|cancelamento)|(cancelacion|cancellation|annulation|cancelamento) +(policy|politica|politique|fees|fee|cargo|frais|taxa|terms|gratuita|gratis|gratuite|gratuito|sin costo|sans frais|free)|free cancellation)';
  cancel constant text := '(^|[^a-z0-9])(cancelad[oa]s?|cancelamos|cancelou|cancel+ed|cancel+ing|cancelacion|cancellation|annulee?s?|annulons|annule|annulation|anulad[oa]s?|anulamos|anulacion|cancelamento|desmarcad[oa]s?)([^a-z0-9]|$)';
BEGIN
  IF t ~ neg THEN v := array_append(v, 'negated_confirmation'); END IF;
  IF regexp_replace(t, policy, ' ', 'g') ~ cancel THEN v := array_append(v, 'cancellation'); END IF;
  RETURN v;
END $$;

-- Versiones de reglas de TypeScript (evidence.ts RULES_VERSION) que la base acepta para confirmar o apartar.
CREATE OR REPLACE FUNCTION public.ai_res_rules_versions()
RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT ARRAY['r2-v1'] $$;

-- La regla de evidencia (20261026010000) con los vetos y la versión de reglas.
CREATE OR REPLACE FUNCTION public.ai_res_confirmation_failures(_res_id uuid, _venue_email text, _local text, _party int, _c jsonb, _code text)
RETURNS text[] LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE i public.ai_reservation_inbound; f text[] := ARRAY[]::text[]; v_cond jsonb; k text; b text; v_q text; v_site text; v_veto text[];
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
  -- A2-RES-01: el sitio web oficial guardado en la reserva decide si el dominio del correo es propio.
  SELECT r.venue_website INTO v_site FROM public.ai_reservations r WHERE r.id = _res_id;
  IF NOT public.ai_res_sender_strong(i.from_address, _venue_email, i.auth, v_site) THEN f := array_append(f, 'sender_not_strong'); END IF;
  v_q := public.ai_res_norm(_c->>'quote');
  IF length(v_q) < 4 OR position(v_q IN public.ai_res_norm(i.reply_text)) = 0 THEN f := array_append(f, 'quote_not_in_original'); END IF;
  -- A2-RES-02: el texto del restaurante no puede negar ni cancelar la reserva (aunque la cita diga "confirmada").
  v_veto := public.ai_res_reply_vetoes(i.reply_text);
  IF cardinality(v_veto) > 0 THEN
    f := f || (SELECT array_agg('reply_' || x) FROM unnest(v_veto) x);
  END IF;
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
  -- A2-RES-02: la decisión debe venir de reglas con los vetos de negación y cancelación (código viejo → no).
  IF EXISTS (SELECT 1 FROM public.ai_reservation_decisions d
              WHERE d.inbound_id = i.id AND d.reservation_id = _res_id AND d.decision IN ('confirmed', 'alternative_offered')
                AND length(btrim(coalesce(d.model, ''))) > 0)
     AND NOT EXISTS (SELECT 1 FROM public.ai_reservation_decisions d
                      WHERE d.inbound_id = i.id AND d.reservation_id = _res_id AND d.decision IN ('confirmed', 'alternative_offered')
                        AND d.rules_version = ANY (public.ai_res_rules_versions())) THEN
    f := array_append(f, 'rules_version_outdated');
  END IF;
  RETURN f;
END $$;

REVOKE ALL ON FUNCTION public.ai_res_fold(text), public.ai_res_reply_vetoes(text), public.ai_res_rules_versions(),
  public.ai_res_confirmation_failures(uuid, text, text, int, jsonb, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_res_fold(text), public.ai_res_reply_vetoes(text), public.ai_res_rules_versions() TO service_role;
