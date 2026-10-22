#!/bin/bash
# Pruebas SQL del catálogo de IATOS Privé (grupo catalog). Reproduce TODAS las migraciones del repo en
# un Postgres local desechable (incluida la prive_require real del grupo core: un miembro de prueba
# obtiene su sesión Privé con prive_unlock) y corre catalog.sql. Uso:
#   PGHOST=/ruta/socket PGPORT=5432 supabase/tests/prive_catalog/run.sh [nombre_db]
# Esperado: solo líneas "OK …". Cualquier "FALLA" o "ERROR" es un error. La migración de pg_cron falla
# en local (la extensión no existe fuera de Supabase); es esperado.
set -u
DIR=$(cd "$(dirname "$0")" && pwd); SEC="$DIR/../security"; MIG="$DIR/../../migrations"; DB=${1:-iatos_prive_catalog_test}
PSQL="psql -U ${PGUSER:-postgres} -q"
$PSQL -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB" >/dev/null 2>&1
$PSQL -d "$DB" -f "$SEC/00_roles.sql" -f "$SEC/01_supabase_stubs.sql" >/dev/null 2>&1
for f in "$MIG"/*.sql; do
  out=$($PSQL -v ON_ERROR_STOP=1 -d "$DB" -f "$f" 2>&1 >/dev/null | grep ERROR | head -1)
  [ -n "$out" ] && echo "FALLÓ $(basename "$f"): $out"
done
# prive_require es la real del grupo core (20261023090100). auth.sessions existe en Supabase pero no
# en los stubs locales: prive_auth_session_alive la usa (igual que supabase/tests/prive/run.sh).
$PSQL -d "$DB" -c "CREATE TABLE IF NOT EXISTS auth.sessions (id uuid PRIMARY KEY, user_id uuid, not_after timestamptz, created_at timestamptz DEFAULT now())" >/dev/null
$PSQL -X -d "$DB" -f "$DIR/catalog.sql" 2>&1 | grep -o 'OK .*\|FALLA.*\|ERROR.*'
