#!/bin/bash
# Pruebas SQL de 20261027130000_prive_sesion_larga (contraseña Privé de 8 caracteres y sesión recordada de
# 365 días deslizantes que se sigue cerrando al perder el derecho, al cerrar sesión en IATOS, al cambiar la
# contraseña, con "Cerrar todas mis sesiones", con el bloqueo total y con la revocación). Construye la base
# con TODAS las migraciones en orden en un Postgres local desechable y corre sesion_larga.sql. Uso:
#   PGHOST=/ruta/socket PGPORT=5432 supabase/tests/prive_sesion/run.sh [nombre_db]
# Salida OK/FALLA/AVISO y un RESUMEN; sale con 1 si algo falla (../lib.sh).
set -u
DIR=$(cd "$(dirname "$0")" && pwd); DB=${1:-iatos_prive_sesion_test}
. "$DIR/../lib.sh"
PSQL="psql -U ${PGUSER:-postgres} -q -X"
# 26 casos de sesion_larga.sql + 1 de idempotencia.
ESPERADOS=27

main() {
  t_build_db "$DB"
  T_IDEM_OK=1 t_idempotency "$DB" "$T_MIG/20261027130000_prive_sesion_larga.sql"
  $PSQL -d "$DB" -f "$DIR/sesion_larga.sql" 2>&1 | grep -o 'OK .*\|FALLA.*\|ERROR.*\|INFO M.*' | sed 's/^ERROR/FALLA ERROR/'
}

main 2>&1 | t_verdict prive_sesion "$ESPERADOS"
exit "${PIPESTATUS[1]}"
