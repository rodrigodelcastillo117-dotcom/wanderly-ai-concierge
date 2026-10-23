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
# 88 de antes + los de la ronda r2 del grupo cuentas (aud2_pagos_adversarial.sql y r2_cuentas.sql).
ESPERADOS=121

main() {
  "$DIR/../security/run.sh" "$DB" 2>&1 | grep -E '^FALLA (migración|stubs|no se pudo)'
  local f
  for f in payments quota_reservations plan_limits trial_no_card plan_limits_recommended; do
    $PSQL -d "$DB" -v ON_ERROR_STOP=1 -f "$DIR/$f.sql" 2>&1 | grep -o 'OK .*\|ERROR.*' | sed 's/^ERROR/FALLA ERROR/'
  done
  # AUD-05: efectos de Stripe repetidos, fuera de orden, con fallas a medias (imprime OK/FALLA por caso).
  $PSQL -d "$DB" -f "$DIR/stripe_events.sql" 2>&1 | grep -o 'OK AP.*\|FALLA.*\|ERROR.*' | sed 's/^ERROR/FALLA ERROR/'
  # L7: re-correr la siembra no pisa lo que el dueño editó (plan_limits_recommended.sql dejó
  # free/live_searches=7). 20261022135300 ya NO es la última que define sus funciones: is_pro la redefine
  # 20261026250000_r2_cuentas_is_pro_price_period. Por eso la segunda pasada va en una COPIA de la base,
  # que se borra, y la base de las pruebas conserva las funciones de una base aplicada solo en orden
  # (run_all.sh lo comprueba con el md5 de las funciones).
  if t_copy_db "$DB" "${DB}_l7"; then
    t_apply "${DB}_l7" "$DIR/../../migrations/20261022135300_pay_plan_limits_recommended.sql" "(segunda pasada) "
    if [ "$($PSQL -d "${DB}_l7" -At -c "SELECT limit_value FROM public.plan_limits WHERE plan='free' AND kind='live_searches'")" = "7" ]; then
      echo "OK L7 re-correr la migración respeta los límites editados por el dueño"
    else
      echo "FALLA L7 la siembra pisó un límite editado"
    fi
    $PSQL -d postgres -c "DROP DATABASE IF EXISTS ${DB}_l7" >/dev/null 2>&1
  else
    echo "FALLA L7: no se pudo copiar la base $DB"
  fi
  # Segunda auditoría (r2, grupo cuentas): idempotencia de sus migraciones (en una copia), casos
  # adversariales del auditor y regresiones propias. r2_cuentas.sql hace \ir de 20261026250000 para
  # probar la conversión de datos y después de 20261027080000_referidos_promo (la última que define
  # is_pro), así que no deja versiones viejas.
  t_idempotency "$DB" "$T_MIG"/20261026*_r2_cuentas_*.sql
  $PSQL -d "$DB" -f "$DIR/aud2_pagos_adversarial.sql" 2>&1 | grep -o 'OK X.*\|FALLA.*\|PENDIENTE.*\|ERROR.*' | sed 's/^ERROR/FALLA ERROR/'
  $PSQL -d "$DB" -f "$DIR/r2_cuentas.sql" 2>&1 | grep -o 'OK RC.*\|FALLA.*\|ERROR.*' | sed 's/^ERROR/FALLA ERROR/'
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
