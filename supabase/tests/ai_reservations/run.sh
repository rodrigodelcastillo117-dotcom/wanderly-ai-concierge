#!/bin/bash
# Pruebas SQL de Reservas IA (grupo reservas) sobre un Postgres local desechable (nunca producción).
# Uso: PGHOST=/ruta/socket PGPORT=5432 ./run.sh [nombre_db]
# Reproduce TODAS las migraciones (igual que la suite de seguridad; la de pg_cron falla en local, es
# esperado), vuelve a aplicar las de Reservas IA (incluidas las del cierre de auditoría,
# 20261024*_aud_reservas_* y las de la ronda r2, 20261026*_r2_reservas_*) para probar que son
# idempotentes y corre
# ai_reservations.sql. Imprime solo líneas "OK …" o "FALLA …".
set -u
DIR=$(cd "$(dirname "$0")" && pwd); DB=${1:-iatos_ai_reservations_test}
PSQL="psql -U ${PGUSER:-postgres} -q -X"
"$DIR/../security/run.sh" "$DB" >/dev/null 2>&1
for f in "$DIR"/../../migrations/2026102317*.sql "$DIR"/../../migrations/20261024*_aud_reservas_*.sql "$DIR"/../../migrations/20261026*_r2_reservas_*.sql; do
  [ -f "$f" ] || continue
  out=$($PSQL -v ON_ERROR_STOP=1 -d "$DB" -f "$f" 2>&1 >/dev/null | grep ERROR | head -1)
  [ -n "$out" ] && echo "FALLA migración $(basename "$f") no es idempotente: $out"
done
$PSQL -At -d "$DB" -f "$DIR/ai_reservations.sql" 2>&1 | grep -o 'OK .*\|FALLA.*\|ERROR.*' | sed 's/^ERROR/FALLA ERROR/'
