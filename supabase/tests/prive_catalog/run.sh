#!/bin/bash
# Pruebas SQL del catálogo de IATOS Privé (grupo catalog). Reproduce TODAS las migraciones del repo en
# un Postgres local desechable, carga el stub de prive_require (solo para pruebas: la función real la
# crea el grupo core en otra rama) y corre catalog.sql. Uso:
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
# Si la rama ya trae la prive_require real (grupo core), el stub NO la reemplaza.
if [ "$($PSQL -tA -d "$DB" -c "select count(*) from pg_proc where proname='prive_require'")" = "0" ]; then
  $PSQL -v ON_ERROR_STOP=1 -d "$DB" -f "$DIR/00_stub_prive_require.sql" >/dev/null || echo "ERROR cargando el stub"
else
  echo "AVISO: prive_require real presente; catalog.sql usa el stub de sesiones y puede requerir ajustes"
fi
$PSQL -X -d "$DB" -f "$DIR/catalog.sql" 2>&1 | grep -o 'OK .*\|FALLA.*\|ERROR.*'
