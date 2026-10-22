-- Borrar un viaje con chat de Iato (hallazgo R10, migración 20261022151500).
-- Uso: después de run.sh <db>, `psql -d <db> -f trip_delete_conversation.sql`.
-- Esperado: cada línea "Dn ... [esperado]: real" con real = esperado.
\set ON_ERROR_STOP off
\pset tuples_only on
RESET ROLE;
INSERT INTO auth.users(id,email) VALUES
  ('5d000000-0000-0000-0000-0000000000d5','d-owner@example.test'),
  ('5e000000-0000-0000-0000-0000000000e5','d-nogeneral@example.test'),
  ('5f000000-0000-0000-0000-0000000000f5','d-collab@example.test')
ON CONFLICT DO NOTHING;
INSERT INTO profiles(id) VALUES ('5d000000-0000-0000-0000-0000000000d5'),('5e000000-0000-0000-0000-0000000000e5'),('5f000000-0000-0000-0000-0000000000f5')
ON CONFLICT DO NOTHING;
INSERT INTO trips(id,user_id,destino,num_viajeros,fecha_salida,fecha_regreso) VALUES
  ('5d100000-0000-0000-0000-000000000051','5d000000-0000-0000-0000-0000000000d5','Puebla',2,'2026-12-12','2026-12-14'),
  ('5e100000-0000-0000-0000-000000000051','5e000000-0000-0000-0000-0000000000e5','Mérida',2,'2026-12-12','2026-12-14');
INSERT INTO trip_collaborators(trip_id,user_id,invited_by,status)
VALUES ('5d100000-0000-0000-0000-000000000051','5f000000-0000-0000-0000-0000000000f5','5d000000-0000-0000-0000-0000000000d5','accepted');
-- Dueño: chat del viaje + general. Colaborador: chat del viaje + general. Otro usuario: solo chat del viaje.
INSERT INTO concierge_conversations(user_id,trip_id,messages) VALUES
  ('5d000000-0000-0000-0000-0000000000d5','5d100000-0000-0000-0000-000000000051','[{"role":"user","content":"viaje"}]'),
  ('5d000000-0000-0000-0000-0000000000d5',NULL,'[{"role":"user","content":"general"}]'),
  ('5f000000-0000-0000-0000-0000000000f5','5d100000-0000-0000-0000-000000000051','[{"role":"user","content":"colab viaje"}]'),
  ('5f000000-0000-0000-0000-0000000000f5',NULL,'[{"role":"user","content":"colab general"}]'),
  ('5e000000-0000-0000-0000-0000000000e5','5e100000-0000-0000-0000-000000000051','[{"role":"user","content":"solo viaje"}]');

-- D1: el dueño borra su viaje (antes: 23505 uq_conv_user_general y el viaje no se borraba).
SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','5d000000-0000-0000-0000-0000000000d5',false);
WITH d AS (DELETE FROM trips WHERE id='5d100000-0000-0000-0000-000000000051' RETURNING id)
SELECT 'D1 el dueño borra el viaje con chat [1]: '||count(*) FROM d;
RESET ROLE;
SELECT 'D2 conversaciones del viaje borrado [0]: '||count(*) FROM concierge_conversations WHERE trip_id='5d100000-0000-0000-0000-000000000051';
SELECT 'D3 las generales se conservan intactas [colab general|general]: '||string_agg(messages->0->>'content','|' ORDER BY messages->0->>'content')
  FROM concierge_conversations WHERE trip_id IS NULL AND user_id IN ('5d000000-0000-0000-0000-0000000000d5','5f000000-0000-0000-0000-0000000000f5');
-- D4: sin conversación general, el chat del viaje pasa a ser la general (comportamiento anterior).
SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','5e000000-0000-0000-0000-0000000000e5',false);
WITH d AS (DELETE FROM trips WHERE id='5e100000-0000-0000-0000-000000000051' RETURNING id)
SELECT 'D4 borra viaje sin general [1]: '||count(*) FROM d;
RESET ROLE;
SELECT 'D5 el chat queda como general [solo viaje]: '||string_agg(messages->0->>'content','|') FROM concierge_conversations WHERE user_id='5e000000-0000-0000-0000-0000000000e5' AND trip_id IS NULL;
-- D6: la función del trigger no se puede llamar directo.
SET ROLE authenticated;
SELECT 'D6 authenticated no ejecuta la función [f]: '||has_function_privilege('authenticated','public.trips_before_delete_conversations()','EXECUTE');
RESET ROLE;
