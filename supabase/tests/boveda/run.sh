#!/bin/bash
# Pruebas SQL de la Bóveda (grupo boveda, migración 20261023190000) sobre un Postgres local
# desechable (nunca producción). Uso: PGHOST=/ruta/socket PGPORT=5432 ./run.sh [nombre_db]
# Reproduce TODAS las migraciones con la suite de seguridad (la de pg_cron falla en local; es
# esperado), siembra una bóveda "vieja" (jsonb con números), vuelve a aplicar la migración para
# probar la copia a filas y que es idempotente, y corre boveda.sql.
# Imprime solo líneas "OK …" o "FALLA …"; cualquier "FALLA" o "ERROR" es un error.
set -u
DIR=$(cd "$(dirname "$0")" && pwd); MIG="$DIR/../../migrations"; DB=${1:-iatos_boveda_test}
PSQL="psql -U ${PGUSER:-postgres} -q -X"
"$DIR/../security/run.sh" "$DB" 2>&1 | grep '^FALLÓ' | grep -v pg_cron || true
$PSQL -d "$DB" -v ON_ERROR_STOP=1 -f "$DIR/legacy_seed.sql" 2>&1 | grep -o 'ERROR.*' | sed 's/^/FALLA semilla: /'
for pass in 1 2; do
  out=$($PSQL -v ON_ERROR_STOP=1 -d "$DB" -f "$MIG/20261023190000_boveda.sql" 2>&1 >/dev/null | grep ERROR | head -1)
  if [ -n "$out" ]; then echo "FALLA migración (pasada $pass): $out"; else echo "OK migración aplicada (pasada $pass, idempotente)"; fi
done
$PSQL -d "$DB" -f "$DIR/boveda.sql" 2>&1 | grep -o 'OK .*\|FALLA.*\|ERROR.*' | sed 's/^ERROR/FALLA ERROR/'
