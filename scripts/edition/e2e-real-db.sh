#!/bin/bash
# Base LOCAL desechable para la prueba E2E con RPC reales (nunca producción):
# roles y stubs de Supabase + TODAS las migraciones del repo + datos de prueba (e2e-real-setup.sql).
# Uso: PGHOST=/ruta/socket PGPORT=5432 ./e2e-real-db.sh [nombre_db]
set -u
DIR=$(cd "$(dirname "$0")" && pwd); ROOT="$DIR/../.."; DB=${1:-edi_e2e}
PSQL="psql -U ${PGUSER:-postgres} -q -X"
$PSQL -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB" >/dev/null
$PSQL -d "$DB" -f "$ROOT/supabase/tests/security/00_roles.sql" -f "$ROOT/supabase/tests/security/01_supabase_stubs.sql" >/dev/null 2>&1
for f in "$ROOT"/supabase/migrations/*.sql; do
  out=$($PSQL -v ON_ERROR_STOP=1 -d "$DB" -f "$f" 2>&1 >/dev/null | grep ERROR | head -1)
  [ -n "$out" ] && echo "migración con error (esperado solo pg_cron): $(basename "$f"): $out"
done
$PSQL -d "$DB" -c "CREATE TABLE IF NOT EXISTS auth.sessions (id uuid PRIMARY KEY, user_id uuid, not_after timestamptz, created_at timestamptz DEFAULT now())" >/dev/null 2>&1
$PSQL -At -d "$DB" -f "$DIR/e2e-real-setup.sql"
