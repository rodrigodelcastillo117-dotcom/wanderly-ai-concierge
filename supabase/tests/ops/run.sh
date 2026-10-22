#!/bin/bash
# Pruebas de las migraciones de operación (2026102213*: reclamo de vuelos, notify_once, cron_health) en un
# Postgres local desechable (nunca producción). Uso: PGHOST=/ruta/socket PGPORT=5432 ./run.sh [nombre_db]
# Construye la base con TODAS las migraciones en orden (vía ../security/run.sh; la de pg_cron falla en
# local y sale como AVISO). La idempotencia de 2026102213* se prueba en una COPIA de la base: antes se
# volvían a aplicar sobre la base de las pruebas y quedaban versiones viejas de
# clear_active_trip_on_collab_removed y trips_quote_basis_guard (P2-QA-1).
# Cada caso imprime OK/FALLA (antes solo valores para comparar a mano, y la suite no podía fallar:
# P2-QA-2). Salida OK/FALLA/AVISO y un RESUMEN; sale con 1 si algo falla (../lib.sh).
set -u
DIR=$(cd "$(dirname "$0")" && pwd); MIG="$DIR/../../migrations"; DB=${1:-iatos_ops_test}
. "$DIR/../lib.sh"
# 11 de idempotencia + T1–T9 + C1 + C2 (concurrencia).
ESPERADOS=22

main() {
  "$DIR/../security/run.sh" "$DB" 2>&1 | grep -E '^FALLA (migración|stubs|no se pudo)'
  echo "--- idempotencia (segunda pasada de 2026102213*, en una copia de la base) ---"
  T_IDEM_OK=1 t_idempotency "$DB" "$MIG"/2026102213*.sql
  echo "--- pruebas ---"
  psql -U "${PGUSER:-postgres}" -q -X -d "$DB" -f "$DIR/flight_watch_claim.sql" 2>&1 | t_brackets
  psql -U "${PGUSER:-postgres}" -q -X -d "$DB" -f "$DIR/cron_health.sql" 2>&1 | t_brackets
  echo "--- dos sesiones simultáneas ---"
  "$DIR/concurrent_claim.sh" "$DB"
}

main 2>&1 | t_verdict ops "$ESPERADOS"
exit "${PIPESTATUS[1]}"
