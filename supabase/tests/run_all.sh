#!/bin/bash
# Corre TODAS las suites SQL en un Postgres local desechable (nunca producción) e imprime una tabla.
# Uso (como el usuario dueño del Postgres local):
#   PGHOST=/ruta/socket PGPORT=5432 supabase/tests/run_all.sh [prefijo_de_bases]
# Variables: KEEP=1 deja las bases al terminar (por defecto se borran); OUT_DIR=<dir> guarda ahí la salida
# completa de cada suite (por defecto un directorio temporal, que se imprime al final).
#
# Qué hace:
#   1. Construye una base de REFERENCIA aplicando todas las migraciones en orden, solo una vez cada una,
#      como en producción (t_build_db de lib.sh).
#   2. Corre las 22 suites (supabase/tests/<suite>/run.sh, incluidas wrapped, diario, prive_ideas y tarjetas) y las dos del expediente del viaje que antes no
#      corría nadie (security/run_trip.sh quotes|expediente), cada una en su propia base <prefijo>_<suite>.
#   3. Por cada suite compara el md5 de prosrc de cada función de la base de referencia con el de la base
#      de la suite al terminar. Una función distinta o ausente es FALLA: significa que la suite probó una
#      versión que no es la que queda en producción (P2-QA-1).
#   4. Imprime la tabla y sale con 0 solo si TODAS las suites pasaron (su run.sh salió con 0, con su total
#      esperado de OK y sin fallas) y ninguna dejó funciones distintas de la referencia.
set -u
DIR=$(cd "$(dirname "$0")" && pwd)
. "$DIR/lib.sh"
PREFIX=${1:-iatos_all}
OUT=${OUT_DIR:-$(mktemp -d -t iatos_sql_XXXXXX)}
mkdir -p "$OUT"
SUITES=(ai_reservations ai_reservations_a2 avatar boveda bridge concierge2 cost edition grupo members_more ops payments prive
        prive_catalog prive_key privevalor security social wrapped diario prive_ideas tarjetas trip_quotes trip_expediente)

fn_md5() { # $1 base → "esquema.función(args) md5" por línea, ordenado
  $T_PSQL -At -F ' ' -d "$1" -c "
    SELECT translate(n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', ' ', '_'), md5(p.prosrc)
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg_toast%'
       AND n.nspname NOT LIKE 'pg_temp%'
     ORDER BY 1" | LC_ALL=C sort -k1,1
}

REF="${PREFIX}_ref"
echo "== base de referencia $REF (todas las migraciones en orden, una sola vez)"
t_build_db "$REF" > "$OUT/ref.txt" 2>&1
grep -v '^AVISO' "$OUT/ref.txt"
REF_FAIL=$(grep -c '^FALLA' "$OUT/ref.txt")
fn_md5 "$REF" > "$OUT/ref.md5"
REF_N=$(wc -l < "$OUT/ref.md5")
echo "   $REF_N funciones en la referencia; migraciones con FALLA: $REF_FAIL"

ROWS=(); TOTAL_FAIL=$REF_FAIL; SUM_OK=0; SUM_EXP=0
for s in "${SUITES[@]}"; do
  db="${PREFIX}_${s}"
  t0=$(date +%s)
  case "$s" in
    trip_quotes) bash "$DIR/security/run_trip.sh" quotes "$db" > "$OUT/$s.txt" 2>&1 ;;
    trip_expediente) bash "$DIR/security/run_trip.sh" expediente "$db" > "$OUT/$s.txt" 2>&1 ;;
    *) bash "$DIR/$s/run.sh" "$db" > "$OUT/$s.txt" 2>&1 ;;
  esac
  rc=$?
  secs=$(( $(date +%s) - t0 ))
  res=$(grep '^RESUMEN' "$OUT/$s.txt" | tail -1)
  ok=$(sed -n 's/.* ok=\([0-9]*\).*/\1/p' <<<"$res"); ok=${ok:-0}
  exp=$(sed -n 's/.* esperado=\([0-9]*\).*/\1/p' <<<"$res"); exp=${exp:-?}
  fails=$(sed -n 's/.* fallas=\([0-9]*\).*/\1/p' <<<"$res"); fails=${fails:-?}
  # Funciones de la referencia que en la base de la suite faltan o tienen otro cuerpo.
  fn_md5 "$db" > "$OUT/$s.md5"
  LC_ALL=C join -a1 -e AUSENTE -o 0,1.2,2.2 "$OUT/ref.md5" "$OUT/$s.md5" | awk '$2 != $3' > "$OUT/$s.fndiff"
  ndiff=$(wc -l < "$OUT/$s.fndiff")
  if [ "$rc" -eq 0 ] && [ -n "$res" ] && [ "$ndiff" -eq 0 ]; then verdict=PASA; else verdict=FALLA; TOTAL_FAIL=$((TOTAL_FAIL + 1)); fi
  [ "$ndiff" -gt 0 ] && echo "FALLA $s: $ndiff función(es) distintas de la base aplicada solo en orden: $(awk '{print $1}' "$OUT/$s.fndiff" | head -5 | tr '\n' ' ')"
  [ -z "$res" ] && echo "FALLA $s: la suite no imprimió su RESUMEN (rc=$rc)"
  SUM_OK=$((SUM_OK + ok)); [ "$exp" != "?" ] && SUM_EXP=$((SUM_EXP + exp))
  ROWS+=("$(printf '| %-16s | %5s | %8s | %6s | %4s | %13s | %-6s | %4ss |' "$s" "$ok" "$exp" "$fails" "$rc" "$ndiff/$REF_N" "$verdict" "$secs")")
  echo "== $s: $verdict (ok=$ok esperado=$exp fallas=$fails rc=$rc funciones≠orden=$ndiff) ${secs}s"
  if [ "${KEEP:-0}" != 1 ]; then $T_PSQL -d postgres -c "DROP DATABASE IF EXISTS $db" >/dev/null 2>&1; fi
done
[ "${KEEP:-0}" != 1 ] && $T_PSQL -d postgres -c "DROP DATABASE IF EXISTS $REF" >/dev/null 2>&1

echo
echo "| suite            |    OK | esperado | fallas |   rc | funciones≠orden | result | tiempo |"
echo "|------------------|------:|---------:|-------:|-----:|--------------:|--------|-------:|"
printf '%s\n' "${ROWS[@]}"
printf '| %-16s | %5s | %8s | %6s | %4s | %13s | %-6s | %5s |\n' TOTAL "$SUM_OK" "$SUM_EXP" "" "" "" "$( [ "$TOTAL_FAIL" -eq 0 ] && echo PASA || echo FALLA )" ""
echo
echo "Salida completa de cada suite: $OUT"
if [ "$TOTAL_FAIL" -eq 0 ]; then
  echo "RESULTADO run_all: PASA (${#SUITES[@]} suites, $SUM_OK OK de $SUM_EXP esperados)"
  exit 0
fi
echo "RESULTADO run_all: FALLA ($TOTAL_FAIL suite(s) o pasos con falla)"
exit 1
