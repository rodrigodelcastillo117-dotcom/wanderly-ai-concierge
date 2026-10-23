#!/bin/bash
# Integración de la Ola 3 (claude/ola3-integ): lo que ninguna suite de rama prueba por sí sola porque
# depende de VARIAS migraciones juntas. Construye la base con TODAS las migraciones del repo en orden,
# comprueba en una COPIA que las 8 migraciones de la ola son idempotentes y corre ola3.sql sobre el
# estado final real:
#   · borrar un viaje encola documentos, fotos del diario, recibos de gastos y Recuerdos del dueño
#     (trips_queue_storage_purge de gastos_split + trips_purge_recuerdos de recuerdos);
#   · la versión final de cada función que una migración de la ola redefine es la última (con lo de
#     las anteriores), no una vieja.
# Uso: PGHOST=/ruta/socket PGPORT=5432 supabase/tests/ola3/run.sh [nombre_db]
set -u
DIR=$(cd "$(dirname "$0")" && pwd); DB=${1:-iatos_ola3_test}
. "$DIR/../lib.sh"
PSQL="psql -U ${PGUSER:-postgres} -q"
MIGS=("$T_MIG/20261027010000_diario_aprendizajes.sql" "$T_MIG/20261027020000_gastos_split.sql"
      "$T_MIG/20261027060000_prive_ideas.sql" "$T_MIG/20261027070000_tarjetas_rango.sql"
      "$T_MIG/20261027080000_referidos_promo.sql" "$T_MIG/20261027090000_social_amigos.sql"
      "$T_MIG/20261027100000_recuerdos.sql" "$T_MIG/20261027100100_alerta_creditos_ia.sql")
# 14 de ola3.sql (O1–O14) + 8 de idempotencia.
ESPERADOS=22

main() {
t_build_db "$DB"
T_IDEM_OK=1 t_idempotency "$DB" "${MIGS[@]}"
$PSQL -X -d "$DB" -f "$DIR/ola3.sql" 2>&1 | grep -o 'OK .*\|FALLA.*\|ERROR.*' | sed 's/^ERROR/FALLA ERROR/'
}

main 2>&1 | t_verdict ola3 "$ESPERADOS"
exit "${PIPESTATUS[1]}"
