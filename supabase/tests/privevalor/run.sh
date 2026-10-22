#!/bin/bash
# Pruebas SQL de privevalor (Privé Drops, Privilege Radar, The Value of Your Privé, Insider's Notebook,
# Before You Go, Privé Passport y métricas). Reproduce TODAS las migraciones del repo en un Postgres local
# desechable (incluida la prive_require real: los miembros de prueba obtienen su sesión Privé con
# prive_unlock), vuelve a aplicar las migraciones de privevalor para probar que son idempotentes y corre
# privevalor.sql. Uso:
#   PGHOST=/ruta/socket PGPORT=5432 supabase/tests/privevalor/run.sh [nombre_db]
# Esperado: solo líneas "OK …". Cualquier "FALLA" o "ERROR" es un error. La migración de pg_cron falla en
# local (la extensión no existe fuera de Supabase); es esperado.
set -u
DIR=$(cd "$(dirname "$0")" && pwd); SEC="$DIR/../security"; MIG="$DIR/../../migrations"; DB=${1:-iatos_privevalor_test}
PSQL="psql -U ${PGUSER:-postgres} -q"
$PSQL -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB" >/dev/null 2>&1
$PSQL -d "$DB" -f "$SEC/00_roles.sql" -f "$SEC/01_supabase_stubs.sql" >/dev/null 2>&1
for f in "$MIG"/*.sql; do
  out=$($PSQL -v ON_ERROR_STOP=1 -d "$DB" -f "$f" 2>&1 >/dev/null | grep ERROR | head -1)
  [ -n "$out" ] && echo "FALLÓ $(basename "$f"): $out"
done
# Idempotencia: las migraciones de privevalor se pueden aplicar otra vez sin error.
for f in "$MIG"/202610241*_privevalor_*.sql; do
  out=$($PSQL -v ON_ERROR_STOP=1 -d "$DB" -f "$f" 2>&1 >/dev/null | grep ERROR | head -1)
  if [ -n "$out" ]; then echo "FALLA migración $(basename "$f") no es idempotente: $out"; else echo "OK idempotente $(basename "$f")"; fi
done
$PSQL -d "$DB" -c "CREATE TABLE IF NOT EXISTS auth.sessions (id uuid PRIMARY KEY, user_id uuid, not_after timestamptz, created_at timestamptz DEFAULT now())" >/dev/null
$PSQL -X -d "$DB" -f "$DIR/privevalor.sql" 2>&1 | grep -o 'OK .*\|FALLA.*\|ERROR.*'
