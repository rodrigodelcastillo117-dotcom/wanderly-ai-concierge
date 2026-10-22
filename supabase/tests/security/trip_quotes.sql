-- Pruebas de public.trip_quotes y de la base de cotización en trips (migración 20261022133000).
-- Uso: después de run.sh <db>, `psql -d <db> -f trip_quotes.sql`.
-- Esperado: Q1-Q10 con el valor indicado entre corchetes.
\set ON_ERROR_STOP off
\pset tuples_only on
RESET ROLE;
INSERT INTO auth.users(id,email) VALUES
  ('a0000000-0000-0000-0000-00000000000a','q-owner@example.test'),
  ('b0000000-0000-0000-0000-00000000000b','q-attacker@example.test'),
  ('c0000000-0000-0000-0000-00000000000c','q-collab@example.test')
ON CONFLICT DO NOTHING;
INSERT INTO trips(id,user_id,destino,num_viajeros,fecha_salida,fecha_regreso,total_estimado)
VALUES ('a1000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-00000000000a','Madrid',2,'2026-11-10','2026-11-15',100000);
INSERT INTO trip_collaborators(trip_id,user_id,invited_by,status)
VALUES ('a1000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-00000000000c','a0000000-0000-0000-0000-00000000000a','accepted');

SELECT 'Q1 base al crear [2|2026-11-10|f]: '||(quote_basis->>'num_viajeros')||'|'||(quote_basis->>'fecha_salida')||'|'||quote_needs_update
FROM trips WHERE id='a1000000-0000-0000-0000-000000000001';

-- Service role inserta dos cotizaciones: versiones 1 y 2, user_id forzado al dueño.
SET ROLE service_role;
INSERT INTO trip_quotes(trip_id,user_id,origin,total,breakdown,line_items,travelers,nights,rooms,date_from,date_to,fx_rate,fx_source,fx_at,valid_until)
VALUES ('a1000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-00000000000b','analizar-viaje',100000,'{"vuelos":60000,"hospedaje":40000}',
  '[{"category":"vuelos","amount":60000,"state":"COTIZADO"},{"category":"hospedaje","amount":40000,"state":"ESTIMADO"}]',
  2,5,1,'2026-11-10','2026-11-15',18.4,'frankfurter',now(),now()+interval '24 hours');
INSERT INTO trip_quotes(trip_id,user_id,origin,total,line_items,travelers,nights,rooms,fx_rate,fx_source,fx_at,valid_until)
VALUES ('a1000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-00000000000a','editar-viaje-ai',90000,'[]',2,5,1,18.4,'fallback',now(),now()+interval '7 days');
RESET ROLE;
SELECT 'Q2 versiones y dueño [1,2|a0000000-0000-0000-0000-00000000000a]: '||string_agg(version::text,',' ORDER BY version)||'|'||min(user_id::text)
FROM trip_quotes WHERE trip_id='a1000000-0000-0000-0000-000000000001';

-- Estado de renglón inválido: rechazado.
SET ROLE service_role;
INSERT INTO trip_quotes(trip_id,user_id,origin,total,line_items,travelers,nights,fx_rate,fx_source,fx_at,valid_until)
VALUES ('a1000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-00000000000a','analizar-viaje',1,'[{"state":"VERIFICADO"}]',2,5,18,'x',now(),now());
-- Solo inserción: ni el service role puede modificar.
UPDATE trip_quotes SET total=1 WHERE trip_id='a1000000-0000-0000-0000-000000000001';
RESET ROLE;
SELECT 'Q3 sin cambios tras estado inválido y UPDATE [2|100000.00,90000.00]: '||count(*)||'|'||string_agg(total::text,',' ORDER BY version)
FROM trip_quotes WHERE trip_id='a1000000-0000-0000-0000-000000000001';

-- Usuarios: el dueño y el colaborador aceptado leen; el atacante no; nadie inserta.
SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','a0000000-0000-0000-0000-00000000000a',false);
SELECT 'Q4 dueño ve [2]: '||count(*) FROM trip_quotes;
INSERT INTO trip_quotes(trip_id,user_id,origin,total,travelers,nights,fx_rate,fx_source,fx_at,valid_until)
VALUES ('a1000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-00000000000a','analizar-viaje',1,1,1,18,'x',now(),now());
SELECT set_config('request.jwt.claim.sub','c0000000-0000-0000-0000-00000000000c',false);
SELECT 'Q5 colaborador ve [2]: '||count(*) FROM trip_quotes;
SELECT set_config('request.jwt.claim.sub','b0000000-0000-0000-0000-00000000000b',false);
SELECT 'Q6 atacante ve [0]: '||count(*) FROM trip_quotes;
DELETE FROM trip_quotes;
RESET ROLE;
SELECT 'Q7 nada insertado ni borrado por usuarios [2]: '||count(*) FROM trip_quotes WHERE trip_id='a1000000-0000-0000-0000-000000000001';

-- El dueño cambia viajeros: queda para recotizar y la base sigue siendo 2 viajeros.
SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','a0000000-0000-0000-0000-00000000000a',false);
UPDATE trips SET num_viajeros=4 WHERE id='a1000000-0000-0000-0000-000000000001';
-- Intentar limpiar la marca a mano o apuntar a otra cotización no tiene efecto / falla.
UPDATE trips SET quote_needs_update=false, quote_basis='{"num_viajeros":4}' WHERE id='a1000000-0000-0000-0000-000000000001';
RESET ROLE;
SELECT 'Q8 recotizar tras cambiar viajeros [t|2]: '||quote_needs_update||'|'||(quote_basis->>'num_viajeros')
FROM trips WHERE id='a1000000-0000-0000-0000-000000000001';

-- Cotización nueva para 4 viajeros: deja de necesitar actualización.
SET ROLE service_role;
INSERT INTO trip_quotes(trip_id,user_id,origin,total,line_items,travelers,nights,rooms,date_from,date_to,fx_rate,fx_source,fx_at,valid_until)
VALUES ('a1000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-00000000000a','analizar-viaje',180000,'[]',4,5,2,'2026-11-10','2026-11-15',18.4,'frankfurter',now(),now()+interval '24 hours');
UPDATE trips SET current_quote_id=(SELECT id FROM trip_quotes WHERE trip_id='a1000000-0000-0000-0000-000000000001' AND version=3)
WHERE id='a1000000-0000-0000-0000-000000000001';
RESET ROLE;
SELECT 'Q9 nueva cotización [f|4]: '||quote_needs_update||'|'||(quote_basis->>'num_viajeros')
FROM trips WHERE id='a1000000-0000-0000-0000-000000000001';

-- current_quote_id de OTRO viaje: rechazado.
INSERT INTO trips(id,user_id,destino,num_viajeros,total_estimado) VALUES ('b1000000-0000-0000-0000-000000000002','b0000000-0000-0000-0000-00000000000b','Decoy',1,1);
SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','b0000000-0000-0000-0000-00000000000b',false);
UPDATE trips SET current_quote_id=(SELECT 'a1000000-0000-0000-0000-000000000001'::uuid) WHERE id='b1000000-0000-0000-0000-000000000002';
RESET ROLE;
SET ROLE service_role;
UPDATE trips SET current_quote_id=(SELECT id FROM trip_quotes WHERE version=1 AND trip_id='a1000000-0000-0000-0000-000000000001')
WHERE id='b1000000-0000-0000-0000-000000000002';
RESET ROLE;
SELECT 'Q10 viaje ajeno sin cotización ajena [null]: '||coalesce(current_quote_id::text,'null') FROM trips WHERE id='b1000000-0000-0000-0000-000000000002';

-- Borrar el viaje borra sus cotizaciones (cascada).
DELETE FROM trips WHERE id='a1000000-0000-0000-0000-000000000001';
SELECT 'Q11 cascada [0]: '||count(*) FROM trip_quotes WHERE trip_id='a1000000-0000-0000-0000-000000000001';
