-- Pruebas del grupo avatar-viajes: avatar (RLS, cupo diario, idempotencia por viaje, viajes
-- pendientes, rescate del avatar huérfano) e importación de viajes pasados (guardado, duplicados,
-- validación, RLS, borrado de cuenta).
-- Uso: run.sh (reproduce migraciones y corre este archivo). Esperado: solo líneas "OK …".
\set ON_ERROR_STOP off
\pset tuples_only on
RESET ROLE;
-- Ids propios (av…) para no chocar con otras pruebas.
INSERT INTO auth.users(id, email) VALUES
  ('a7000000-0000-4000-8000-000000000001', 'av-owner@example.test'),
  ('a7000000-0000-4000-8000-000000000002', 'av-attacker@example.test'),
  ('a7000000-0000-4000-8000-000000000003', 'av-sinavatar@example.test')
ON CONFLICT DO NOTHING;
INSERT INTO profiles(id) VALUES ('a7000000-0000-4000-8000-000000000001'), ('a7000000-0000-4000-8000-000000000002'), ('a7000000-0000-4000-8000-000000000003')
ON CONFLICT DO NOTHING;
INSERT INTO trips(id, user_id, destino, num_viajeros, fecha_salida, fecha_regreso, vuelos_json) VALUES
  ('a7100000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000001', 'Roma', 2, current_date - 12, current_date - 5, '[{"aerolinea":"Iberia","confirmacion":"QWE123"}]'),
  ('a7100000-0000-4000-8000-000000000002', 'a7000000-0000-4000-8000-000000000001', 'Tokio', 2, current_date + 30, current_date + 40, '[]'),
  ('a7100000-0000-4000-8000-000000000003', 'a7000000-0000-4000-8000-000000000002', 'Lima', 1, current_date - 9, current_date - 3, '[]'),
  ('a7100000-0000-4000-8000-000000000004', 'a7000000-0000-4000-8000-000000000003', 'Bogotá', 1, current_date - 9, current_date - 2, '[]');

-- ───── Avatar: escritura del servidor ─────
SET ROLE service_role;
INSERT INTO avatar_profiles(user_id, base_path, current_url, version) VALUES
  ('a7000000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000001/base/v1.png', 'https://x.supabase.co/storage/v1/object/public/travel-moments/avatars/a7000000-0000-4000-8000-000000000001/a.png', 1),
  ('a7000000-0000-4000-8000-000000000002', 'a7000000-0000-4000-8000-000000000002/base/v1.png', 'https://x.supabase.co/a.png', 1);
SELECT CASE WHEN public.avatar_claim_trip('a7000000-0000-4000-8000-000000000001', 'a7100000-0000-4000-8000-000000000001', 'fin_de_viaje',
  '{"key":"ciudad:roma","nombre":"Pin del Coliseo","lugar":"Roma","pais":"IT","emoji":"🏛️","slot":"pin","prompt":"a pin"}') IS NOT NULL
  THEN 'OK AV1 primer reclamo del viaje crea su recuerdo' ELSE 'FALLA AV1' END;
SELECT CASE WHEN public.avatar_claim_trip('a7000000-0000-4000-8000-000000000001', 'a7100000-0000-4000-8000-000000000001', 'fin_de_viaje',
  '{"key":"ciudad:roma","nombre":"Pin del Coliseo","lugar":"Roma","pais":"IT","emoji":"🏛️","slot":"pin","prompt":"a pin"}') IS NULL
  THEN 'OK AV2 segundo reclamo simultáneo del mismo viaje: nada (idempotente)' ELSE 'FALLA AV2' END;
SELECT CASE WHEN count(*) = 1 THEN 'OK AV3 una sola fila por viaje' ELSE 'FALLA AV3 ' || count(*) END
  FROM avatar_souvenirs WHERE trip_key = 'a7100000-0000-4000-8000-000000000001';
DO $$ BEGIN
  PERFORM public.avatar_claim_trip('a7000000-0000-4000-8000-000000000002', 'a7100000-0000-4000-8000-000000000001', 'fin_de_viaje', '{"key":"ciudad:roma","nombre":"x","lugar":"x"}');
  RAISE NOTICE 'FALLA AV4 se reclamó el viaje de otra persona';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'OK AV4 no se puede reclamar el viaje de otra persona';
END $$;
-- Reintento: sin_cupo con más de 20 min → se retoma; aplicado → nunca.
UPDATE avatar_souvenirs SET status = 'sin_cupo', updated_at = now() - interval '1 hour' WHERE trip_key = 'a7100000-0000-4000-8000-000000000001';
SELECT CASE WHEN public.avatar_claim_trip('a7000000-0000-4000-8000-000000000001', 'a7100000-0000-4000-8000-000000000001', 'fin_de_viaje',
  '{"key":"ciudad:roma","nombre":"Pin del Coliseo","lugar":"Roma","pais":"IT","emoji":"🏛️","slot":"pin","prompt":"a pin"}') IS NOT NULL
  THEN 'OK AV5 sin cupo y vencido: se retoma' ELSE 'FALLA AV5' END;
SELECT CASE WHEN attempts = 2 AND status = 'pendiente' THEN 'OK AV6 intento 2 en pendiente' ELSE 'FALLA AV6 ' || attempts || status END
  FROM avatar_souvenirs WHERE trip_key = 'a7100000-0000-4000-8000-000000000001';
UPDATE avatar_souvenirs SET status = 'aplicado', visible = true, updated_at = now() - interval '2 days' WHERE trip_key = 'a7100000-0000-4000-8000-000000000001';
SELECT CASE WHEN public.avatar_claim_trip('a7000000-0000-4000-8000-000000000001', 'a7100000-0000-4000-8000-000000000001', 'fin_de_viaje',
  '{"key":"ciudad:roma","nombre":"Pin del Coliseo","lugar":"Roma","pais":"IT","emoji":"🏛️","slot":"pin","prompt":"a pin"}') IS NULL
  THEN 'OK AV7 recuerdo aplicado: nunca se vuelve a procesar' ELSE 'FALLA AV7' END;

-- Cupo diario.
SELECT CASE WHEN public.avatar_take_images('a7000000-0000-4000-8000-000000000001', 'crear', 2, 8) = 2 THEN 'OK AV8 cupo: 2 de 8' ELSE 'FALLA AV8' END;
SELECT CASE WHEN public.avatar_take_images('a7000000-0000-4000-8000-000000000001', 'crear', 7, 8) = 6 THEN 'OK AV9 cupo: solo quedan 6' ELSE 'FALLA AV9' END;
SELECT CASE WHEN public.avatar_take_images('a7000000-0000-4000-8000-000000000001', 'crear', 1, 8) = 0 THEN 'OK AV10 cupo agotado: 0' ELSE 'FALLA AV10' END;
SELECT CASE WHEN public.avatar_take_images('a7000000-0000-4000-8000-000000000001', 'evolucion', 1, 3) = 1 THEN 'OK AV11 el cupo de evolución es aparte' ELSE 'FALLA AV11' END;
UPDATE avatar_image_usage SET created_at = now() - interval '25 hours' WHERE user_id = 'a7000000-0000-4000-8000-000000000001' AND kind = 'crear';
SELECT CASE WHEN public.avatar_take_images('a7000000-0000-4000-8000-000000000001', 'crear', 2, 8) = 2 THEN 'OK AV12 al pasar 24 h vuelve el cupo' ELSE 'FALLA AV12' END;

-- Viajes pendientes de recuerdo (corrida diaria).
SELECT CASE WHEN string_agg(trip_id::text, ',') = 'a7100000-0000-4000-8000-000000000003'
  THEN 'OK AV13 pendientes: solo viajes terminados de personas con avatar y sin recuerdo resuelto'
  ELSE 'FALLA AV13 ' || coalesce(string_agg(trip_id::text, ','), 'ninguno') END
  FROM public.avatar_trips_due(50) WHERE trip_id::text LIKE 'a71%';
RESET ROLE;

-- ───── Avatar: lo que ve y puede hacer la app ─────
SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub', 'a7000000-0000-4000-8000-000000000002', false);
SELECT CASE WHEN count(*) = 0 THEN 'OK AV14 nadie ve los recuerdos de otra persona' ELSE 'FALLA AV14' END FROM avatar_souvenirs;
SELECT CASE WHEN count(*) = 1 THEN 'OK AV15 cada quien ve su propio estado de avatar' ELSE 'FALLA AV15 ' || count(*) END FROM avatar_profiles;
DO $$ BEGIN
  INSERT INTO avatar_souvenirs(user_id, trip_key, souvenir_key, nombre, lugar) VALUES ('a7000000-0000-4000-8000-000000000002', 'x', 'ciudad:paris', 'x', 'x');
  RAISE NOTICE 'FALLA AV16 la app insertó un recuerdo';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'OK AV16 la app no puede regalarse recuerdos';
END $$;
DO $$ BEGIN
  UPDATE avatar_profiles SET current_url = 'https://evil.example/x.png';
  RAISE NOTICE 'FALLA AV17 la app cambió su avatar_profiles';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'OK AV17 avatar_profiles solo lo escribe el servidor';
END $$;
DO $$ BEGIN
  PERFORM public.avatar_take_images('a7000000-0000-4000-8000-000000000002', 'crear', 1, 100);
  RAISE NOTICE 'FALLA AV18 la app usó avatar_take_images';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'OK AV18 el cupo solo lo toma el servidor';
END $$;
DO $$ BEGIN
  PERFORM public.avatar_claim_trip('a7000000-0000-4000-8000-000000000002', 'a7100000-0000-4000-8000-000000000003', 'fin_de_viaje', '{}');
  RAISE NOTICE 'FALLA AV19 la app reclamó un viaje';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'OK AV19 avatar_claim_trip solo servidor';
END $$;
DO $$ BEGIN
  PERFORM count(*) FROM avatar_image_usage;
  RAISE NOTICE 'FALLA AV20 la app lee el registro de uso';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'OK AV20 el registro de uso no se lee desde la app';
END $$;
RESET ROLE;
SET ROLE anon; SELECT set_config('request.jwt.claim.sub', '', false);
DO $$ BEGIN
  PERFORM count(*) FROM avatar_souvenirs;
  RAISE NOTICE 'FALLA AV21 anon lee recuerdos';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'OK AV21 anon no lee recuerdos';
END $$;
RESET ROLE;
SELECT CASE WHEN public = false THEN 'OK AV22 el bucket avatar-private es privado' ELSE 'FALLA AV22' END FROM storage.buckets WHERE id = 'avatar-private';
SELECT CASE WHEN count(*) = 0 THEN 'OK AV23 sin políticas de la app sobre avatar-private' ELSE 'FALLA AV23' END
  FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND (qual LIKE '%avatar-private%' OR with_check LIKE '%avatar-private%');

-- ───── Importar viaje pasado ─────
-- Producción tiene trips_status_chk (analizando|listo|error) fuera de las migraciones: se simula.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'trips_status_chk') THEN
    ALTER TABLE public.trips ADD CONSTRAINT trips_status_chk CHECK (status IN ('analizando', 'listo', 'error')) NOT VALID;
  END IF;
END $$;
SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub', 'a7000000-0000-4000-8000-000000000001', false);
SELECT CASE WHEN (r->>'ok')::boolean AND (r->>'realizado')::boolean THEN 'OK IM1 viaje pasado importado (realizado)' ELSE 'FALLA IM1 ' || r::text END
FROM (SELECT public.import_past_trip(
  jsonb_build_object('destino', 'Nueva York', 'pais_destino', 'Estados Unidos', 'fecha_salida', '2026-05-02', 'fecha_regreso', '2026-05-08',
    'num_viajeros', 1, 'pagado_total', 2236.50, 'pagado_moneda', 'usd', 'total_estimado', 41200,
    'vuelos_json', '[{"aerolinea":"Aeroméxico","numero_vuelo":"AM0402","confirmacion":"ZXC789","pagado":{"monto":812.4,"moneda":"USD"}}]'::jsonb,
    'hospedaje_json', '[{"nombre":"The Standard","confirmacion":"H-55821","pagado":{"monto":1424.1,"moneda":"USD"}}]'::jsonb,
    'itinerario_json', '{"importado":{"archivos":2}}'::jsonb),
  ARRAY['pnr:zxc789', 'VUELO:AM402:2026-05-02', 'HOTEL:H-55821', 'basura sin formato']) AS r) s;
RESET ROLE;
SELECT CASE WHEN fuente = 'documento' AND realizado AND status = 'listo' AND pagado_total = 2236.50 AND pagado_moneda = 'USD'
  THEN 'OK IM2 guardado con fuente documento, status listo y lo pagado en su moneda' ELSE 'FALLA IM2 ' || fuente || realizado || status || pagado_total || pagado_moneda END
  FROM trips WHERE user_id = 'a7000000-0000-4000-8000-000000000001' AND destino = 'Nueva York';
SELECT CASE WHEN count(*) = 3 THEN 'OK IM3 llaves de duplicado normalizadas (la inválida se descarta)' ELSE 'FALLA IM3 ' || count(*) END
  FROM trip_import_refs WHERE user_id = 'a7000000-0000-4000-8000-000000000001';
SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub', 'a7000000-0000-4000-8000-000000000001', false);
SELECT CASE WHEN r->>'code' = 'duplicado' AND r->>'trip_id' = (SELECT id::text FROM trips WHERE destino = 'Nueva York' AND user_id = auth.uid())
  THEN 'OK IM4 mismo boleto otra vez: duplicado, apunta al viaje existente' ELSE 'FALLA IM4 ' || r::text END
FROM (SELECT public.import_past_trip(jsonb_build_object('destino', 'NYC', 'fecha_salida', '2026-05-02'), ARRAY['PNR:ZXC789']) AS r) s;
SELECT CASE WHEN r->>'code' = 'duplicado' AND r->>'trip_id' = 'a7100000-0000-4000-8000-000000000001'
  THEN 'OK IM5 la confirmación ya estaba en otro viaje suyo: duplicado' ELSE 'FALLA IM5 ' || r::text END
FROM (SELECT public.import_past_trip(jsonb_build_object('destino', 'Roma', 'fecha_salida', '2026-01-02'), ARRAY['PNR:qwe123']) AS r) s;
SELECT CASE WHEN r->>'code' = 'invalido' AND r->>'campo' = 'fechas' THEN 'OK IM6 regreso antes de la salida: inválido' ELSE 'FALLA IM6 ' || r::text END
FROM (SELECT public.import_past_trip(jsonb_build_object('destino', 'Oaxaca', 'fecha_salida', '2026-05-10', 'fecha_regreso', '2026-05-01'), ARRAY[]::text[]) AS r) s;
SELECT CASE WHEN r->>'code' = 'invalido' AND r->>'campo' = 'pagado' THEN 'OK IM7 monto sin moneda: inválido (no se adivina la moneda)' ELSE 'FALLA IM7 ' || r::text END
FROM (SELECT public.import_past_trip(jsonb_build_object('destino', 'Oaxaca', 'fecha_salida', '2026-05-10', 'pagado_total', 500), ARRAY[]::text[]) AS r) s;
-- (La verificación va en otra sentencia: dentro de la misma, la fila recién insertada no se ve.)
SELECT public.import_past_trip(jsonb_build_object('destino', 'Oaxaca', 'fecha_salida', '2025-11-01', 'fecha_regreso', '2025-11-04'), ARRAY['RESERVA:OAX-1'])->>'trip_id' AS im8 \gset
SELECT CASE WHEN pagado_total IS NULL AND pagado_moneda IS NULL AND total_estimado IS NULL
  THEN 'OK IM8 sin precio en el documento: se guarda vacío, no se inventa' ELSE 'FALLA IM8' END
  FROM trips WHERE id = :'im8';
DO $$ BEGIN
  INSERT INTO trip_import_refs(user_id, trip_id, ref) VALUES ('a7000000-0000-4000-8000-000000000001', 'a7100000-0000-4000-8000-000000000001', 'PNR:AAA111');
  RAISE NOTICE 'FALLA IM9 la app insertó una llave';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'OK IM9 las llaves solo las escribe import_past_trip';
END $$;
SELECT set_config('request.jwt.claim.sub', 'a7000000-0000-4000-8000-000000000002', false);
SELECT CASE WHEN count(*) = 0 THEN 'OK IM10 nadie ve las llaves de otra persona' ELSE 'FALLA IM10' END FROM trip_import_refs;
SELECT CASE WHEN (r->>'ok')::boolean THEN 'OK IM11 el mismo boleto en OTRA cuenta no cuenta como duplicado' ELSE 'FALLA IM11 ' || r::text END
FROM (SELECT public.import_past_trip(jsonb_build_object('destino', 'NYC', 'fecha_salida', '2026-05-02'), ARRAY['PNR:ZXC789']) AS r) s;
RESET ROLE;
SET ROLE anon; SELECT set_config('request.jwt.claim.sub', '', false);
DO $$ BEGIN
  PERFORM public.import_past_trip('{"destino":"x","fecha_salida":"2026-01-01"}', ARRAY[]::text[]);
  RAISE NOTICE 'FALLA IM12 anon importó';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'OK IM12 anon no puede importar';
END $$;
RESET ROLE;

-- ───── Borrado de cuenta ─────
INSERT INTO storage.buckets(id, name, public) VALUES ('travel-moments', 'travel-moments', true) ON CONFLICT DO NOTHING;
INSERT INTO storage.objects(bucket_id, name) VALUES
  ('avatar-private', 'a7000000-0000-4000-8000-000000000001/base/v1.png'),
  ('avatar-private', 'a7000000-0000-4000-8000-000000000001/variantes/x.png'),
  ('travel-moments', 'avatars/a7000000-0000-4000-8000-000000000001/x.png');
SELECT CASE WHEN count(*) = 3 THEN 'OK DEL1 borrar la cuenta incluye la imagen base, las variantes y el avatar público' ELSE 'FALLA DEL1 ' || count(*) END
  FROM public.account_deletion_files('a7000000-0000-4000-8000-000000000001') f WHERE f.name LIKE '%a7000000-0000-4000-8000-000000000001%';
SELECT public.purge_account_data('a7000000-0000-4000-8000-000000000001') IS NOT NULL;
SELECT CASE WHEN (SELECT count(*) FROM avatar_souvenirs WHERE user_id = 'a7000000-0000-4000-8000-000000000001')
               + (SELECT count(*) FROM avatar_profiles WHERE user_id = 'a7000000-0000-4000-8000-000000000001')
               + (SELECT count(*) FROM avatar_image_usage WHERE user_id = 'a7000000-0000-4000-8000-000000000001')
               + (SELECT count(*) FROM trip_import_refs WHERE user_id = 'a7000000-0000-4000-8000-000000000001') = 0
  THEN 'OK DEL2 el borrado de cuenta elimina avatar, recuerdos, cupo y llaves de importación' ELSE 'FALLA DEL2' END;
