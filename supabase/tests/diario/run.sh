#!/bin/bash
# Pruebas SQL del Diario que aprende (20261027010000_diario_aprendizajes.sql): estado de aprendizaje
# de cada entrada (solo el servidor lo escribe) y journal_learnings (cada quien ve, corrige y borra
# SOLO lo suyo; en un viaje compartido lo del colaborador es del colaborador; anon nada; se borra con
# la entrada y con el viaje; sube el rev del perfil de gustos). Construye la base con TODAS las
# migraciones en orden en un Postgres local desechable, prueba en una COPIA que la migración es
# idempotente y corre diario.sql sobre el estado final real. Uso:
#   PGHOST=/ruta/socket PGPORT=5432 supabase/tests/diario/run.sh [nombre_db]
set -u
DIR=$(cd "$(dirname "$0")" && pwd); DB=${1:-iatos_diario_test}
. "$DIR/../lib.sh"
PSQL="psql -U ${PGUSER:-postgres} -q"
MIG="$T_MIG/20261027010000_diario_aprendizajes.sql"
# 26 de diario.sql (D1–D26) + 1 de idempotencia.
ESPERADOS=27

main() {
t_build_db "$DB"
T_IDEM_OK=1 t_idempotency "$DB" "$MIG"
$PSQL -X -d "$DB" -f "$DIR/diario.sql" 2>&1 | grep -o 'OK .*\|FALLA.*\|ERROR.*' | sed 's/^ERROR/FALLA ERROR/'
}

main 2>&1 | t_verdict diario "$ESPERADOS"
exit "${PIPESTATUS[1]}"
