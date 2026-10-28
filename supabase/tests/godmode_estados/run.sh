#!/bin/bash
# God Mode · Fase 1: estados de reserva seguros y honestos (migración 20261028010000_godmode_estados).
# Construye la base con TODAS las migraciones en orden, comprueba en una COPIA que la migración es
# idempotente y corre estados.sql sobre el estado final real:
#   · aislamiento: A no ve lo de B en reservation_state_v ni en my_open_reservations; anon sin acceso;
#   · mapeo de las cuatro máquinas al vocabulario canónico (CONFIRMED solo con evidencia);
#   · el CHECK nuevo de concierge_requests no rompe los inserts y cambios reales del código;
#   · la normalización 'pending' → 'solicitado' es idempotente y no mueve updated_at.
# Uso: PGHOST=/ruta/socket PGPORT=5432 supabase/tests/godmode_estados/run.sh [nombre_db]
set -u
DIR=$(cd "$(dirname "$0")" && pwd); DB=${1:-iatos_godmode_estados_test}
. "$DIR/../lib.sh"
PSQL="psql -U ${PGUSER:-postgres} -q -X"
MIG="$T_MIG/20261028010000_godmode_estados.sql"
# 1 de idempotencia + G1–G… de estados.sql
ESPERADOS=47

main() {
  t_build_db "$DB"
  T_IDEM_OK=1 t_idempotency "$DB" "$MIG"
  # mig_fix: la migración posterior que redefine reservation_state_v (espejo de "Hablar con una persona",
  # auditoría 10). Tras volver a aplicar esta migración, se aplica también para probar el estado real.
  $PSQL -At -d "$DB" -v mig="$MIG" -v mig_fix="$T_MIG/20261029010000_fix_iato_mesa.sql" -f "$DIR/estados.sql" 2>&1 | grep -o 'OK .*\|FALLA.*\|ERROR.*' | sed 's/^ERROR/FALLA ERROR/'
}

main 2>&1 | t_verdict godmode_estados "$ESPERADOS"
exit "${PIPESTATUS[1]}"
