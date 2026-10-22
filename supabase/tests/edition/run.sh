#!/bin/bash
# Pruebas SQL de THE PRIVATE EDITION sobre un Postgres local desechable (nunca producción).
# Uso: PGHOST=/ruta/socket PGPORT=5432 ./run.sh [nombre_db]
# Base con TODAS las migraciones en orden (vía la suite de seguridad; la de pg_cron falla en local y sale
# como AVISO). E-IDEM vuelve a aplicar, en orden, las migraciones de la edición (RPC, siembra y
# correcciones: 202610251001* y 202610251100*, las últimas del repo, así que la base termina igual que en
# producción; run_all.sh lo comprueba con el md5 de las funciones) y comprueba que no duplican filas;
# luego corre edition.sql.
# Salida OK/FALLA/AVISO y un RESUMEN; sale con 1 si algo falla (../lib.sh).
set -u
DIR=$(cd "$(dirname "$0")" && pwd); DB=${1:-edi_test}
. "$DIR/../lib.sh"
PSQL="psql -U ${PGUSER:-postgres} -q -X"
ESPERADOS=51

main() {
  "$DIR/../security/run.sh" "$DB" 2>&1 | grep -E '^FALLA (migración|stubs|no se pudo)'
  local q="select (select count(*) from edition_articles)||'/'||(select count(*) from edition_sources)||'/'||(select count(*) from edition_article_sources)"
  local before after f
  before=$($PSQL -At -d "$DB" -c "$q")
  for f in "$T_MIG"/202610251001*.sql "$T_MIG"/202610251100*.sql; do t_apply "$DB" "$f" "(segunda pasada, no es idempotente) "; done
  after=$($PSQL -At -d "$DB" -c "$q")
  [ -n "$after" ] && [ "$before" = "$after" ] && echo "OK E-IDEM re-aplicar las migraciones no duplica nada ($after)" || echo "FALLA E-IDEM $before → $after"
  $PSQL -d "$DB" -c "CREATE TABLE IF NOT EXISTS auth.sessions (id uuid PRIMARY KEY, user_id uuid, not_after timestamptz, created_at timestamptz DEFAULT now())" >/dev/null
  $PSQL -At -d "$DB" -f "$DIR/edition.sql" 2>&1 | grep -o 'OK .*\|FALLA.*\|ERROR.*' | sed 's/^ERROR/FALLA ERROR/'
}

main 2>&1 | t_verdict edition "$ESPERADOS"
exit "${PIPESTATUS[1]}"
