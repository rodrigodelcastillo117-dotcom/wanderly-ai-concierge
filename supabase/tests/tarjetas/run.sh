#!/bin/bash
# Pruebas SQL de las tarjetas de rango (my_member_card, founders, member_card_grants). Construye la base
# con TODAS las migraciones del repo en orden en un Postgres local desechable (la de pg_cron falla en
# local y sale como AVISO), prueba en una COPIA que la migración es idempotente y corre tarjetas.sql
# sobre el estado final real. Uso:
#   PGHOST=/ruta/socket PGPORT=5432 supabase/tests/tarjetas/run.sh [nombre_db]
# Salida OK/FALLA/AVISO y un RESUMEN; sale con 1 si algo falla (../lib.sh).
set -u
DIR=$(cd "$(dirname "$0")" && pwd); DB=${1:-iatos_tarjetas_test}
. "$DIR/../lib.sh"
PSQL="psql -U ${PGUSER:-postgres} -q -X"
MIG="$T_MIG/20261027070000_tarjetas_rango.sql"
# 47 de tarjetas.sql + 1 de idempotencia.
ESPERADOS=48

main() {
t_build_db "$DB"
T_IDEM_OK=1 t_idempotency "$DB" "$MIG"
$PSQL -d "$DB" -f "$DIR/tarjetas.sql" 2>&1 | grep -o 'OK .*\|FALLA.*\|ERROR.*' | sed 's/^ERROR/FALLA ERROR/'
}

main 2>&1 | t_verdict tarjetas "$ESPERADOS"
exit "${PIPESTATUS[1]}"
