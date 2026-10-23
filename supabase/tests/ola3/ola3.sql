-- Integración Ola 3: purga al borrar un viaje y versión final de las funciones redefinidas.
-- Imprime "OK …" o "FALLA …". Requiere run.sh.
-- Usuarios (ids 0a1…): 1 Ana (dueña de Roma) · 2 Beto (colaborador aceptado en Roma) · 3 Caro (ajena, dueña de Lima)
-- Viajes (ids 0a2…): 1 Roma (Ana) · 2 Lima (Caro, no se borra)
\set ON_ERROR_STOP off
\pset tuples_only on
RESET ROLE;

CREATE OR REPLACE FUNCTION public.o3_ok(_label text, _cond boolean, _detail text DEFAULT '') RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF coalesce(_cond, false) THEN RAISE NOTICE 'OK % %', _label, _detail; ELSE RAISE NOTICE 'FALLA % %', _label, _detail; END IF;
END $$;
-- Cuerpo de la versión vigente de una función (la que queda tras aplicar todas las migraciones en orden).
CREATE OR REPLACE FUNCTION public.o3_src(_fn regprocedure) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT prosrc FROM pg_proc WHERE oid = _fn
$$;

INSERT INTO auth.users(id, email) VALUES
  ('0a100000-0000-4000-8000-000000000001', 'o3-ana@example.test'),
  ('0a100000-0000-4000-8000-000000000002', 'o3-beto@example.test'),
  ('0a100000-0000-4000-8000-000000000003', 'o3-caro@example.test')
ON CONFLICT DO NOTHING;
INSERT INTO public.profiles(id) SELECT id FROM auth.users WHERE id::text LIKE '0a100000-%' ON CONFLICT DO NOTHING;
INSERT INTO public.trips(id, user_id, destino, fecha_salida, fecha_regreso) VALUES
  ('0a200000-0000-4000-8000-000000000001', '0a100000-0000-4000-8000-000000000001', 'Roma', current_date - 30, current_date - 25),
  ('0a200000-0000-4000-8000-000000000002', '0a100000-0000-4000-8000-000000000003', 'Lima', current_date - 30, current_date - 25);
INSERT INTO public.trip_collaborators(trip_id, user_id, invited_by, status) VALUES
  ('0a200000-0000-4000-8000-000000000001', '0a100000-0000-4000-8000-000000000002', '0a100000-0000-4000-8000-000000000001', 'accepted');

-- Archivos del viaje en cada bucket que se purga con él (como los dejan las apps).
INSERT INTO storage.buckets(id, name) VALUES ('trip-documents', 'trip-documents'), ('journal-photos', 'journal-photos'),
  ('trip-receipts', 'trip-receipts'), ('recuerdos', 'recuerdos') ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.objects(bucket_id, name, owner) VALUES
  -- documentos: {viaje}/{archivo}
  ('trip-documents', '0a200000-0000-4000-8000-000000000001/pasaporte.pdf', '0a100000-0000-4000-8000-000000000001'),
  ('trip-documents', '0a200000-0000-4000-8000-000000000002/boleto.pdf', '0a100000-0000-4000-8000-000000000003'),
  -- diario: {quien subió}/{viaje}/{archivo}; también la foto del colaborador
  ('journal-photos', '0a100000-0000-4000-8000-000000000001/0a200000-0000-4000-8000-000000000001/coliseo.jpg', '0a100000-0000-4000-8000-000000000001'),
  ('journal-photos', '0a100000-0000-4000-8000-000000000002/0a200000-0000-4000-8000-000000000001/trevi.jpg', '0a100000-0000-4000-8000-000000000002'),
  -- recibos de gastos: {viaje}/{archivo}
  ('trip-receipts', '0a200000-0000-4000-8000-000000000001/ticket-cena.jpg', '0a100000-0000-4000-8000-000000000002'),
  ('trip-receipts', '0a200000-0000-4000-8000-000000000002/ticket-lima.jpg', '0a100000-0000-4000-8000-000000000003');
-- Recuerdos: Ana (dueña) con miniatura, Beto (colaborador) y otra de Ana sin viaje.
INSERT INTO public.recuerdos(id, user_id, trip_id, media_type, mime_type, storage_path, thumb_path, bytes, taken_on, date_source, trip_source) VALUES
  ('0a300000-0000-4000-8000-000000000001', '0a100000-0000-4000-8000-000000000001', '0a200000-0000-4000-8000-000000000001', 'foto', 'image/jpeg',
   '0a100000-0000-4000-8000-000000000001/0a300000-0000-4000-8000-000000000001.jpg', '0a100000-0000-4000-8000-000000000001/0a300000-0000-4000-8000-000000000001_t.jpg',
   1000, current_date - 28, 'exif', 'fecha'),
  ('0a300000-0000-4000-8000-000000000002', '0a100000-0000-4000-8000-000000000002', '0a200000-0000-4000-8000-000000000001', 'foto', 'image/jpeg',
   '0a100000-0000-4000-8000-000000000002/0a300000-0000-4000-8000-000000000002.jpg', NULL, 1000, current_date - 27, 'exif', 'fecha'),
  ('0a300000-0000-4000-8000-000000000003', '0a100000-0000-4000-8000-000000000001', NULL, 'foto', 'image/jpeg',
   '0a100000-0000-4000-8000-000000000001/0a300000-0000-4000-8000-000000000003.jpg', NULL, 1000, current_date - 2, 'archivo', 'ninguno');

-- ───── Triggers de borrado del viaje ─────
SELECT public.o3_ok('O1 trips tiene los dos triggers BEFORE DELETE de purga activos (archivos del viaje y Recuerdos)',
  (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.trips'::regclass AND NOT tgisinternal AND tgenabled <> 'D'
     AND tgname IN ('trips_queue_storage_purge', 'trips_purge_recuerdos')) = 2);
SELECT public.o3_ok('O2 trips_queue_storage_purge (versión final, gastos_split) conserva documentos y diario y agrega recibos',
  public.o3_src('public.trips_queue_storage_purge()') LIKE '%''trip-documents''%'
  AND public.o3_src('public.trips_queue_storage_purge()') LIKE '%''journal-photos''%'
  AND public.o3_src('public.trips_queue_storage_purge()') LIKE '%''trip-receipts''%');

DELETE FROM public.storage_purge_queue;
DELETE FROM public.trips WHERE id = '0a200000-0000-4000-8000-000000000001';

SELECT public.o3_ok('O3 borrar Roma encola su documento',
  EXISTS (SELECT 1 FROM public.storage_purge_queue WHERE bucket_id = 'trip-documents' AND reason = 'trip_deleted'
            AND user_id = '0a100000-0000-4000-8000-000000000001' AND name = '0a200000-0000-4000-8000-000000000001/pasaporte.pdf'));
SELECT public.o3_ok('O4 encola las fotos del diario del viaje, también la del colaborador',
  (SELECT count(*) FROM public.storage_purge_queue WHERE bucket_id = 'journal-photos' AND reason = 'trip_deleted'
     AND user_id = '0a100000-0000-4000-8000-000000000001' AND name LIKE '%/0a200000-0000-4000-8000-000000000001/%') = 2);
SELECT public.o3_ok('O5 encola el recibo de gastos del viaje',
  EXISTS (SELECT 1 FROM public.storage_purge_queue WHERE bucket_id = 'trip-receipts' AND reason = 'trip_deleted'
            AND user_id = '0a100000-0000-4000-8000-000000000001' AND name = '0a200000-0000-4000-8000-000000000001/ticket-cena.jpg'));
SELECT public.o3_ok('O6 encola la foto y la miniatura de Recuerdos de la dueña ligadas al viaje',
  (SELECT string_agg(right(name, 6), ',' ORDER BY name) FROM public.storage_purge_queue WHERE bucket_id = 'recuerdos'
     AND reason = 'trip_deleted' AND user_id = '0a100000-0000-4000-8000-000000000001') = '01.jpg,_t.jpg');
SELECT public.o3_ok('O7 la fila del Recuerdo de la dueña se borra; la suya sin viaje se queda',
  NOT EXISTS (SELECT 1 FROM public.recuerdos WHERE id = '0a300000-0000-4000-8000-000000000001')
  AND EXISTS (SELECT 1 FROM public.recuerdos WHERE id = '0a300000-0000-4000-8000-000000000003'));
SELECT public.o3_ok('O8 el Recuerdo del colaborador NO se encola: se queda en su calendario sin viaje',
  NOT EXISTS (SELECT 1 FROM public.storage_purge_queue WHERE name LIKE '%0a300000-0000-4000-8000-000000000002%')
  AND (SELECT trip_id IS NULL FROM public.recuerdos WHERE id = '0a300000-0000-4000-8000-000000000002'));
SELECT public.o3_ok('O9 nada de Lima (otro viaje, otra persona) entra a la cola; solo hay 6 archivos encolados',
  NOT EXISTS (SELECT 1 FROM public.storage_purge_queue WHERE name LIKE '%0a200000-0000-4000-8000-000000000002%')
  AND (SELECT count(*) FROM public.storage_purge_queue) = 6,
  (SELECT string_agg(bucket_id || ':' || name, ' ') FROM public.storage_purge_queue));

-- ───── Versión final de las funciones que redefine una migración de la ola ─────
SELECT public.o3_ok('O10 is_pro final (referidos_promo): cortesía con vencimiento + precio/periodo de r2_cuentas',
  public.o3_src('public.is_pro(uuid)') LIKE '%comped_until%'
  AND public.o3_src('public.is_pro(uuid)') LIKE '%pro_price_ok(s.price_id, s.currency)%'
  AND public.o3_src('public.is_pro(uuid)') LIKE '%current_period_end > now()%');
SELECT public.o3_ok('O11 apply_stripe_subscription final (referidos_promo): la cortesía de referidos cede ante una suscripción viva',
  public.o3_src('public.apply_stripe_subscription(uuid,text,text,text,timestamptz,timestamptz,boolean,text,text,timestamptz)') LIKE '%stripe_sub_is_live%');
SELECT public.o3_ok('O12 claim_trial_fingerprint final (referidos_promo): registra la tarjeta para referidos',
  (SELECT bool_or(prosrc LIKE '%stripe_card_customers%') FROM pg_proc WHERE proname = 'claim_trial_fingerprint' AND pronamespace = 'public'::regnamespace));
SELECT public.o3_ok('O13 friend_profiles, amigo_perfil y solicitudes_amistad finales (social_amigos): el avatar solo con permiso',
  (SELECT bool_and(prosrc LIKE '%_social_pref(%avatar%') AND count(*) >= 3 FROM pg_proc
     WHERE pronamespace = 'public'::regnamespace AND proname IN ('friend_profiles', 'amigo_perfil', 'solicitudes_amistad')));
SELECT public.o3_ok('O14 purge_account_data, account_deletion_files y handle_new_user siguen con una sola firma cada una',
  (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace
     AND proname IN ('purge_account_data', 'account_deletion_files', 'handle_new_user')) = 3);
