#!/bin/bash
# Pruebas SQL de Reservas IA (grupo reservas) sobre un Postgres local desechable (nunca producción).
# Uso: PGHOST=/ruta/socket PGPORT=5432 ./run.sh [nombre_db]
# Construye la base con TODAS las migraciones en orden (vía la suite de seguridad; la de pg_cron falla en
# local y sale como AVISO), comprueba en una COPIA de la base que las de Reservas IA (incluidas las del
# cierre de auditoría, 20261024*_aud_reservas_*, y las de la ronda r2, 20261026*_r2_reservas_*) son
# idempotentes y corre ai_reservations.sql sobre el estado final real (P2-QA-1). Salida OK/FALLA/AVISO y
# un RESUMEN; sale con 1 si algo falla (../lib.sh).
set -u
DIR=$(cd "$(dirname "$0")" && pwd); DB=${1:-iatos_ai_reservations_test}
. "$DIR/../lib.sh"
PSQL="psql -U ${PGUSER:-postgres} -q -X"
ESPERADOS=57

main() {
  "$DIR/../security/run.sh" "$DB" 2>&1 | grep -E '^FALLA (migración|stubs|no se pudo)'
  t_idempotency "$DB" "$T_MIG"/2026102317*.sql "$T_MIG"/20261024*_aud_reservas_*.sql "$T_MIG"/20261026*_r2_reservas_*.sql
  $PSQL -At -d "$DB" -f "$DIR/ai_reservations.sql" 2>&1 | grep -o 'OK .*\|FALLA.*\|ERROR.*' | sed 's/^ERROR/FALLA ERROR/'
}

main 2>&1 | t_verdict ai_reservations "$ESPERADOS"
exit "${PIPESTATUS[1]}"
