#!/bin/bash
# Pruebas SQL de las ediciones especiales de la tarjeta (member_card_grants.edition: rose_gold | special)
# de 20261027110000_tarjetas_edicion.sql. Construye la base con TODAS las migraciones del repo en orden
# en un Postgres local desechable (la de pg_cron falla en local y sale como AVISO), prueba en una COPIA
# que la migración es idempotente (también reaplicando la de tarjetas_rango antes, en orden) y corre
# edicion.sql sobre el estado final real. Uso:
#   PGHOST=/ruta/socket PGPORT=5432 supabase/tests/tarjetas_edicion/run.sh [nombre_db]
# Salida OK/FALLA/AVISO y un RESUMEN; sale con 1 si algo falla (../lib.sh).
set -u
DIR=$(cd "$(dirname "$0")" && pwd); DB=${1:-iatos_tarjetas_edicion_test}
. "$DIR/../lib.sh"
PSQL="psql -U ${PGUSER:-postgres} -q -X"
MIGS=("$T_MIG/20261027070000_tarjetas_rango.sql" "$T_MIG/20261027110000_tarjetas_edicion.sql")
# 23 de edicion.sql (E0–E22) + 2 de idempotencia.
ESPERADOS=25

main() {
t_build_db "$DB"
T_IDEM_OK=1 t_idempotency "$DB" "${MIGS[@]}"
$PSQL -d "$DB" -f "$DIR/edicion.sql" 2>&1 | grep -o 'OK .*\|FALLA.*\|ERROR.*' | sed 's/^ERROR/FALLA ERROR/'
}

main 2>&1 | t_verdict tarjetas_edicion "$ESPERADOS"
exit "${PIPESTATUS[1]}"
