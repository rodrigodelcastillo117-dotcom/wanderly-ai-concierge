#!/bin/bash
# Operador IATOS (migración 20261029100000_operador): bandera apagada por defecto, candado por incidente,
# idempotencia por marca de agua, despertar con cada mensaje del viajero/proveedor, topes por caso (acciones,
# gasto, UNA búsqueda de vuelos, correos), consentimiento solo desde un mensaje real del viajero, correos a
# proveedores siempre con fuente y en su horario, vínculo de Telegram con código de un solo uso y permisos.
# Construye la base con TODAS las migraciones en orden, comprueba en una COPIA que la migración es idempotente
# y corre operador.sql sobre el estado final real.
# Uso: PGHOST=/ruta/socket PGPORT=5432 supabase/tests/operador/run.sh [nombre_db]
set -u
DIR=$(cd "$(dirname "$0")" && pwd); DB=${1:-iatos_operador_test}
. "$DIR/../lib.sh"
PSQL="psql -U ${PGUSER:-postgres} -q -X"
MIG="$T_MIG/20261029100000_operador.sql"
# 1 de idempotencia + los casos de operador.sql
ESPERADOS=33

main() {
  t_build_db "$DB"
  T_IDEM_OK=1 t_idempotency "$DB" "$MIG"
  $PSQL -At -d "$DB" -f "$DIR/operador.sql" 2>&1 | grep -o 'OK .*\|FALLA.*\|ERROR.*' | sed 's/^ERROR/FALLA ERROR/'
}

main 2>&1 | t_verdict operador "$ESPERADOS"
exit "${PIPESTATUS[1]}"
