#!/bin/bash
# Pruebas SQL de pagos y cuota sobre un Postgres local desechable (nunca producción).
# Uso: PGHOST=/ruta/socket PGPORT=5432 ./run.sh [nombre_db]
# Esperado: líneas "OK ..." y al final "OK CONCURRENCIA ...". Cualquier "FALLA" es un error.
set -u
DIR=$(cd "$(dirname "$0")" && pwd); DB=${1:-iatos_pay_test}
PSQL="psql -U ${PGUSER:-postgres} -q -X"
# Reproduce todas las migraciones (la de pg_cron falla en local; es esperado).
"$DIR/../security/run.sh" "$DB" >/dev/null 2>&1
$PSQL -d "$DB" -v ON_ERROR_STOP=1 -f "$DIR/payments.sql" 2>&1 | grep -o 'OK .*\|ERROR.*' || echo "FALLA payments.sql"

# Concurrencia: la sesión 1 consume el análisis gratis y tarda en confirmar; la sesión 2 llega en
# medio. Con el UPDATE condicional, la 2 espera el candado y luego ve el contador en 1 → negada.
T=$(mktemp)
U=22222222-0000-0000-0000-000000000001
$PSQL -d "$DB" -c "INSERT INTO auth.users (id, email, email_confirmed_at) VALUES ('$U', 'carrera@test.mx', now())"
$PSQL -d "$DB" -At -c "BEGIN; SELECT public.consume_free_quota('$U', 'trip_analysis')->>'allowed'; SELECT pg_sleep(2); COMMIT;" \
  > "$T" 2>&1 &
sleep 0.5
S2=$($PSQL -d "$DB" -At -c "SELECT public.consume_free_quota('$U', 'trip_analysis')->>'reason'")
wait
S1=$(grep -E "^(true|false)$" "$T"); rm -f "$T"
USED=$($PSQL -d "$DB" -At -c "SELECT trips_analyzed_used FROM public.usage_limits WHERE user_id = '$U'")
if [ "$S1" = "true" ] && [ "$S2" = "quota_exceeded" ] && [ "$USED" = "1" ]; then
  echo "OK CONCURRENCIA trip_analysis: sesión 1 permitida, sesión 2 simultánea negada, contador=1"
else
  echo "FALLA CONCURRENCIA s1=$S1 s2=$S2 usados=$USED"
fi
