#!/bin/bash
# Pruebas SQL de "Ya lo reservé" compartido en el viaje (r2 grupo, trip_purchase_marks). Construye la base con
# TODAS las migraciones del repo en orden en un Postgres local desechable (la de pg_cron falla en local y sale
# como AVISO), prueba en una COPIA que la migración es idempotente, corre grupo.sql sobre el estado final real
# y, en otra COPIA, que la copia de las marcas viejas de bookings hace lo correcto. Uso:
#   PGHOST=/ruta/socket PGPORT=5432 supabase/tests/grupo/run.sh [nombre_db]
# Salida OK/FALLA/AVISO y un RESUMEN; sale con 1 si algo falla (../lib.sh).
set -u
DIR=$(cd "$(dirname "$0")" && pwd); DB=${1:-iatos_grupo_test}
. "$DIR/../lib.sh"
PSQL="psql -U ${PGUSER:-postgres} -q"
MIG="$T_MIG/20261026300000_r2_grupo_reservado.sql"
# 26 de grupo.sql (RG0–RG25) + 4 de la copia de marcas viejas (RB1–RB4).
ESPERADOS=30

backfill() {
  local copy="${DB}_bf" Q
  if ! t_copy_db "$DB" "$copy"; then echo "FALLA RB no se pudo copiar la base $DB"; return; fi
  Q="$PSQL -X -At -d $copy"
  # Marcas hechas con la versión anterior de la app (solo en bookings): Carlos (colaborador) y luego Olga
  # marcan el mismo hotel; Sara (no miembro) tiene una fila con ese viaje; una cancelada no cuenta.
  $Q >/dev/null 2>&1 <<'SQL'
INSERT INTO auth.users(id, email) VALUES
  ('9d000000-0000-0000-0000-000000000001', 'rb-olga@example.test'), ('9d000000-0000-0000-0000-000000000002', 'rb-carlos@example.test'),
  ('9d000000-0000-0000-0000-000000000003', 'rb-sara@example.test') ON CONFLICT DO NOTHING;
INSERT INTO public.profiles(id) SELECT id FROM auth.users WHERE id::text LIKE '9d000000-%' ON CONFLICT DO NOTHING;
UPDATE public.profiles SET full_name = 'Carlos Ruiz' WHERE id = '9d000000-0000-0000-0000-000000000002';
INSERT INTO public.trips(id, user_id, destino) VALUES ('9e000000-0000-0000-0000-000000000001', '9d000000-0000-0000-0000-000000000001', 'Lisboa');
INSERT INTO public.trip_collaborators(trip_id, user_id, invited_by, status) VALUES
  ('9e000000-0000-0000-0000-000000000001', '9d000000-0000-0000-0000-000000000002', '9d000000-0000-0000-0000-000000000001', 'accepted');
INSERT INTO public.bookings(user_id, trip_id, category, provider, status, title, raw_payload, created_at) VALUES
  ('9d000000-0000-0000-0000-000000000002', '9e000000-0000-0000-0000-000000000001', 'hotel', 'Booking.com', 'pending', 'Hotel', '{"compra_item":"hospedaje:0:hotel"}', '2026-10-01 10:00+00'),
  ('9d000000-0000-0000-0000-000000000001', '9e000000-0000-0000-0000-000000000001', 'hotel', 'Booking.com', 'pending', 'Hotel', '{"compra_item":"hospedaje:0:hotel"}', '2026-10-05 10:00+00'),
  ('9d000000-0000-0000-0000-000000000003', '9e000000-0000-0000-0000-000000000001', 'car', 'Kayak', 'pending', 'Auto', '{"compra_item":"auto:0:kayak"}', '2026-10-02 10:00+00'),
  ('9d000000-0000-0000-0000-000000000001', '9e000000-0000-0000-0000-000000000001', 'flight', 'Google Flights', 'cancelled', 'Vuelo', '{"compra_item":"vuelo:0:x"}', '2026-10-03 10:00+00'),
  ('9d000000-0000-0000-0000-000000000001', '9e000000-0000-0000-0000-000000000001', 'activity', 'GetYourGuide', 'pending', 'Museo', '{"compra_item":"actividad:0:museo"}', '2026-10-04 10:00+00');
SQL
  t_apply "$copy" "$MIG" "(copia de marcas viejas) " || { $PSQL -X -d postgres -c "DROP DATABASE IF EXISTS $copy" >/dev/null 2>&1; return; }
  local hotel n1 n2
  hotel=$($Q -c "SELECT marked_by || '|' || marked_by_name || '|' || to_char(marked_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') FROM public.trip_purchase_marks WHERE trip_id = '9e000000-0000-0000-0000-000000000001' AND item_key = 'hospedaje:0:hotel'")
  if [ "$hotel" = "9d000000-0000-0000-0000-000000000002|Carlos Ruiz|2026-10-01" ]; then echo "OK RB1 la marca vieja de Carlos pasa al grupo con su nombre y su fecha original (gana la primera)"; else echo "FALLA RB1 hotel: $hotel"; fi
  n1=$($Q -c "SELECT string_agg(item_key, ',' ORDER BY item_key) FROM public.trip_purchase_marks WHERE trip_id = '9e000000-0000-0000-0000-000000000001'")
  if [ "$n1" = "actividad:0:museo,hospedaje:0:hotel" ]; then echo "OK RB2 no se copian la marca de un no miembro ni las canceladas"; else echo "FALLA RB2 marcas: $n1"; fi
  t_apply "$copy" "$MIG" "(copia de marcas viejas, segunda pasada) " >/dev/null
  n2=$($Q -c "SELECT count(*) FROM public.trip_purchase_marks WHERE trip_id = '9e000000-0000-0000-0000-000000000001'")
  if [ "$n2" = "2" ]; then echo "OK RB3 repetir la migración no duplica marcas"; else echo "FALLA RB3 count=$n2"; fi
  n2=$($Q -c "SELECT count(*) FROM public.bookings WHERE trip_id = '9e000000-0000-0000-0000-000000000001'")
  if [ "$n2" = "5" ]; then echo "OK RB4 la copia no toca bookings"; else echo "FALLA RB4 bookings=$n2"; fi
  $PSQL -X -d postgres -c "DROP DATABASE IF EXISTS $copy" >/dev/null 2>&1
}

main() {
t_build_db "$DB"
t_idempotency "$DB" "$MIG"
$PSQL -X -d "$DB" -f "$DIR/grupo.sql" 2>&1 | grep -o 'OK .*\|FALLA.*\|ERROR.*' | sed 's/^ERROR/FALLA ERROR/'
backfill
}

main 2>&1 | t_verdict grupo "$ESPERADOS"
exit "${PIPESTATUS[1]}"
