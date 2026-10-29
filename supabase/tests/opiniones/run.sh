#!/bin/bash
# Opiniones de los usuarios (migración 20261029060000_opiniones): forma validada en la base, tope por hora,
# fuera de la vista de reservas, en la Mesa de operaciones y en "Mis solicitudes", marcar leída / resuelta,
# responder (sin correo si el usuario no lo quiere) y el aviso al equipo con marca. Construye la base con
# TODAS las migraciones en orden, comprueba en una COPIA que la migración es idempotente y corre
# opiniones.sql sobre el estado final real.
# Uso: PGHOST=/ruta/socket PGPORT=5432 supabase/tests/opiniones/run.sh [nombre_db]
set -u
DIR=$(cd "$(dirname "$0")" && pwd); DB=${1:-iatos_opiniones_test}
. "$DIR/../lib.sh"
PSQL="psql -U ${PGUSER:-postgres} -q -X"
MIG="$T_MIG/20261029060000_opiniones.sql"
# 1 de idempotencia + los casos de opiniones.sql
ESPERADOS=30

main() {
  t_build_db "$DB"
  T_IDEM_OK=1 t_idempotency "$DB" "$MIG"
  $PSQL -At -d "$DB" -f "$DIR/opiniones.sql" 2>&1 | grep -o 'OK .*\|FALLA.*\|ERROR.*' | sed 's/^ERROR/FALLA ERROR/'
}

main 2>&1 | t_verdict opiniones "$ESPERADOS"
exit "${PIPESTATUS[1]}"
