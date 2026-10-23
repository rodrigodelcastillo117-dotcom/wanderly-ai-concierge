#!/bin/bash
# Pruebas SQL de la promoción "Invita 5 amigos y gana 1 mes de PRO" (20261027080000_referidos_promo.sql).
# Construye la base con TODAS las migraciones del repo en orden en un Postgres local desechable (la de
# pg_cron falla en local y sale como AVISO), prueba en una COPIA que la migración es idempotente, corre
# referidos.sql sobre el estado final real y una prueba de concurrencia (dos evaluaciones a la vez del
# mismo invitador dan un solo premio). Uso:
#   PGHOST=/ruta/socket PGPORT=5432 supabase/tests/referidos/run.sh [nombre_db]
# Salida OK/FALLA/AVISO y un RESUMEN; sale con 1 si algo falla (../lib.sh).
set -u
DIR=$(cd "$(dirname "$0")" && pwd); DB=${1:-iatos_referidos_test}
. "$DIR/../lib.sh"
PSQL="psql -U ${PGUSER:-postgres} -q -X"
MIG="$T_MIG/20261027080000_referidos_promo.sql"
# 42 de referidos.sql (RF1–RF33) + 1 de idempotencia + 1 de concurrencia.
ESPERADOS=44

conc_double_eval() { # $1 base
  local db=$1 n
  $PSQL -d "$db" -v ON_ERROR_STOP=1 >/dev/null 2>&1 <<'SQL'
INSERT INTO auth.users (id, email, created_at, email_confirmed_at, raw_app_meta_data)
SELECT ('c9000000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid, 'rf-conc-' || g || '@example.test',
       now() - interval '5 minutes', now() - interval '5 minutes', '{"provider":"google"}'::jsonb
  FROM generate_series(0, 5) g;
INSERT INTO public.referrals (user_id, referrer_id, code)
SELECT ('c9000000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid, 'c9000000-0000-0000-0000-000000000000', 'CONC'
  FROM generate_series(1, 5) g;
-- Los viajes sin el trigger: así los 5 quedan válidos y SIN premio, listos para la carrera.
ALTER TABLE public.trips DISABLE TRIGGER trips_referral_eval;
INSERT INTO public.trips (user_id, destino)
SELECT ('c9000000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid, 'Lima' FROM generate_series(1, 5) g;
ALTER TABLE public.trips ENABLE TRIGGER trips_referral_eval;
SQL
  t_conc2 "$db" "SELECT public.referral_evaluate('c9000000-0000-0000-0000-000000000000')" \
                "SELECT public.referral_evaluate('c9000000-0000-0000-0000-000000000000')"
  n=$($PSQL -At -d "$db" -c "SELECT count(*) FROM public.referral_rewards WHERE user_id = 'c9000000-0000-0000-0000-000000000000'")
  if [ -z "$T_CONC_ERR" ] && [ "$T_WAITED" = si ] && [ "$C1" = 1 ] && [ "$C2" = 0 ] && [ "$n" = 1 ]; then
    echo "OK RFC1 dos evaluaciones simultáneas del mismo invitador: la segunda espera el candado y no duplica el premio"
  else
    echo "FALLA RFC1 concurrencia: err='$T_CONC_ERR' esperó=$T_WAITED s1='$C1' s2='$C2' premios=$n"
  fi
}

main() {
  t_build_db "$DB"
  T_IDEM_OK=1 t_idempotency "$DB" "$MIG"
  $PSQL -d "$DB" -f "$DIR/referidos.sql" 2>&1 | grep -o 'OK RF.*\|FALLA.*\|ERROR.*' | sed 's/^ERROR/FALLA ERROR/'
  conc_double_eval "$DB"
}

main 2>&1 | t_verdict referidos "$ESPERADOS"
exit "${PIPESTATUS[1]}"
