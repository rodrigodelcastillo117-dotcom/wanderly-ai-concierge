#!/bin/bash
# Pruebas SQL de Concierge 2.0 (migración 20261023130000: app_flags de modelos, tope opcional del Modo
# exigente y concierge_runtime_config) sobre un Postgres local desechable (nunca producción).
# Uso: PGHOST=/ruta/socket PGPORT=5432 ./run.sh [nombre_db]
# Esperado: líneas "OK ..."; cualquier "ERROR"/"FALLA" es un error.
set -u
DIR=$(cd "$(dirname "$0")" && pwd); MIG="$DIR/../../migrations"; DB=${1:-iatos_concierge2_test}
PSQL="psql -U ${PGUSER:-postgres} -q -X"
"$DIR/../security/run.sh" "$DB" 2>&1 | grep '^FALLÓ' | grep -v pg_cron || true
echo "--- idempotencia (segunda pasada de 20261023130000) ---"
out=$($PSQL -v ON_ERROR_STOP=1 -d "$DB" -f "$MIG/20261023130000_concierge2_runtime_config.sql" 2>&1 >/dev/null | grep ERROR | head -1)
if [ -n "$out" ]; then echo "FALLA idempotencia: $out"; else echo "OK idempotente"; fi
echo "--- pruebas ---"
$PSQL -d "$DB" -v ON_ERROR_STOP=1 -f "$DIR/concierge2.sql" 2>&1 | grep -o 'OK .*\|ERROR.*\|FALLA.*' || echo "FALLA concierge2.sql"
