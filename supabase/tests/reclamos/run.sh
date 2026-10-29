#!/bin/bash
# Reclamos (migración 20261029090000_reclamos): nadie escribe directo, correo siempre con fuente, envío solo
# con consentimiento y bandera, transiciones, un solo recordatorio, correo entrante idempotente, reenvíos
# ligados por folio solo del mismo usuario, avisos en la app y vistas del operador solo para el equipo.
# Construye la base con TODAS las migraciones en orden, comprueba en una COPIA que la migración es
# idempotente y corre reclamos.sql sobre el estado final real.
# Uso: PGHOST=/ruta/socket PGPORT=5432 supabase/tests/reclamos/run.sh [nombre_db]
set -u
DIR=$(cd "$(dirname "$0")" && pwd); DB=${1:-iatos_reclamos_test}
. "$DIR/../lib.sh"
PSQL="psql -U ${PGUSER:-postgres} -q -X"
MIG="$T_MIG/20261029090000_reclamos.sql"
# 1 de idempotencia + los casos de reclamos.sql
ESPERADOS=35

main() {
  t_build_db "$DB"
  T_IDEM_OK=1 t_idempotency "$DB" "$MIG"
  $PSQL -At -d "$DB" -f "$DIR/reclamos.sql" 2>&1 | grep -o 'OK .*\|FALLA.*\|ERROR.*' | sed 's/^ERROR/FALLA ERROR/'
}

main 2>&1 | t_verdict reclamos "$ESPERADOS"
exit "${PIPESTATUS[1]}"
