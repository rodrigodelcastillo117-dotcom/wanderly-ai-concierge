#!/bin/bash
# Incidentes (migración 20261029080000_incidentes): crear idempotente, forma validada, bitácora, guardia,
# vigilante (sin avance, sin tomar, operador IA caído, mensaje sin respuesta, hora prometida vencida), reparto de
# avisos con reintento, Mesa (tomar, responder, escalar, resolver con nota), cierre solo con confirmación del
# usuario o nota humana, reabrir con severidad mayor, "Mis solicitudes", tiempos medidos y permisos.
# Construye la base con TODAS las migraciones en orden, comprueba en una COPIA que la migración es idempotente
# y corre incidentes.sql sobre el estado final real.
# Uso: PGHOST=/ruta/socket PGPORT=5432 supabase/tests/incidentes/run.sh [nombre_db]
set -u
DIR=$(cd "$(dirname "$0")" && pwd); DB=${1:-iatos_incidentes_test}
. "$DIR/../lib.sh"
PSQL="psql -U ${PGUSER:-postgres} -q -X"
MIG="$T_MIG/20261029080000_incidentes.sql"
# 1 de idempotencia + los casos de incidentes.sql
ESPERADOS=56

main() {
  t_build_db "$DB"
  T_IDEM_OK=1 t_idempotency "$DB" "$MIG"
  $PSQL -At -d "$DB" -f "$DIR/incidentes.sql" 2>&1 | grep -o 'OK .*\|FALLA.*\|ERROR.*' | sed 's/^ERROR/FALLA ERROR/'
}

main 2>&1 | t_verdict incidentes "$ESPERADOS"
exit "${PIPESTATUS[1]}"
