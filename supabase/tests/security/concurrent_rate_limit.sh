#!/bin/bash
# F-07: dos peticiones simultáneas del mismo sujeto con límite 1. La sesión 1 cuenta su golpe y
# tarda en confirmar; la 2 llega en medio. Con check_rate_limit atómico (candado por sujeto+cubeta)
# la 2 espera y ve el golpe de la 1 → negada. Antes (SELECT y luego INSERT) pasaban las dos.
# Uso: PGHOST=… PGPORT=… ./concurrent_rate_limit.sh <db>
set -u
DB=${1:?db}; PSQL="psql -U ${PGUSER:-postgres} -q -X -At -d $DB"
T=$(mktemp)
$PSQL -c "BEGIN; SELECT public.check_rate_limit('ip:203.0.113.9','conc-test:m',1,60)->>'allowed'; SELECT pg_sleep(2); COMMIT;" > "$T" 2>&1 &
# Espera a que la sesión 1 ya tenga su golpe y esté dormida (antes era "sleep 0.5": con la máquina
# cargada la 2 llegaba primero y la prueba fallaba sin que el código estuviera mal).
for _ in $(seq 1 100); do
  [ "$($PSQL -c "SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND query LIKE '%conc-test:m%pg_sleep(2)%' AND pid <> pg_backend_pid()")" -ge 1 ] && break
  sleep 0.1
done
sleep 0.2
S2=$($PSQL -c "SELECT public.check_rate_limit('ip:203.0.113.9','conc-test:m',1,60)->>'allowed'")
wait
S1=$(grep -E '^(true|false)$' "$T" | head -1); rm -f "$T"
N=$($PSQL -c "SELECT count(*) FROM public.rate_limits WHERE subject='ip:203.0.113.9'")
if [ "$S1" = "true" ] && [ "$S2" = "false" ] && [ "$N" = "1" ]; then
  echo "OK R4 CONCURRENCIA check_rate_limit: sesión 1 permitida, sesión 2 simultánea negada, 1 golpe"
else
  echo "FALLA R4 CONCURRENCIA s1=$S1 s2=$S2 golpes=$N"
fi
