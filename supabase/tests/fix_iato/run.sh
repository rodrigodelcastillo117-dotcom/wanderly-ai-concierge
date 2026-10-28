#!/bin/bash
# Auditoría 10 (migración 20261029010000_fix_iato_mesa): "Hablar con una persona" en Mis solicitudes y en la
# Mesa de operaciones (espejo de fixer_escalations en concierge_requests, sin correos duplicados) y conteos
# de Members Only iguales a la lista. Construye la base con TODAS las migraciones en orden, comprueba en
# una COPIA que la migración es idempotente y corre fix_iato.sql sobre el estado final real.
# Uso: PGHOST=/ruta/socket PGPORT=5432 supabase/tests/fix_iato/run.sh [nombre_db]
set -u
DIR=$(cd "$(dirname "$0")" && pwd); DB=${1:-iatos_fix_iato_test}
. "$DIR/../lib.sh"
PSQL="psql -U ${PGUSER:-postgres} -q -X"
MIG="$T_MIG/20261029010000_fix_iato_mesa.sql"
# 1 de idempotencia + los casos de fix_iato.sql
ESPERADOS=19

main() {
  t_build_db "$DB"
  T_IDEM_OK=1 t_idempotency "$DB" "$MIG"
  $PSQL -At -d "$DB" -f "$DIR/fix_iato.sql" 2>&1 | grep -o 'OK .*\|FALLA.*\|ERROR.*' | sed 's/^ERROR/FALLA ERROR/'
}

main 2>&1 | t_verdict fix_iato "$ESPERADOS"
exit "${PIPESTATUS[1]}"
