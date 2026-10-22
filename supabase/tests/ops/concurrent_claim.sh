#!/bin/bash
# Dos sesiones reclaman vuelos al mismo tiempo: la A reclama 3 y deja su transacción ABIERTA; la B, que
# entra mientras tanto, debe recibir 3 vuelos distintos (SKIP LOCKED) sin esperar a la A. Las sesiones se
# coordinan con una compuerta de candados (t_conc2 de ../lib.sh), no con "sleep": la B corre solo cuando
# la A ya reclamó y sigue abierta, y la A no confirma hasta que la B terminó o quedó bloqueada.
# Uso: PGHOST=… PGPORT=… ./concurrent_claim.sh <db>
set -u
DB=${1:?db}; DIR=$(cd "$(dirname "$0")" && pwd)
. "$DIR/../lib.sh"
PSQL="psql -U ${PGUSER:-postgres} -d $DB -X -q -t -A"
$PSQL <<'SQL'
TRUNCATE public.tracked_flights;
INSERT INTO public.tracked_flights (user_id, flight, flight_date)
SELECT '11111111-0000-0000-0000-000000000001', 'AM' || g, (now() AT TIME ZONE 'UTC')::date
  FROM generate_series(1, 6) g;
SQL
CLAIM="SET ROLE service_role; SELECT coalesce(string_agg(flight, ',' ORDER BY flight), '(nada)') FROM public.claim_tracked_flights(3)"
t_conc2 "$DB" "$CLAIM" "BEGIN; $CLAIM; COMMIT;"
A=$C1; B=$C2
C=$($PSQL -c "SET ROLE service_role; SELECT coalesce(string_agg(flight, ',' ORDER BY flight), '(nada)') FROM public.claim_tracked_flights(10)")
NA=$(echo "$A" | tr ',' '\n' | grep -c '^AM'); NB=$(echo "$B" | tr ',' '\n' | grep -c '^AM')
COMMON=$(comm -12 <(echo "$A" | tr ',' '\n' | sort) <(echo "$B" | tr ',' '\n' | sort) | wc -l)
if [ -z "$T_CONC_ERR" ] && [ "$NA" = 3 ] && [ "$NB" = 3 ] && [ "$COMMON" = 0 ] && [ "$T_WAITED" = no ] && [ "$C" = "(nada)" ]; then
  echo "OK C2 CONCURRENCIA claim_tracked_flights: A=$A (abierta) y B=$B sin repetir y sin esperar a A; después, nada pendiente"
else
  echo "FALLA C2 CONCURRENCIA claim_tracked_flights A=$A B=$B comunes=$COMMON B_esperó=$T_WAITED después=$C ${T_CONC_ERR}"
fi
