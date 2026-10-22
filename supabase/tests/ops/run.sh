#!/bin/bash
# Reproduce todas las migraciones en un Postgres local desechable (con ../security/run.sh), vuelve a
# correr las migraciones de operación para probar que son idempotentes y corre las pruebas de ops.
# Uso: PGHOST=/ruta/socket PGPORT=5432 ./run.sh [nombre_db]
set -u
DIR=$(cd "$(dirname "$0")" && pwd); MIG="$DIR/../../migrations"; DB=${1:-iatos_ops_test}
"$DIR/../security/run.sh" "$DB" 2>&1 | grep '^FALLÓ' || true
echo "--- idempotencia (segunda pasada de 2026102213*) ---"
for f in "$MIG"/2026102213*.sql; do
  out=$(psql -U "${PGUSER:-postgres}" -q -v ON_ERROR_STOP=1 -d "$DB" -f "$f" 2>&1 >/dev/null | grep ERROR | head -1)
  if [ -n "$out" ]; then echo "FALLÓ $(basename "$f"): $out"; else echo "ok $(basename "$f")"; fi
done
echo "--- pruebas ---"
psql -U "${PGUSER:-postgres}" -q -X -d "$DB" -f "$DIR/flight_watch_claim.sql" 2>&1 | grep -v '^$\|^SET$\|^RESET$'
psql -U "${PGUSER:-postgres}" -q -X -d "$DB" -f "$DIR/cron_health.sql" 2>&1 | grep -v '^$\|^SET$\|^RESET$\|NOTICE\|DETAIL\|drop cascades'
echo "--- dos sesiones simultáneas ---"
"$DIR/concurrent_claim.sh" "$DB"
