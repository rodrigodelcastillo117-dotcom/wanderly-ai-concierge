-- Bóveda (grupo boveda): documentos de viaje, membresías, tarjetas y seguros en un solo lugar.
-- Idempotente. Datos de identidad: todo es SOLO del dueño (RLS por user_id = auth.uid()).
--
-- · vault_items: una fila por documento / membresía / tarjeta / seguro. Las tarjetas guardan, a lo
--   mucho, los últimos 4 dígitos y nunca vencimiento (el Aviso de Privacidad promete no guardar
--   números completos de tarjeta, CVV ni fechas de vencimiento; aquí lo impone un CHECK).
-- · vault_files: fotos (JPEG ya sin EXIF: el cliente las vuelve a codificar) y PDFs de cada fila.
-- · Bucket PRIVADO travel-vault, ruta {user_id}/{item_id}/{uuid}.jpg|pdf (sin el nombre original
--   del archivo, que suele traer el nombre de la persona). Sin política UPDATE: no se sobrescribe.
--   Descarga solo con enlace firmado de vida corta (el cliente pide 60 s).
-- · user_vault_benefits pasa a ser una PROYECCIÓN sin números (nombres, niveles y beneficios) que
--   mantiene un trigger: es lo que ya leen concierge-chat, analizar-viaje, buscar-promociones y
--   generar-packing-list como contexto de IA, así que los números y documentos nunca llegan ahí.
--   El cliente ya no la escribe directo.
-- · Borrado de cuenta: purge_account_data borra toda tabla pública con user_id uuid (ambas lo
--   tienen) y account_deletion_files ya incluye todo objeto cuya ruta empieza con {user_id}/, así
--   que no hace falta redefinirlas (supabase/tests/boveda lo comprueba).

-- ───── Bucket privado ─────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('travel-vault', 'travel-vault', false, 10485760, ARRAY['image/jpeg', 'application/pdf'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ───── Utilidades ─────
CREATE OR REPLACE FUNCTION public.vault_benefits_ok(p text[])
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(cardinality(p), 0) <= 40
     AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p, '{}'::text[])) b WHERE b IS NULL OR length(b) NOT BETWEEN 1 AND 200);
$$;

CREATE OR REPLACE FUNCTION public.vault_try_date(p text)
RETURNS date LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF p IS NULL OR p !~ '^\d{4}-\d{2}-\d{2}$' THEN RETURN NULL; END IF;
  RETURN p::date;
EXCEPTION WHEN others THEN RETURN NULL;
END $$;

-- ───── vault_items ─────
CREATE TABLE IF NOT EXISTS public.vault_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL DEFAULT auth.uid(),
  section       text NOT NULL CHECK (section IN ('documento', 'membresia', 'tarjeta', 'seguro')),
  kind          text NOT NULL,
  program_id    text CHECK (program_id ~ '^[a-z0-9-]{1,60}$'),
  tier_id       text CHECK (tier_id ~ '^[a-z0-9-]{1,60}$'),
  title         text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 120),
  issuer        text CHECK (length(issuer) <= 120),
  tier          text CHECK (length(tier) <= 60),
  number        text CHECK (number ~ '^[A-Za-z0-9 ./-]{1,64}$'),
  holder_name   text CHECK (length(holder_name) <= 120),
  country_code  text CHECK (country_code ~ '^[A-Z]{2}$'),
  visa_type     text CHECK (length(visa_type) <= 60),
  entries       text CHECK (entries IN ('una', 'doble', 'multiple')),
  valid_from    date,
  expires_on    date,
  contact_phone text CHECK (contact_phone ~ '^[0-9+() -]{3,30}$'),
  benefits      text[] NOT NULL DEFAULT '{}'::text[],
  benefits_unverified boolean NOT NULL DEFAULT false,
  notes         text CHECK (length(notes) <= 1000),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vault_items_kind_in_section CHECK (
    CASE section
      WHEN 'documento' THEN kind IN ('pasaporte', 'visa', 'autorizacion', 'ine', 'licencia', 'vacuna', 'otro_documento')
      WHEN 'membresia' THEN kind IN ('aerolinea', 'hotel', 'auto', 'crucero', 'sala', 'viajero_confiable', 'otra_membresia')
      WHEN 'tarjeta'   THEN kind = 'tarjeta'
      WHEN 'seguro'    THEN kind IN ('seguro_viaje', 'seguro_medico', 'asistencia', 'otro_seguro')
    END
  ),
  -- Tarjetas: solo últimos 4 dígitos y sin vencimiento.
  CONSTRAINT vault_items_card_no_pan CHECK (section <> 'tarjeta' OR number IS NULL OR number ~ '^[0-9]{4}$'),
  CONSTRAINT vault_items_card_no_expiry CHECK (section <> 'tarjeta' OR (expires_on IS NULL AND valid_from IS NULL)),
  CONSTRAINT vault_items_dates CHECK (valid_from IS NULL OR expires_on IS NULL OR valid_from <= expires_on),
  CONSTRAINT vault_items_benefits CHECK (public.vault_benefits_ok(benefits))
);
CREATE INDEX IF NOT EXISTS idx_vault_items_user ON public.vault_items (user_id, section, expires_on);

-- ───── vault_files ─────
CREATE TABLE IF NOT EXISTS public.vault_files (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL DEFAULT auth.uid(),
  item_id      uuid NOT NULL REFERENCES public.vault_items(id) ON DELETE CASCADE,
  side         text NOT NULL CHECK (side IN ('frente', 'reverso', 'pagina', 'pdf')),
  storage_path text NOT NULL UNIQUE,
  mime         text NOT NULL CHECK (mime IN ('image/jpeg', 'application/pdf')),
  size         bigint NOT NULL CHECK (size > 0 AND size <= 10485760),
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vault_files_path CHECK (
    storage_path ~ ('^' || user_id::text || '/' || item_id::text
      || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|pdf)$')
  ),
  CONSTRAINT vault_files_ext_matches_mime CHECK ((mime = 'image/jpeg') = (storage_path LIKE '%.jpg'))
);
CREATE INDEX IF NOT EXISTS idx_vault_files_item ON public.vault_files (item_id);
CREATE INDEX IF NOT EXISTS idx_vault_files_user ON public.vault_files (user_id);

-- ───── Permisos y RLS (solo el dueño; anon nada) ─────
ALTER TABLE public.vault_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vault_files ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.vault_items, public.vault_files FROM anon, PUBLIC;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.vault_items, public.vault_files FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vault_items TO authenticated;
-- Un archivo no se edita: se borra y se sube otro.
REVOKE UPDATE ON public.vault_files FROM authenticated;
GRANT SELECT, INSERT, DELETE ON public.vault_files TO authenticated;
GRANT ALL ON public.vault_items, public.vault_files TO service_role;

DROP POLICY IF EXISTS vault_items_select ON public.vault_items;
CREATE POLICY vault_items_select ON public.vault_items FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS vault_items_insert ON public.vault_items;
CREATE POLICY vault_items_insert ON public.vault_items FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS vault_items_update ON public.vault_items;
CREATE POLICY vault_items_update ON public.vault_items FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS vault_items_delete ON public.vault_items;
CREATE POLICY vault_items_delete ON public.vault_items FOR DELETE TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS vault_files_select ON public.vault_files;
CREATE POLICY vault_files_select ON public.vault_files FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS vault_files_insert ON public.vault_files;
CREATE POLICY vault_files_insert ON public.vault_files FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.vault_items i WHERE i.id = item_id AND i.user_id = auth.uid()));
DROP POLICY IF EXISTS vault_files_delete ON public.vault_files;
CREATE POLICY vault_files_delete ON public.vault_files FOR DELETE TO authenticated USING (user_id = auth.uid());

-- ───── Límites anti-abuso y updated_at ─────
CREATE OR REPLACE FUNCTION public.vault_enforce_limits()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_TABLE_NAME = 'vault_items' THEN
    IF (SELECT count(*) FROM public.vault_items WHERE user_id = NEW.user_id) >= 300 THEN
      RAISE EXCEPTION 'vault_items_limit' USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    IF (SELECT count(*) FROM public.vault_files WHERE item_id = NEW.item_id) >= 6 THEN
      RAISE EXCEPTION 'vault_files_per_item_limit' USING ERRCODE = 'check_violation';
    END IF;
    IF (SELECT count(*) FROM public.vault_files WHERE user_id = NEW.user_id) >= 600 THEN
      RAISE EXCEPTION 'vault_files_limit' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.vault_enforce_limits() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS vault_items_limits ON public.vault_items;
CREATE TRIGGER vault_items_limits BEFORE INSERT ON public.vault_items
  FOR EACH ROW EXECUTE FUNCTION public.vault_enforce_limits();
DROP TRIGGER IF EXISTS vault_files_limits ON public.vault_files;
CREATE TRIGGER vault_files_limits BEFORE INSERT ON public.vault_files
  FOR EACH ROW EXECUTE FUNCTION public.vault_enforce_limits();
DROP TRIGGER IF EXISTS vault_items_set_updated_at ON public.vault_items;
CREATE TRIGGER vault_items_set_updated_at BEFORE UPDATE ON public.vault_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ───── storage.objects del bucket travel-vault ─────
-- Ruta válida = {uuid dueño}/{uuid fila}/{uuid}.jpg|pdf; cualquier otra forma no tiene dueño.
CREATE OR REPLACE FUNCTION public.vault_path_owner(p_name text)
RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|pdf)$'
         THEN split_part(p_name, '/', 1)::uuid END;
$$;
CREATE OR REPLACE FUNCTION public.vault_path_item(p_name text)
RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN public.vault_path_owner(p_name) IS NOT NULL THEN split_part(p_name, '/', 2)::uuid END;
$$;
GRANT EXECUTE ON FUNCTION public.vault_path_owner(text), public.vault_path_item(text) TO authenticated, service_role;

DROP POLICY IF EXISTS travel_vault_obj_select ON storage.objects;
CREATE POLICY travel_vault_obj_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'travel-vault' AND public.vault_path_owner(name) = auth.uid());
DROP POLICY IF EXISTS travel_vault_obj_insert ON storage.objects;
CREATE POLICY travel_vault_obj_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'travel-vault' AND public.vault_path_owner(name) = auth.uid()
    AND EXISTS (SELECT 1 FROM public.vault_items i WHERE i.id = public.vault_path_item(name) AND i.user_id = auth.uid())
  );
DROP POLICY IF EXISTS travel_vault_obj_delete ON storage.objects;
CREATE POLICY travel_vault_obj_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'travel-vault' AND public.vault_path_owner(name) = auth.uid());
-- Sin política UPDATE ni nada para anon.

-- ───── Proyección sin números hacia user_vault_benefits (contexto de IA existente) ─────
CREATE OR REPLACE FUNCTION public.vault_sync_legacy(p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_user_id IS NULL THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.vault_items WHERE user_id = p_user_id AND section IN ('membresia', 'tarjeta')) THEN
    DELETE FROM public.user_vault_benefits WHERE user_id = p_user_id;
    RETURN;
  END IF;
  INSERT INTO public.user_vault_benefits (user_id, credit_cards, airline_alliances, hotel_loyalty, car_rentals, travel_documents)
  SELECT p_user_id,
    coalesce((SELECT jsonb_agg(jsonb_build_object('bank', coalesce(issuer, title), 'card_name', title,
        'card_tier', coalesce(tier, ''), 'perks_enabled', to_jsonb(benefits)) ORDER BY created_at)
      FROM public.vault_items WHERE user_id = p_user_id AND section = 'tarjeta'), '[]'::jsonb),
    coalesce((SELECT jsonb_agg(jsonb_build_object('airline', title, 'alliance_name', '',
        'tier_status', coalesce(tier, ''), 'perks', to_jsonb(benefits)) ORDER BY created_at)
      FROM public.vault_items WHERE user_id = p_user_id AND kind = 'aerolinea'), '[]'::jsonb),
    coalesce((SELECT jsonb_agg(jsonb_build_object('chain_name', title, 'status_tier', coalesce(tier, ''),
        'perks', to_jsonb(benefits)) ORDER BY created_at)
      FROM public.vault_items WHERE user_id = p_user_id AND kind = 'hotel'), '[]'::jsonb),
    coalesce((SELECT jsonb_agg(jsonb_build_object('company_name', title, 'tier_status', coalesce(tier, ''),
        'preferred_car_type', '') ORDER BY created_at)
      FROM public.vault_items WHERE user_id = p_user_id AND kind = 'auto'), '[]'::jsonb),
    '[]'::jsonb
  ON CONFLICT (user_id) DO UPDATE SET credit_cards = EXCLUDED.credit_cards,
    airline_alliances = EXCLUDED.airline_alliances, hotel_loyalty = EXCLUDED.hotel_loyalty,
    car_rentals = EXCLUDED.car_rentals, travel_documents = '[]'::jsonb;
END $$;
REVOKE ALL ON FUNCTION public.vault_sync_legacy(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.vault_sync_legacy(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.vault_items_after_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN PERFORM public.vault_sync_legacy(OLD.user_id); END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') AND (TG_OP = 'INSERT' OR NEW.user_id IS DISTINCT FROM OLD.user_id) THEN
    PERFORM public.vault_sync_legacy(NEW.user_id);
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.vault_items_after_change() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS vault_items_sync_legacy ON public.vault_items;
CREATE TRIGGER vault_items_sync_legacy AFTER INSERT OR UPDATE OR DELETE ON public.vault_items
  FOR EACH ROW EXECUTE FUNCTION public.vault_items_after_change();

-- La proyección la escribe solo el trigger: el cliente puede leerla y borrarla, no escribirla
-- (así no vuelven a entrar números de documento a lo que lee la IA).
REVOKE INSERT, UPDATE ON public.user_vault_benefits FROM authenticated, anon;

-- ───── Migración de la bóveda anterior (jsonb) a filas; solo cuentas que aún no tienen filas ─────
DO $$
DECLARE r record; e jsonb; v_kind text; v_country text; v_section text;
BEGIN
  FOR r IN SELECT b.* FROM public.user_vault_benefits b
           WHERE NOT EXISTS (SELECT 1 FROM public.vault_items i WHERE i.user_id = b.user_id) LOOP
    FOR e IN SELECT x FROM jsonb_array_elements(CASE WHEN jsonb_typeof(r.credit_cards) = 'array' THEN r.credit_cards ELSE '[]' END) x WHERE jsonb_typeof(x) = 'object' LOOP
      INSERT INTO public.vault_items (user_id, section, kind, title, issuer, tier, benefits, benefits_unverified, notes)
      VALUES (r.user_id, 'tarjeta', 'tarjeta',
        left(coalesce(nullif(btrim(concat_ws(' ', e->>'bank', e->>'card_name')), ''), 'Tarjeta'), 120),
        left(nullif(btrim(e->>'bank'), ''), 120), left(nullif(btrim(e->>'card_tier'), ''), 60),
        coalesce((SELECT array_agg(left(x, 200)) FROM (
           SELECT btrim(x #>> '{}') AS x FROM jsonb_array_elements(
             coalesce(CASE WHEN jsonb_typeof(e->'perks_enabled') = 'array' THEN e->'perks_enabled' END, '[]')
             || coalesce(CASE WHEN jsonb_typeof(e->'lounge_access') = 'array' THEN e->'lounge_access' END, '[]')
             || coalesce(CASE WHEN jsonb_typeof(e->'insurance') = 'array' THEN e->'insurance' END, '[]')
             || coalesce(CASE WHEN jsonb_typeof(e->'extras') = 'array' THEN e->'extras' END, '[]')) x
           WHERE jsonb_typeof(x) IN ('string', 'number') AND btrim(x #>> '{}') <> '' LIMIT 40) s), '{}'),
        coalesce(e->>'ai_autofilled', '') = 'true',
        left(nullif(concat_ws(' · ', nullif(e->>'network', ''), nullif(e->>'miles_program', '')), ''), 1000));
    END LOOP;
    FOR e IN SELECT x FROM jsonb_array_elements(CASE WHEN jsonb_typeof(r.airline_alliances) = 'array' THEN r.airline_alliances ELSE '[]' END) x WHERE jsonb_typeof(x) = 'object' LOOP
      INSERT INTO public.vault_items (user_id, section, kind, title, tier, number, notes)
      VALUES (r.user_id, 'membresia', 'aerolinea',
        left(coalesce(nullif(btrim(e->>'airline'), ''), nullif(btrim(e->>'alliance_name'), ''), 'Aerolínea'), 120),
        left(nullif(btrim(e->>'tier_status'), ''), 60),
        nullif(left(btrim(regexp_replace(coalesce(e->>'membership_number', ''), '[^A-Za-z0-9 ./-]', '', 'g')), 64), ''),
        left(nullif(concat_ws(' · ', nullif(e->>'alliance_name', ''), nullif(e->>'seat_preference', '')), ''), 1000));
    END LOOP;
    FOR e IN SELECT x FROM jsonb_array_elements(CASE WHEN jsonb_typeof(r.hotel_loyalty) = 'array' THEN r.hotel_loyalty ELSE '[]' END) x WHERE jsonb_typeof(x) = 'object' LOOP
      INSERT INTO public.vault_items (user_id, section, kind, title, tier, number, notes)
      VALUES (r.user_id, 'membresia', 'hotel', left(coalesce(nullif(btrim(e->>'chain_name'), ''), 'Hotel'), 120),
        left(nullif(btrim(e->>'status_tier'), ''), 60),
        nullif(left(btrim(regexp_replace(coalesce(e->>'member_id', ''), '[^A-Za-z0-9 ./-]', '', 'g')), 64), ''),
        left(nullif(btrim(e->>'room_preferences'), ''), 1000));
    END LOOP;
    FOR e IN SELECT x FROM jsonb_array_elements(CASE WHEN jsonb_typeof(r.car_rentals) = 'array' THEN r.car_rentals ELSE '[]' END) x WHERE jsonb_typeof(x) = 'object' LOOP
      INSERT INTO public.vault_items (user_id, section, kind, title, number, notes)
      VALUES (r.user_id, 'membresia', 'auto', left(coalesce(nullif(btrim(e->>'company_name'), ''), 'Renta de autos'), 120),
        nullif(left(btrim(regexp_replace(coalesce(e->>'customer_id', ''), '[^A-Za-z0-9 ./-]', '', 'g')), 64), ''),
        left(nullif(btrim(e->>'preferred_car_type'), ''), 1000));
    END LOOP;
    FOR e IN SELECT x FROM jsonb_array_elements(CASE WHEN jsonb_typeof(r.travel_documents) = 'array' THEN r.travel_documents ELSE '[]' END) x WHERE jsonb_typeof(x) = 'object' LOOP
      v_section := 'documento'; v_country := NULL;
      v_kind := CASE e->>'doc_type'
        WHEN 'Pasaporte' THEN 'pasaporte'
        WHEN 'Visa USA' THEN 'visa' WHEN 'Visa Schengen' THEN 'visa' WHEN 'Visa UK' THEN 'visa'
        WHEN 'Licencia internacional' THEN 'licencia'
        WHEN 'Global Entry' THEN 'viajero_confiable' WHEN 'TSA PreCheck' THEN 'viajero_confiable'
        WHEN 'NEXUS' THEN 'viajero_confiable' WHEN 'SENTRI' THEN 'viajero_confiable'
        ELSE 'otro_documento' END;
      IF v_kind = 'viajero_confiable' THEN v_section := 'membresia'; END IF;
      v_country := CASE e->>'doc_type' WHEN 'Visa USA' THEN 'US' WHEN 'Visa Schengen' THEN 'EU' WHEN 'Visa UK' THEN 'GB' END;
      INSERT INTO public.vault_items (user_id, section, kind, title, issuer, number, country_code, expires_on, notes)
      VALUES (r.user_id, v_section, v_kind, left(coalesce(nullif(btrim(e->>'doc_type'), ''), 'Documento'), 120),
        left(nullif(btrim(e->>'country'), ''), 120),
        nullif(left(btrim(regexp_replace(coalesce(e->>'number', ''), '[^A-Za-z0-9 ./-]', '', 'g')), 64), ''),
        v_country, public.vault_try_date(e->>'expires'), left(nullif(btrim(e->>'notes'), ''), 1000));
    END LOOP;
  END LOOP;
END $$;

-- Ningún número de documento queda en la tabla que lee la IA.
UPDATE public.user_vault_benefits SET travel_documents = '[]'::jsonb WHERE travel_documents <> '[]'::jsonb;
