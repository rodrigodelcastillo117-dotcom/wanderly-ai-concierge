# Utilidades comunes de las suites SQL (P2-QA-1, P2-QA-2). Se carga desde cada run.sh con
#   . "$DIR/../lib.sh"
#
# Convención de salida de TODAS las suites:
#   "OK …"     una aserción que pasó; cuenta para el total esperado de la suite.
#   "FALLA …"  una aserción que no pasó, una migración rota, un error de SQL inesperado o un total
#              de OK distinto del esperado. Cualquier línea que contenga FALLA, FALLÓ o ERROR y no
#              empiece por "OK" o "AVISO" cuenta como falla.
#   "AVISO …"  algo esperado que no es una prueba (p. ej. pg_cron no existe en un Postgres local).
#   "RESUMEN …" la última línea: total de OK, total esperado, fallas y veredicto. run_all.sh la lee.
# Cada run.sh termina con `main "$@" 2>&1 | t_verdict <suite> <OK esperados>` y sale con su código:
# 0 solo si no hubo ninguna falla y el número de OK es exactamente el esperado.
#
# Orden de las migraciones: la base de prueba se construye aplicando TODAS las migraciones en orden,
# igual que en producción. Una migración NO se vuelve a aplicar sobre la base donde corren las pruebas
# (eso la dejaba con versiones viejas de funciones redefinidas después, P2-QA-1): la idempotencia se
# comprueba en una COPIA de la base (t_idempotency), que se borra al terminar.

T_LIB_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
T_MIG="$T_LIB_DIR/../migrations"
T_SEC="$T_LIB_DIR/security"
T_PSQL="psql -U ${PGUSER:-postgres} -q -X"

# Errores de migración que se esperan en un Postgres local (no en producción). Cualquier otro es FALLA.
t_allowed_migration_error() { # $1 archivo, $2 primera línea de error
  case "$(basename "$1")" in
    20260527200005_*) [[ "$2" == *'extension "pg_cron" is not available'* ]] ;;
    *) return 1 ;;
  esac
}

# Aplica un archivo SQL con ON_ERROR_STOP. Imprime "FALLA migración …" (o AVISO si el error es de los
# esperados en local) y devuelve 1 si falló.
t_apply() { # $1 base, $2 archivo, [$3 prefijo del mensaje]
  local err rc first
  err=$($T_PSQL -v ON_ERROR_STOP=1 -d "$1" -f "$2" 2>&1 >/dev/null); rc=$?
  first=$(printf '%s\n' "$err" | grep -m1 'ERROR\|FATAL\|error:')
  [ "$rc" -eq 0 ] && [ -z "$first" ] && return 0
  [ -z "$first" ] && first="psql salió con código $rc"
  if t_allowed_migration_error "$2" "$first"; then
    echo "AVISO migración $(basename "$2"): falla en local como se espera ($first)"
    return 0
  fi
  echo "FALLA migración ${3:-}$(basename "$2"): $first"
  return 1
}

# Crea la base desde cero y aplica roles, stubs de Supabase y TODAS las migraciones en orden.
t_build_db() { # $1 base
  $T_PSQL -d postgres -c "DROP DATABASE IF EXISTS $1" -c "CREATE DATABASE $1" >/dev/null 2>&1 \
    || { echo "FALLA no se pudo crear la base $1"; return 1; }
  # 00_roles.sql crea roles del clúster: si ya existen da error y es normal.
  $T_PSQL -d "$1" -f "$T_SEC/00_roles.sql" >/dev/null 2>&1
  $T_PSQL -d "$1" -v ON_ERROR_STOP=1 -f "$T_SEC/01_supabase_stubs.sql" >/dev/null 2>&1 \
    || echo "FALLA stubs de Supabase (01_supabase_stubs.sql) en $1"
  local f
  for f in "$T_MIG"/*.sql; do t_apply "$1" "$f"; done
}

# Copia una base (CREATE DATABASE … TEMPLATE). Reintenta: tras una prueba de concurrencia, el
# servidor puede tardar unos milisegundos en soltar las conexiones de la base de origen.
t_copy_db() { # $1 origen, $2 copia
  local i
  for i in $(seq 1 40); do
    $T_PSQL -d postgres -c "DROP DATABASE IF EXISTS $2" -c "CREATE DATABASE $2 TEMPLATE $1" >/dev/null 2>&1 && return 0
    sleep 0.25
  done
  return 1
}

# Idempotencia SIN tocar la base de las pruebas: copia la base (que ya tiene todas las migraciones
# en orden), vuelve a aplicar ahí los archivos dados y borra la copia. Con T_IDEM_OK=1 imprime además
# "OK idempotente <archivo>" por cada uno (las suites que ya contaban esas líneas).
t_idempotency() { # $1 base, $2… archivos
  local db=$1 copy="${1}_idem" f; shift
  if ! t_copy_db "$db" "$copy"; then echo "FALLA idempotencia: no se pudo copiar la base $db"; return 1; fi
  for f in "$@"; do
    [ -f "$f" ] || continue
    if t_apply "$copy" "$f" "(segunda pasada, no es idempotente) "; then
      [ "${T_IDEM_OK:-0}" = 1 ] && echo "OK idempotente $(basename "$f")"
    fi
  done
  $T_PSQL -d postgres -c "DROP DATABASE IF EXISTS $copy" >/dev/null 2>&1
  return 0
}

# Convierte líneas "<ID> <descripción> [<esperado>]: <observado>" en "OK …" o "FALLA … (esperado: …)".
# Las demás líneas se descartan (las pruebas de este formato provocan errores a propósito: el veredicto
# lo dan las líneas con corchetes y el total esperado de la suite). Quita el prefijo "NOTICE:  ".
t_brackets() {
  perl -ne '
    s/^psql:\S+:\d+: //; s/^(NOTICE|INFO):\s+//; s/^\s+//; s/\s+$//;
    next unless /^([A-Z][A-Za-z]*\d+[A-Za-z0-9]*) (.*)\[([^\]]*)\]:\s?(.*)$/;
    my ($id, $d, $e, $o) = ($1, $2, $3, $4);
    if ($e eq $o) { print "OK $id $d\[$e\]: $o\n" } else { print "FALLA $id $d\[$e\]: $o (esperado: $e)\n" }
  '
}

# Dos sesiones coordinadas con una compuerta (sin "sleep" que dependa de la carga de la máquina):
#   1. una sesión "compuerta" toma pg_advisory_lock(20261026, k);
#   2. la sesión 1 corre "BEGIN; <SQL1>; pg_advisory_xact_lock(20261026, k); COMMIT": hace su parte y
#      se queda con la transacción ABIERTA esperando la compuerta (se comprueba en pg_locks);
#   3. la sesión 2 corre <SQL2>; se espera a que termine o a que quede bloqueada por un candado;
#   4. se abre la compuerta (pg_terminate_backend de la sesión compuerta) y la sesión 1 confirma.
# Deja en C1 la primera línea de la sesión 1, en C2 la salida de la sesión 2, en T_WAITED "si" o "no"
# (si la sesión 2 quedó esperando un candado de la 1) y en T_CONC_ERR un texto si algo no se coordinó.
T_GATE_SEQ=0
t_conc2() { # $1 base, $2 SQL de la sesión 1, $3 SQL de la sesión 2
  local db=$1 k app d i n pid1 pid2 pidg
  T_GATE_SEQ=$((T_GATE_SEQ + 1)); k=$(( ($$ % 100000) * 100 + T_GATE_SEQ )); app="tconc_${k}"
  d=$(mktemp -d); C1=""; C2=""; T_WAITED="no"; T_CONC_ERR=""
  local Q="$T_PSQL -At -d $db"
  PGAPPNAME="${app}_g" $Q -c "SELECT pg_advisory_lock(20261026, $k); SELECT pg_sleep(600);" >/dev/null 2>&1 &
  pidg=$!
  for i in $(seq 1 600); do
    n=$($Q -c "SELECT count(*) FROM pg_locks l JOIN pg_stat_activity a USING (pid) WHERE a.application_name='${app}_g' AND l.locktype='advisory' AND l.granted AND l.classid=20261026 AND l.objid=$k")
    [ "$n" = "1" ] && break; sleep 0.05
  done
  [ "$n" = "1" ] || T_CONC_ERR="la compuerta no tomó su candado"
  PGAPPNAME="${app}_1" $Q -c "BEGIN; $2; SELECT pg_advisory_xact_lock(20261026, $k); COMMIT;" > "$d/1" 2>&1 &
  pid1=$!
  for i in $(seq 1 600); do
    n=$($Q -c "SELECT count(*) FROM pg_locks l JOIN pg_stat_activity a USING (pid) WHERE a.application_name='${app}_1' AND l.locktype='advisory' AND NOT l.granted AND l.classid=20261026 AND l.objid=$k")
    [ "$n" = "1" ] && break
    kill -0 "$pid1" 2>/dev/null || break
    sleep 0.05
  done
  [ "$n" = "1" ] || T_CONC_ERR="${T_CONC_ERR:+$T_CONC_ERR; }la sesión 1 no llegó a la compuerta con su transacción abierta"
  PGAPPNAME="${app}_2" $Q -c "$3" > "$d/2" 2>&1 &
  pid2=$!
  for i in $(seq 1 600); do
    kill -0 "$pid2" 2>/dev/null || break
    n=$($Q -c "SELECT count(*) FROM pg_stat_activity WHERE application_name='${app}_2' AND wait_event_type='Lock'")
    if [ "$n" = "1" ]; then T_WAITED="si"; break; fi
    sleep 0.05
  done
  $Q -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name='${app}_g'" >/dev/null 2>&1
  wait "$pid1" "$pid2" 2>/dev/null; wait "$pidg" 2>/dev/null
  C1=$(grep -v '^$' "$d/1" | head -1); C2=$(grep -v '^$' "$d/2")
  rm -rf "$d"
}

# Lee la salida de la suite, la reimprime y al final decide. Sale con 0 solo si no hubo fallas y el
# total de OK es exactamente el esperado.
t_verdict() { # $1 nombre de la suite, $2 total de OK esperado
  local name=$1 expected=$2 ok=0 fail=0 line verdict
  while IFS= read -r line; do
    printf '%s\n' "$line"
    case "$line" in
      OK*) ok=$((ok + 1)) ;;
      AVISO*|RESUMEN*) ;;
      *FALLA*|*FALLÓ*|*ERROR*) fail=$((fail + 1)) ;;
    esac
  done
  if [ "$ok" -ne "$expected" ]; then
    echo "FALLA $name: se esperaban $expected líneas OK y hubo $ok"
    fail=$((fail + 1))
  fi
  if [ "$fail" -eq 0 ]; then verdict=PASA; else verdict=FALLA; fi
  echo "RESUMEN $name ok=$ok esperado=$expected fallas=$fail resultado=$verdict"
  [ "$verdict" = PASA ]
}
