#!/bin/bash
# Pruebas SQL de IATOS Privé (grupo core) sobre un Postgres local desechable (nunca producción).
# Uso: PGHOST=/ruta/socket PGPORT=5432 ./run.sh [nombre_db]
# Reproduce TODAS las migraciones en una base nueva (igual que la suite de seguridad; la de pg_cron
# falla en local, es esperado) y corre prive.sql. Imprime solo líneas "OK …" o "FALLA …".
set -u
DIR=$(cd "$(dirname "$0")" && pwd); DB=${1:-iatos_prive_test}
PSQL="psql -U ${PGUSER:-postgres} -q -X"
"$DIR/../security/run.sh" "$DB" >/dev/null 2>&1
# Una migración que falle al reproducirse es una falla de esta suite.
# Las del cierre de auditoría (20261024*_aud_prive_*) redefinen funciones de las 2026102309*: van
# después, como en producción, y también deben ser idempotentes.
# Segunda auditoría (r2, grupo cuentas): 20261026*_r2_cuentas_* redefinen funciones de las anteriores.
for f in "$DIR"/../../migrations/2026102309*.sql "$DIR"/../../migrations/20261024*_aud_prive_*.sql \
         "$DIR"/../../migrations/20261026*_r2_cuentas_*.sql; do
  out=$($PSQL -v ON_ERROR_STOP=1 -d "$DB" -f "$f" 2>&1 >/dev/null | grep ERROR | head -1)
  [ -n "$out" ] && echo "FALLA migración $(basename "$f") no es idempotente: $out"
done
# auth.sessions ya está en los stubs (01_supabase_stubs.sql); esto queda por compatibilidad con bases viejas.
$PSQL -d "$DB" -c "CREATE TABLE IF NOT EXISTS auth.sessions (id uuid PRIMARY KEY, user_id uuid, not_after timestamptz, created_at timestamptz DEFAULT now())" >/dev/null 2>&1
$PSQL -At -d "$DB" -f "$DIR/prive.sql" 2>&1 | grep -o 'OK .*\|FALLA.*\|ERROR.*' | sed 's/^ERROR/FALLA ERROR/'
# Cierre de auditoría: AUD-01 (sesión de Auth, fail closed) y NEW-01 (revocar concesión con invitación).
$PSQL -At -d "$DB" -f "$DIR/aud_session.sql" 2>&1 | grep -o 'OK .*\|FALLA.*\|ERROR.*' | sed 's/^ERROR/FALLA ERROR/'
$PSQL -At -d "$DB" -f "$DIR/aud_seg_strength.sql" 2>&1 | grep -o 'OK .*\|FALLA.*\|ERROR.*' | sed 's/^ERROR/FALLA ERROR/'
# Segunda auditoría (r2, grupo cuentas): casos del auditor (aud2_prive.sql) y regresiones propias.
$PSQL -At -d "$DB" -f "$DIR/aud2_prive.sql" 2>&1 | grep -o 'OK .*\|FALLA.*\|ERROR.*' | sed 's/^ERROR/FALLA ERROR/'
$PSQL -At -d "$DB" -f "$DIR/r2_cuentas_prive.sql" 2>&1 | grep -o 'OK .*\|FALLA.*\|ERROR.*' | sed 's/^ERROR/FALLA ERROR/'
$PSQL -At -d "$DB" -f "$DIR/aud2_sweep.sql" 2>&1 | grep -o 'OK .*\|FALLA.*\|ERROR.*' | sed 's/^ERROR/FALLA ERROR/'
