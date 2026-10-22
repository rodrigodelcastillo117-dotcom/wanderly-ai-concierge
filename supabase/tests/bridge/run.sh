#!/bin/bash
# Pruebas SQL del Booking Bridge (grupo bridge) sobre un Postgres local desechable (nunca producción).
# Uso: PGHOST=/ruta/socket PGPORT=5432 ./run.sh [nombre_db]
# Reproduce TODAS las migraciones (igual que la suite de seguridad; la de pg_cron falla en local, es
# esperado), comprueba que la migración del bridge sea idempotente y corre bridge.sql.
# Imprime solo líneas "OK …" o "FALLA …".
set -u
DIR=$(cd "$(dirname "$0")" && pwd); DB=${1:-iatos_bridge_test}
PSQL="psql -U ${PGUSER:-postgres} -q -X"
"$DIR/../security/run.sh" "$DB" >/dev/null 2>&1
for f in "$DIR"/../../migrations/202610231800*.sql "$DIR"/../../migrations/20261024*_aud_bridge_*.sql; do
  out=$($PSQL -v ON_ERROR_STOP=1 -d "$DB" -f "$f" 2>&1 >/dev/null | grep ERROR | head -1)
  [ -n "$out" ] && echo "FALLA migración $(basename "$f") no es idempotente: $out"
done
$PSQL -At -d "$DB" -f "$DIR/bridge.sql" 2>&1 | grep -o 'OK .*\|FALLA.*\|ERROR.*' | sed 's/^ERROR/FALLA ERROR/'
