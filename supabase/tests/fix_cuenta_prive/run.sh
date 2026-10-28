#!/bin/bash
# Pruebas SQL de 20261029020000_fix_cuenta_prive: prive_status() dice de dónde viene el PRO (pagado,
# prueba o cortesía; la auditoría P1-1 vio a una cuenta de cortesía con "0 de 90 días" sin saber que la
# cortesía nunca suma) y el panel editorial responde 42501/403 (no 400) a quien no es admin. Construye la base con TODAS las migraciones en orden en un Postgres local
# desechable y corre fix_cuenta_prive.sql. Uso:
#   PGHOST=/ruta/socket PGPORT=5432 supabase/tests/fix_cuenta_prive/run.sh [nombre_db]
# Salida OK/FALLA/AVISO y un RESUMEN; sale con 1 si algo falla (../lib.sh).
set -u
DIR=$(cd "$(dirname "$0")" && pwd); DB=${1:-iatos_fix_cuenta_prive_test}
. "$DIR/../lib.sh"
PSQL="psql -U ${PGUSER:-postgres} -q -X"
# 12 casos de fix_cuenta_prive.sql + 1 de idempotencia.
ESPERADOS=13

main() {
  t_build_db "$DB"
  T_IDEM_OK=1 t_idempotency "$DB" "$T_MIG/20261029020000_fix_cuenta_prive.sql"
  $PSQL -d "$DB" -f "$DIR/fix_cuenta_prive.sql" 2>&1 | grep -o 'OK .*\|FALLA.*\|ERROR.*' | sed 's/^ERROR/FALLA ERROR/'
}

main 2>&1 | t_verdict fix_cuenta_prive "$ESPERADOS"
exit "${PIPESTATUS[1]}"
