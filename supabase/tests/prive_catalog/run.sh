#!/bin/bash
# Pruebas SQL del catálogo de IATOS Privé (grupo catalog). Construye la base con TODAS las migraciones del
# repo en orden en un Postgres local desechable (incluida la prive_require real del grupo core: un
# miembro de prueba obtiene su sesión Privé con prive_unlock) y corre catalog.sql. Uso:
#   PGHOST=/ruta/socket PGPORT=5432 supabase/tests/prive_catalog/run.sh [nombre_db]
# La migración de pg_cron falla en local y sale como AVISO. Salida OK/FALLA/AVISO y un RESUMEN; sale con 1
# si algo falla (../lib.sh).
set -u
DIR=$(cd "$(dirname "$0")" && pwd); DB=${1:-iatos_prive_catalog_test}
. "$DIR/../lib.sh"
PSQL="psql -U ${PGUSER:-postgres} -q -X"
ESPERADOS=110

main() {
  t_build_db "$DB"
  # auth.sessions ya está en los stubs (01_supabase_stubs.sql); esto queda por compatibilidad con bases viejas.
  $PSQL -d "$DB" -c "CREATE TABLE IF NOT EXISTS auth.sessions (id uuid PRIMARY KEY, user_id uuid, not_after timestamptz, created_at timestamptz DEFAULT now())" >/dev/null 2>&1
  $PSQL -d "$DB" -f "$DIR/catalog.sql" 2>&1 | grep -o 'OK .*\|FALLA.*\|ERROR.*' | sed 's/^ERROR/FALLA ERROR/'
}

main 2>&1 | t_verdict prive_catalog "$ESPERADOS"
exit "${PIPESTATUS[1]}"
