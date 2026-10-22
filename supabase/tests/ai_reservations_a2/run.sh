#!/bin/bash
# [A2] Casos adversariales de la segunda auditoría, convertidos en regresión (ronda r2).
# Uso: PGHOST=... PGPORT=... ./run.sh <db>. Imprime solo líneas "OK …" o "FALLA …".
set -u
DIR=$(cd "$(dirname "$0")" && pwd); DB=${1:?db}
"$DIR/../ai_reservations/run.sh" "$DB" > /dev/null 2>&1
psql -U ${PGUSER:-postgres} -q -X -At -d "$DB" -f "$DIR/a2_adversarial.sql" 2>&1 | grep -o 'OK R2.*\|FALLA.*\|ERROR.*' | sed 's/^ERROR/FALLA ERROR/'
