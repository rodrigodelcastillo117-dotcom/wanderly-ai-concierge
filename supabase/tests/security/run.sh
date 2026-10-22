#!/bin/bash
# Reproduce las migraciones del repo en un Postgres local desechable y corre los ataques y flujos
# legítimos de rls_attacks.sql. Uso: PGHOST=/ruta/socket PGPORT=5432 ./run.sh [nombre_db]
# Esperado: todos los "A*" en 0 (o "permission denied") y todos los "L*" con ok/visibles.
# Después corre hardening.sql y la prueba de concurrencia del rate limit: solo líneas "OK …"
# (cualquier "FALLA" o "ERROR" es un error). aud_seguridad.sql: inventario del esquema y ataques de cierre.
# La migración de pg_cron falla en local (la extensión no existe fuera de Supabase); es esperado.
set -u
DIR=$(cd "$(dirname "$0")" && pwd); MIG="$DIR/../../migrations"; DB=${1:-iatos_rls_test}
PSQL="psql -U ${PGUSER:-postgres} -q"
$PSQL -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB" >/dev/null
$PSQL -d "$DB" -f "$DIR/00_roles.sql" -f "$DIR/01_supabase_stubs.sql" >/dev/null 2>&1
for f in "$MIG"/*.sql; do
  out=$($PSQL -v ON_ERROR_STOP=1 -d "$DB" -f "$f" 2>&1 >/dev/null | grep ERROR | head -1)
  [ -n "$out" ] && echo "FALLÓ $(basename "$f"): $out"
done
$PSQL -d "$DB" -f "$DIR/rls_attacks.sql" 2>&1 | grep -v '^$' | grep -v 'set_config\|^ *|' | sed 's/^ *//'
$PSQL -X -d "$DB" -f "$DIR/hardening.sql" 2>&1 | grep -o 'OK .*\|FALLA.*\|ERROR.*'
$PSQL -X -d "$DB" -f "$DIR/round_b.sql" 2>&1 | grep -o 'OK .*\|FALLA.*\|ERROR.*'
$PSQL -X -d "$DB" -f "$DIR/concierge_requests.sql" 2>&1 | grep -o 'OK .*\|FALLA.*\|ERROR.*'
$PSQL -X -d "$DB" -f "$DIR/trip_delete_conversation.sql" 2>&1 | grep -o 'OK .*\|FALLA.*\|ERROR.*\|D[0-9].*'
$PSQL -X -d "$DB" -f "$DIR/taste_profile.sql" 2>&1 | grep -o 'OK .*\|FALLA.*\|ERROR.*'
$PSQL -d "$DB" -f "$DIR/profiles_tier.sql" 2>&1 | grep -E 'T[0-9]|denied' | sed 's/^ *//'
$PSQL -X -d "$DB" -f "$DIR/action_idempotency.sql" 2>&1 | grep -o 'OK .*\|FALLA.*\|ERROR.*'
$PSQL -X -d "$DB" -f "$DIR/aud_seguridad.sql" 2>&1 | grep -o 'OK .*\|FALLA.*\|ERROR.*' | grep -v 'violates row-level security'
# Segunda auditoría, grupo privacidad (T-P2-2 y siguientes). Algunas pruebas reaplican su migración
# (\ir) para probar el relleno de datos viejos; después de cada una se reaplican EN ORDEN todas las
# migraciones r2_privacidad, para que la base quede igual que en producción (Q-L1: no probar una
# versión vieja de una función que una migración posterior reemplaza).
for t in "$DIR"/r2_privacidad_*.sql; do
  [ -f "$t" ] || continue
  $PSQL -X -d "$DB" -f "$t" 2>&1 | grep -o 'OK .*\|FALLA.*\|ERROR.*'
  for m in "$MIG"/20261026*_r2_privacidad_*.sql; do
    out=$($PSQL -X -v ON_ERROR_STOP=1 -d "$DB" -f "$m" 2>&1 >/dev/null | grep ERROR | head -1)
    [ -n "$out" ] && echo "FALLA migración $(basename "$m") no es idempotente: $out"
  done
done
"$DIR/concurrent_rate_limit.sh" "$DB"
