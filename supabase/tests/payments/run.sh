#!/bin/bash
# Pruebas SQL de pagos y cuota sobre un Postgres local desechable (nunca producción).
# Uso: PGHOST=/ruta/socket PGPORT=5432 ./run.sh [nombre_db]
# Esperado: líneas "OK ..." y al final "OK CONCURRENCIA ...". Cualquier "FALLA" es un error.
set -u
DIR=$(cd "$(dirname "$0")" && pwd); DB=${1:-iatos_pay_test}
PSQL="psql -U ${PGUSER:-postgres} -q -X"
# Reproduce todas las migraciones (la de pg_cron falla en local; es esperado).
"$DIR/../security/run.sh" "$DB" >/dev/null 2>&1
$PSQL -d "$DB" -v ON_ERROR_STOP=1 -f "$DIR/payments.sql" 2>&1 | grep -o 'OK .*\|ERROR.*' || echo "FALLA payments.sql"
$PSQL -d "$DB" -v ON_ERROR_STOP=1 -f "$DIR/quota_reservations.sql" 2>&1 | grep -o 'OK .*\|ERROR.*' || echo "FALLA quota_reservations.sql"
$PSQL -d "$DB" -v ON_ERROR_STOP=1 -f "$DIR/plan_limits.sql" 2>&1 | grep -o 'OK .*\|ERROR.*' || echo "FALLA plan_limits.sql"
$PSQL -d "$DB" -v ON_ERROR_STOP=1 -f "$DIR/trial_no_card.sql" 2>&1 | grep -o 'OK .*\|ERROR.*' || echo "FALLA trial_no_card.sql"
$PSQL -d "$DB" -v ON_ERROR_STOP=1 -f "$DIR/plan_limits_recommended.sql" 2>&1 | grep -o 'OK .*\|ERROR.*' || echo "FALLA plan_limits_recommended.sql"
# AUD-05: efectos de Stripe repetidos, fuera de orden, con fallas a medias (imprime OK/FALLA por caso).
$PSQL -d "$DB" -f "$DIR/stripe_events.sql" 2>&1 | grep -o 'OK AP.*\|FALLA.*\|ERROR.*' || echo "FALLA stripe_events.sql"
# Segunda auditoría (r2, grupo cuentas): casos adversariales del auditor y regresiones propias.
$PSQL -d "$DB" -f "$DIR/aud2_pagos_adversarial.sql" 2>&1 | grep -o 'OK X.*\|FALLA.*\|PENDIENTE.*\|ERROR.*' || echo "FALLA aud2_pagos_adversarial.sql"
$PSQL -d "$DB" -f "$DIR/r2_cuentas.sql" 2>&1 | grep -o 'OK RC.*\|FALLA.*\|ERROR.*' || echo "FALLA r2_cuentas.sql"
# Re-correr la siembra no pisa lo que el dueño editó (plan_limits_recommended.sql dejó free/live_searches=7).
$PSQL -d "$DB" -f "$DIR/../../migrations/20261022135300_pay_plan_limits_recommended.sql" >/dev/null 2>&1
# Esa siembra redefine is_pro con la versión anterior: se vuelven a aplicar las migraciones r2 (idempotentes).
for f in "$DIR"/../../migrations/20261026*_r2_cuentas_*.sql; do
  [ -f "$f" ] || continue
  out=$($PSQL -v ON_ERROR_STOP=1 -d "$DB" -f "$f" 2>&1 >/dev/null | grep ERROR | head -1)
  [ -n "$out" ] && echo "FALLA migración $(basename "$f") no es idempotente: $out"
done
if [ "$($PSQL -d "$DB" -At -c "SELECT limit_value FROM public.plan_limits WHERE plan='free' AND kind='live_searches'")" = "7" ]; then
  echo "OK L7 re-correr la migración respeta los límites editados por el dueño"
else
  echo "FALLA L7 la siembra pisó un límite editado"
fi

# Concurrencia: la sesión 1 consume el análisis gratis y tarda en confirmar; la sesión 2 llega en
# medio. Con el UPDATE condicional, la 2 espera el candado y luego ve el contador en 1 → negada.
T=$(mktemp)
U=22222222-0000-0000-0000-000000000001
$PSQL -d "$DB" -c "INSERT INTO auth.users (id, email, email_confirmed_at) VALUES ('$U', 'carrera@test.mx', now())"
$PSQL -d "$DB" -At -c "BEGIN; SELECT public.consume_free_quota('$U', 'trip_analysis')->>'allowed'; SELECT pg_sleep(2); COMMIT;" \
  > "$T" 2>&1 &
sleep 0.5
S2=$($PSQL -d "$DB" -At -c "SELECT public.consume_free_quota('$U', 'trip_analysis')->>'reason'")
wait
S1=$(grep -E "^(true|false)$" "$T"); rm -f "$T"
USED=$($PSQL -d "$DB" -At -c "SELECT trips_analyzed_used FROM public.usage_limits WHERE user_id = '$U'")
if [ "$S1" = "true" ] && [ "$S2" = "quota_exceeded" ] && [ "$USED" = "1" ]; then
  echo "OK CONCURRENCIA trip_analysis: sesión 1 permitida, sesión 2 simultánea negada, contador=1"
else
  echo "FALLA CONCURRENCIA s1=$S1 s2=$S2 usados=$USED"
fi

# Concurrencia de reservas: la sesión 1 aparta el análisis gratis y tarda en confirmar; la sesión 2
# (otra pestaña, otra llave) llega en medio: espera el candado y recibe in_progress, nunca un 2o cupo.
U2=22222222-0000-0000-0000-000000000002
T2=$(mktemp)
$PSQL -d "$DB" -c "INSERT INTO auth.users (id, email, email_confirmed_at) VALUES ('$U2', 'carrera2@test.mx', now())"
$PSQL -d "$DB" -At -c "BEGIN; SELECT public.reserve_quota('$U2', 'trip_analysis', 'c:pestana-1')->>'reason'; SELECT pg_sleep(2); COMMIT;" \
  > "$T2" 2>&1 &
sleep 0.5
R2=$($PSQL -d "$DB" -At -c "SELECT public.reserve_quota('$U2', 'trip_analysis', 'c:pestana-2')->>'reason'")
wait
R1=$(grep -E "^[a-z_]+$" "$T2" | head -1); rm -f "$T2"
if [ "$R1" = "reserved" ] && [ "$R2" = "in_progress" ]; then
  echo "OK CONCURRENCIA reserve_quota: sesión 1 reservada, sesión 2 simultánea in_progress"
else
  echo "FALLA CONCURRENCIA reserve_quota r1=$R1 r2=$R2"
fi

# ===================================================================== AUD-05: concurrencia real (dos transacciones)
# Cada caso: la sesión 1 hace su parte y se queda con la transacción abierta 2 s; la sesión 2 llega
# en medio con el MISMO efecto (entrega duplicada) o con el efecto que compite (reembolso vs. factura).
conc() { # $1 = SQL de la sesión 1 (dentro de BEGIN…COMMIT), $2 = SQL de la sesión 2
  local t; t=$(mktemp)
  $PSQL -d "$DB" -At -c "BEGIN; $1; SELECT pg_sleep(2); COMMIT;" > "$t" 2>&1 &
  sleep 0.5
  C2=$($PSQL -d "$DB" -At -c "$2" 2>&1)
  wait
  C1=$(grep -v '^$' "$t" | head -1); rm -f "$t"
}
CU=4d0d0000-0000-0000-0000-0000000000
$PSQL -d "$DB" -c "INSERT INTO auth.users (id, email, email_confirmed_at) SELECT ('${CU}'||lpad(n::text,2,'0'))::uuid, 'conc'||n||'@test.mx', now() FROM generate_series(1,4) n"

# CC1: dos entregas simultáneas del primer evento de una cuenta SIN fila: una sola fila, PRO una vez.
A="SELECT public.apply_stripe_subscription('${CU}01','cus_cc1','sub_cc1','active',NULL,now()+interval '30 days',false,'p','mxn',now())->>'applied'"
conc "$A" "$A"
N=$($PSQL -d "$DB" -At -c "SELECT count(*)||':'||max(status) FROM public.subscriptions WHERE user_id='${CU}01'")
if [ "$C1" = "true" ] && [ "$C2" = "true" ] && [ "$N" = "1:active" ]; then
  echo "OK CC1 apply_stripe_subscription simultáneo sin fila previa: una fila active (s1=$C1 s2=$C2)"
else echo "FALLA CC1 s1=$C1 s2=$C2 filas=$N"; fi

# CC2: invoice.paid e invoice.payment_succeeded de la misma factura al mismo tiempo: un solo periodo.
R="SELECT public.prive_record_paid_period('${CU}02','in_cc2','sub_cc2','cus_cc2',now()-interval '1 day',now()+interval '29 days',9900,'mxn','webhook')->>'recorded'"
conc "$R" "$R"
N=$($PSQL -d "$DB" -At -c "SELECT count(*) FROM public.pro_paid_periods WHERE stripe_invoice_id='in_cc2'")
if [ "$C1" = "true" ] && [ "$C2" = "true" ] && [ "$N" = "1" ]; then echo "OK CC2 periodo pagado simultáneo: una sola fila"
else echo "FALLA CC2 s1=$C1 s2=$C2 filas=$N"; fi

# CC3: carrera reembolso vs. factura. La sesión 1 registra el periodo pagado (invoice.paid) y aún no
# confirma; la sesión 2 termina el reembolso total de esa factura (registro + antigüedad). Resultado
# correcto: el periodo queda 'refunded' (no cuenta para Privé), sin importar quién llegó primero.
HAS_COMMIT=$($PSQL -d "$DB" -At -c "SELECT count(*) FROM pg_proc WHERE proname='stripe_commit_payment_event'")
R3="SELECT public.prive_record_paid_period('${CU}03','in_cc3','sub_cc3','cus_cc3',now()-interval '1 day',now()+interval '29 days',9900,'mxn','webhook')->>'recorded'"
if [ "$HAS_COMMIT" = "1" ]; then
  F3="SELECT public.stripe_commit_payment_event(jsonb_build_object('event_id','evt_cc3','type','charge.refunded','invoice_id','in_cc3','amount',9900,'amount_refunded',9900,'action','reembolso_total_revocado','event_created',now()),'refund_full',9900)->>'logged'"
else # ruta anterior del webhook: marcar y luego registrar
  F3="SELECT public.prive_mark_paid_period('in_cc3','refund_full',9900)->>'reason'; INSERT INTO public.stripe_payment_events(event_id,type,invoice_id,action,event_created) VALUES ('evt_cc3','charge.refunded','in_cc3','reembolso_total_revocado',now())"
fi
conc "$R3" "$F3"
P=$($PSQL -d "$DB" -At -c "SELECT status FROM public.pro_paid_periods WHERE stripe_invoice_id='in_cc3'")
D=$($PSQL -d "$DB" -At -c "SELECT public.prive_tenure_days('${CU}03')")
if [ "$P" = "refunded" ] && [ "$D" = "0" ]; then echo "OK CC3 reembolso simultáneo al registro del periodo: queda refunded y no cuenta"
else echo "FALLA CC3 periodo=$P dias=$D (s2=$(echo $C2 | head -c 80))"; fi

# CC4: el mismo reembolso entregado dos veces al mismo tiempo: un registro y una sola marca.
if [ "$HAS_COMMIT" = "1" ]; then
  $PSQL -d "$DB" -At -c "SELECT public.prive_record_paid_period('${CU}04','in_cc4','sub_cc4','cus_cc4',now()-interval '1 day',now()+interval '29 days',9900,'mxn','webhook')" >/dev/null
  F4="SELECT public.stripe_commit_payment_event(jsonb_build_object('event_id','evt_cc4','type','charge.refunded','invoice_id','in_cc4','amount',9900,'amount_refunded',9900,'action','reembolso_total_revocado','event_created',now()),'refund_full',9900)->>'duplicate'"
  conc "$F4" "$F4"
  N=$($PSQL -d "$DB" -At -c "SELECT count(*) FROM public.stripe_payment_events WHERE event_id='evt_cc4'")
  P=$($PSQL -d "$DB" -At -c "SELECT status FROM public.pro_paid_periods WHERE stripe_invoice_id='in_cc4'")
  if [ "$C1" = "false" ] && [ "$C2" = "true" ] && [ "$N" = "1" ] && [ "$P" = "refunded" ]; then
    echo "OK CC4 mismo evento simultáneo: un registro (la 2a entrega es duplicado) y el periodo refunded"
  else echo "FALLA CC4 s1=$C1 s2=$C2 filas=$N periodo=$P"; fi
else
  echo "FALLA CC4 stripe_commit_payment_event no existe (migración 20261024051500 sin aplicar)"
fi
