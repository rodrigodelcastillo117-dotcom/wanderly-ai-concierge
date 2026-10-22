#!/bin/bash
# [A2] Casos adversariales de la segunda auditoría, convertidos en regresión (ronda r2, grupo reservas).
# Uso: PGHOST=/ruta/socket PGPORT=5432 ./run.sh [nombre_db]
# Construye la base con TODAS las migraciones en orden (vía la suite de seguridad; la de pg_cron falla en
# local y sale como AVISO), sin reaplicar ninguna sobre la base de las pruebas (P2-QA-1), y corre
# a2_adversarial.sql sobre el estado final real. Salida OK/FALLA/AVISO y un RESUMEN; sale con 1 si algo
# falla o si el número de OK no es el esperado (../lib.sh).
set -u
DIR=$(cd "$(dirname "$0")" && pwd); DB=${1:-iatos_ai_reservations_a2_test}
. "$DIR/../lib.sh"
PSQL="psql -U ${PGUSER:-postgres} -q -X"
ESPERADOS=21

main() {
  "$DIR/../security/run.sh" "$DB" 2>&1 | grep -E '^FALLA (migración|stubs|no se pudo)'
  $PSQL -At -d "$DB" -f "$DIR/a2_adversarial.sql" 2>&1 | grep -o 'OK R2.*\|FALLA.*\|ERROR.*' | sed 's/^ERROR/FALLA ERROR/'
}

main 2>&1 | t_verdict ai_reservations_a2 "$ESPERADOS"
exit "${PIPESTATUS[1]}"
