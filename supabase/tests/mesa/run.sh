#!/bin/bash
# Mesa de operaciones (migración 20261028180000_mesa_operaciones). Construye la base con TODAS las
# migraciones en orden, comprueba en una COPIA que la migración es idempotente y corre mesa.sql sobre el
# estado final real:
#   · permisos: un no-admin (ni anon, ni la llave de servicio sin persona) no lista ni transiciona;
#   · RLS: un usuario no ve solicitudes, historial ni respuestas de otro;
#   · transiciones válidas e inválidas de solicitudes, Privé (prive_request_transition) y reservas IA
#     (ai_reservation_transition), con historial (quién, cuándo, de qué estado a cuál);
#   · correos: marca de enviado sin duplicados, registro de la falla y reintento.
# Uso: PGHOST=/ruta/socket PGPORT=5432 supabase/tests/mesa/run.sh [nombre_db]
set -u
DIR=$(cd "$(dirname "$0")" && pwd); DB=${1:-iatos_mesa_test}
. "$DIR/../lib.sh"
PSQL="psql -U ${PGUSER:-postgres} -q -X"
MIG="$T_MIG/20261028180000_mesa_operaciones.sql"
# 1 de idempotencia + los casos de mesa.sql
ESPERADOS=67

main() {
  t_build_db "$DB"
  T_IDEM_OK=1 t_idempotency "$DB" "$MIG"
  $PSQL -At -d "$DB" -f "$DIR/mesa.sql" 2>&1 | grep -o 'OK .*\|FALLA.*\|ERROR.*' | sed 's/^ERROR/FALLA ERROR/'
}

main 2>&1 | t_verdict mesa "$ESPERADOS"
exit "${PIPESTATUS[1]}"
