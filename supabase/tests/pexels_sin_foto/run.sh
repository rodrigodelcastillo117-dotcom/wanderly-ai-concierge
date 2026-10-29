#!/bin/bash
# Pruebas SQL de 20261029070000_pexels_sin_foto.sql (ronda 4 de cuenta y técnica, P2-4: Madrid sin foto en
# Favoritos por una entrada "sin foto" de Pexels guardada 7 días en public.serp_cache).
#   - La migración borra SOLO las filas de Pexels con "image": null.
#   - Se quedan: fotos válidas, videos de Pexels ("url": null), otros motores con "image": null y
#     respuestas de Pexels sin la llave "image".
#   - Una segunda pasada no borra nada más (idempotente sobre los datos).
# Construye la base con TODAS las migraciones en orden en un Postgres local desechable, comprueba en una
# COPIA que la migración es idempotente y prueba el DELETE real en otra COPIA con filas sembradas.
# Uso: PGHOST=/ruta/socket PGPORT=5432 supabase/tests/pexels_sin_foto/run.sh [nombre_db]
set -u
DIR=$(cd "$(dirname "$0")" && pwd); DB=${1:-iatos_pexels_sin_foto_test}
. "$DIR/../lib.sh"
PSQL="psql -U ${PGUSER:-postgres} -q -X"
MIG="$T_MIG/20261029070000_pexels_sin_foto.sql"
# 1 idempotencia + 8 casos de pexels_sin_foto.sql
ESPERADOS=9

main() {
  t_build_db "$DB"
  T_IDEM_OK=1 t_idempotency "$DB" "$MIG"
  local copy="${DB}_datos"
  t_copy_db "$DB" "$copy" || { echo "FALLA no se pudo copiar la base para los datos"; return; }
  $PSQL -At -d "$copy" -v mig="$MIG" -f "$DIR/pexels_sin_foto.sql" 2>&1 | t_brackets
  $PSQL -d postgres -c "DROP DATABASE IF EXISTS $copy" >/dev/null 2>&1
}

main 2>&1 | t_verdict pexels_sin_foto "$ESPERADOS"
exit "${PIPESTATUS[1]}"
