-- Ronda r2 (segunda auditoría, grupo reservas) · A2-RES-01 (P1) y A2-RES-06 (P3): remitente fuerte.
-- No edita migraciones aplicadas: las extiende. Idempotente. REQUIERE AUTORIZACIÓN DEL DUEÑO PARA
-- APLICARSE EN PRODUCCIÓN. La función sigue apagada (app_flags.ai_reservations_enabled = false).
--
-- A2-RES-01: con un buzón COMPARTIDO (live.fr, wanadoo.fr, yahoo.co.uk…, antes fuera de la lista), otra
-- cuenta del mismo proveedor con DMARC pass pasaba como el restaurante. Ahora la lógica se invierte:
--   * la aceptación por DOMINIO (otro buzón o subdominio con DMARC pass) solo vale si el dominio es
--     PROPIO del restaurante: no está en la lista de buzones compartidos y coincide con el host de su
--     sitio web oficial (venue_website, sin "www."), o es un subdominio de él;
--   * en cualquier otro caso (lista amplia + heurística "el dominio no coincide con el sitio oficial")
--     se exige la DIRECCIÓN EXACTA a la que escribimos (con DMARC pass, o DKIM pass y DMARC gray).
-- A2-RES-06: DMARC con cualquier valor distinto de 'pass' o 'gray' (fail, processing_failed, unknown,
-- 'failed', 'permerror', ausente, no texto) descarta: falla cerrada.
-- Misma regla que core.ts senderAuthentication / venueOwnsDomain / siteHost (pruebas de Vitest exigen
-- que la lista coincida y la suite SQL ai_reservations prueba los mismos casos).

-- Host del sitio web oficial: https, ASCII, sin credenciales, sin "www." ni punto final.
CREATE OR REPLACE FUNCTION public.ai_res_site_host(_url text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN h2 IS NULL OR position('.' IN h2) = 0 OR left(h2, 1) = '.' OR position('..' IN h2) > 0 THEN NULL ELSE h2 END
    FROM (SELECT regexp_replace(regexp_replace(h, '\.$', ''), '^www\.', '') AS h2
            FROM (SELECT substring(lower(btrim(coalesce(_url, ''))) FROM '^https://([a-z0-9.-]+)(?::[0-9]{1,5})?(?:[/?#]|$)') AS h) a) b;
$$;

-- Buzones compartidos: misma lista que SHARED_MAILBOX_DOMAINS en core.ts (una prueba de Vitest exige que coincidan).
CREATE OR REPLACE FUNCTION public.ai_res_freemail_domains()
RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY[
    'gmail.com','googlemail.com','hotmail.com','hotmail.es','hotmail.fr','hotmail.it','hotmail.de','hotmail.co.uk','hotmail.com.mx','hotmail.com.ar',
    'hotmail.com.br','hotmail.cl','hotmail.be','hotmail.ca','outlook.com','outlook.es','outlook.fr','outlook.it','outlook.de','outlook.com.mx',
    'outlook.com.ar','outlook.com.br','outlook.cl','outlook.co.uk','outlook.pt','live.com','live.com.mx','live.fr','live.it','live.co.uk',
    'live.de','live.nl','live.be','live.ca','live.com.ar','live.cl','live.com.pt','msn.com','windowslive.com','passport.com',
    'yahoo.com','yahoo.com.mx','yahoo.es','yahoo.fr','yahoo.it','yahoo.de','yahoo.co.uk','yahoo.com.ar','yahoo.com.br','yahoo.ca',
    'yahoo.cl','yahoo.com.co','yahoo.com.pe','yahoo.com.ve','yahoo.co.jp','ymail.com','rocketmail.com','icloud.com','me.com','mac.com',
    'aol.com','aol.fr','aim.com','proton.me','protonmail.com','protonmail.ch','pm.me','tutanota.com','tuta.io','fastmail.com',
    'hey.com','mailbox.org','posteo.de','hushmail.com','zoho.com','zohomail.com','gmx.com','gmx.de','gmx.net','gmx.at',
    'gmx.ch','gmx.fr','gmx.es','web.de','t-online.de','freenet.de','arcor.de','mail.com','email.com','usa.com',
    'seznam.cz','wp.pl','o2.pl','onet.pl','interia.pl','abv.bg','yandex.ru','yandex.com','ya.ru','mail.ru',
    'inbox.ru','list.ru','bk.ru','rambler.ru','orange.fr','wanadoo.fr','free.fr','laposte.net','sfr.fr','neuf.fr',
    'bbox.fr','numericable.fr','club-internet.fr','aliceadsl.fr','cegetel.net','libero.it','virgilio.it','tiscali.it','alice.it','tin.it',
    'email.it','fastwebnet.it','telefonica.net','movistar.es','ono.com','terra.es','sapo.pt','prodigy.net.mx','infinitummail.com','telmexmail.com',
    'terra.com.mx','terra.com.br','uol.com.br','bol.com.br','ig.com.br','globo.com','arnet.com.ar','fibertel.com.ar','speedy.com.ar','btinternet.com',
    'sky.com','talktalk.net','virginmedia.com','ntlworld.com','comcast.net','verizon.net','att.net','sbcglobal.net','bellsouth.net','cox.net',
    'charter.net','earthlink.net','juno.com','optonline.net','shaw.ca','rogers.com','sympatico.ca','videotron.ca','bigpond.com','optusnet.com.au',
    'xtra.co.nz','qq.com','163.com','126.com','sina.com','naver.com','daum.net','hanmail.net','rediffmail.com','lycos.com',
    'inbox.com'];
$$;

-- La firma de 3 argumentos se reemplaza por la de 4 (con el sitio web del lugar). Si quedaran las dos,
-- una llamada con 3 argumentos sería ambigua.
DROP FUNCTION IF EXISTS public.ai_res_sender_strong(text, text, jsonb);

CREATE OR REPLACE FUNCTION public.ai_res_sender_strong(_from text, _venue text, _auth jsonb, _venue_website text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE
  re constant text := '^[a-z0-9._%+''-]+@[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$';
  f text := lower(btrim(coalesce(_from, ''))); v text := lower(btrim(coalesce(_venue, '')));
  fd text; vd text; dmarc text; dkim text;
BEGIN
  IF f !~ re OR v !~ re OR jsonb_typeof(_auth) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
  dmarc := CASE WHEN jsonb_typeof(_auth->'dmarc') = 'string' THEN lower(btrim(_auth->>'dmarc')) END;
  dkim := CASE WHEN jsonb_typeof(_auth->'dkim') = 'string' THEN lower(btrim(_auth->>'dkim')) END;
  -- A2-RES-06: falla cerrada.
  IF dmarc IS NULL OR dmarc NOT IN ('pass', 'gray') THEN RETURN false; END IF;
  -- La dirección exacta a la que escribimos: DMARC pass, o DKIM alineado (pass) sin DMARC fail.
  IF f = v THEN RETURN dmarc = 'pass' OR dkim = 'pass'; END IF;
  -- A2-RES-01: otro buzón del dominio solo si el dominio es propio del restaurante.
  IF NOT public.ai_res_venue_owns_domain(v, _venue_website) THEN RETURN false; END IF;
  fd := split_part(f, '@', 2); vd := split_part(v, '@', 2);
  IF NOT (fd = vd OR right(fd, length(vd) + 1) = '.' || vd) THEN RETURN false; END IF;
  RETURN dmarc = 'pass';
END $$;

-- ¿El dominio del correo del lugar es suyo? No compartido y = host del sitio oficial (o subdominio de él).
CREATE OR REPLACE FUNCTION public.ai_res_venue_owns_domain(_venue text, _venue_website text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(vd <> '' AND s IS NOT NULL
           AND NOT (vd = ANY (public.ai_res_freemail_domains())) AND NOT (s = ANY (public.ai_res_freemail_domains()))
           AND (vd = s OR right(vd, length(s) + 1) = '.' || s), false)
    FROM (SELECT CASE WHEN v ~ '^[a-z0-9._%+''-]+@[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'
                      THEN split_part(v, '@', 2) ELSE '' END AS vd,
                 public.ai_res_site_host(_venue_website) AS s
            FROM (SELECT lower(btrim(coalesce(_venue, ''))) AS v) x) y;
$$;

-- La regla de evidencia (20261024170000) con el remitente nuevo. Igual que antes salvo la llamada a
-- ai_res_sender_strong, que ahora recibe el sitio web oficial de la reserva.
CREATE OR REPLACE FUNCTION public.ai_res_confirmation_failures(_res_id uuid, _venue_email text, _local text, _party int, _c jsonb, _code text)
RETURNS text[] LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE i public.ai_reservation_inbound; f text[] := ARRAY[]::text[]; v_cond jsonb; k text; b text; v_q text; v_site text;
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

REVOKE ALL ON FUNCTION public.ai_res_site_host(text), public.ai_res_freemail_domains(),
  public.ai_res_sender_strong(text, text, jsonb, text), public.ai_res_venue_owns_domain(text, text),
  public.ai_res_confirmation_failures(uuid, text, text, int, jsonb, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_res_site_host(text), public.ai_res_freemail_domains(),
  public.ai_res_sender_strong(text, text, jsonb, text), public.ai_res_venue_owns_domain(text, text)
  TO service_role;
