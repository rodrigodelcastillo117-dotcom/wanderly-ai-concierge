#!/bin/bash
# Pruebas SQL del avatar por capas e inventario (grupo avatar-inventario): bucket público avatar-assets
# (solo service_role escribe), tabla avatar_assets (RLS: autenticados leen, anon nada, la app no
# escribe), columnas nuevas de avatar_profiles/avatar_variants (país del fondo, fondo del MISMO país,
# máx. 3 objetos, cara/mano en fracciones, cuerpo completo bajo avatars/<su id>/) y que nadie vea ni
# cambie lo de otro. Construye la base con TODAS las migraciones en orden en un Postgres local
# desechable (nunca producción), prueba en una COPIA que la migración es idempotente y corre avinv.sql.
# Uso: PGHOST=/ruta/socket PGPORT=5432 supabase/tests/avatar_inventario/run.sh [nombre_db]
set -u
DIR=$(cd "$(dirname "$0")" && pwd); DB=${1:-iatos_avinv_test}
. "$DIR/../lib.sh"
PSQL="psql -U ${PGUSER:-postgres} -q"
MIGS=("$T_MIG/20261027120000_avatar_inventario.sql")
# 30 de avinv.sql (AI1–AI30) + 1 de idempotencia.
ESPERADOS=31

main() {
t_build_db "$DB"
T_IDEM_OK=1 t_idempotency "$DB" "${MIGS[@]}"
$PSQL -X -d "$DB" -f "$DIR/avinv.sql" 2>&1 | grep -o 'OK .*\|FALLA.*\|ERROR.*' | sed 's/^ERROR/FALLA ERROR/'
}

main 2>&1 | t_verdict avatar_inventario "$ESPERADOS"
exit "${PIPESTATUS[1]}"
