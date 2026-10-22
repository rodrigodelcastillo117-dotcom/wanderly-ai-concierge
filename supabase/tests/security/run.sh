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
# 156 líneas OK de hardening, round_b, concierge_requests, taste_profile, action_idempotency, aud_seguridad
# y concurrencia (las mismas de antes) + 15 de rls_attacks + 6 de trip_delete_conversation + 9 de profiles_tier.
ESPERADOS=186

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
  "$DIR/concurrent_rate_limit.sh" "$DB"
}

main 2>&1 | t_verdict security "$ESPERADOS"
exit "${PIPESTATUS[1]}"
