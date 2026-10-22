#!/bin/bash
# Reproduce las migraciones del repo EN ORDEN en un Postgres local desechable (nunca producción) y corre
# los ataques y flujos legítimos de rls_attacks.sql, hardening.sql, las demás pruebas de seguridad, la
# auditoría de cierre (aud_seguridad.sql) y la prueba de concurrencia del rate limit.
# Uso: PGHOST=/ruta/socket PGPORT=5432 ./run.sh [nombre_db]
# Salida: solo líneas "OK …", "FALLA …" o "AVISO …" y un "RESUMEN" final (ver ../lib.sh). Sale con
# código distinto de 0 si algo falla, si una migración no se aplica o si el total de OK no es el esperado.
# La migración de pg_cron falla en local (la extensión no existe fuera de Supabase): sale como AVISO.
# Otras suites usan este script para construir su base; de su salida solo toman las líneas
# "FALLA migración …".
set -u
DIR=$(cd "$(dirname "$0")" && pwd); DB=${1:-iatos_rls_test}
. "$DIR/../lib.sh"
PSQL="psql -U ${PGUSER:-postgres} -q"
# Segunda auditoría, grupo privacidad (T-P2-1 y siguientes). Varias pruebas r2_privacidad_*.sql recrean
# datos viejos y vuelven a aplicar su migración (\ir) para probar el relleno. Para no reaplicar
# migraciones sobre la base de las pruebas (P2-QA-1) corren en una COPIA de la base, que se borra al
# terminar; y para no probar versiones viejas de funciones que una migración posterior redefine (p. ej.
# purge_account_data: 20261026130000 → 20261026170000), cada "\ir <migración N>" se sustituye por la
# migración N seguida de TODAS las posteriores en orden, como las aplicaría producción (Q-L1).
r2_privacidad() { # $1 base
  local copy="${1}_r2priv" tmp t
  if ! t_copy_db "$1" "$copy"; then echo "FALLA r2_privacidad: no se pudo copiar la base $1"; return; fi
  tmp=$(mktemp -d)
  for t in "$DIR"/r2_privacidad_*.sql; do
    [ -f "$t" ] || continue
    MIGDIR="$T_MIG" perl -ne '
      if (m{^\\ir\s+\.\./\.\./migrations/(\S+\.sql)\s*$}) {
        my $n = $1; opendir(my $d, $ENV{MIGDIR}) or die; my @m = sort grep { /\.sql$/ && $_ ge $n } readdir($d);
        die "no existe la migración $n\n" unless grep { $_ eq $n } @m;
        print "\\i $ENV{MIGDIR}/$_\n" for @m; next;
      }
      print;' "$t" > "$tmp/$(basename "$t")" || { echo "FALLA r2_privacidad: no se pudo preparar $(basename "$t")"; continue; }
    $PSQL -X -d "$copy" -f "$tmp/$(basename "$t")" 2>&1 | grep -o 'OK .*\|FALLA.*\|ERROR.*' | sed 's/^ERROR/FALLA ERROR/'
  done
  rm -rf "$tmp"
  $PSQL -d postgres -c "DROP DATABASE IF EXISTS $copy" >/dev/null 2>&1
}

# 156 líneas OK de hardening, round_b, concierge_requests, taste_profile, action_idempotency, aud_seguridad
# y concurrencia (las mismas de antes) + 15 de rls_attacks + 6 de trip_delete_conversation + 9 de profiles_tier
# = 186; ronda r2 (grupo privacidad): +2 de rls_attacks (L1c, L1d: el código crea una solicitud que se
# acepta), +1 de hardening (P1b) y +65 de r2_privacidad_*.sql (avatar 11, d1_politicas 9, documentos 18,
# fotos 17, photo_url 7, tier_audit 3).
ESPERADOS=254

main() {
  t_build_db "$DB"
  # rls_attacks.sql, trip_delete_conversation.sql y profiles_tier.sql imprimen "<ID> … [esperado]: real":
  # t_brackets lo convierte en OK/FALLA (antes había que comparar los corchetes a mano).
  $PSQL -X -d "$DB" -f "$DIR/rls_attacks.sql" 2>&1 | t_brackets
  $PSQL -X -d "$DB" -f "$DIR/hardening.sql" 2>&1 | grep -o 'OK .*\|FALLA.*\|ERROR.*' | sed 's/^ERROR/FALLA ERROR/'
  $PSQL -X -d "$DB" -f "$DIR/round_b.sql" 2>&1 | grep -o 'OK .*\|FALLA.*\|ERROR.*' | sed 's/^ERROR/FALLA ERROR/'
  $PSQL -X -d "$DB" -f "$DIR/concierge_requests.sql" 2>&1 | grep -o 'OK .*\|FALLA.*\|ERROR.*' | sed 's/^ERROR/FALLA ERROR/'
  $PSQL -X -d "$DB" -f "$DIR/trip_delete_conversation.sql" 2>&1 | t_brackets
  $PSQL -X -d "$DB" -f "$DIR/taste_profile.sql" 2>&1 | grep -o 'OK .*\|FALLA.*\|ERROR.*' | sed 's/^ERROR/FALLA ERROR/'
  $PSQL -X -d "$DB" -f "$DIR/profiles_tier.sql" 2>&1 | t_brackets
  $PSQL -X -d "$DB" -f "$DIR/action_idempotency.sql" 2>&1 | grep -o 'OK .*\|FALLA.*\|ERROR.*' | sed 's/^ERROR/FALLA ERROR/'
  # aud_seguridad.sql intenta escrituras que la RLS debe rechazar ("violates row-level security"): esos
  # errores son el resultado esperado del ataque y se descartan; cada caso tiene su línea OK/FALLA y el
  # total esperado detecta una línea que deje de imprimirse.
  $PSQL -X -d "$DB" -f "$DIR/aud_seguridad.sql" 2>&1 | grep -o 'OK .*\|FALLA.*\|ERROR.*' | grep -v 'violates row-level security' | sed 's/^ERROR/FALLA ERROR/'
  # Idempotencia de las migraciones r2 de privacidad (en una copia, ../lib.sh) y sus pruebas.
  t_idempotency "$DB" "$T_MIG"/20261026*_r2_privacidad_*.sql
  r2_privacidad "$DB"
  "$DIR/concurrent_rate_limit.sh" "$DB"
}

main 2>&1 | t_verdict security "$ESPERADOS"
exit "${PIPESTATUS[1]}"
