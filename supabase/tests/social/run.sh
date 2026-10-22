#!/bin/bash
# Pruebas SQL de Social (amigo_perfil, amigos_resumen, saludar_amigo, viajes juntos). Construye la base con
# TODAS las migraciones del repo en orden en un Postgres local desechable (la de pg_cron falla en local y
# sale como AVISO), prueba en una COPIA de la base que la migración nueva es idempotente, corre social.sql
# sobre el estado final real y una prueba de saludos simultáneos. Uso:
#   PGHOST=/ruta/socket PGPORT=5432 supabase/tests/social/run.sh [nombre_db]
# Salida OK/FALLA/AVISO y un RESUMEN; sale con 1 si algo falla (../lib.sh).
set -u
DIR=$(cd "$(dirname "$0")" && pwd); DB=${1:-iatos_social_test}
. "$DIR/../lib.sh"
PSQL="psql -U ${PGUSER:-postgres} -q"
ESPERADOS=70

main() {
t_build_db "$DB"
t_idempotency "$DB" "$T_MIG"/20261024140000_social_friend_profile.sql
$PSQL -X -d "$DB" -f "$DIR/social.sql" 2>&1 | grep -o 'OK .*\|FALLA.*\|ERROR.*' | sed 's/^ERROR/FALLA ERROR/'

# Dos toques simultáneos de "Saludar" (dos sesiones): solo uno pasa y sale un solo aviso.
A=5a000000-0000-0000-0000-00000000000a; F=5f000000-0000-0000-0000-00000000000f
CALL="SET ROLE authenticated; SELECT set_config('request.jwt.claim.role','authenticated',false), set_config('request.jwt.claim.sub','$A',false);
SELECT public.saludar_amigo('$F')->>'ok';"
for i in 1 2 3; do $PSQL -X -At -d "$DB" -c "$CALL" >/dev/null 2>&1 & done; wait
n=$($PSQL -X -At -d "$DB" -c "SELECT count(*) FROM public.notifications WHERE user_id='$F' AND type='social_poke'")
p=$($PSQL -X -At -d "$DB" -c "SELECT count(*) FROM public.social_pokes WHERE user_id='$A' AND friend_id='$F'")
if [ "$n" = "1" ] && [ "$p" = "1" ]; then echo "OK K1 tres toques simultáneos → un saludo y un aviso"; else echo "FALLA K1 simultáneos: avisos=$n saludos=$p"; fi
}

main 2>&1 | t_verdict social "$ESPERADOS"
exit "${PIPESTATUS[1]}"
