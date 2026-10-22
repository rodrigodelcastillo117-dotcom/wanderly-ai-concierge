#!/bin/bash
# Pruebas SQL de privevalor (Privé Drops, Privilege Radar, The Value of Your Privé, Insider's Notebook,
# Before You Go, Privé Passport y métricas). Construye la base con TODAS las migraciones del repo en orden
# en un Postgres local desechable (incluida la prive_require real: los miembros de prueba obtienen su
# sesión Privé con prive_unlock), prueba en una COPIA de la base que las migraciones de privevalor son
# idempotentes y corre privevalor.sql sobre el estado final real. Uso:
#   PGHOST=/ruta/socket PGPORT=5432 supabase/tests/privevalor/run.sh [nombre_db]
# La migración de pg_cron falla en local y sale como AVISO. Salida OK/FALLA/AVISO y un RESUMEN; sale con 1
# si algo falla (../lib.sh).
set -u
DIR=$(cd "$(dirname "$0")" && pwd); DB=${1:-iatos_privevalor_test}
. "$DIR/../lib.sh"
PSQL="psql -U ${PGUSER:-postgres} -q -X"
ESPERADOS=144

main() {
  t_build_db "$DB"
  T_IDEM_OK=1 t_idempotency "$DB" "$T_MIG"/202610241*_privevalor_*.sql
  $PSQL -d "$DB" -c "CREATE TABLE IF NOT EXISTS auth.sessions (id uuid PRIMARY KEY, user_id uuid, not_after timestamptz, created_at timestamptz DEFAULT now())" >/dev/null
  $PSQL -d "$DB" -f "$DIR/privevalor.sql" 2>&1 | grep -o 'OK .*\|FALLA.*\|ERROR.*' | sed 's/^ERROR/FALLA ERROR/'
}

main 2>&1 | t_verdict privevalor "$ESPERADOS"
exit "${PIPESTATUS[1]}"
