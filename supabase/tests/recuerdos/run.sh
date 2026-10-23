#!/bin/bash
# Pruebas SQL de Recuerdos (fotos y videos por fecha y viaje, bucket privado "recuerdos", álbum
# compartido con los miembros del viaje, purga con el viaje y con la cuenta) y del aviso de créditos de
# IA a administradores (alert_admins_ai_credits). Construye la base con TODAS las migraciones del repo
# en orden en un Postgres local desechable, prueba en una COPIA que las dos migraciones son
# idempotentes y corre recuerdos.sql sobre el estado final real. Uso:
#   PGHOST=/ruta/socket PGPORT=5432 supabase/tests/recuerdos/run.sh [nombre_db]
# Salida OK/FALLA/AVISO y un RESUMEN; sale con 1 si algo falla (../lib.sh).
set -u
DIR=$(cd "$(dirname "$0")" && pwd); DB=${1:-iatos_recuerdos_test}
. "$DIR/../lib.sh"
PSQL="psql -U ${PGUSER:-postgres} -q"
MIGS=("$T_MIG/20261027100000_recuerdos.sql" "$T_MIG/20261027100100_alerta_creditos_ia.sql")
# 38 de recuerdos.sql (R0–R37) + 6 del aviso (A1–A6) + 2 de idempotencia.
ESPERADOS=46

main() {
t_build_db "$DB"
T_IDEM_OK=1 t_idempotency "$DB" "${MIGS[@]}"
$PSQL -X -d "$DB" -f "$DIR/recuerdos.sql" 2>&1 | grep -o 'OK .*\|FALLA.*\|ERROR.*' | sed 's/^ERROR/FALLA ERROR/'
}

main 2>&1 | t_verdict recuerdos "$ESPERADOS"
exit "${PIPESTATUS[1]}"
