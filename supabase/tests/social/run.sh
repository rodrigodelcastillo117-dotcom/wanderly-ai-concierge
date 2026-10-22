#!/bin/bash
# Pruebas SQL de Social (amigo_perfil, amigos_resumen, saludar_amigo, viajes juntos). Reproduce TODAS
# las migraciones del repo en un Postgres local desechable, vuelve a aplicar la migración nueva
# (idempotencia), corre social.sql y una prueba de dos saludos simultáneos. Uso:
#   PGHOST=/ruta/socket PGPORT=5432 supabase/tests/social/run.sh [nombre_db]
# Esperado: solo líneas "OK …". Cualquier "FALLA" o "ERROR" es un error. La migración de pg_cron falla
# en local (la extensión no existe fuera de Supabase); es esperado.
set -u
DIR=$(cd "$(dirname "$0")" && pwd); SEC="$DIR/../security"; MIG="$DIR/../../migrations"; DB=${1:-iatos_social_test}
PSQL="psql -U ${PGUSER:-postgres} -q"
$PSQL -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB" >/dev/null 2>&1
$PSQL -d "$DB" -f "$SEC/00_roles.sql" -f "$SEC/01_supabase_stubs.sql" >/dev/null 2>&1
for f in "$MIG"/*.sql; do
  out=$($PSQL -v ON_ERROR_STOP=1 -d "$DB" -f "$f" 2>&1 >/dev/null | grep ERROR | head -1)
  [ -n "$out" ] && echo "FALLÓ $(basename "$f"): $out"
done
for f in "$MIG"/20261024140000_social_friend_profile.sql; do
  out=$($PSQL -v ON_ERROR_STOP=1 -d "$DB" -f "$f" 2>&1 >/dev/null | grep ERROR | head -1)
  [ -n "$out" ] && echo "FALLA migración $(basename "$f") no es idempotente: $out"
done
$PSQL -X -d "$DB" -f "$DIR/social.sql" 2>&1 | grep -o 'OK .*\|FALLA.*\|ERROR.*'

# Dos toques simultáneos de "Saludar" (dos sesiones): solo uno pasa y sale un solo aviso.
A=5a000000-0000-0000-0000-00000000000a; F=5f000000-0000-0000-0000-00000000000f
CALL="SET ROLE authenticated; SELECT set_config('request.jwt.claim.role','authenticated',false), set_config('request.jwt.claim.sub','$A',false);
SELECT public.saludar_amigo('$F')->>'ok';"
for i in 1 2 3; do $PSQL -X -At -d "$DB" -c "$CALL" >/dev/null 2>&1 & done; wait
n=$($PSQL -X -At -d "$DB" -c "SELECT count(*) FROM public.notifications WHERE user_id='$F' AND type='social_poke'")
p=$($PSQL -X -At -d "$DB" -c "SELECT count(*) FROM public.social_pokes WHERE user_id='$A' AND friend_id='$F'")
if [ "$n" = "1" ] && [ "$p" = "1" ]; then echo "OK K1 tres toques simultáneos → un saludo y un aviso"; else echo "FALLA K1 simultáneos: avisos=$n saludos=$p"; fi
