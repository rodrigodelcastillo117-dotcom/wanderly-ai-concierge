#!/bin/bash
# Repite CC3 (concurrency.sh) N veces sobre una base ya construida por run.sh, cada vez con un usuario y una
# factura nuevos. Sirve para demostrar que CC3 es determinista: sin la mutación da N OK; con la mutación M1
# de pagos (pro_paid_period_lock sin candado) da N FALLA, sin OK falsos.
# Uso: PGHOST=… PGPORT=… ./cc3_repeat.sh <db> [N=20]
set -u
DIR=$(cd "$(dirname "$0")" && pwd); DB=${1:?db}; N=${2:-20}
. "$DIR/../lib.sh"
. "$DIR/concurrency.sh"
ok=0; fail=0
for i in $(seq 1 "$N"); do
  U=$(printf '4d0d0000-0000-0000-0000-0000%08d' "$((90000000 + i + RANDOM))")
  $PAY_PSQL -d "$DB" -c "INSERT INTO auth.users (id, email, email_confirmed_at) VALUES ('$U','rep-$U@t.mx',now()) ON CONFLICT DO NOTHING" >/dev/null
  line=$(pay_cc3 "$DB" "$U" "in_rep_${i}_$RANDOM")
  echo "[$i] $line"
  case "$line" in OK*) ok=$((ok + 1));; *) fail=$((fail + 1));; esac
done
echo "CC3 repetida $N veces: OK=$ok FALLA=$fail"
