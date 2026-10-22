#!/bin/bash
# Pruebas SQL de IATOS Privé (grupo core) sobre un Postgres local desechable (nunca producción).
# Uso: PGHOST=/ruta/socket PGPORT=5432 ./run.sh [nombre_db]
# Construye la base con TODAS las migraciones en orden, igual que en producción (vía la suite de
# seguridad; la de pg_cron falla en local y sale como AVISO), y corre prive.sql, aud_session.sql y
# aud_seg_strength.sql sobre ESE estado final.
# P2-QA-1 / Q-L1 / P3-6: antes este script volvía a aplicar 2026102309* y 20261024*_aud_prive_* DESPUÉS de
# la pasada completa, así que las pruebas corrían contra versiones viejas de prive_save_progress (anterior
# a PK-01, 20261024310000) y de prive_record_paid_period / prive_mark_paid_period (anteriores a AUD-05,
# 20261024051500). Ahora la idempotencia de esas migraciones se comprueba en una COPIA de la base, que se
# borra, y las pruebas ven exactamente las funciones de una base aplicada solo en orden (run_all.sh lo
# verifica con el md5 de cada función).
# Salida OK/FALLA/AVISO y un RESUMEN; sale con 1 si algo falla (../lib.sh).
set -u
DIR=$(cd "$(dirname "$0")" && pwd); DB=${1:-iatos_prive_test}
. "$DIR/../lib.sh"
PSQL="psql -U ${PGUSER:-postgres} -q -X"
ESPERADOS=140

main() {
  "$DIR/../security/run.sh" "$DB" 2>&1 | grep -E '^FALLA (migración|stubs|no se pudo)'
  t_idempotency "$DB" "$T_MIG"/2026102309*.sql "$T_MIG"/20261024*_aud_prive_*.sql
  # auth.sessions ya está en los stubs (01_supabase_stubs.sql); esto queda por compatibilidad con bases viejas.
  $PSQL -d "$DB" -c "CREATE TABLE IF NOT EXISTS auth.sessions (id uuid PRIMARY KEY, user_id uuid, not_after timestamptz, created_at timestamptz DEFAULT now())" >/dev/null 2>&1
  $PSQL -At -d "$DB" -f "$DIR/prive.sql" 2>&1 | grep -o 'OK .*\|FALLA.*\|ERROR.*' | sed 's/^ERROR/FALLA ERROR/'
  # Cierre de auditoría: AUD-01 (sesión de Auth, fail closed) y NEW-01 (revocar concesión con invitación).
  $PSQL -At -d "$DB" -f "$DIR/aud_session.sql" 2>&1 | grep -o 'OK .*\|FALLA.*\|ERROR.*' | sed 's/^ERROR/FALLA ERROR/'
  $PSQL -At -d "$DB" -f "$DIR/aud_seg_strength.sql" 2>&1 | grep -o 'OK .*\|FALLA.*\|ERROR.*' | sed 's/^ERROR/FALLA ERROR/'
}

main 2>&1 | t_verdict prive "$ESPERADOS"
exit "${PIPESTATUS[1]}"
