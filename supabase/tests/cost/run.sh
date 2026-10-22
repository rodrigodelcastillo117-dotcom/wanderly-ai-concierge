#!/bin/bash
# Pruebas SQL del grupo cost (caché compartida, registro de uso, bolsa de búsquedas en vivo, C-01 y
# reclamo de alertas) sobre un Postgres local desechable (nunca producción).
# Uso: PGHOST=/ruta/socket PGPORT=5432 ./run.sh [nombre_db]
# Base con TODAS las migraciones en orden (la de pg_cron falla en local y sale como AVISO); la
# idempotencia de 20261022142* se prueba en una COPIA de la base. Las aserciones de cost.sql son RAISE
# EXCEPTION: un "ERROR" sale como "FALLA ERROR". Salida OK/FALLA/AVISO y un RESUMEN; sale con 1 si algo
# falla (../lib.sh).
set -u
DIR=$(cd "$(dirname "$0")" && pwd); MIG="$DIR/../../migrations"; DB=${1:-iatos_cost_test}
. "$DIR/../lib.sh"
PSQL="psql -U ${PGUSER:-postgres} -q -X"
ESPERADOS=16

main() {
"$DIR/../security/run.sh" "$DB" 2>&1 | grep -E '^FALLA (migración|stubs|no se pudo)'
echo "--- idempotencia (segunda pasada de 20261022142*, en una copia de la base) ---"
t_idempotency "$DB" "$MIG"/20261022142*.sql
echo "--- pruebas ---"
$PSQL -d "$DB" -v ON_ERROR_STOP=1 -f "$DIR/cost.sql" 2>&1 | grep -o 'OK .*\|ERROR.*' | sed 's/^ERROR/FALLA ERROR/'

# Concurrencia 1: dos búsquedas simultáneas del mismo usuario FREE con 4 de 5 usadas: la sesión A
# toma la 5a y tarda en confirmar; la B espera el candado y recibe quota_exceeded (nunca 6).
U=c0572000-0000-0000-0000-000000000001
$PSQL -d "$DB" -c "INSERT INTO auth.users (id, email, email_confirmed_at) VALUES ('$U', 'cost-carrera@test.mx', now())"
$PSQL -d "$DB" -c "INSERT INTO public.live_search_usage (user_id, day, plan, searches) VALUES ('$U', (now() AT TIME ZONE 'UTC')::date, 'free', 4)"
T=$(mktemp)
$PSQL -d "$DB" -At -c "BEGIN; SELECT public.live_search_take('$U', 1)->>'allowed'; SELECT pg_sleep(2); COMMIT;" > "$T" 2>&1 &
sleep 0.5
S2=$($PSQL -d "$DB" -At -c "SELECT public.live_search_take('$U', 1)->>'reason'")
wait
S1=$(grep -E '^(true|false)$' "$T"); rm -f "$T"
USED=$($PSQL -d "$DB" -At -c "SELECT searches FROM public.live_search_usage WHERE user_id = '$U'")
if [ "$S1" = "true" ] && [ "$S2" = "quota_exceeded" ] && [ "$USED" = "5" ]; then
  echo "OK CONCURRENCIA live_search_take: sesión A tomó la 5a, sesión B simultánea negada, usadas=5"
else
  echo "FALLA CONCURRENCIA live_search_take a=$S1 b=$S2 usadas=$USED"
fi

# Concurrencia 2: dos corridas de price-watch-cron al mismo tiempo reciben alertas distintas.
$PSQL -d "$DB" <<'SQL'
INSERT INTO public.trips (id, user_id, destino, num_viajeros, fecha_salida, fecha_regreso)
SELECT ('c0573000-0000-0000-0000-00000000000' || g)::uuid, 'c0572000-0000-0000-0000-000000000001', 'Destino ' || g, 1, current_date + 20, current_date + 25
  FROM generate_series(1, 6) g;
INSERT INTO public.price_watches (user_id, trip_id, origin_iata, destination_iata, departure_date, baseline_price_mxn)
SELECT 'c0572000-0000-0000-0000-000000000001', ('c0573000-0000-0000-0000-00000000000' || g)::uuid, 'MEX', 'D' || g, current_date + 20, 10000
  FROM generate_series(1, 6) g;
SQL
OUT=$(mktemp -d)
( $PSQL -d "$DB" -At <<'SQL' > "$OUT/a.txt" 2>&1
BEGIN;
SET ROLE service_role;
SELECT string_agg(destination_iata, ',' ORDER BY destination_iata) FROM public.claim_price_watches(3, interval '6 hours') WHERE destination_iata LIKE 'D%';
SELECT pg_sleep(2);
COMMIT;
SQL
) &
sleep 0.5
B=$($PSQL -d "$DB" -At -c "SET ROLE service_role; SELECT string_agg(destination_iata, ',' ORDER BY destination_iata) FROM public.claim_price_watches(3, interval '6 hours') WHERE destination_iata LIKE 'D%';" | grep -v '^SET$')
wait
A=$(grep -E '^D' "$OUT/a.txt"); rm -rf "$OUT"
COMMON=$(comm -12 <(echo "$A" | tr ',' '\n' | sort) <(echo "$B" | tr ',' '\n' | sort) | wc -l)
if [ -n "$A" ] && [ -n "$B" ] && [ "$COMMON" = "0" ]; then
  echo "OK CONCURRENCIA claim_price_watches: A=$A y B=$B (sin repetir; B no esperó a A)"
else
  echo "FALLA CONCURRENCIA claim_price_watches A=$A B=$B comunes=$COMMON"
fi
}

main 2>&1 | t_verdict cost "$ESPERADOS"
exit "${PIPESTATUS[1]}"
