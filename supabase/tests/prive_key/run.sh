#!/bin/bash
# Pruebas SQL de THE PRIVÉ KEY (equipo privekey). Reproduce TODAS las migraciones del repo en un Postgres local
# desechable (prive_require real del grupo core) y corre key.sql. Uso:
#   PGHOST=/ruta/socket PGPORT=5432 supabase/tests/prive_key/run.sh [nombre_db]
# EXCLUDE=<patrón> omite migraciones (para mostrar el defecto ANTES de la corrección, p. ej. EXCLUDE=privekey).
# Esperado: solo líneas "OK …". La migración de pg_cron falla en local (no existe fuera de Supabase).
set -u
DIR=$(cd "$(dirname "$0")" && pwd); SEC="$DIR/../security"; MIG="$DIR/../../migrations"; DB=${1:-iatos_prive_key_test}
PSQL="psql -U ${PGUSER:-postgres} -q"
$PSQL -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB" >/dev/null 2>&1
$PSQL -d "$DB" -f "$SEC/00_roles.sql" -f "$SEC/01_supabase_stubs.sql" >/dev/null 2>&1
for f in "$MIG"/*.sql; do
  if [ -n "${EXCLUDE:-}" ] && [[ "$(basename "$f")" == *"$EXCLUDE"* ]]; then echo "OMITIDA $(basename "$f")"; continue; fi
  out=$($PSQL -v ON_ERROR_STOP=1 -d "$DB" -f "$f" 2>&1 >/dev/null | grep ERROR | head -1)
  [ -n "$out" ] && echo "FALLÓ $(basename "$f"): $out"
done
$PSQL -d "$DB" -c "CREATE TABLE IF NOT EXISTS auth.sessions (id uuid PRIMARY KEY, user_id uuid, not_after timestamptz, created_at timestamptz DEFAULT now())" >/dev/null
$PSQL -X -d "$DB" -f "$DIR/key.sql" 2>&1 | grep -o 'OK .*\|FALLA.*\|ERROR.*'
