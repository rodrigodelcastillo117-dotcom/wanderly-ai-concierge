#!/bin/bash
# Pruebas SQL de Members Only "agrega más" (members_venues, members_cities, members_teaser). Reproduce
# TODAS las migraciones del repo en un Postgres local desechable, vuelve a aplicar la migración nueva
# (idempotencia) y corre members_more.sql. Uso:
#   PGHOST=/ruta/socket PGPORT=5432 supabase/tests/members_more/run.sh [nombre_db]
# Esperado: solo líneas "OK …". Cualquier "FALLA" o "ERROR" es un error. La migración de pg_cron falla
# en local (la extensión no existe fuera de Supabase); es esperado.
set -u
DIR=$(cd "$(dirname "$0")" && pwd); SEC="$DIR/../security"; MIG="$DIR/../../migrations"; DB=${1:-iatos_members_more_test}
PSQL="psql -U ${PGUSER:-postgres} -q"
$PSQL -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB" >/dev/null 2>&1
$PSQL -d "$DB" -f "$SEC/00_roles.sql" -f "$SEC/01_supabase_stubs.sql" >/dev/null 2>&1
for f in "$MIG"/*.sql; do
  out=$($PSQL -v ON_ERROR_STOP=1 -d "$DB" -f "$f" 2>&1 >/dev/null | grep ERROR | head -1)
  [ -n "$out" ] && echo "FALLÓ $(basename "$f"): $out"
done
for f in "$MIG"/202610231201*.sql; do
  out=$($PSQL -v ON_ERROR_STOP=1 -d "$DB" -f "$f" 2>&1 >/dev/null | grep ERROR | head -1)
  [ -n "$out" ] && echo "FALLA migración $(basename "$f") no es idempotente: $out"
done
$PSQL -X -d "$DB" -f "$DIR/members_more.sql" 2>&1 | grep -o 'OK .*\|FALLA.*\|ERROR.*'
