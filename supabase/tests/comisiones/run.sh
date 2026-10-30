#!/bin/bash
# Comisiones y reservas gestionadas (migración 20261030020000_comisiones): banderas (lectura prendida, todo lo que
# mueve dinero apagado), libro de clics (normalizado en el servidor, sin duplicar entre affiliate_clicks, bookings y
# booking-go), libro de comisiones (idempotente, una pagada no retrocede), reservas gestionadas (folio, idempotencia,
# sandbox sin dinero, confirmación del Booking Bridge con evidencia del proveedor), solicitudes del Operador (candado,
# consentimiento real del viajero con folio, política del proveedor, sin ejecutar), aprobación humana, ejecución
# una sola vez, tokens de webhook, cargo por servicio y tablero solo para administradores.
# Construye la base con TODAS las migraciones en orden, comprueba en una COPIA que la migración es idempotente
# y corre comisiones.sql sobre el estado final real.
# Uso: PGHOST=/ruta/socket PGPORT=5432 supabase/tests/comisiones/run.sh [nombre_db]
set -u
DIR=$(cd "$(dirname "$0")" && pwd); DB=${1:-iatos_comisiones_test}
. "$DIR/../lib.sh"
PSQL="psql -U ${PGUSER:-postgres} -q -X"
MIG="$T_MIG/20261030020000_comisiones.sql"
# 1 de idempotencia + los 27 casos de comisiones.sql
ESPERADOS=28

main() {
  t_build_db "$DB"
  T_IDEM_OK=1 t_idempotency "$DB" "$MIG"
  $PSQL -At -d "$DB" -f "$DIR/comisiones.sql" 2>&1 | grep -o 'OK .*\|FALLA.*\|ERROR.*' | sed 's/^ERROR/FALLA ERROR/'
}

main 2>&1 | t_verdict comisiones "$ESPERADOS"
exit "${PIPESTATUS[1]}"
