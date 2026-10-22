# Pruebas de concurrencia de pagos y cuota (las carga run.sh y cc3_repeat.sh con `.`; requieren ../lib.sh).
# Cada caso usa t_conc2: la sesión 1 hace su parte y se queda con la transacción ABIERTA en una compuerta
# de candados; la sesión 2 corre solo cuando la 1 ya llegó ahí, y la 1 no confirma hasta que la 2 terminó
# o quedó bloqueada esperando un candado de la 1. Antes era "sleep 0.5": con la máquina cargada la sesión
# 2 podía llegar ANTES que la 1 y CC3 daba OK falsos con la mutación M1 (sin candado por factura).
PAY_PSQL="psql -U ${PGUSER:-postgres} -q -X"

pay_conc_quota() { # CONCURRENCIA trip_analysis: la 1 consume el análisis gratis; la 2 llega en medio → negada.
  local db=$1 U=22222222-0000-0000-0000-000000000001 used
  $PAY_PSQL -d "$db" -c "INSERT INTO auth.users (id, email, email_confirmed_at) VALUES ('$U', 'carrera@test.mx', now())"
  t_conc2 "$db" "SELECT public.consume_free_quota('$U', 'trip_analysis')->>'allowed'" \
    "SELECT public.consume_free_quota('$U', 'trip_analysis')->>'reason'"
  used=$($PAY_PSQL -d "$db" -At -c "SELECT trips_analyzed_used FROM public.usage_limits WHERE user_id = '$U'")
  if [ -z "$T_CONC_ERR" ] && [ "$C1" = "true" ] && [ "$C2" = "quota_exceeded" ] && [ "$used" = "1" ]; then
    echo "OK CONCURRENCIA trip_analysis: sesión 1 permitida, sesión 2 simultánea negada, contador=1 (s2 esperó: $T_WAITED)"
  else
    echo "FALLA CONCURRENCIA s1=$C1 s2=$C2 usados=$used ${T_CONC_ERR}"
  fi
}

pay_conc_reserve() { # CONCURRENCIA reserve_quota: la 1 aparta el análisis; la 2 (otra pestaña) → in_progress.
  local db=$1 U2=22222222-0000-0000-0000-000000000002
  $PAY_PSQL -d "$db" -c "INSERT INTO auth.users (id, email, email_confirmed_at) VALUES ('$U2', 'carrera2@test.mx', now())"
  t_conc2 "$db" "SELECT public.reserve_quota('$U2', 'trip_analysis', 'c:pestana-1')->>'reason'" \
    "SELECT public.reserve_quota('$U2', 'trip_analysis', 'c:pestana-2')->>'reason'"
  if [ -z "$T_CONC_ERR" ] && [ "$C1" = "reserved" ] && [ "$C2" = "in_progress" ]; then
    echo "OK CONCURRENCIA reserve_quota: sesión 1 reservada, sesión 2 simultánea in_progress (s2 esperó: $T_WAITED)"
  else
    echo "FALLA CONCURRENCIA reserve_quota r1=$C1 r2=$C2 ${T_CONC_ERR}"
  fi
}

PAY_CU=4d0d0000-0000-0000-0000-0000000000
pay_conc_users() {
  $PAY_PSQL -d "$1" -c "INSERT INTO auth.users (id, email, email_confirmed_at) SELECT ('${PAY_CU}'||lpad(n::text,2,'0'))::uuid, 'conc'||n||'@test.mx', now() FROM generate_series(1,4) n"
}

pay_cc1() { # dos entregas simultáneas del primer evento de una cuenta SIN fila: una sola fila, PRO una vez.
  local db=$1 A N
  A="SELECT public.apply_stripe_subscription('${PAY_CU}01','cus_cc1','sub_cc1','active',NULL,now()+interval '30 days',false,'p','mxn',now())->>'applied'"
  t_conc2 "$db" "$A" "$A"
  N=$($PAY_PSQL -d "$db" -At -c "SELECT count(*)||':'||max(status) FROM public.subscriptions WHERE user_id='${PAY_CU}01'")
  if [ -z "$T_CONC_ERR" ] && [ "$C1" = "true" ] && [ "$C2" = "true" ] && [ "$N" = "1:active" ]; then
    echo "OK CC1 apply_stripe_subscription simultáneo sin fila previa: una fila active (s1=$C1 s2=$C2)"
  else echo "FALLA CC1 s1=$C1 s2=$C2 filas=$N ${T_CONC_ERR}"; fi
}

pay_cc2() { # invoice.paid e invoice.payment_succeeded de la misma factura al mismo tiempo: un solo periodo.
  local db=$1 R N
  R="SELECT public.prive_record_paid_period('${PAY_CU}02','in_cc2','sub_cc2','cus_cc2',now()-interval '1 day',now()+interval '29 days',9900,'mxn','webhook')->>'recorded'"
  t_conc2 "$db" "$R" "$R"
  N=$($PAY_PSQL -d "$db" -At -c "SELECT count(*) FROM public.pro_paid_periods WHERE stripe_invoice_id='in_cc2'")
  if [ -z "$T_CONC_ERR" ] && [ "$C1" = "true" ] && [ "$C2" = "true" ] && [ "$N" = "1" ]; then echo "OK CC2 periodo pagado simultáneo: una sola fila"
  else echo "FALLA CC2 s1=$C1 s2=$C2 filas=$N ${T_CONC_ERR}"; fi
}

# CC3: carrera reembolso vs. factura. La sesión 1 registra el periodo pagado (invoice.paid) y aún no
# confirma; la sesión 2 termina el reembolso total de esa factura (registro + antigüedad). Correcto: la 2
# ESPERA el candado de la factura que tiene la 1 y el periodo queda 'refunded' (no cuenta para Privé).
# Es la única prueba que protege el candado (CC2 y CC4 pasan también sin él por UNIQUE y la PK).
pay_cc3() { # $1 base, [$2 usuario], [$3 factura]
  local db=$1 U=${2:-${PAY_CU}03} INV=${3:-in_cc3} HAS_COMMIT R3 F3 P D
  HAS_COMMIT=$($PAY_PSQL -d "$db" -At -c "SELECT count(*) FROM pg_proc WHERE proname='stripe_commit_payment_event'")
  R3="SELECT public.prive_record_paid_period('$U','$INV','sub_cc3','cus_cc3',now()-interval '1 day',now()+interval '29 days',9900,'mxn','webhook')->>'recorded'"
  if [ "$HAS_COMMIT" = "1" ]; then
    F3="SELECT public.stripe_commit_payment_event(jsonb_build_object('event_id','evt_$INV','type','charge.refunded','invoice_id','$INV','amount',9900,'amount_refunded',9900,'action','reembolso_total_revocado','event_created',now()),'refund_full',9900)->>'logged'"
  else # ruta anterior del webhook: marcar y luego registrar
    F3="SELECT public.prive_mark_paid_period('$INV','refund_full',9900)->>'reason'; INSERT INTO public.stripe_payment_events(event_id,type,invoice_id,action,event_created) VALUES ('evt_$INV','charge.refunded','$INV','reembolso_total_revocado',now())"
  fi
  t_conc2 "$db" "$R3" "$F3"
  P=$($PAY_PSQL -d "$db" -At -c "SELECT status FROM public.pro_paid_periods WHERE stripe_invoice_id='$INV'")
  D=$($PAY_PSQL -d "$db" -At -c "SELECT public.prive_tenure_days('$U')")
  if [ -z "$T_CONC_ERR" ] && [ "$T_WAITED" = "si" ] && [ "$P" = "refunded" ] && [ "$D" = "0" ]; then
    echo "OK CC3 reembolso simultáneo al registro del periodo: la 2a sesión esperó el candado de la factura; queda refunded y no cuenta"
  else
    echo "FALLA CC3 periodo=$P dias=$D s2_esperó=$T_WAITED (s2=$(echo $C2 | head -c 80)) ${T_CONC_ERR}"
  fi
}

pay_cc4() { # el mismo reembolso entregado dos veces al mismo tiempo: un registro y una sola marca.
  local db=$1 F4 N P HAS_COMMIT
  HAS_COMMIT=$($PAY_PSQL -d "$db" -At -c "SELECT count(*) FROM pg_proc WHERE proname='stripe_commit_payment_event'")
  if [ "$HAS_COMMIT" != "1" ]; then echo "FALLA CC4 stripe_commit_payment_event no existe (migración 20261024051500 sin aplicar)"; return; fi
  $PAY_PSQL -d "$db" -At -c "SELECT public.prive_record_paid_period('${PAY_CU}04','in_cc4','sub_cc4','cus_cc4',now()-interval '1 day',now()+interval '29 days',9900,'mxn','webhook')" >/dev/null
  F4="SELECT public.stripe_commit_payment_event(jsonb_build_object('event_id','evt_cc4','type','charge.refunded','invoice_id','in_cc4','amount',9900,'amount_refunded',9900,'action','reembolso_total_revocado','event_created',now()),'refund_full',9900)->>'duplicate'"
  t_conc2 "$db" "$F4" "$F4"
  N=$($PAY_PSQL -d "$db" -At -c "SELECT count(*) FROM public.stripe_payment_events WHERE event_id='evt_cc4'")
  P=$($PAY_PSQL -d "$db" -At -c "SELECT status FROM public.pro_paid_periods WHERE stripe_invoice_id='in_cc4'")
  if [ -z "$T_CONC_ERR" ] && [ "$C1" = "false" ] && [ "$C2" = "true" ] && [ "$N" = "1" ] && [ "$P" = "refunded" ]; then
    echo "OK CC4 mismo evento simultáneo: un registro (la 2a entrega es duplicado) y el periodo refunded"
  else echo "FALLA CC4 s1=$C1 s2=$C2 filas=$N periodo=$P ${T_CONC_ERR}"; fi
}
