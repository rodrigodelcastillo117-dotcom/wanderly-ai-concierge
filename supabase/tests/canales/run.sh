#!/bin/bash
# Canales (migración 20261030030000_canales): Iato por Telegram/WhatsApp. Ventana de 24 h de WhatsApp, ubicación
# compartida, acciones propuestas que solo se confirman una vez desde el MISMO chat vinculado (aislamiento entre
# usuarios), preferencias del viajero (canal preferido y horario de no molestar), avisos diferidos y permisos.
# Construye la base con TODAS las migraciones en orden, comprueba en una COPIA que la migración es idempotente
# y corre canales.sql sobre el estado final real.
# Uso: PGHOST=/ruta/socket PGPORT=5432 supabase/tests/canales/run.sh [nombre_db]
set -u
DIR=$(cd "$(dirname "$0")" && pwd); DB=${1:-iatos_canales_test}
. "$DIR/../lib.sh"
PSQL="psql -U ${PGUSER:-postgres} -q -X"
MIG="$T_MIG/20261030030000_canales.sql"
# 1 de idempotencia + los casos de canales.sql
ESPERADOS=28

main() {
  t_build_db "$DB"
  T_IDEM_OK=1 t_idempotency "$DB" "$MIG"
  $PSQL -At -d "$DB" -f "$DIR/canales.sql" 2>&1 | grep -o 'OK .*\|FALLA.*\|ERROR.*' | sed 's/^ERROR/FALLA ERROR/'
}

main 2>&1 | t_verdict canales "$ESPERADOS"
exit "${PIPESTATUS[1]}"
