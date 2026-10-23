#!/bin/bash
# Pruebas SQL de Gastos del viaje estilo Splitwise (20261027020000_gastos_split.sql): miembros reales, partes
# que suman el total, quién pagó, liquidar, foto del ticket y RLS con intentos de abuso. Construye la base con
# TODAS las migraciones del repo en orden en un Postgres local desechable (la de pg_cron falla en local y sale
# como AVISO), prueba en una COPIA que la migración es idempotente, corre gastos.sql sobre el estado final real
# y, en otra COPIA, que los nombres escritos a mano y los gastos viejos se migran sin perder nada. Uso:
#   PGHOST=/ruta/socket PGPORT=5432 supabase/tests/gastos/run.sh [nombre_db]
# Salida OK/FALLA/AVISO y un RESUMEN; sale con 1 si algo falla (../lib.sh).
set -u
DIR=$(cd "$(dirname "$0")" && pwd); DB=${1:-iatos_gastos_test}
. "$DIR/../lib.sh"
PSQL="psql -U ${PGUSER:-postgres} -q"
MIG="$T_MIG/20261027020000_gastos_split.sql"
# 48 de gastos.sql (GS0–GS47) + 4 de la copia con datos viejos (GB1–GB4).
ESPERADOS=52

legacy() {
  local copy="${DB}_legacy" Q
  if ! t_copy_db "$DB" "$copy"; then echo "FALLA GB no se pudo copiar la base $DB"; return; fi
  Q="$PSQL -X -At -d $copy"
  # Datos como los dejó la versión anterior: personas escritas a mano y gastos sin partes (se apagan los
  # triggers nuevos para insertarlos tal cual estaban).
  $Q >/dev/null 2>&1 <<'SQL'
INSERT INTO auth.users(id, email) VALUES
  ('b1000000-0000-0000-0000-000000000001', 'gb-rodrigo@example.test'), ('b1000000-0000-0000-0000-000000000002', 'gb-ana1@example.test'),
  ('b1000000-0000-0000-0000-000000000003', 'gb-ana2@example.test'), ('b1000000-0000-0000-0000-000000000004', 'gb-bea@example.test')
ON CONFLICT DO NOTHING;
INSERT INTO public.profiles(id) SELECT id FROM auth.users WHERE id::text LIKE 'b1000000-%' ON CONFLICT DO NOTHING;
UPDATE public.profiles SET full_name = 'Rodrigo del Castillo' WHERE id = 'b1000000-0000-0000-0000-000000000001';
UPDATE public.profiles SET full_name = 'Ana López' WHERE id = 'b1000000-0000-0000-0000-000000000002';
UPDATE public.profiles SET full_name = 'Ana María Ruiz' WHERE id = 'b1000000-0000-0000-0000-000000000003';
UPDATE public.profiles SET full_name = 'Beatriz Soto', username = 'bea' WHERE id = 'b1000000-0000-0000-0000-000000000004';
INSERT INTO public.trips(id, user_id, destino) VALUES ('b2000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', 'Roma → Florencia → Venecia');
INSERT INTO public.trip_collaborators(trip_id, user_id, invited_by, status) VALUES
  ('b2000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-000000000001', 'accepted'),
  ('b2000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000003', 'b1000000-0000-0000-0000-000000000001', 'accepted'),
  ('b2000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000004', 'b1000000-0000-0000-0000-000000000001', 'accepted');
DELETE FROM public.trip_split_people WHERE trip_id = 'b2000000-0000-0000-0000-000000000001';
INSERT INTO public.trip_split_people(id, trip_id, name, created_at) VALUES
  ('b3000000-0000-0000-0000-000000000001', 'b2000000-0000-0000-0000-000000000001', 'Rodrigo', '2026-10-01 10:00+00'),
  ('b3000000-0000-0000-0000-000000000002', 'b2000000-0000-0000-0000-000000000001', 'Ana', '2026-10-01 10:01+00'),
  ('b3000000-0000-0000-0000-000000000003', 'b2000000-0000-0000-0000-000000000001', 'Bea', '2026-10-01 10:02+00');
ALTER TABLE public.trip_split_expenses DISABLE TRIGGER USER;
INSERT INTO public.trip_split_expenses(id, trip_id, payer_id, amount, currency, description) VALUES
  ('b4000000-0000-0000-0000-000000000001', 'b2000000-0000-0000-0000-000000000001', 'b3000000-0000-0000-0000-000000000001', 100, 'MXN', 'Cena'),
  ('b4000000-0000-0000-0000-000000000002', 'b2000000-0000-0000-0000-000000000001', 'b3000000-0000-0000-0000-000000000003', 50, 'EUR', 'Museo');
ALTER TABLE public.trip_split_expenses ENABLE TRIGGER USER;
SQL
  t_apply "$copy" "$MIG" "(copia con datos viejos) " || { $PSQL -X -d postgres -c "DROP DATABASE IF EXISTS $copy" >/dev/null 2>&1; return; }
  local r
  r=$($Q -c "SELECT string_agg(p.name || ':' || s.amount::text, ',' ORDER BY e.description, p.created_at) FROM public.trip_split_shares s
              JOIN public.trip_split_people p ON p.id = s.person_id JOIN public.trip_split_expenses e ON e.id = s.expense_id
             WHERE e.trip_id = 'b2000000-0000-0000-0000-000000000001'")
  if [ "$r" = "Rodrigo:33.34,Ana:33.33,Bea:33.33,Rodrigo:16.67,Ana:16.67,Bea:16.66" ]; then
    echo "OK GB1 los gastos viejos quedan en partes iguales entre las personas que había (los mismos saldos que mostraba la app)"
  else echo "FALLA GB1 partes: $r"; fi
  r=$($Q -c "SELECT string_agg(name || ':' || coalesce(member_id::text, 'sin app') || ':' || linked_by_name::text, ',' ORDER BY created_at)
               FROM public.trip_split_people WHERE trip_id = 'b2000000-0000-0000-0000-000000000001' AND id::text LIKE 'b3%'")
  if [ "$r" = "Rodrigo:b1000000-0000-0000-0000-000000000001:true,Ana:sin app:false,Bea:b1000000-0000-0000-0000-000000000004:true" ]; then
    echo "OK GB2 los nombres a mano se conservan: 'Rodrigo' y 'Bea' se ligan a su miembro; 'Ana' (dos Anas en el viaje) queda sin app"
  else echo "FALLA GB2 personas: $r"; fi
  r=$($Q -c "SELECT string_agg(p.name || ':' || (SELECT count(*) FROM public.trip_split_shares s WHERE s.person_id = p.id), ',' ORDER BY p.name)
               FROM public.trip_split_people p WHERE p.trip_id = 'b2000000-0000-0000-0000-000000000001' AND p.id::text NOT LIKE 'b3%'")
  if [ "$r" = "Ana López:0,Ana María Ruiz:0" ]; then
    echo "OK GB3 los miembros que faltaban se agregan sin cambiar los gastos viejos"
  else echo "FALLA GB3 nuevos: $r"; fi
  t_apply "$copy" "$MIG" "(copia con datos viejos, segunda pasada) " >/dev/null
  r=$($Q -c "SELECT (SELECT count(*) FROM public.trip_split_people WHERE trip_id = 'b2000000-0000-0000-0000-000000000001') || '|' ||
                    (SELECT count(*) FROM public.trip_split_shares WHERE trip_id = 'b2000000-0000-0000-0000-000000000001')")
  if [ "$r" = "5|6" ]; then echo "OK GB4 repetir la migración no duplica personas ni partes"; else echo "FALLA GB4 conteo: $r"; fi
  $PSQL -X -d postgres -c "DROP DATABASE IF EXISTS $copy" >/dev/null 2>&1
}

main() {
t_build_db "$DB"
t_idempotency "$DB" "$MIG"
$PSQL -X -d "$DB" -f "$DIR/gastos.sql" 2>&1 | grep -o 'OK .*\|FALLA.*\|ERROR.*' | sed 's/^ERROR/FALLA ERROR/'
legacy
}

main 2>&1 | t_verdict gastos "$ESPERADOS"
exit "${PIPESTATUS[1]}"
