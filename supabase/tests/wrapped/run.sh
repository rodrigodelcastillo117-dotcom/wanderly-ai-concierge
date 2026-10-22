#!/bin/bash
# Pruebas SQL de IATOS Wrapped ("Tu año en viajes"): wrapped_companions(p_year) y las tablas que el
# resumen lee desde el navegador. Construye la base con TODAS las migraciones del repo en orden en un
# Postgres local desechable (la de pg_cron falla en local y sale como AVISO), prueba en una COPIA que la
# migración es idempotente y corre wrapped.sql sobre el estado final real. Uso:
#   PGHOST=/ruta/socket PGPORT=5432 supabase/tests/wrapped/run.sh [nombre_db]
# Salida OK/FALLA/AVISO y un RESUMEN; sale con 1 si algo falla (../lib.sh).
set -u
DIR=$(cd "$(dirname "$0")" && pwd); DB=${1:-iatos_wrapped_test}
. "$DIR/../lib.sh"
PSQL="psql -U ${PGUSER:-postgres} -q"
MIG="$T_MIG/20261026310000_wrapped.sql"
# 21 de wrapped.sql (W0–W20) + 1 de idempotencia.
ESPERADOS=22

main() {
t_build_db "$DB"
T_IDEM_OK=1 t_idempotency "$DB" "$MIG"
$PSQL -X -d "$DB" -f "$DIR/wrapped.sql" 2>&1 | grep -o 'OK .*\|FALLA.*\|ERROR.*' | sed 's/^ERROR/FALLA ERROR/'
}

main 2>&1 | t_verdict wrapped "$ESPERADOS"
exit "${PIPESTATUS[1]}"
