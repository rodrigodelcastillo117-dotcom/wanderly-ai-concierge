#!/bin/bash
# Vigilancia proactiva (migración 20261030010000_vigilancia): bandera, vuelos candidatos (seguimiento + itinerario
# leído), alta idempotente, reclamo con cupo diario de SerpApi y sin dobles, bitácora y avisos una sola vez,
# confirmaciones solo con fuente y con consentimiento (la base lo vuelve a comprobar al enviar), preferencia del
# viajero apagada por omisión, resumen de la Mesa solo para administradores, RLS y permisos.
# Construye la base con TODAS las migraciones en orden, comprueba en una COPIA que la migración es idempotente
# y corre vigilancia.sql sobre el estado final real.
# Uso: PGHOST=/ruta/socket PGPORT=5432 supabase/tests/vigilancia/run.sh [nombre_db]
set -u
DIR=$(cd "$(dirname "$0")" && pwd); DB=${1:-iatos_vigilancia_test}
. "$DIR/../lib.sh"
PSQL="psql -U ${PGUSER:-postgres} -q -X"
MIG="$T_MIG/20261030010000_vigilancia.sql"
# 1 de idempotencia + los casos de vigilancia.sql
ESPERADOS=36

main() {
  t_build_db "$DB"
  T_IDEM_OK=1 t_idempotency "$DB" "$MIG"
  $PSQL -At -d "$DB" -f "$DIR/vigilancia.sql" 2>&1 | grep -o 'OK .*\|FALLA.*\|ERROR.*' | sed 's/^ERROR/FALLA ERROR/'
}

main 2>&1 | t_verdict vigilancia "$ESPERADOS"
exit "${PIPESTATUS[1]}"
