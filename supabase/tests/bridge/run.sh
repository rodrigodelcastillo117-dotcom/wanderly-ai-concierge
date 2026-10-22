#!/bin/bash
# Pruebas SQL del Booking Bridge (grupo bridge) sobre un Postgres local desechable (nunca producción).
# Uso: PGHOST=/ruta/socket PGPORT=5432 ./run.sh [nombre_db]
# Construye la base con TODAS las migraciones en orden (vía la suite de seguridad; la de pg_cron falla en
# local y sale como AVISO), comprueba en una COPIA de la base que las migraciones del bridge son
# idempotentes y corre bridge.sql sobre el estado final real. Salida OK/FALLA/AVISO y un RESUMEN; sale
# con 1 si algo falla (../lib.sh).
set -u
DIR=$(cd "$(dirname "$0")" && pwd); DB=${1:-iatos_bridge_test}
. "$DIR/../lib.sh"
PSQL="psql -U ${PGUSER:-postgres} -q -X"
ESPERADOS=42

main() {
  "$DIR/../security/run.sh" "$DB" 2>&1 | grep -E '^FALLA (migración|stubs|no se pudo)'
  t_idempotency "$DB" "$T_MIG"/202610231800*.sql "$T_MIG"/20261024*_aud_bridge_*.sql
  $PSQL -At -d "$DB" -f "$DIR/bridge.sql" 2>&1 | grep -o 'OK .*\|FALLA.*\|ERROR.*' | sed 's/^ERROR/FALLA ERROR/'
}

main 2>&1 | t_verdict bridge "$ESPERADOS"
exit "${PIPESTATUS[1]}"
