#!/bin/bash
# Pruebas SQL de THE PRIVATE EDITION sobre un Postgres local desechable (nunca producción).
# Uso: PGHOST=/ruta/socket PGPORT=5432 ./run.sh [nombre_db]
# Reproduce TODAS las migraciones en una base nueva (vía la suite de seguridad; la de pg_cron falla en
# local, es esperado), comprueba que las migraciones de la edición sean idempotentes y corre edition.sql.
# Imprime solo líneas "OK …" o "FALLA …".
set -u
DIR=$(cd "$(dirname "$0")" && pwd); DB=${1:-edi_test}
PSQL="psql -U ${PGUSER:-postgres} -q -X"
"$DIR/../security/run.sh" "$DB" >/dev/null 2>&1
# Re-aplicar las migraciones de la edición (RPC, siembra y correcciones): deben ser idempotentes (sin errores ni duplicados).
before=$($PSQL -At -d "$DB" -c "select (select count(*) from edition_articles)||'/'||(select count(*) from edition_sources)||'/'||(select count(*) from edition_article_sources)")
for f in "$DIR"/../../migrations/202610251001*.sql "$DIR"/../../migrations/202610251100*.sql; do
  out=$($PSQL -v ON_ERROR_STOP=1 -d "$DB" -f "$f" 2>&1 >/dev/null | grep ERROR | head -1)
  [ -n "$out" ] && echo "FALLA migración $(basename "$f") no es idempotente: $out"
done
after=$($PSQL -At -d "$DB" -c "select (select count(*) from edition_articles)||'/'||(select count(*) from edition_sources)||'/'||(select count(*) from edition_article_sources)")
[ "$before" = "$after" ] && echo "OK E-IDEM re-aplicar las migraciones no duplica nada ($after)" || echo "FALLA E-IDEM $before → $after"
$PSQL -d "$DB" -c "CREATE TABLE IF NOT EXISTS auth.sessions (id uuid PRIMARY KEY, user_id uuid, not_after timestamptz, created_at timestamptz DEFAULT now())" >/dev/null
$PSQL -At -d "$DB" -f "$DIR/edition.sql" 2>&1 | grep -o 'OK .*\|FALLA.*\|ERROR.*' | sed 's/^ERROR/FALLA ERROR/'
