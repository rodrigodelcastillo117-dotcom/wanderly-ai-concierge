#!/bin/bash
# Pruebas SQL de Concierge 2.0 (migración 20261023130000: app_flags de modelos, tope opcional del Modo
# exigente y concierge_runtime_config) sobre un Postgres local desechable (nunca producción).
# Uso: PGHOST=/ruta/socket PGPORT=5432 ./run.sh [nombre_db]
# Base con TODAS las migraciones en orden; la idempotencia se prueba en una COPIA de la base. Las
# aserciones son RAISE EXCEPTION: un "ERROR" de concierge2.sql sale como "FALLA ERROR". Salida
# OK/FALLA/AVISO y un RESUMEN; sale con 1 si algo falla (../lib.sh).
set -u
DIR=$(cd "$(dirname "$0")" && pwd); DB=${1:-iatos_concierge2_test}
. "$DIR/../lib.sh"
PSQL="psql -U ${PGUSER:-postgres} -q -X"
ESPERADOS=7

main() {
  "$DIR/../security/run.sh" "$DB" 2>&1 | grep -E '^FALLA (migración|stubs|no se pudo)'
  echo "--- idempotencia (segunda pasada de 20261023130000, en una copia de la base) ---"
  T_IDEM_OK=1 t_idempotency "$DB" "$T_MIG"/20261023130000_concierge2_runtime_config.sql
  echo "--- pruebas ---"
  $PSQL -d "$DB" -v ON_ERROR_STOP=1 -f "$DIR/concierge2.sql" 2>&1 | grep -o 'OK .*\|ERROR.*\|FALLA.*' | sed 's/^ERROR/FALLA ERROR/'
}

main 2>&1 | t_verdict concierge2 "$ESPERADOS"
exit "${PIPESTATUS[1]}"
