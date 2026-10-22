#!/bin/bash
# Pruebas SQL de la Bóveda (grupo boveda, migración 20261023190000) sobre un Postgres local
# desechable (nunca producción). Uso: PGHOST=/ruta/socket PGPORT=5432 ./run.sh [nombre_db]
# Base con TODAS las migraciones en orden (vía la suite de seguridad; la de pg_cron falla en local y sale
# como AVISO). Siembra una bóveda "vieja" (jsonb con números) y vuelve a aplicar 20261023190000 dos veces
# sobre la misma base para probar la copia a filas y que es idempotente (ninguna migración posterior
# redefine sus funciones: run_all.sh lo comprueba con el md5 de las funciones contra una base aplicada
# solo en orden) y corre boveda.sql. Salida OK/FALLA/AVISO y un RESUMEN; sale con 1 si algo falla.
set -u
DIR=$(cd "$(dirname "$0")" && pwd); MIG="$DIR/../../migrations"; DB=${1:-iatos_boveda_test}
. "$DIR/../lib.sh"
PSQL="psql -U ${PGUSER:-postgres} -q -X"
ESPERADOS=50

main() {
  "$DIR/../security/run.sh" "$DB" 2>&1 | grep -E '^FALLA (migración|stubs|no se pudo)'
  $PSQL -d "$DB" -v ON_ERROR_STOP=1 -f "$DIR/legacy_seed.sql" 2>&1 | grep -o 'ERROR.*' | sed 's/^/FALLA semilla: /'
  local pass
  for pass in 1 2; do
    t_apply "$DB" "$MIG/20261023190000_boveda.sql" "(pasada $pass) " && echo "OK migración aplicada (pasada $pass, idempotente)"
  done
  $PSQL -d "$DB" -f "$DIR/boveda.sql" 2>&1 | grep -o 'OK .*\|FALLA.*\|ERROR.*' | sed 's/^ERROR/FALLA ERROR/'
}

main 2>&1 | t_verdict boveda "$ESPERADOS"
exit "${PIPESTATUS[1]}"
