#!/bin/bash
# Pruebas SQL de las "Ideas" de la Ruleta de inspiración (Explorar de IATOS Privé). Construye la base con TODAS
# las migraciones del repo en orden en un Postgres local desechable (prive_require real) y corre ideas.sql. Uso:
#   PGHOST=/ruta/socket PGPORT=5432 supabase/tests/prive_ideas/run.sh [nombre_db]
# Salida OK/FALLA/AVISO y un RESUMEN; sale con 1 si algo falla (../lib.sh).
set -u
DIR=$(cd "$(dirname "$0")" && pwd); DB=${1:-iatos_prive_ideas_test}
. "$DIR/../lib.sh"
PSQL="psql -U ${PGUSER:-postgres} -q -X"
ESPERADOS=26

main() {
  t_build_db "$DB"
  $PSQL -d "$DB" -c "CREATE TABLE IF NOT EXISTS auth.sessions (id uuid PRIMARY KEY, user_id uuid, not_after timestamptz, created_at timestamptz DEFAULT now())" >/dev/null
  $PSQL -d "$DB" -f "$DIR/ideas.sql" 2>&1 | grep -o 'OK .*\|FALLA.*\|ERROR.*' | sed 's/^ERROR/FALLA ERROR/'
  T_IDEM_OK=1 t_idempotency "$DB" "$T_MIG/20261027060000_prive_ideas.sql"
}

main 2>&1 | t_verdict prive_ideas "$ESPERADOS"
exit "${PIPESTATUS[1]}"
