#!/bin/bash
# Pruebas SQL de THE PRIVÉ KEY (equipo privekey). Construye la base con TODAS las migraciones del repo en
# orden en un Postgres local desechable (prive_require real del grupo core) y corre key.sql. Uso:
#   PGHOST=/ruta/socket PGPORT=5432 supabase/tests/prive_key/run.sh [nombre_db]
# EXCLUDE=<patrón> omite migraciones (para mostrar el defecto ANTES de la corrección, p. ej.
# EXCLUDE=privekey); con EXCLUDE la suite se espera que FALLE.
# La migración de pg_cron falla en local y sale como AVISO. Salida OK/FALLA/AVISO y un RESUMEN; sale con 1
# si algo falla (../lib.sh).
set -u
DIR=$(cd "$(dirname "$0")" && pwd); DB=${1:-iatos_prive_key_test}
. "$DIR/../lib.sh"
PSQL="psql -U ${PGUSER:-postgres} -q -X"
ESPERADOS=47

main() {
  if [ -z "${EXCLUDE:-}" ]; then
    t_build_db "$DB"
  else
    $PSQL -d postgres -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB" >/dev/null 2>&1
    $PSQL -d "$DB" -f "$T_SEC/00_roles.sql" >/dev/null 2>&1
    $PSQL -d "$DB" -f "$T_SEC/01_supabase_stubs.sql" >/dev/null 2>&1
    local f
    for f in "$T_MIG"/*.sql; do
      if [[ "$(basename "$f")" == *"$EXCLUDE"* ]]; then echo "AVISO OMITIDA $(basename "$f")"; continue; fi
      t_apply "$DB" "$f"
    done
  fi
  $PSQL -d "$DB" -c "CREATE TABLE IF NOT EXISTS auth.sessions (id uuid PRIMARY KEY, user_id uuid, not_after timestamptz, created_at timestamptz DEFAULT now())" >/dev/null
  $PSQL -d "$DB" -f "$DIR/key.sql" 2>&1 | grep -o 'OK .*\|FALLA.*\|ERROR.*' | sed 's/^ERROR/FALLA ERROR/'
}

main 2>&1 | t_verdict prive_key "$ESPERADOS"
exit "${PIPESTATUS[1]}"
