#!/bin/bash
# Dos sesiones reclaman vuelos al mismo tiempo: la A deja su transacción abierta 3 s; la B, que
# entra mientras tanto, debe recibir vuelos distintos (SKIP LOCKED) sin esperar a la A.
# Uso: PGHOST=… PGPORT=… ./concurrent_claim.sh <db>
set -u
DB=${1:?db}
PSQL="psql -U ${PGUSER:-postgres} -d $DB -X -q -t -A"
$PSQL <<'SQL'
TRUNCATE public.tracked_flights;
INSERT INTO public.tracked_flights (user_id, flight, flight_date)
SELECT '11111111-0000-0000-0000-000000000001', 'AM' || g, (now() AT TIME ZONE 'UTC')::date
  FROM generate_series(1, 6) g;
SQL
OUT=$(mktemp -d)
( $PSQL <<'SQL' > "$OUT/a.txt" 2>&1
BEGIN;
SET ROLE service_role;
SELECT 'A reclamó ' || string_agg(flight, ',' ORDER BY flight) || ' a las ' || to_char(clock_timestamp(), 'HH24:MI:SS.MS') FROM public.claim_tracked_flights(3);
SELECT pg_sleep(3);
SELECT 'A COMMIT a las ' || to_char(clock_timestamp(), 'HH24:MI:SS.MS');
COMMIT;
SQL
) &
sleep 1
$PSQL <<'SQL' > "$OUT/b.txt" 2>&1
BEGIN;
SET ROLE service_role;
SELECT 'B (A sigue abierta) reclamó ' || coalesce(string_agg(flight, ',' ORDER BY flight), '(nada)') || ' a las ' || to_char(clock_timestamp(), 'HH24:MI:SS.MS') FROM public.claim_tracked_flights(3);
COMMIT;
SQL
wait
$PSQL <<'SQL' > "$OUT/c.txt" 2>&1
SET ROLE service_role;
SELECT 'C (después de ambas) reclamó ' || coalesce(string_agg(flight, ',' ORDER BY flight), '(nada: todos ya intentados)') FROM public.claim_tracked_flights(10);
SQL
cat "$OUT/a.txt" "$OUT/b.txt" "$OUT/c.txt" | grep -v '^$\|^SET$\|^BEGIN$\|^COMMIT$'
rm -rf "$OUT"
