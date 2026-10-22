#!/bin/bash
# Pruebas SQL de pagos y cuota sobre un Postgres local desechable (nunca producción).
# Uso: PGHOST=/ruta/socket PGPORT=5432 ./run.sh [nombre_db]
# Base con TODAS las migraciones en orden (vía ../security/run.sh; la de pg_cron falla en local y sale como
# AVISO). Las aserciones de payments.sql, quota_reservations.sql, plan_limits*.sql y trial_no_card.sql son
# RAISE EXCEPTION: un "ERROR" sale como "FALLA ERROR" (antes quedaba como "ERROR" y el conteo de FALLA no lo
# veía, P2-QA-2) y, con ON_ERROR_STOP, el resto del archivo no corre: el total esperado lo detecta.
# Las pruebas de concurrencia (concurrency.sh) coordinan las dos sesiones con candados, no con sleep.
# Salida OK/FALLA/AVISO y un RESUMEN; sale con 1 si algo falla (../lib.sh).
set -u
DIR=$(cd "$(dirname "$0")" && pwd); DB=${1:-iatos_pay_test}
. "$DIR/../lib.sh"
. "$DIR/concurrency.sh"
PSQL="psql -U ${PGUSER:-postgres} -q -X"
ESPERADOS=88

main() {
  "$DIR/../security/run.sh" "$DB" 2>&1 | grep -E '^FALLA (migración|stubs|no se pudo)'
  local f
  for f in payments quota_reservations plan_limits trial_no_card plan_limits_recommended; do
    $PSQL -d "$DB" -v ON_ERROR_STOP=1 -f "$DIR/$f.sql" 2>&1 | grep -o 'OK .*\|ERROR.*' | sed 's/^ERROR/FALLA ERROR/'
  done
  # AUD-05: efectos de Stripe repetidos, fuera de orden, con fallas a medias (imprime OK/FALLA por caso).
  $PSQL -d "$DB" -f "$DIR/stripe_events.sql" 2>&1 | grep -o 'OK AP.*\|FALLA.*\|ERROR.*' | sed 's/^ERROR/FALLA ERROR/'
  # L7: re-correr la siembra no pisa lo que el dueño editó (plan_limits_recommended.sql dejó
  # free/live_searches=7). 20261022135300 es la última migración que define sus funciones: volver a
  # aplicarla no deja versiones viejas (run_all.sh lo comprueba con el md5 de las funciones).
  t_apply "$DB" "$DIR/../../migrations/20261022135300_pay_plan_limits_recommended.sql" "(segunda pasada) "
  if [ "$($PSQL -d "$DB" -At -c "SELECT limit_value FROM public.plan_limits WHERE plan='free' AND kind='live_searches'")" = "7" ]; then
    echo "OK L7 re-correr la migración respeta los límites editados por el dueño"
  else
    echo "FALLA L7 la siembra pisó un límite editado"
  fi
  pay_conc_quota "$DB"
  pay_conc_reserve "$DB"
  # AUD-05: concurrencia real (dos transacciones).
  pay_conc_users "$DB"
  pay_cc1 "$DB"
  pay_cc2 "$DB"
  pay_cc3 "$DB"
  pay_cc4 "$DB"
}

main 2>&1 | t_verdict payments "$ESPERADOS"
exit "${PIPESTATUS[1]}"
