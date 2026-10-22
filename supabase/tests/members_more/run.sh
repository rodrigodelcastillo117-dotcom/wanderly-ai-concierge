#!/bin/bash
# Pruebas SQL de Members Only "agrega más" (members_venues, members_cities, members_teaser). Construye la
# base con TODAS las migraciones del repo en orden en un Postgres local desechable (la de pg_cron falla en
# local y sale como AVISO), prueba en una COPIA de la base que la migración nueva es idempotente y corre
# members_more.sql sobre el estado final real. Uso:
#   PGHOST=/ruta/socket PGPORT=5432 supabase/tests/members_more/run.sh [nombre_db]
# Salida OK/FALLA/AVISO y un RESUMEN; sale con 1 si algo falla (../lib.sh).
set -u
DIR=$(cd "$(dirname "$0")" && pwd); DB=${1:-iatos_members_more_test}
. "$DIR/../lib.sh"
PSQL="psql -U ${PGUSER:-postgres} -q -X"
ESPERADOS=30

main() {
  t_build_db "$DB"
  t_idempotency "$DB" "$T_MIG"/202610231201*.sql
  $PSQL -d "$DB" -f "$DIR/members_more.sql" 2>&1 | grep -o 'OK .*\|FALLA.*\|ERROR.*' | sed 's/^ERROR/FALLA ERROR/'
}

main 2>&1 | t_verdict members_more "$ESPERADOS"
exit "${PIPESTATUS[1]}"
