-- IATOS Privé (grupo catalog) · 2/9 · Siembra del catálogo de destinos. GENERADO por
-- scripts/prive/gen_destinations_sql.mjs desde scripts/prive/destinations.mjs (lista EXACTA del dueño,
-- 2026-10-22) y destinations.coords.json (Wikidata P625, consultado el 2026-10-22). No editar a mano.
--
-- Todos los destinos nacen SIN COBERTURA VERIFICADA: la cobertura se calcula con el contenido
-- verificado (prive_destination_coverage), no se escribe aquí. Coordenadas sin fuente verificable = NULL
-- (Riviera Nayarit: Wikidata no la tiene; Roma-Condesa: barrio compuesto; Interlomas: el dato de
-- Wikidata no coincide con la ubicación real). Idempotente: ON CONFLICT (slug) actualiza.

INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('mc', 'country', NULL, 'Mónaco', 'Monaco', 'MC', NULL, 43.7311, 7.42, 'https://www.wikidata.org/wiki/Q235', NULL, 'Q235', 'Europe/Monaco', 'EUR', 'europa', true, 10)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('om', 'country', NULL, 'Omán · destinos destacados', 'Oman · featured destinations', 'OM', NULL, 21, 57, 'https://www.wikidata.org/wiki/Q842', NULL, 'Q842', 'Asia/Muscat', 'OMR', 'medio_oriente', true, 810)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('sg', 'country', NULL, 'Singapur', 'Singapore', 'SG', NULL, 1.3, 103.8, 'https://www.wikidata.org/wiki/Q334', NULL, 'Q334', 'Asia/Singapore', 'SGD', 'asia_oceania', true, 860)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('hk', 'country', NULL, 'Hong Kong', 'Hong Kong', 'HK', NULL, 22.2783, 114.1586, 'https://www.wikidata.org/wiki/Q8646', NULL, 'Q8646', 'Asia/Hong_Kong', 'HKD', 'asia_oceania', true, 870)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('sc', 'country', NULL, 'Seychelles', 'Seychelles', 'SC', NULL, -7.1, 52.7667, 'https://www.wikidata.org/wiki/Q1042', NULL, 'Q1042', 'Indian/Mahe', 'SCR', 'otras_regiones', true, 1080)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('mu', 'country', NULL, 'Mauricio', 'Mauritius', 'MU', NULL, -20.2, 57.5, 'https://www.wikidata.org/wiki/Q1027', NULL, 'Q1027', 'Indian/Mauritius', 'MUR', 'otras_regiones', true, 1090)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('mv', 'country', NULL, 'Maldivas', 'Maldives', 'MV', NULL, 4.18, 73.51, 'https://www.wikidata.org/wiki/Q826', NULL, 'Q826', 'Indian/Maldives', 'MVR', 'otras_regiones', true, 1100)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('ae', 'country', NULL, 'Emiratos Árabes Unidos', 'United Arab Emirates', 'AE', NULL, NULL, NULL, NULL, 'Área: agrupa destinos, sin coordenada propia', NULL, 'Asia/Dubai', 'AED', NULL, false, 5000)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('ar', 'country', NULL, 'Argentina', 'Argentina', 'AR', NULL, NULL, NULL, NULL, 'Área: agrupa destinos, sin coordenada propia', NULL, 'America/Argentina/Buenos_Aires', 'ARS', NULL, false, 5000)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('at', 'country', NULL, 'Austria', 'Austria', 'AT', NULL, NULL, NULL, NULL, 'Área: agrupa destinos, sin coordenada propia', NULL, 'Europe/Vienna', 'EUR', NULL, false, 5000)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('au', 'country', NULL, 'Australia', 'Australia', 'AU', NULL, NULL, NULL, NULL, 'Área: agrupa destinos, sin coordenada propia', NULL, 'Australia/Sydney', 'AUD', NULL, false, 5000)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('br', 'country', NULL, 'Brasil', 'Brazil', 'BR', NULL, NULL, NULL, NULL, 'Área: agrupa destinos, sin coordenada propia', NULL, 'America/Sao_Paulo', 'BRL', NULL, false, 5000)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('ca', 'country', NULL, 'Canadá', 'Canada', 'CA', NULL, NULL, NULL, NULL, 'Área: agrupa destinos, sin coordenada propia', NULL, 'America/Toronto', 'CAD', NULL, false, 5000)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('ch', 'country', NULL, 'Suiza', 'Switzerland', 'CH', NULL, NULL, NULL, NULL, 'Área: agrupa destinos, sin coordenada propia', NULL, 'Europe/Zurich', 'CHF', NULL, false, 5000)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('co', 'country', NULL, 'Colombia', 'Colombia', 'CO', NULL, NULL, NULL, NULL, 'Área: agrupa destinos, sin coordenada propia', NULL, 'America/Bogota', 'COP', NULL, false, 5000)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('de', 'country', NULL, 'Alemania', 'Germany', 'DE', NULL, NULL, NULL, NULL, 'Área: agrupa destinos, sin coordenada propia', NULL, 'Europe/Berlin', 'EUR', NULL, false, 5000)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('es', 'country', NULL, 'España', 'Spain', 'ES', NULL, NULL, NULL, NULL, 'Área: agrupa destinos, sin coordenada propia', NULL, 'Europe/Madrid', 'EUR', NULL, false, 5000)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('fr', 'country', NULL, 'Francia', 'France', 'FR', NULL, NULL, NULL, NULL, 'Área: agrupa destinos, sin coordenada propia', NULL, 'Europe/Paris', 'EUR', NULL, false, 5000)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('gb', 'country', NULL, 'Reino Unido', 'United Kingdom', 'GB', NULL, NULL, NULL, NULL, 'Área: agrupa destinos, sin coordenada propia', NULL, 'Europe/London', 'GBP', NULL, false, 5000)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('gr', 'country', NULL, 'Grecia', 'Greece', 'GR', NULL, NULL, NULL, NULL, 'Área: agrupa destinos, sin coordenada propia', NULL, 'Europe/Athens', 'EUR', NULL, false, 5000)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('id', 'country', NULL, 'Indonesia', 'Indonesia', 'ID', NULL, NULL, NULL, NULL, 'Área: agrupa destinos, sin coordenada propia', NULL, 'Asia/Jakarta', 'IDR', NULL, false, 5000)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('it', 'country', NULL, 'Italia', 'Italy', 'IT', NULL, NULL, NULL, NULL, 'Área: agrupa destinos, sin coordenada propia', NULL, 'Europe/Rome', 'EUR', NULL, false, 5000)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('jp', 'country', NULL, 'Japón', 'Japan', 'JP', NULL, NULL, NULL, NULL, 'Área: agrupa destinos, sin coordenada propia', NULL, 'Asia/Tokyo', 'JPY', NULL, false, 5000)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('kr', 'country', NULL, 'Corea del Sur', 'South Korea', 'KR', NULL, NULL, NULL, NULL, 'Área: agrupa destinos, sin coordenada propia', NULL, 'Asia/Seoul', 'KRW', NULL, false, 5000)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('ma', 'country', NULL, 'Marruecos', 'Morocco', 'MA', NULL, NULL, NULL, NULL, 'Área: agrupa destinos, sin coordenada propia', NULL, 'Africa/Casablanca', 'MAD', NULL, false, 5000)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('mx', 'country', NULL, 'México', 'Mexico', 'MX', NULL, NULL, NULL, NULL, 'Área: agrupa destinos, sin coordenada propia', NULL, 'America/Mexico_City', 'MXN', NULL, false, 5000)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('nl', 'country', NULL, 'Países Bajos', 'Netherlands', 'NL', NULL, NULL, NULL, NULL, 'Área: agrupa destinos, sin coordenada propia', NULL, 'Europe/Amsterdam', 'EUR', NULL, false, 5000)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('nz', 'country', NULL, 'Nueva Zelanda', 'New Zealand', 'NZ', NULL, NULL, NULL, NULL, 'Área: agrupa destinos, sin coordenada propia', NULL, 'Pacific/Auckland', 'NZD', NULL, false, 5000)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('pe', 'country', NULL, 'Perú', 'Peru', 'PE', NULL, NULL, NULL, NULL, 'Área: agrupa destinos, sin coordenada propia', NULL, 'America/Lima', 'PEN', NULL, false, 5000)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('pf', 'country', NULL, 'Polinesia Francesa', 'French Polynesia', 'PF', NULL, NULL, NULL, NULL, 'Área: agrupa destinos, sin coordenada propia', NULL, 'Pacific/Tahiti', 'XPF', NULL, false, 5000)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('pt', 'country', NULL, 'Portugal', 'Portugal', 'PT', NULL, NULL, NULL, NULL, 'Área: agrupa destinos, sin coordenada propia', NULL, 'Europe/Lisbon', 'EUR', NULL, false, 5000)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('qa', 'country', NULL, 'Catar', 'Qatar', 'QA', NULL, NULL, NULL, NULL, 'Área: agrupa destinos, sin coordenada propia', NULL, 'Asia/Qatar', 'QAR', NULL, false, 5000)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('sa', 'country', NULL, 'Arabia Saudita', 'Saudi Arabia', 'SA', NULL, NULL, NULL, NULL, 'Área: agrupa destinos, sin coordenada propia', NULL, 'Asia/Riyadh', 'SAR', NULL, false, 5000)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('th', 'country', NULL, 'Tailandia', 'Thailand', 'TH', NULL, NULL, NULL, NULL, 'Área: agrupa destinos, sin coordenada propia', NULL, 'Asia/Bangkok', 'THB', NULL, false, 5000)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('us', 'country', NULL, 'Estados Unidos', 'United States', 'US', NULL, NULL, NULL, NULL, 'Área: agrupa destinos, sin coordenada propia', NULL, 'America/New_York', 'USD', NULL, false, 5000)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('uy', 'country', NULL, 'Uruguay', 'Uruguay', 'UY', NULL, NULL, NULL, NULL, 'Área: agrupa destinos, sin coordenada propia', NULL, 'America/Montevideo', 'UYU', NULL, false, 5000)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('za', 'country', NULL, 'Sudáfrica', 'South Africa', 'ZA', NULL, NULL, NULL, NULL, 'Área: agrupa destinos, sin coordenada propia', NULL, 'Africa/Johannesburg', 'ZAR', NULL, false, 5000)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('monaco-monte-carlo', 'neighborhood', (SELECT id FROM public.prive_destinations WHERE slug = 'mc'), 'Montecarlo', 'Monte Carlo', 'MC', 'Mónaco', 43.7389, 7.4252, 'https://www.wikidata.org/wiki/Q45240', NULL, 'Q45240', 'Europe/Monaco', 'EUR', 'europa', true, 20)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('paris', 'locality', (SELECT id FROM public.prive_destinations WHERE slug = 'fr'), 'París', 'Paris', 'FR', 'Île-de-France', 48.8567, 2.3522, 'https://www.wikidata.org/wiki/Q90', NULL, 'Q90', 'Europe/Paris', 'EUR', 'europa', true, 30)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('londres', 'locality', (SELECT id FROM public.prive_destinations WHERE slug = 'gb'), 'Londres', 'London', 'GB', 'Inglaterra', 51.5072, -0.1275, 'https://www.wikidata.org/wiki/Q84', NULL, 'Q84', 'Europe/London', 'GBP', 'europa', true, 40)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('milan', 'locality', (SELECT id FROM public.prive_destinations WHERE slug = 'it'), 'Milán', 'Milan', 'IT', 'Lombardía', 45.4669, 9.19, 'https://www.wikidata.org/wiki/Q490', NULL, 'Q490', 'Europe/Rome', 'EUR', 'europa', true, 50)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('roma', 'locality', (SELECT id FROM public.prive_destinations WHERE slug = 'it'), 'Roma', 'Rome', 'IT', 'Lacio', 41.8931, 12.4828, 'https://www.wikidata.org/wiki/Q220', NULL, 'Q220', 'Europe/Rome', 'EUR', 'europa', true, 60)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('florencia', 'locality', (SELECT id FROM public.prive_destinations WHERE slug = 'it'), 'Florencia', 'Florence', 'IT', 'Toscana', 43.7714, 11.2542, 'https://www.wikidata.org/wiki/Q2044', NULL, 'Q2044', 'Europe/Rome', 'EUR', 'europa', true, 70)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('venecia', 'locality', (SELECT id FROM public.prive_destinations WHERE slug = 'it'), 'Venecia', 'Venice', 'IT', 'Véneto', 45.4397, 12.3319, 'https://www.wikidata.org/wiki/Q641', NULL, 'Q641', 'Europe/Rome', 'EUR', 'europa', true, 80)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('capri', 'locality', (SELECT id FROM public.prive_destinations WHERE slug = 'it'), 'Capri', 'Capri', 'IT', 'Campania', 40.55, 14.2333, 'https://www.wikidata.org/wiki/Q173292', NULL, 'Q173292', 'Europe/Rome', 'EUR', 'europa', true, 90)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('costa-amalfitana', 'region', (SELECT id FROM public.prive_destinations WHERE slug = 'it'), 'Costa Amalfitana', 'Amalfi Coast', 'IT', 'Campania', 40.6333, 14.6, 'https://www.wikidata.org/wiki/Q212214', NULL, 'Q212214', 'Europe/Rome', 'EUR', 'europa', true, 100)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('lago-de-como', 'region', (SELECT id FROM public.prive_destinations WHERE slug = 'it'), 'Lago de Como', 'Lake Como', 'IT', 'Lombardía', 46, 9.2667, 'https://www.wikidata.org/wiki/Q15523', NULL, 'Q15523', 'Europe/Rome', 'EUR', 'europa', true, 110)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('saint-tropez', 'locality', (SELECT id FROM public.prive_destinations WHERE slug = 'fr'), 'Saint-Tropez', 'Saint-Tropez', 'FR', 'Provenza-Alpes-Costa Azul', 43.2697, 6.6386, 'https://www.wikidata.org/wiki/Q1813', NULL, 'Q1813', 'Europe/Paris', 'EUR', 'europa', true, 120)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('cannes', 'locality', (SELECT id FROM public.prive_destinations WHERE slug = 'fr'), 'Cannes', 'Cannes', 'FR', 'Provenza-Alpes-Costa Azul', 43.5525, 7.0214, 'https://www.wikidata.org/wiki/Q39984', NULL, 'Q39984', 'Europe/Paris', 'EUR', 'europa', true, 130)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('niza', 'locality', (SELECT id FROM public.prive_destinations WHERE slug = 'fr'), 'Niza', 'Nice', 'FR', 'Provenza-Alpes-Costa Azul', 43.7019, 7.2683, 'https://www.wikidata.org/wiki/Q33959', NULL, 'Q33959', 'Europe/Paris', 'EUR', 'europa', true, 140)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('courchevel', 'locality', (SELECT id FROM public.prive_destinations WHERE slug = 'fr'), 'Courchevel', 'Courchevel', 'FR', 'Auvernia-Ródano-Alpes', 45.415, 6.6339, 'https://www.wikidata.org/wiki/Q290817', NULL, 'Q290817', 'Europe/Paris', 'EUR', 'europa', true, 150)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('megeve', 'locality', (SELECT id FROM public.prive_destinations WHERE slug = 'fr'), 'Megève', 'Megève', 'FR', 'Auvernia-Ródano-Alpes', 45.8569, 6.6175, 'https://www.wikidata.org/wiki/Q259283', NULL, 'Q259283', 'Europe/Paris', 'EUR', 'europa', true, 160)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('gstaad', 'locality', (SELECT id FROM public.prive_destinations WHERE slug = 'ch'), 'Gstaad', 'Gstaad', 'CH', 'Berna', 46.4667, 7.2833, 'https://www.wikidata.org/wiki/Q37149', NULL, 'Q37149', 'Europe/Zurich', 'CHF', 'europa', true, 170)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('st-moritz', 'locality', (SELECT id FROM public.prive_destinations WHERE slug = 'ch'), 'St. Moritz', 'St. Moritz', 'CH', 'Grisones', 46.4972, 9.8378, 'https://www.wikidata.org/wiki/Q68986', NULL, 'Q68986', 'Europe/Zurich', 'CHF', 'europa', true, 180)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('zurich', 'locality', (SELECT id FROM public.prive_destinations WHERE slug = 'ch'), 'Zúrich', 'Zurich', 'CH', 'Zúrich', 47.3744, 8.5411, 'https://www.wikidata.org/wiki/Q72', NULL, 'Q72', 'Europe/Zurich', 'CHF', 'europa', true, 190)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('ginebra', 'locality', (SELECT id FROM public.prive_destinations WHERE slug = 'ch'), 'Ginebra', 'Geneva', 'CH', 'Ginebra', 46.2, 6.15, 'https://www.wikidata.org/wiki/Q71', NULL, 'Q71', 'Europe/Zurich', 'CHF', 'europa', true, 200)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('madrid', 'locality', (SELECT id FROM public.prive_destinations WHERE slug = 'es'), 'Madrid', 'Madrid', 'ES', 'Comunidad de Madrid', 40.4169, -3.7033, 'https://www.wikidata.org/wiki/Q2807', NULL, 'Q2807', 'Europe/Madrid', 'EUR', 'europa', true, 210)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('barcelona', 'locality', (SELECT id FROM public.prive_destinations WHERE slug = 'es'), 'Barcelona', 'Barcelona', 'ES', 'Cataluña', 41.3825, 2.1769, 'https://www.wikidata.org/wiki/Q1492', NULL, 'Q1492', 'Europe/Madrid', 'EUR', 'europa', true, 220)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('marbella', 'locality', (SELECT id FROM public.prive_destinations WHERE slug = 'es'), 'Marbella', 'Marbella', 'ES', 'Andalucía', 36.5114, -4.8834, 'https://www.wikidata.org/wiki/Q484799', NULL, 'Q484799', 'Europe/Madrid', 'EUR', 'europa', true, 230)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('ibiza', 'locality', (SELECT id FROM public.prive_destinations WHERE slug = 'es'), 'Ibiza', 'Ibiza', 'ES', 'Islas Baleares', 38.98, 1.43, 'https://www.wikidata.org/wiki/Q52631', NULL, 'Q52631', 'Europe/Madrid', 'EUR', 'europa', true, 240)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('formentera', 'locality', (SELECT id FROM public.prive_destinations WHERE slug = 'es'), 'Formentera', 'Formentera', 'ES', 'Islas Baleares', 38.7, 1.45, 'https://www.wikidata.org/wiki/Q52626', NULL, 'Q52626', 'Europe/Madrid', 'EUR', 'europa', true, 250)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('mallorca', 'locality', (SELECT id FROM public.prive_destinations WHERE slug = 'es'), 'Mallorca', 'Mallorca', 'ES', 'Islas Baleares', 39.6167, 2.9833, 'https://www.wikidata.org/wiki/Q8828', NULL, 'Q8828', 'Europe/Madrid', 'EUR', 'europa', true, 260)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('mykonos', 'locality', (SELECT id FROM public.prive_destinations WHERE slug = 'gr'), 'Mykonos', 'Mykonos', 'GR', 'Egeo Meridional', 37.446, 25.3286, 'https://www.wikidata.org/wiki/Q190210', NULL, 'Q190210', 'Europe/Athens', 'EUR', 'europa', true, 270)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('santorini', 'locality', (SELECT id FROM public.prive_destinations WHERE slug = 'gr'), 'Santorini', 'Santorini', 'GR', 'Egeo Meridional', 36.415, 25.4325, 'https://www.wikidata.org/wiki/Q129296', NULL, 'Q129296', 'Europe/Athens', 'EUR', 'europa', true, 280)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('atenas', 'locality', (SELECT id FROM public.prive_destinations WHERE slug = 'gr'), 'Atenas', 'Athens', 'GR', 'Ática', 37.9842, 23.7281, 'https://www.wikidata.org/wiki/Q1524', NULL, 'Q1524', 'Europe/Athens', 'EUR', 'europa', true, 290)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('viena', 'locality', (SELECT id FROM public.prive_destinations WHERE slug = 'at'), 'Viena', 'Vienna', 'AT', 'Viena', 48.2083, 16.3725, 'https://www.wikidata.org/wiki/Q1741', NULL, 'Q1741', 'Europe/Vienna', 'EUR', 'europa', true, 300)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('berlin', 'locality', (SELECT id FROM public.prive_destinations WHERE slug = 'de'), 'Berlín', 'Berlin', 'DE', 'Berlín', 52.5167, 13.3833, 'https://www.wikidata.org/wiki/Q64', NULL, 'Q64', 'Europe/Berlin', 'EUR', 'europa', true, 310)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('amsterdam', 'locality', (SELECT id FROM public.prive_destinations WHERE slug = 'nl'), 'Ámsterdam', 'Amsterdam', 'NL', 'Holanda Septentrional', 52.3667, 4.8833, 'https://www.wikidata.org/wiki/Q727', NULL, 'Q727', 'Europe/Amsterdam', 'EUR', 'europa', true, 320)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('lisboa', 'locality', (SELECT id FROM public.prive_destinations WHERE slug = 'pt'), 'Lisboa', 'Lisbon', 'PT', 'Lisboa', 38.708, -9.139, 'https://www.wikidata.org/wiki/Q597', NULL, 'Q597', 'Europe/Lisbon', 'EUR', 'europa', true, 330)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('porto', 'locality', (SELECT id FROM public.prive_destinations WHERE slug = 'pt'), 'Porto', 'Porto', 'PT', 'Norte', 41.15, -8.6108, 'https://www.wikidata.org/wiki/Q36433', NULL, 'Q36433', 'Europe/Lisbon', 'EUR', 'europa', true, 340)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('nueva-york', 'locality', (SELECT id FROM public.prive_destinations WHERE slug = 'us'), 'Nueva York', 'New York', 'US', 'Nueva York', 40.7128, -74.0061, 'https://www.wikidata.org/wiki/Q60', NULL, 'Q60', 'America/New_York', 'USD', 'norteamerica', true, 350)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('miami', 'locality', (SELECT id FROM public.prive_destinations WHERE slug = 'us'), 'Miami', 'Miami', 'US', 'Florida', 25.7742, -80.1936, 'https://www.wikidata.org/wiki/Q8652', NULL, 'Q8652', 'America/New_York', 'USD', 'norteamerica', true, 360)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('miami-beach', 'locality', (SELECT id FROM public.prive_destinations WHERE slug = 'us'), 'Miami Beach', 'Miami Beach', 'US', 'Florida', 25.8139, -80.1325, 'https://www.wikidata.org/wiki/Q201516', NULL, 'Q201516', 'America/New_York', 'USD', 'norteamerica', true, 370)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('los-angeles', 'locality', (SELECT id FROM public.prive_destinations WHERE slug = 'us'), 'Los Ángeles', 'Los Angeles', 'US', 'California', 34.0522, -118.2437, 'https://www.wikidata.org/wiki/Q65', NULL, 'Q65', 'America/Los_Angeles', 'USD', 'norteamerica', true, 380)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('beverly-hills', 'locality', (SELECT id FROM public.prive_destinations WHERE slug = 'us'), 'Beverly Hills', 'Beverly Hills', 'US', 'California', 34.0731, -118.3994, 'https://www.wikidata.org/wiki/Q127856', NULL, 'Q127856', 'America/Los_Angeles', 'USD', 'norteamerica', true, 390)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('malibu', 'locality', (SELECT id FROM public.prive_destinations WHERE slug = 'us'), 'Malibu', 'Malibu', 'US', 'California', 34.035, -118.695, 'https://www.wikidata.org/wiki/Q387047', NULL, 'Q387047', 'America/Los_Angeles', 'USD', 'norteamerica', true, 400)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('las-vegas', 'locality', (SELECT id FROM public.prive_destinations WHERE slug = 'us'), 'Las Vegas', 'Las Vegas', 'US', 'Nevada', 36.1672, -115.1486, 'https://www.wikidata.org/wiki/Q23768', NULL, 'Q23768', 'America/Los_Angeles', 'USD', 'norteamerica', true, 410)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('aspen', 'locality', (SELECT id FROM public.prive_destinations WHERE slug = 'us'), 'Aspen', 'Aspen', 'US', 'Colorado', 39.1922, -106.8244, 'https://www.wikidata.org/wiki/Q205842', NULL, 'Q205842', 'America/Denver', 'USD', 'norteamerica', true, 420)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('vail', 'locality', (SELECT id FROM public.prive_destinations WHERE slug = 'us'), 'Vail', 'Vail', 'US', 'Colorado', 39.6358, -106.3631, 'https://www.wikidata.org/wiki/Q747987', NULL, 'Q747987', 'America/Denver', 'USD', 'norteamerica', true, 430)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('jackson-hole', 'region', (SELECT id FROM public.prive_destinations WHERE slug = 'us'), 'Jackson Hole', 'Jackson Hole', 'US', 'Wyoming', 43.5167, -110.8333, 'https://www.wikidata.org/wiki/Q1677361', NULL, 'Q1677361', 'America/Denver', 'USD', 'norteamerica', true, 440)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('napa-valley', 'region', (SELECT id FROM public.prive_destinations WHERE slug = 'us'), 'Napa Valley', 'Napa Valley', 'US', 'California', 38.5, -122.32, 'https://www.wikidata.org/wiki/Q6159125', NULL, 'Q6159125', 'America/Los_Angeles', 'USD', 'norteamerica', true, 450)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('san-francisco', 'locality', (SELECT id FROM public.prive_destinations WHERE slug = 'us'), 'San Francisco', 'San Francisco', 'US', 'California', 37.7775, -122.4164, 'https://www.wikidata.org/wiki/Q62', NULL, 'Q62', 'America/Los_Angeles', 'USD', 'norteamerica', true, 460)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('chicago', 'locality', (SELECT id FROM public.prive_destinations WHERE slug = 'us'), 'Chicago', 'Chicago', 'US', 'Illinois', 41.8819, -87.6278, 'https://www.wikidata.org/wiki/Q1297', NULL, 'Q1297', 'America/Chicago', 'USD', 'norteamerica', true, 470)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('boston', 'locality', (SELECT id FROM public.prive_destinations WHERE slug = 'us'), 'Boston', 'Boston', 'US', 'Massachusetts', 42.3603, -71.0578, 'https://www.wikidata.org/wiki/Q100', NULL, 'Q100', 'America/New_York', 'USD', 'norteamerica', true, 480)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('palm-beach', 'locality', (SELECT id FROM public.prive_destinations WHERE slug = 'us'), 'Palm Beach', 'Palm Beach', 'US', 'Florida', 26.7056, -80.0364, 'https://www.wikidata.org/wiki/Q695411', NULL, 'Q695411', 'America/New_York', 'USD', 'norteamerica', true, 490)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('hamptons', 'region', (SELECT id FROM public.prive_destinations WHERE slug = 'us'), 'Hamptons', 'The Hamptons', 'US', 'Nueva York', 40.8849, -72.5011, 'https://www.wikidata.org/wiki/Q1574020', NULL, 'Q1574020', 'America/New_York', 'USD', 'norteamerica', true, 500)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('toronto', 'locality', (SELECT id FROM public.prive_destinations WHERE slug = 'ca'), 'Toronto', 'Toronto', 'CA', 'Ontario', 43.6703, -79.3867, 'https://www.wikidata.org/wiki/Q172', NULL, 'Q172', 'America/Toronto', 'CAD', 'norteamerica', true, 510)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('vancouver', 'locality', (SELECT id FROM public.prive_destinations WHERE slug = 'ca'), 'Vancouver', 'Vancouver', 'CA', 'Columbia Británica', 49.2608, -123.1139, 'https://www.wikidata.org/wiki/Q24639', NULL, 'Q24639', 'America/Vancouver', 'CAD', 'norteamerica', true, 520)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('whistler', 'locality', (SELECT id FROM public.prive_destinations WHERE slug = 'ca'), 'Whistler', 'Whistler', 'CA', 'Columbia Británica', 50.1208, -122.9544, 'https://www.wikidata.org/wiki/Q203122', NULL, 'Q203122', 'America/Vancouver', 'CAD', 'norteamerica', true, 530)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('montreal', 'locality', (SELECT id FROM public.prive_destinations WHERE slug = 'ca'), 'Montreal', 'Montreal', 'CA', 'Quebec', 45.5033, -73.5868, 'https://www.wikidata.org/wiki/Q340', NULL, 'Q340', 'America/Toronto', 'CAD', 'norteamerica', true, 540)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('cdmx', 'locality', (SELECT id FROM public.prive_destinations WHERE slug = 'mx'), 'Ciudad de México', 'Mexico City', 'MX', 'Ciudad de México', 19.3538, -99.1359, 'https://www.wikidata.org/wiki/Q1489', NULL, 'Q1489', 'America/Mexico_City', 'MXN', 'mexico', true, 550)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('interlomas', 'locality', (SELECT id FROM public.prive_destinations WHERE slug = 'mx'), 'Interlomas', 'Interlomas', 'MX', 'Estado de México (Huixquilucan)', NULL, NULL, NULL, 'Wikidata da 19.2299,-99.2816, que cae al sur de la CDMX y no coincide con Interlomas (Huixquilucan, al poniente). No se pudo verificar con una segunda fuente: queda sin coordenada.', 'Q5918995', 'America/Mexico_City', 'MXN', 'mexico', true, 580)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('valle-de-bravo', 'locality', (SELECT id FROM public.prive_destinations WHERE slug = 'mx'), 'Valle de Bravo', 'Valle de Bravo', 'MX', 'Estado de México', 19.1925, -100.1306, 'https://www.wikidata.org/wiki/Q3058725', NULL, 'Q3058725', 'America/Mexico_City', 'MXN', 'mexico', true, 590)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('san-miguel-de-allende', 'locality', (SELECT id FROM public.prive_destinations WHERE slug = 'mx'), 'San Miguel de Allende', 'San Miguel de Allende', 'MX', 'Guanajuato', 20.9153, -100.7439, 'https://www.wikidata.org/wiki/Q753891', NULL, 'Q753891', 'America/Mexico_City', 'MXN', 'mexico', true, 600)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('guadalajara', 'locality', (SELECT id FROM public.prive_destinations WHERE slug = 'mx'), 'Guadalajara', 'Guadalajara', 'MX', 'Jalisco', 20.6764, -103.3422, 'https://www.wikidata.org/wiki/Q9022', NULL, 'Q9022', 'America/Mexico_City', 'MXN', 'mexico', true, 610)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('puerto-vallarta', 'locality', (SELECT id FROM public.prive_destinations WHERE slug = 'mx'), 'Puerto Vallarta', 'Puerto Vallarta', 'MX', 'Jalisco', 20.6413, -105.2233, 'https://www.wikidata.org/wiki/Q853258', NULL, 'Q853258', 'America/Mexico_City', 'MXN', 'mexico', true, 620)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('riviera-nayarit', 'region', (SELECT id FROM public.prive_destinations WHERE slug = 'mx'), 'Riviera Nayarit', 'Riviera Nayarit', 'MX', 'Nayarit', NULL, NULL, NULL, 'Wikidata no tiene coordenada (P625) para este elemento', 'Q7338874', 'America/Mexico_City', 'MXN', 'mexico', true, 640)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('los-cabos', 'region', (SELECT id FROM public.prive_destinations WHERE slug = 'mx'), 'Los Cabos', 'Los Cabos', 'MX', 'Baja California Sur', 23.2667, -109.7667, 'https://www.wikidata.org/wiki/Q659516', NULL, 'Q659516', 'America/Mazatlan', 'MXN', 'mexico', true, 650)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('todos-santos', 'locality', (SELECT id FROM public.prive_destinations WHERE slug = 'mx'), 'Todos Santos', 'Todos Santos', 'MX', 'Baja California Sur', 23.4469, -110.2231, 'https://www.wikidata.org/wiki/Q1658489', NULL, 'Q1658489', 'America/Mazatlan', 'MXN', 'mexico', true, 670)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('cancun', 'locality', (SELECT id FROM public.prive_destinations WHERE slug = 'mx'), 'Cancún', 'Cancún', 'MX', 'Quintana Roo', 21.1614, -86.8248, 'https://www.wikidata.org/wiki/Q8969', NULL, 'Q8969', 'America/Cancun', 'MXN', 'mexico', true, 680)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('riviera-maya', 'region', (SELECT id FROM public.prive_destinations WHERE slug = 'mx'), 'Riviera Maya', 'Riviera Maya', 'MX', 'Quintana Roo', 20.6314, -87.0731, 'https://www.wikidata.org/wiki/Q2061038', NULL, 'Q2061038', 'America/Cancun', 'MXN', 'mexico', true, 690)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('tulum', 'locality', (SELECT id FROM public.prive_destinations WHERE slug = 'mx'), 'Tulum', 'Tulum', 'MX', 'Quintana Roo', 20.2147, -87.4289, 'https://www.wikidata.org/wiki/Q725883', NULL, 'Q725883', 'America/Cancun', 'MXN', 'mexico', true, 700)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('merida', 'locality', (SELECT id FROM public.prive_destinations WHERE slug = 'mx'), 'Mérida', 'Mérida', 'MX', 'Yucatán', 20.97, -89.62, 'https://www.wikidata.org/wiki/Q165204', NULL, 'Q165204', 'America/Merida', 'MXN', 'mexico', true, 710)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('oaxaca', 'locality', (SELECT id FROM public.prive_destinations WHERE slug = 'mx'), 'Oaxaca', 'Oaxaca', 'MX', 'Oaxaca', 17.0606, -96.7253, 'https://www.wikidata.org/wiki/Q131429', NULL, 'Q131429', 'America/Mexico_City', 'MXN', 'mexico', true, 720)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('valle-de-guadalupe', 'region', (SELECT id FROM public.prive_destinations WHERE slug = 'mx'), 'Valle de Guadalupe', 'Valle de Guadalupe', 'MX', 'Baja California', 32.0978, -116.5669, 'https://www.wikidata.org/wiki/Q834310', NULL, 'Q834310', 'America/Tijuana', 'MXN', 'mexico', true, 730)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('puebla', 'locality', (SELECT id FROM public.prive_destinations WHERE slug = 'mx'), 'Puebla', 'Puebla', 'MX', 'Puebla', 19.0514, -98.2178, 'https://www.wikidata.org/wiki/Q125293', NULL, 'Q125293', 'America/Mexico_City', 'MXN', 'mexico', true, 740)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('queretaro', 'locality', (SELECT id FROM public.prive_destinations WHERE slug = 'mx'), 'Querétaro', 'Querétaro', 'MX', 'Querétaro', 20.5881, -100.3881, 'https://www.wikidata.org/wiki/Q173121', NULL, 'Q173121', 'America/Mexico_City', 'MXN', 'mexico', true, 750)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('monterrey', 'locality', (SELECT id FROM public.prive_destinations WHERE slug = 'mx'), 'Monterrey', 'Monterrey', 'MX', 'Nuevo León', 25.6844, -100.3181, 'https://www.wikidata.org/wiki/Q81033', NULL, 'Q81033', 'America/Monterrey', 'MXN', 'mexico', true, 760)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('dubai', 'locality', (SELECT id FROM public.prive_destinations WHERE slug = 'ae'), 'Dubái', 'Dubai', 'AE', 'Dubái', 25.2697, 55.3094, 'https://www.wikidata.org/wiki/Q612', NULL, 'Q612', 'Asia/Dubai', 'AED', 'medio_oriente', true, 770)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('abu-dabi', 'locality', (SELECT id FROM public.prive_destinations WHERE slug = 'ae'), 'Abu Dabi', 'Abu Dhabi', 'AE', 'Abu Dabi', 24.4511, 54.3969, 'https://www.wikidata.org/wiki/Q1519', NULL, 'Q1519', 'Asia/Dubai', 'AED', 'medio_oriente', true, 780)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('doha', 'locality', (SELECT id FROM public.prive_destinations WHERE slug = 'qa'), 'Doha', 'Doha', 'QA', 'Doha', 25.2861, 51.5294, 'https://www.wikidata.org/wiki/Q3861', NULL, 'Q3861', 'Asia/Qatar', 'QAR', 'medio_oriente', true, 790)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('riad', 'locality', (SELECT id FROM public.prive_destinations WHERE slug = 'sa'), 'Riad', 'Riyadh', 'SA', 'Riad', 24.6383, 46.715, 'https://www.wikidata.org/wiki/Q3692', NULL, 'Q3692', 'Asia/Riyadh', 'SAR', 'medio_oriente', true, 800)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('mascate', 'locality', (SELECT id FROM public.prive_destinations WHERE slug = 'om'), 'Mascate', 'Muscat', 'OM', 'Mascate', 23.6139, 58.5922, 'https://www.wikidata.org/wiki/Q3826', NULL, 'Q3826', 'Asia/Muscat', 'OMR', 'medio_oriente', true, 820)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('tokio', 'locality', (SELECT id FROM public.prive_destinations WHERE slug = 'jp'), 'Tokio', 'Tokyo', 'JP', 'Tokio', 35.6894, 139.6917, 'https://www.wikidata.org/wiki/Q1490', NULL, 'Q1490', 'Asia/Tokyo', 'JPY', 'asia_oceania', true, 830)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('kioto', 'locality', (SELECT id FROM public.prive_destinations WHERE slug = 'jp'), 'Kioto', 'Kyoto', 'JP', 'Kioto', 35.0116, 135.7681, 'https://www.wikidata.org/wiki/Q34600', NULL, 'Q34600', 'Asia/Tokyo', 'JPY', 'asia_oceania', true, 840)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('osaka', 'locality', (SELECT id FROM public.prive_destinations WHERE slug = 'jp'), 'Osaka', 'Osaka', 'JP', 'Osaka', 34.6938, 135.5021, 'https://www.wikidata.org/wiki/Q35765', NULL, 'Q35765', 'Asia/Tokyo', 'JPY', 'asia_oceania', true, 850)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('seul', 'locality', (SELECT id FROM public.prive_destinations WHERE slug = 'kr'), 'Seúl', 'Seoul', 'KR', 'Seúl', 37.56, 126.99, 'https://www.wikidata.org/wiki/Q8684', NULL, 'Q8684', 'Asia/Seoul', 'KRW', 'asia_oceania', true, 880)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('bangkok', 'locality', (SELECT id FROM public.prive_destinations WHERE slug = 'th'), 'Bangkok', 'Bangkok', 'TH', 'Bangkok', 13.75, 100.5167, 'https://www.wikidata.org/wiki/Q1861', NULL, 'Q1861', 'Asia/Bangkok', 'THB', 'asia_oceania', true, 890)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('phuket', 'region', (SELECT id FROM public.prive_destinations WHERE slug = 'th'), 'Phuket', 'Phuket', 'TH', 'Phuket', 7.89, 98.3983, 'https://www.wikidata.org/wiki/Q182565', NULL, 'Q182565', 'Asia/Bangkok', 'THB', 'asia_oceania', true, 900)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('bali', 'region', (SELECT id FROM public.prive_destinations WHERE slug = 'id'), 'Bali', 'Bali', 'ID', 'Bali', -8.5, 115, 'https://www.wikidata.org/wiki/Q3125978', NULL, 'Q3125978', 'Asia/Makassar', 'IDR', 'asia_oceania', true, 910)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('yakarta', 'locality', (SELECT id FROM public.prive_destinations WHERE slug = 'id'), 'Yakarta', 'Jakarta', 'ID', 'Yakarta', -6.1753, 106.8269, 'https://www.wikidata.org/wiki/Q3630', NULL, 'Q3630', 'Asia/Jakarta', 'IDR', 'asia_oceania', true, 920)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('sidney', 'locality', (SELECT id FROM public.prive_destinations WHERE slug = 'au'), 'Sídney', 'Sydney', 'AU', 'Nueva Gales del Sur', -33.8678, 151.21, 'https://www.wikidata.org/wiki/Q3130', NULL, 'Q3130', 'Australia/Sydney', 'AUD', 'asia_oceania', true, 930)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('melbourne', 'locality', (SELECT id FROM public.prive_destinations WHERE slug = 'au'), 'Melbourne', 'Melbourne', 'AU', 'Victoria', -37.8142, 144.9631, 'https://www.wikidata.org/wiki/Q3141', NULL, 'Q3141', 'Australia/Melbourne', 'AUD', 'asia_oceania', true, 940)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('queenstown', 'locality', (SELECT id FROM public.prive_destinations WHERE slug = 'nz'), 'Queenstown', 'Queenstown', 'NZ', 'Otago', -45.0311, 168.6625, 'https://www.wikidata.org/wiki/Q613602', NULL, 'Q613602', 'Pacific/Auckland', 'NZD', 'asia_oceania', true, 950)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('cartagena', 'locality', (SELECT id FROM public.prive_destinations WHERE slug = 'co'), 'Cartagena', 'Cartagena', 'CO', 'Bolívar', 10.4236, -75.5253, 'https://www.wikidata.org/wiki/Q657461', NULL, 'Q657461', 'America/Bogota', 'COP', 'otras_regiones', true, 960)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('bogota', 'locality', (SELECT id FROM public.prive_destinations WHERE slug = 'co'), 'Bogotá', 'Bogotá', 'CO', 'Bogotá D. C.', 4.6097, -74.0817, 'https://www.wikidata.org/wiki/Q2841', NULL, 'Q2841', 'America/Bogota', 'COP', 'otras_regiones', true, 970)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('medellin', 'locality', (SELECT id FROM public.prive_destinations WHERE slug = 'co'), 'Medellín', 'Medellín', 'CO', 'Antioquia', 6.2502, -75.5676, 'https://www.wikidata.org/wiki/Q48278', NULL, 'Q48278', 'America/Bogota', 'COP', 'otras_regiones', true, 980)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('buenos-aires', 'locality', (SELECT id FROM public.prive_destinations WHERE slug = 'ar'), 'Buenos Aires', 'Buenos Aires', 'AR', 'CABA', -34.5997, -58.3819, 'https://www.wikidata.org/wiki/Q1486', NULL, 'Q1486', 'America/Argentina/Buenos_Aires', 'ARS', 'otras_regiones', true, 990)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('mendoza', 'locality', (SELECT id FROM public.prive_destinations WHERE slug = 'ar'), 'Mendoza', 'Mendoza', 'AR', 'Mendoza', -32.8897, -68.8444, 'https://www.wikidata.org/wiki/Q44237', NULL, 'Q44237', 'America/Argentina/Mendoza', 'ARS', 'otras_regiones', true, 1000)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('punta-del-este', 'locality', (SELECT id FROM public.prive_destinations WHERE slug = 'uy'), 'Punta del Este', 'Punta del Este', 'UY', 'Maldonado', -34.9557, -54.9381, 'https://www.wikidata.org/wiki/Q56069', NULL, 'Q56069', 'America/Montevideo', 'UYU', 'otras_regiones', true, 1010)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('rio-de-janeiro', 'locality', (SELECT id FROM public.prive_destinations WHERE slug = 'br'), 'Río de Janeiro', 'Rio de Janeiro', 'BR', 'Río de Janeiro', -22.9111, -43.2056, 'https://www.wikidata.org/wiki/Q8678', NULL, 'Q8678', 'America/Sao_Paulo', 'BRL', 'otras_regiones', true, 1020)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('sao-paulo', 'locality', (SELECT id FROM public.prive_destinations WHERE slug = 'br'), 'São Paulo', 'São Paulo', 'BR', 'São Paulo', -23.5504, -46.6339, 'https://www.wikidata.org/wiki/Q174', NULL, 'Q174', 'America/Sao_Paulo', 'BRL', 'otras_regiones', true, 1030)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('lima', 'locality', (SELECT id FROM public.prive_destinations WHERE slug = 'pe'), 'Lima', 'Lima', 'PE', 'Lima', -12.06, -77.0375, 'https://www.wikidata.org/wiki/Q2868', NULL, 'Q2868', 'America/Lima', 'PEN', 'otras_regiones', true, 1040)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('cusco', 'locality', (SELECT id FROM public.prive_destinations WHERE slug = 'pe'), 'Cusco', 'Cusco', 'PE', 'Cusco', -13.5169, -71.9786, 'https://www.wikidata.org/wiki/Q5582862', NULL, 'Q5582862', 'America/Lima', 'PEN', 'otras_regiones', true, 1050)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('marrakech', 'locality', (SELECT id FROM public.prive_destinations WHERE slug = 'ma'), 'Marrakech', 'Marrakesh', 'MA', 'Marrakech-Safí', 31.6295, -7.9811, 'https://www.wikidata.org/wiki/Q101625', NULL, 'Q101625', 'Africa/Casablanca', 'MAD', 'otras_regiones', true, 1060)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('ciudad-del-cabo', 'locality', (SELECT id FROM public.prive_destinations WHERE slug = 'za'), 'Ciudad del Cabo', 'Cape Town', 'ZA', 'Cabo Occidental', -33.9253, 18.4239, 'https://www.wikidata.org/wiki/Q5465', NULL, 'Q5465', 'Africa/Johannesburg', 'ZAR', 'otras_regiones', true, 1070)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('bora-bora', 'locality', (SELECT id FROM public.prive_destinations WHERE slug = 'pf'), 'Bora Bora', 'Bora Bora', 'PF', 'Islas de Sotavento', -16.498, -151.736, 'https://www.wikidata.org/wiki/Q183113', NULL, 'Q183113', 'Pacific/Tahiti', 'XPF', 'otras_regiones', true, 1110)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('area-cdmx', 'area', (SELECT id FROM public.prive_destinations WHERE slug = 'mx'), 'Área metropolitana de Ciudad de México', 'Mexico City metropolitan area', 'MX', 'CDMX y Estado de México', NULL, NULL, NULL, 'Área: agrupa destinos, sin coordenada propia', NULL, 'America/Mexico_City', 'MXN', 'mexico', false, 5000)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('area-los-angeles', 'area', (SELECT id FROM public.prive_destinations WHERE slug = 'us'), 'Área de Los Ángeles', 'Los Angeles area', 'US', 'California', NULL, NULL, NULL, 'Área: agrupa destinos, sin coordenada propia', NULL, 'America/New_York', 'USD', 'norteamerica', false, 5000)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('area-miami', 'area', (SELECT id FROM public.prive_destinations WHERE slug = 'us'), 'Área de Miami', 'Miami area', 'US', 'Florida', NULL, NULL, NULL, 'Área: agrupa destinos, sin coordenada propia', NULL, 'America/New_York', 'USD', 'norteamerica', false, 5000)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('cdmx-polanco', 'neighborhood', (SELECT id FROM public.prive_destinations WHERE slug = 'cdmx'), 'Polanco', 'Polanco', 'MX', 'Ciudad de México', 19.4333, -99.2, 'https://www.wikidata.org/wiki/Q785318', NULL, 'Q785318', 'America/Mexico_City', 'MXN', 'mexico', true, 560)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('cdmx-roma-condesa', 'neighborhood', (SELECT id FROM public.prive_destinations WHERE slug = 'cdmx'), 'Roma-Condesa', 'Roma-Condesa', 'MX', 'Ciudad de México', NULL, NULL, NULL, 'Barrio compuesto (Roma Norte y Condesa): sin coordenada única verificable.', NULL, 'America/Mexico_City', 'MXN', 'mexico', true, 570)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('punta-mita', 'locality', (SELECT id FROM public.prive_destinations WHERE slug = 'riviera-nayarit'), 'Punta Mita', 'Punta Mita', 'MX', 'Nayarit', 20.7752, -105.527, 'https://www.wikidata.org/wiki/Q7260546', NULL, 'Q7260546', 'America/Mexico_City', 'MXN', 'mexico', true, 630)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;
INSERT INTO public.prive_destinations (slug, kind, parent_id, name_es, name_en, iso_country, admin_area, lat, lng, coord_source, coord_note, wikidata_qid, timezone, currency, region_group, is_destination, sort_order)
VALUES ('san-jose-del-cabo', 'locality', (SELECT id FROM public.prive_destinations WHERE slug = 'los-cabos'), 'San José del Cabo', 'San José del Cabo', 'MX', 'Baja California Sur', 23.0617, -109.7114, 'https://www.wikidata.org/wiki/Q2088134', NULL, 'Q2088134', 'America/Mazatlan', 'MXN', 'mexico', true, 660)
ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
  iso_country = EXCLUDED.iso_country, admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = EXCLUDED.coord_source,
  coord_note = EXCLUDED.coord_note, wikidata_qid = EXCLUDED.wikidata_qid, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency,
  region_group = EXCLUDED.region_group, is_destination = EXCLUDED.is_destination, sort_order = EXCLUDED.sort_order;

-- Sobrenombres: cada uno apunta a un solo destino (alias_norm es la llave primaria).
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'abu dabi', id FROM public.prive_destinations WHERE slug = 'abu-dabi'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'abu dhabi', id FROM public.prive_destinations WHERE slug = 'abu-dabi'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'abudabi', id FROM public.prive_destinations WHERE slug = 'abu-dabi'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'akumal', id FROM public.prive_destinations WHERE slug = 'riviera-maya'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'amalfi', id FROM public.prive_destinations WHERE slug = 'costa-amalfitana'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'amalfi coast', id FROM public.prive_destinations WHERE slug = 'costa-amalfitana'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'amsterdam', id FROM public.prive_destinations WHERE slug = 'amsterdam'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'area cdmx', id FROM public.prive_destinations WHERE slug = 'area-cdmx'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'area de los angeles', id FROM public.prive_destinations WHERE slug = 'area-los-angeles'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'area de miami', id FROM public.prive_destinations WHERE slug = 'area-miami'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'area los angeles', id FROM public.prive_destinations WHERE slug = 'area-los-angeles'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'area metropolitana de ciudad de mexico', id FROM public.prive_destinations WHERE slug = 'area-cdmx'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'area miami', id FROM public.prive_destinations WHERE slug = 'area-miami'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'aspen', id FROM public.prive_destinations WHERE slug = 'aspen'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'atenas', id FROM public.prive_destinations WHERE slug = 'atenas'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'athens', id FROM public.prive_destinations WHERE slug = 'atenas'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'bahia de banderas', id FROM public.prive_destinations WHERE slug = 'riviera-nayarit'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'bali', id FROM public.prive_destinations WHERE slug = 'bali'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'bangkok', id FROM public.prive_destinations WHERE slug = 'bangkok'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'barcelona', id FROM public.prive_destinations WHERE slug = 'barcelona'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'bellagio italia', id FROM public.prive_destinations WHERE slug = 'lago-de-como'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'berlin', id FROM public.prive_destinations WHERE slug = 'berlin'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'beverly hills', id FROM public.prive_destinations WHERE slug = 'beverly-hills'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'bogota', id FROM public.prive_destinations WHERE slug = 'bogota'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'bora bora', id FROM public.prive_destinations WHERE slug = 'bora-bora'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'boston', id FROM public.prive_destinations WHERE slug = 'boston'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'bsas', id FROM public.prive_destinations WHERE slug = 'buenos-aires'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'buenos aires', id FROM public.prive_destinations WHERE slug = 'buenos-aires'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'caba', id FROM public.prive_destinations WHERE slug = 'buenos-aires'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'cabo', id FROM public.prive_destinations WHERE slug = 'los-cabos'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'cabo san lucas', id FROM public.prive_destinations WHERE slug = 'los-cabos'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'cancun', id FROM public.prive_destinations WHERE slug = 'cancun'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'cannes', id FROM public.prive_destinations WHERE slug = 'cannes'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'cape town', id FROM public.prive_destinations WHERE slug = 'ciudad-del-cabo'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'capri', id FROM public.prive_destinations WHERE slug = 'capri'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'cartagena', id FROM public.prive_destinations WHERE slug = 'cartagena'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'cartagena de indias', id FROM public.prive_destinations WHERE slug = 'cartagena'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'cdmx', id FROM public.prive_destinations WHERE slug = 'cdmx'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'cdmx polanco', id FROM public.prive_destinations WHERE slug = 'cdmx-polanco'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'cdmx roma condesa', id FROM public.prive_destinations WHERE slug = 'cdmx-roma-condesa'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'cernobbio', id FROM public.prive_destinations WHERE slug = 'lago-de-como'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'chicago', id FROM public.prive_destinations WHERE slug = 'chicago'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'ciudad de mexico', id FROM public.prive_destinations WHERE slug = 'cdmx'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'ciudad de nueva york', id FROM public.prive_destinations WHERE slug = 'nueva-york'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'ciudad del cabo', id FROM public.prive_destinations WHERE slug = 'ciudad-del-cabo'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'colonia condesa', id FROM public.prive_destinations WHERE slug = 'cdmx-roma-condesa'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'colonia roma', id FROM public.prive_destinations WHERE slug = 'cdmx-roma-condesa'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'condesa', id FROM public.prive_destinations WHERE slug = 'cdmx-roma-condesa'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'corredor turistico los cabos', id FROM public.prive_destinations WHERE slug = 'los-cabos'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'costa amalfitana', id FROM public.prive_destinations WHERE slug = 'costa-amalfitana'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'costiera amalfitana', id FROM public.prive_destinations WHERE slug = 'costa-amalfitana'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'courchevel', id FROM public.prive_destinations WHERE slug = 'courchevel'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'cusco', id FROM public.prive_destinations WHERE slug = 'cusco'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'cuzco', id FROM public.prive_destinations WHERE slug = 'cusco'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'destinos destacados de oman', id FROM public.prive_destinations WHERE slug = 'om'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'df', id FROM public.prive_destinations WHERE slug = 'cdmx'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'distrito federal', id FROM public.prive_destinations WHERE slug = 'cdmx'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'doha', id FROM public.prive_destinations WHERE slug = 'doha'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'dubai', id FROM public.prive_destinations WHERE slug = 'dubai'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'eivissa', id FROM public.prive_destinations WHERE slug = 'ibiza'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'firenze', id FROM public.prive_destinations WHERE slug = 'florencia'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'florence', id FROM public.prive_destinations WHERE slug = 'florencia'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'florencia', id FROM public.prive_destinations WHERE slug = 'florencia'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'formentera', id FROM public.prive_destinations WHERE slug = 'formentera'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'gdl', id FROM public.prive_destinations WHERE slug = 'guadalajara'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'geneva', id FROM public.prive_destinations WHERE slug = 'ginebra'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'geneve', id FROM public.prive_destinations WHERE slug = 'ginebra'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'genf', id FROM public.prive_destinations WHERE slug = 'ginebra'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'ginebra', id FROM public.prive_destinations WHERE slug = 'ginebra'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'gstaad', id FROM public.prive_destinations WHERE slug = 'gstaad'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'guadalajara', id FROM public.prive_destinations WHERE slug = 'guadalajara'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'hamptons', id FROM public.prive_destinations WHERE slug = 'hamptons'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'hipodromo condesa', id FROM public.prive_destinations WHERE slug = 'cdmx-roma-condesa'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'hk', id FROM public.prive_destinations WHERE slug = 'hk'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'hong kong', id FROM public.prive_destinations WHERE slug = 'hk'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'hongkong', id FROM public.prive_destinations WHERE slug = 'hk'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'huixquilucan', id FROM public.prive_destinations WHERE slug = 'interlomas'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'ibiza', id FROM public.prive_destinations WHERE slug = 'ibiza'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'interlomas', id FROM public.prive_destinations WHERE slug = 'interlomas'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'isla de capri', id FROM public.prive_destinations WHERE slug = 'capri'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'isla de phuket', id FROM public.prive_destinations WHERE slug = 'phuket'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'isla mauricio', id FROM public.prive_destinations WHERE slug = 'mu'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'islas maldivas', id FROM public.prive_destinations WHERE slug = 'mv'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'islas seychelles', id FROM public.prive_destinations WHERE slug = 'sc'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'jackson hole', id FROM public.prive_destinations WHERE slug = 'jackson-hole'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'jakarta', id FROM public.prive_destinations WHERE slug = 'yakarta'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'jose ignacio', id FROM public.prive_destinations WHERE slug = 'punta-del-este'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'kioto', id FROM public.prive_destinations WHERE slug = 'kioto'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'kyoto', id FROM public.prive_destinations WHERE slug = 'kioto'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'la condesa', id FROM public.prive_destinations WHERE slug = 'cdmx-roma-condesa'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'lago de como', id FROM public.prive_destinations WHERE slug = 'lago-de-como'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'lago di como', id FROM public.prive_destinations WHERE slug = 'lago-de-como'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'lake como', id FROM public.prive_destinations WHERE slug = 'lago-de-como'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'las vegas', id FROM public.prive_destinations WHERE slug = 'las-vegas'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'lima', id FROM public.prive_destinations WHERE slug = 'lima'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'lisboa', id FROM public.prive_destinations WHERE slug = 'lisboa'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'lisbon', id FROM public.prive_destinations WHERE slug = 'lisboa'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'london', id FROM public.prive_destinations WHERE slug = 'londres'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'londres', id FROM public.prive_destinations WHERE slug = 'londres'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'los angeles', id FROM public.prive_destinations WHERE slug = 'los-angeles'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'los angeles area', id FROM public.prive_destinations WHERE slug = 'area-los-angeles'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'los cabos', id FROM public.prive_destinations WHERE slug = 'los-cabos'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'los hamptons', id FROM public.prive_destinations WHERE slug = 'hamptons'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'madrid', id FROM public.prive_destinations WHERE slug = 'madrid'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'majorca', id FROM public.prive_destinations WHERE slug = 'mallorca'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'maldivas', id FROM public.prive_destinations WHERE slug = 'mv'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'maldives', id FROM public.prive_destinations WHERE slug = 'mv'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'malibu', id FROM public.prive_destinations WHERE slug = 'malibu'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'mallorca', id FROM public.prive_destinations WHERE slug = 'mallorca'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'marbella', id FROM public.prive_destinations WHERE slug = 'marbella'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'marrakech', id FROM public.prive_destinations WHERE slug = 'marrakech'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'marrakesh', id FROM public.prive_destinations WHERE slug = 'marrakech'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'marraquech', id FROM public.prive_destinations WHERE slug = 'marrakech'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'mascate', id FROM public.prive_destinations WHERE slug = 'mascate'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'mauricio', id FROM public.prive_destinations WHERE slug = 'mu'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'mauritius', id FROM public.prive_destinations WHERE slug = 'mu'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'mc', id FROM public.prive_destinations WHERE slug = 'mc'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'medellin', id FROM public.prive_destinations WHERE slug = 'medellin'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'megeve', id FROM public.prive_destinations WHERE slug = 'megeve'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'melbourne', id FROM public.prive_destinations WHERE slug = 'melbourne'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'mendoza', id FROM public.prive_destinations WHERE slug = 'mendoza'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'merida', id FROM public.prive_destinations WHERE slug = 'merida'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'merida yucatan', id FROM public.prive_destinations WHERE slug = 'merida'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'mexico city', id FROM public.prive_destinations WHERE slug = 'cdmx'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'mexico city metropolitan area', id FROM public.prive_destinations WHERE slug = 'area-cdmx'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'mexico df', id FROM public.prive_destinations WHERE slug = 'cdmx'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'miami', id FROM public.prive_destinations WHERE slug = 'miami'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'miami area', id FROM public.prive_destinations WHERE slug = 'area-miami'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'miami beach', id FROM public.prive_destinations WHERE slug = 'miami-beach'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'miconos', id FROM public.prive_destinations WHERE slug = 'mykonos'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'mikonos', id FROM public.prive_destinations WHERE slug = 'mykonos'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'milan', id FROM public.prive_destinations WHERE slug = 'milan'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'milano', id FROM public.prive_destinations WHERE slug = 'milan'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'monaco', id FROM public.prive_destinations WHERE slug = 'mc'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'monaco monte carlo', id FROM public.prive_destinations WHERE slug = 'monaco-monte-carlo'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'monte carlo', id FROM public.prive_destinations WHERE slug = 'monaco-monte-carlo'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'montecarlo', id FROM public.prive_destinations WHERE slug = 'monaco-monte-carlo'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'monterrey', id FROM public.prive_destinations WHERE slug = 'monterrey'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'montreal', id FROM public.prive_destinations WHERE slug = 'montreal'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'mty', id FROM public.prive_destinations WHERE slug = 'monterrey'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'mu', id FROM public.prive_destinations WHERE slug = 'mu'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'muscat', id FROM public.prive_destinations WHERE slug = 'mascate'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'mv', id FROM public.prive_destinations WHERE slug = 'mv'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'mykonos', id FROM public.prive_destinations WHERE slug = 'mykonos'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'napa', id FROM public.prive_destinations WHERE slug = 'napa-valley'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'napa valley', id FROM public.prive_destinations WHERE slug = 'napa-valley'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'new york', id FROM public.prive_destinations WHERE slug = 'nueva-york'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'new york city', id FROM public.prive_destinations WHERE slug = 'nueva-york'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'nice', id FROM public.prive_destinations WHERE slug = 'niza'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'nice francia', id FROM public.prive_destinations WHERE slug = 'niza'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'niza', id FROM public.prive_destinations WHERE slug = 'niza'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'nueva york', id FROM public.prive_destinations WHERE slug = 'nueva-york'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'nuevo vallarta', id FROM public.prive_destinations WHERE slug = 'riviera-nayarit'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'nyc', id FROM public.prive_destinations WHERE slug = 'nueva-york'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'oaxaca', id FROM public.prive_destinations WHERE slug = 'oaxaca'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'oaxaca de juarez', id FROM public.prive_destinations WHERE slug = 'oaxaca'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'oia', id FROM public.prive_destinations WHERE slug = 'santorini'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'om', id FROM public.prive_destinations WHERE slug = 'om'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'oman', id FROM public.prive_destinations WHERE slug = 'om'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'oman destinos destacados', id FROM public.prive_destinations WHERE slug = 'om'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'oman featured destinations', id FROM public.prive_destinations WHERE slug = 'om'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'oporto', id FROM public.prive_destinations WHERE slug = 'porto'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'osaka', id FROM public.prive_destinations WHERE slug = 'osaka'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'palm beach', id FROM public.prive_destinations WHERE slug = 'palm-beach'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'palma de mallorca', id FROM public.prive_destinations WHERE slug = 'mallorca'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'paris', id FROM public.prive_destinations WHERE slug = 'paris'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'phuket', id FROM public.prive_destinations WHERE slug = 'phuket'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'playa del carmen', id FROM public.prive_destinations WHERE slug = 'riviera-maya'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'polanco', id FROM public.prive_destinations WHERE slug = 'cdmx-polanco'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'porto', id FROM public.prive_destinations WHERE slug = 'porto'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'positano', id FROM public.prive_destinations WHERE slug = 'costa-amalfitana'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'principado de monaco', id FROM public.prive_destinations WHERE slug = 'mc'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'puebla', id FROM public.prive_destinations WHERE slug = 'puebla'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'puebla de zaragoza', id FROM public.prive_destinations WHERE slug = 'puebla'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'puerto aventuras', id FROM public.prive_destinations WHERE slug = 'riviera-maya'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'puerto banus', id FROM public.prive_destinations WHERE slug = 'marbella'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'puerto vallarta', id FROM public.prive_destinations WHERE slug = 'puerto-vallarta'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'punta de mita', id FROM public.prive_destinations WHERE slug = 'punta-mita'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'punta del este', id FROM public.prive_destinations WHERE slug = 'punta-del-este'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'punta mita', id FROM public.prive_destinations WHERE slug = 'punta-mita'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'pvr', id FROM public.prive_destinations WHERE slug = 'puerto-vallarta'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'queenstown', id FROM public.prive_destinations WHERE slug = 'queenstown'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'queretaro', id FROM public.prive_destinations WHERE slug = 'queretaro'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'ravello', id FROM public.prive_destinations WHERE slug = 'costa-amalfitana'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'riad', id FROM public.prive_destinations WHERE slug = 'riad'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'rio', id FROM public.prive_destinations WHERE slug = 'rio-de-janeiro'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'rio de janeiro', id FROM public.prive_destinations WHERE slug = 'rio-de-janeiro'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'riviera maya', id FROM public.prive_destinations WHERE slug = 'riviera-maya'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'riviera nayarit', id FROM public.prive_destinations WHERE slug = 'riviera-nayarit'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'riyad', id FROM public.prive_destinations WHERE slug = 'riad'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'riyadh', id FROM public.prive_destinations WHERE slug = 'riad'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'roma', id FROM public.prive_destinations WHERE slug = 'roma'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'roma condesa', id FROM public.prive_destinations WHERE slug = 'cdmx-roma-condesa'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'roma norte', id FROM public.prive_destinations WHERE slug = 'cdmx-roma-condesa'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'rome', id FROM public.prive_destinations WHERE slug = 'roma'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'saint moritz', id FROM public.prive_destinations WHERE slug = 'st-moritz'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'saint tropez', id FROM public.prive_destinations WHERE slug = 'saint-tropez'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'san francisco', id FROM public.prive_destinations WHERE slug = 'san-francisco'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'san jose del cabo', id FROM public.prive_destinations WHERE slug = 'san-jose-del-cabo'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'san miguel', id FROM public.prive_destinations WHERE slug = 'san-miguel-de-allende'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'san miguel de allende', id FROM public.prive_destinations WHERE slug = 'san-miguel-de-allende'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'san moritz', id FROM public.prive_destinations WHERE slug = 'st-moritz'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'san pablo', id FROM public.prive_destinations WHERE slug = 'sao-paulo'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'san tropez', id FROM public.prive_destinations WHERE slug = 'saint-tropez'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'sankt moritz', id FROM public.prive_destinations WHERE slug = 'st-moritz'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'santiago de queretaro', id FROM public.prive_destinations WHERE slug = 'queretaro'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'santorin', id FROM public.prive_destinations WHERE slug = 'santorini'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'santorini', id FROM public.prive_destinations WHERE slug = 'santorini'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'sao paulo', id FROM public.prive_destinations WHERE slug = 'sao-paulo'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'sc', id FROM public.prive_destinations WHERE slug = 'sc'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'seminyak', id FROM public.prive_destinations WHERE slug = 'bali'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'seoul', id FROM public.prive_destinations WHERE slug = 'seul'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'seul', id FROM public.prive_destinations WHERE slug = 'seul'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'seychelles', id FROM public.prive_destinations WHERE slug = 'sc'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'sg', id FROM public.prive_destinations WHERE slug = 'sg'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'sidney', id FROM public.prive_destinations WHERE slug = 'sidney'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'singapore', id FROM public.prive_destinations WHERE slug = 'sg'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'singapur', id FROM public.prive_destinations WHERE slug = 'sg'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'sjd', id FROM public.prive_destinations WHERE slug = 'san-jose-del-cabo'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'sma', id FROM public.prive_destinations WHERE slug = 'san-miguel-de-allende'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'south beach', id FROM public.prive_destinations WHERE slug = 'miami-beach'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'st moritz', id FROM public.prive_destinations WHERE slug = 'st-moritz'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'st tropez', id FROM public.prive_destinations WHERE slug = 'saint-tropez'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'sultanato de oman', id FROM public.prive_destinations WHERE slug = 'om'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'sydney', id FROM public.prive_destinations WHERE slug = 'sidney'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'the hamptons', id FROM public.prive_destinations WHERE slug = 'hamptons'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'thira', id FROM public.prive_destinations WHERE slug = 'santorini'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'todos santos', id FROM public.prive_destinations WHERE slug = 'todos-santos'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'tokio', id FROM public.prive_destinations WHERE slug = 'tokio'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'tokyo', id FROM public.prive_destinations WHERE slug = 'tokio'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'toronto', id FROM public.prive_destinations WHERE slug = 'toronto'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'tremezzo', id FROM public.prive_destinations WHERE slug = 'lago-de-como'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'tulum', id FROM public.prive_destinations WHERE slug = 'tulum'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'ubud', id FROM public.prive_destinations WHERE slug = 'bali'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'uluwatu', id FROM public.prive_destinations WHERE slug = 'bali'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'vail', id FROM public.prive_destinations WHERE slug = 'vail'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'vallarta', id FROM public.prive_destinations WHERE slug = 'puerto-vallarta'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'valle de bravo', id FROM public.prive_destinations WHERE slug = 'valle-de-bravo'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'valle de guadalupe', id FROM public.prive_destinations WHERE slug = 'valle-de-guadalupe'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'valle de napa', id FROM public.prive_destinations WHERE slug = 'napa-valley'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'valle de uco', id FROM public.prive_destinations WHERE slug = 'mendoza'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'valle sagrado', id FROM public.prive_destinations WHERE slug = 'cusco'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'vancouver', id FROM public.prive_destinations WHERE slug = 'vancouver'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'vegas', id FROM public.prive_destinations WHERE slug = 'las-vegas'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'venecia', id FROM public.prive_destinations WHERE slug = 'venecia'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'venezia', id FROM public.prive_destinations WHERE slug = 'venecia'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'venice', id FROM public.prive_destinations WHERE slug = 'venecia'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'viena', id FROM public.prive_destinations WHERE slug = 'viena'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'vienna', id FROM public.prive_destinations WHERE slug = 'viena'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'whistler', id FROM public.prive_destinations WHERE slug = 'whistler'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'wien', id FROM public.prive_destinations WHERE slug = 'viena'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'yakarta', id FROM public.prive_destinations WHERE slug = 'yakarta'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'zuerich', id FROM public.prive_destinations WHERE slug = 'zurich'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;
INSERT INTO public.prive_destination_aliases (alias_norm, destination_id) SELECT 'zurich', id FROM public.prive_destinations WHERE slug = 'zurich'
ON CONFLICT (alias_norm) DO UPDATE SET destination_id = EXCLUDED.destination_id;

-- Áreas metropolitanas (agrupan sin duplicar).
INSERT INTO public.prive_destination_members (area_id, destination_id)
SELECT a.id, d.id FROM public.prive_destinations a, public.prive_destinations d WHERE a.slug = 'area-cdmx' AND d.slug = 'cdmx'
ON CONFLICT DO NOTHING;
INSERT INTO public.prive_destination_members (area_id, destination_id)
SELECT a.id, d.id FROM public.prive_destinations a, public.prive_destinations d WHERE a.slug = 'area-cdmx' AND d.slug = 'interlomas'
ON CONFLICT DO NOTHING;
INSERT INTO public.prive_destination_members (area_id, destination_id)
SELECT a.id, d.id FROM public.prive_destinations a, public.prive_destinations d WHERE a.slug = 'area-los-angeles' AND d.slug = 'los-angeles'
ON CONFLICT DO NOTHING;
INSERT INTO public.prive_destination_members (area_id, destination_id)
SELECT a.id, d.id FROM public.prive_destinations a, public.prive_destinations d WHERE a.slug = 'area-los-angeles' AND d.slug = 'beverly-hills'
ON CONFLICT DO NOTHING;
INSERT INTO public.prive_destination_members (area_id, destination_id)
SELECT a.id, d.id FROM public.prive_destinations a, public.prive_destinations d WHERE a.slug = 'area-los-angeles' AND d.slug = 'malibu'
ON CONFLICT DO NOTHING;
INSERT INTO public.prive_destination_members (area_id, destination_id)
SELECT a.id, d.id FROM public.prive_destinations a, public.prive_destinations d WHERE a.slug = 'area-miami' AND d.slug = 'miami'
ON CONFLICT DO NOTHING;
INSERT INTO public.prive_destination_members (area_id, destination_id)
SELECT a.id, d.id FROM public.prive_destinations a, public.prive_destinations d WHERE a.slug = 'area-miami' AND d.slug = 'miami-beach'
ON CONFLICT DO NOTHING;
