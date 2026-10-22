-- r2 grupo: "Ya lo reservé" compartido (trip_purchase_marks). Imprime "OK …" o "FALLA …". Requiere run.sh.
-- Usuarios (ids 9a…): 1 Olga (dueña del viaje) · 2 Carlos (colaborador aceptado) · 3 Sara (no es miembro)
--                     4 Pedro (invitación pendiente, aún no es miembro) · 5 Lía (colaboradora que sale del viaje)
-- Viajes (ids 9b…): 1 Lisboa (de Olga) · 2 Roma (de Sara)
\set ON_ERROR_STOP off
\pset tuples_only on
RESET ROLE;

CREATE OR REPLACE FUNCTION public.rg_ok(_label text, _cond boolean, _detail text DEFAULT '') RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF coalesce(_cond, false) THEN RAISE NOTICE 'OK % %', _label, _detail; ELSE RAISE NOTICE 'FALLA % %', _label, _detail; END IF;
END $$;
-- Ejecuta q como el usuario (rol authenticated) y devuelve el texto o ERR:<mensaje>.
CREATE OR REPLACE FUNCTION public.rg_as(_uid uuid, _q text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', _uid::text, false), set_config('request.jwt.claim.role', 'authenticated', false);
  SET LOCAL ROLE authenticated;
  EXECUTE _q INTO v;
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claim.role', '', false);
  RETURN coalesce(v, '<null>');
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claim.role', '', false);
  RETURN 'ERR:' || SQLERRM;
END $$;
-- Igual, como visitante sin sesión (rol anon).
CREATE OR REPLACE FUNCTION public.rg_anon(_q text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claim.role', 'anon', false);
  SET LOCAL ROLE anon;
  EXECUTE _q INTO v;
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.role', '', false);
  RETURN coalesce(v, '<null>');
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.role', '', false);
  RETURN 'ERR:' || SQLERRM;
END $$;
GRANT EXECUTE ON FUNCTION public.rg_ok(text, boolean, text), public.rg_as(uuid, text), public.rg_anon(text) TO authenticated, anon;

INSERT INTO auth.users(id, email) VALUES
  ('9a000000-0000-0000-0000-000000000001', 'rg-olga@example.test'),
  ('9a000000-0000-0000-0000-000000000002', 'rg-carlos@example.test'),
  ('9a000000-0000-0000-0000-000000000003', 'rg-sara@example.test'),
  ('9a000000-0000-0000-0000-000000000004', 'rg-pedro@example.test'),
  ('9a000000-0000-0000-0000-000000000005', 'rg-lia@example.test')
ON CONFLICT DO NOTHING;
INSERT INTO public.profiles(id) SELECT id FROM auth.users WHERE id::text LIKE '9a000000-%' ON CONFLICT DO NOTHING;
UPDATE public.profiles SET full_name = 'Olga Pérez' WHERE id = '9a000000-0000-0000-0000-000000000001';
UPDATE public.profiles SET full_name = 'Carlos Ruiz' WHERE id = '9a000000-0000-0000-0000-000000000002';
UPDATE public.profiles SET full_name = 'Sara Intrusa' WHERE id = '9a000000-0000-0000-0000-000000000003';
UPDATE public.profiles SET full_name = NULL, username = 'lia.viaja' WHERE id = '9a000000-0000-0000-0000-000000000005';
INSERT INTO public.trips(id, user_id, destino) VALUES
  ('9b000000-0000-0000-0000-000000000001', '9a000000-0000-0000-0000-000000000001', 'Lisboa'),
  ('9b000000-0000-0000-0000-000000000002', '9a000000-0000-0000-0000-000000000003', 'Roma');
INSERT INTO public.trip_collaborators(trip_id, user_id, invited_by, status) VALUES
  ('9b000000-0000-0000-0000-000000000001', '9a000000-0000-0000-0000-000000000002', '9a000000-0000-0000-0000-000000000001', 'accepted'),
  ('9b000000-0000-0000-0000-000000000001', '9a000000-0000-0000-0000-000000000004', '9a000000-0000-0000-0000-000000000001', 'pending'),
  ('9b000000-0000-0000-0000-000000000001', '9a000000-0000-0000-0000-000000000005', '9a000000-0000-0000-0000-000000000001', 'accepted');

-- ───── Esquema ─────
SELECT public.rg_ok('RG0 la tabla tiene RLS y anon no tiene ningún permiso',
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.trip_purchase_marks'::regclass)
  AND NOT has_table_privilege('anon', 'public.trip_purchase_marks', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.trip_purchase_marks', 'INSERT')
  AND NOT has_table_privilege('anon', 'public.trip_purchase_marks', 'DELETE'));

-- ───── Carlos (colaborador) marca el vuelo, como en la app: su fila de bookings y la marca del grupo ─────
INSERT INTO public.bookings(id, user_id, trip_id, category, provider, status, title, raw_payload) VALUES
  ('9c000000-0000-0000-0000-000000000001', '9a000000-0000-0000-0000-000000000002', '9b000000-0000-0000-0000-000000000001',
   'flight', 'Google Flights', 'pending', 'Vuelo · Iberia', '{"compra_item":"vuelo:0:iberia","marcado_por_usuario":true}'),
  ('9c000000-0000-0000-0000-000000000002', '9a000000-0000-0000-0000-000000000002', '9b000000-0000-0000-0000-000000000001',
   'flight', 'Iberia', 'confirmed', 'Vuelo · Iberia', '{"compra_item":"vuelo:0:iberia","evidencia":"proveedor"}');
SELECT public.rg_ok('RG1 Carlos (colaborador) marca el vuelo a su nombre',
  public.rg_as('9a000000-0000-0000-0000-000000000002',
    $q$INSERT INTO public.trip_purchase_marks(trip_id, item_key, category, marked_by)
       VALUES ('9b000000-0000-0000-0000-000000000001', 'vuelo:0:iberia', 'flight', auth.uid()) RETURNING marked_by_name$q$) = 'Carlos Ruiz');

-- ───── Quién ve la marca ─────
SELECT public.rg_ok('RG2 Olga (dueña) ve la marca de Carlos con su nombre y la fecha',
  public.rg_as('9a000000-0000-0000-0000-000000000001',
    $q$SELECT string_agg(item_key || '|' || marked_by_name || '|' || (marked_at > now() - interval '1 minute')::text, ',')
         FROM public.trip_purchase_marks WHERE trip_id = '9b000000-0000-0000-0000-000000000001'$q$) = 'vuelo:0:iberia|Carlos Ruiz|true');
SELECT public.rg_ok('RG3 Sara (no es miembro) no ve ninguna marca del viaje de Olga',
  public.rg_as('9a000000-0000-0000-0000-000000000003', $q$SELECT count(*)::text FROM public.trip_purchase_marks$q$) = '0');
SELECT public.rg_ok('RG4 Pedro (invitación pendiente) aún no ve nada',
  public.rg_as('9a000000-0000-0000-0000-000000000004', $q$SELECT count(*)::text FROM public.trip_purchase_marks$q$) = '0');
SELECT public.rg_ok('RG5 un visitante sin sesión (anon) no puede leer la tabla',
  public.rg_anon($q$SELECT count(*)::text FROM public.trip_purchase_marks$q$) LIKE 'ERR:%permission denied%');
SELECT public.rg_ok('RG6 Olga (dueña) no ve la fila de bookings de Carlos (la constancia sigue siendo personal)',
  public.rg_as('9a000000-0000-0000-0000-000000000001', $q$SELECT count(*)::text FROM public.bookings WHERE user_id = '9a000000-0000-0000-0000-000000000002'$q$) = '0');

-- ───── Quién puede marcar ─────
SELECT public.rg_ok('RG7 Sara no puede marcar en el viaje de Olga',
  public.rg_as('9a000000-0000-0000-0000-000000000003',
    $q$INSERT INTO public.trip_purchase_marks(trip_id, item_key, marked_by)
       VALUES ('9b000000-0000-0000-0000-000000000001', 'hospedaje:0:x', auth.uid()) RETURNING id::text$q$) LIKE 'ERR:%row-level security%');
SELECT public.rg_ok('RG8 Olga no puede marcar suplantando a Carlos (marked_by ajeno)',
  public.rg_as('9a000000-0000-0000-0000-000000000001',
    $q$INSERT INTO public.trip_purchase_marks(trip_id, item_key, marked_by)
       VALUES ('9b000000-0000-0000-0000-000000000001', 'hospedaje:0:hotel-urban', '9a000000-0000-0000-0000-000000000002') RETURNING id::text$q$) LIKE 'ERR:%row-level security%');
SELECT public.rg_ok('RG9 Pedro (pendiente) no puede marcar',
  public.rg_as('9a000000-0000-0000-0000-000000000004',
    $q$INSERT INTO public.trip_purchase_marks(trip_id, item_key, marked_by)
       VALUES ('9b000000-0000-0000-0000-000000000001', 'auto:0:kayak', auth.uid()) RETURNING id::text$q$) LIKE 'ERR:%row-level security%');
SELECT public.rg_ok('RG10 anon no puede marcar',
  public.rg_anon($q$INSERT INTO public.trip_purchase_marks(trip_id, item_key)
       VALUES ('9b000000-0000-0000-0000-000000000001', 'auto:0:kayak') RETURNING id::text$q$) LIKE 'ERR:%permission denied%');
-- El nombre y la fecha los pone la base: Olga manda "Carlos Ruiz" y una fecha vieja y queda a su nombre, hoy.
SELECT public.rg_ok('RG11 el nombre y la fecha que manda el cliente se ignoran',
  public.rg_as('9a000000-0000-0000-0000-000000000001',
    $q$INSERT INTO public.trip_purchase_marks(trip_id, item_key, category, marked_by, marked_by_name, marked_at)
       VALUES ('9b000000-0000-0000-0000-000000000001', 'hospedaje:0:hotel-urban', 'hotel', auth.uid(), 'Carlos Ruiz', '2020-01-01')
       RETURNING marked_by_name || '|' || (marked_at > now() - interval '1 minute')::text$q$) = 'Olga Pérez|true');
SELECT public.rg_ok('RG12 una sola marca por elemento: Carlos no duplica el hotel que ya marcó Olga',
  public.rg_as('9a000000-0000-0000-0000-000000000002',
    $q$INSERT INTO public.trip_purchase_marks(trip_id, item_key, marked_by)
       VALUES ('9b000000-0000-0000-0000-000000000001', 'hospedaje:0:hotel-urban', auth.uid()) RETURNING id::text$q$) LIKE 'ERR:%trip_purchase_marks_trip_item_key%');
SELECT public.rg_ok('RG13 Lía (sin nombre, con usuario) marca y sale su usuario',
  public.rg_as('9a000000-0000-0000-0000-000000000005',
    $q$INSERT INTO public.trip_purchase_marks(trip_id, item_key, category, marked_by)
       VALUES ('9b000000-0000-0000-0000-000000000001', 'actividad:0:museo', 'activity', auth.uid()) RETURNING marked_by_name$q$) = 'lia.viaja');

-- ───── Actualizar: solo lo propio, sin cambiar de viaje ni de autor ─────
SELECT public.rg_ok('RG14 Carlos no puede quedarse con la marca de Olga (UPDATE de marca ajena)',
  public.rg_as('9a000000-0000-0000-0000-000000000002',
    $q$WITH u AS (UPDATE public.trip_purchase_marks SET marked_by = auth.uid() WHERE item_key = 'hospedaje:0:hotel-urban' RETURNING 1)
       SELECT count(*)::text FROM u$q$) = '0');
SELECT public.rg_ok('RG15 Olga no puede pasar su marca a nombre de Carlos',
  public.rg_as('9a000000-0000-0000-0000-000000000001',
    $q$WITH u AS (UPDATE public.trip_purchase_marks SET marked_by = '9a000000-0000-0000-0000-000000000002' WHERE item_key = 'hospedaje:0:hotel-urban' RETURNING 1)
       SELECT count(*)::text FROM u$q$) LIKE 'ERR:%row-level security%');
SELECT public.rg_as('9a000000-0000-0000-0000-000000000003',
  $q$INSERT INTO public.trip_purchase_marks(trip_id, item_key, marked_by) VALUES ('9b000000-0000-0000-0000-000000000002', 'vuelo:0:roma', auth.uid()) RETURNING id::text$q$);
SELECT public.rg_as('9a000000-0000-0000-0000-000000000003',
    $q$WITH u AS (UPDATE public.trip_purchase_marks SET trip_id = '9b000000-0000-0000-0000-000000000001', marked_at = '2020-01-01'
                  WHERE item_key = 'vuelo:0:roma' RETURNING trip_id::text || '|' || (marked_at > '2021-01-01')::text AS r) SELECT string_agg(r, ',') FROM u$q$) AS rg16 \gset
SELECT public.rg_ok('RG16 un UPDATE no mueve la marca a otro viaje ni cambia su fecha',
  :'rg16' = '9b000000-0000-0000-0000-000000000002|true'
  AND (SELECT trip_id FROM public.trip_purchase_marks WHERE item_key = 'vuelo:0:roma') = '9b000000-0000-0000-0000-000000000002'
  AND NOT EXISTS (SELECT 1 FROM public.trip_purchase_marks WHERE trip_id = '9b000000-0000-0000-0000-000000000001' AND item_key = 'vuelo:0:roma'));

-- ───── Quitar: quien la puso o el dueño ─────
SELECT public.rg_ok('RG17 Carlos (no es dueño) no puede quitar la marca de Olga',
  public.rg_as('9a000000-0000-0000-0000-000000000002',
    $q$WITH d AS (DELETE FROM public.trip_purchase_marks WHERE item_key = 'hospedaje:0:hotel-urban' RETURNING 1) SELECT count(*)::text FROM d$q$) = '0'
  AND EXISTS (SELECT 1 FROM public.trip_purchase_marks WHERE item_key = 'hospedaje:0:hotel-urban'));
SELECT public.rg_ok('RG18 Carlos no puede quitar la marca de Lía (otra colaboradora)',
  public.rg_as('9a000000-0000-0000-0000-000000000002',
    $q$WITH d AS (DELETE FROM public.trip_purchase_marks WHERE item_key = 'actividad:0:museo' RETURNING 1) SELECT count(*)::text FROM d$q$) = '0');
SELECT public.rg_ok('RG19 Sara no puede quitar marcas del viaje de Olga',
  public.rg_as('9a000000-0000-0000-0000-000000000003',
    $q$WITH d AS (DELETE FROM public.trip_purchase_marks WHERE trip_id = '9b000000-0000-0000-0000-000000000001' RETURNING 1) SELECT count(*)::text FROM d$q$) = '0'
  AND (SELECT count(*) FROM public.trip_purchase_marks WHERE trip_id = '9b000000-0000-0000-0000-000000000001') = 3);
-- (El DELETE va en su propia sentencia: una sola sentencia no vería lo que borra el trigger.)
SELECT public.rg_as('9a000000-0000-0000-0000-000000000002',
    $q$WITH d AS (DELETE FROM public.trip_purchase_marks WHERE item_key = 'vuelo:0:iberia' RETURNING 1) SELECT count(*)::text FROM d$q$) AS rg20 \gset
SELECT public.rg_ok('RG20 Carlos quita su propia marca; se va su constancia "marcado a mano" pero no su reserva confirmada',
  :'rg20' = '1'
  AND NOT EXISTS (SELECT 1 FROM public.bookings WHERE id = '9c000000-0000-0000-0000-000000000001')
  AND EXISTS (SELECT 1 FROM public.bookings WHERE id = '9c000000-0000-0000-0000-000000000002' AND status = 'confirmed'));
SELECT public.rg_ok('RG21 Olga (dueña) sí puede quitar la marca de Lía',
  public.rg_as('9a000000-0000-0000-0000-000000000001',
    $q$WITH d AS (DELETE FROM public.trip_purchase_marks WHERE item_key = 'actividad:0:museo' RETURNING 1) SELECT count(*)::text FROM d$q$) = '1');

-- ───── Salir del viaje y borrar ─────
SELECT public.rg_as('9a000000-0000-0000-0000-000000000005',
  $q$INSERT INTO public.trip_purchase_marks(trip_id, item_key, marked_by) VALUES ('9b000000-0000-0000-0000-000000000001', 'restaurante:0:x', auth.uid()) RETURNING id::text$q$);
DELETE FROM public.trip_collaborators WHERE trip_id = '9b000000-0000-0000-0000-000000000001' AND user_id = '9a000000-0000-0000-0000-000000000005';
SELECT public.rg_ok('RG22 Lía ya fuera del viaje no ve marcas, no marca y no quita la suya',
  public.rg_as('9a000000-0000-0000-0000-000000000005', $q$SELECT count(*)::text FROM public.trip_purchase_marks$q$) = '0'
  AND public.rg_as('9a000000-0000-0000-0000-000000000005',
    $q$INSERT INTO public.trip_purchase_marks(trip_id, item_key, marked_by) VALUES ('9b000000-0000-0000-0000-000000000001', 'auto:0:kayak', auth.uid()) RETURNING id::text$q$) LIKE 'ERR:%row-level security%'
  AND public.rg_as('9a000000-0000-0000-0000-000000000005',
    $q$WITH d AS (DELETE FROM public.trip_purchase_marks WHERE item_key = 'restaurante:0:x' RETURNING 1) SELECT count(*)::text FROM d$q$) = '0');
SELECT public.rg_ok('RG23 su marca sigue visible para el grupo',
  public.rg_as('9a000000-0000-0000-0000-000000000002',
    $q$SELECT marked_by_name FROM public.trip_purchase_marks WHERE item_key = 'restaurante:0:x'$q$) = 'lia.viaja');
DELETE FROM auth.users WHERE id = '9a000000-0000-0000-0000-000000000005';
SELECT public.rg_ok('RG24 si se borra la cuenta, la marca queda sin autor ni nombre',
  (SELECT marked_by IS NULL AND marked_by_name IS NULL FROM public.trip_purchase_marks WHERE item_key = 'restaurante:0:x'));
DELETE FROM public.trips WHERE id = '9b000000-0000-0000-0000-000000000001';
SELECT public.rg_ok('RG25 borrar el viaje borra sus marcas',
  NOT EXISTS (SELECT 1 FROM public.trip_purchase_marks WHERE trip_id = '9b000000-0000-0000-0000-000000000001'));
