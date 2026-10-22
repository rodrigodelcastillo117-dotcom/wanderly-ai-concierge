#!/bin/bash
# Pruebas del expediente del viaje que no corría ningún run.sh (P3-QA-3): trip_quotes.sql (cotizaciones y
# base de cotización, 20261022133000) y trip_expediente.sql (viaje activo, selecciones, trip_id de reservas
# y gastos, documentos del viaje y gastos compartidos). Cada archivo corre en su PROPIA base nueva, con
# TODAS las migraciones en orden: así no la contaminan otras pruebas (sobre la base de security,
# aud_seguridad.sql deja un objeto en trip-documents y D5/D8 no cuadraban).
# Uso: PGHOST=/ruta/socket PGPORT=5432 ./run_trip.sh quotes|expediente [nombre_db]
# Salida: "OK …"/"FALLA …" por cada línea "<ID> … [esperado]: real" y un RESUMEN (ver ../lib.sh).
set -u
DIR=$(cd "$(dirname "$0")" && pwd); WHICH=${1:?quotes|expediente}; DB=${2:-iatos_trip_${1}_test}
. "$DIR/../lib.sh"
PSQL="psql -U ${PGUSER:-postgres} -q -X"
case "$WHICH" in
  quotes) FILE=trip_quotes.sql; ESPERADOS=11 ;;       # Q1–Q11
  expediente) FILE=trip_expediente.sql; ESPERADOS=27 ;; # T1–T3, S1–S5, B1–B3, D0–D11 (con D6b), P1–P3
  *) echo "uso: $0 quotes|expediente [db]"; exit 2 ;;
esac

main() {
  t_build_db "$DB"
  $PSQL -d "$DB" -f "$DIR/$FILE" 2>&1 | t_brackets
}

main 2>&1 | t_verdict "trip_$WHICH" "$ESPERADOS"
exit "${PIPESTATUS[1]}"
