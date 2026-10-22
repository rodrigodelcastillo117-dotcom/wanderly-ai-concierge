#!/bin/bash
# Pruebas SQL del grupo avatar-viajes (avatar que evoluciona, recuerdos por viaje, importación de
# viajes pasados) sobre un Postgres local desechable (nunca producción).
# Uso: PGHOST=/ruta/socket PGPORT=5432 ./run.sh [nombre_db]
# Esperado: solo líneas "OK ..."; cualquier "FALLA"/"ERROR" es un error.
set -u
DIR=$(cd "$(dirname "$0")" && pwd); MIG="$DIR/../../migrations"; DB=${1:-iatos_avatar_test}
PSQL="psql -U ${PGUSER:-postgres} -q -X"
# Reproduce todas las migraciones (la de pg_cron falla en local; es esperado).
"$DIR/../security/run.sh" "$DB" 2>&1 | grep '^FALLÓ' | grep -v pg_cron || true

echo "--- rescate del avatar huérfano + idempotencia (segunda pasada de 20261024200*) ---"
U=a7000000-0000-4000-8000-0000000000f1
$PSQL -d "$DB" -c "INSERT INTO auth.users (id, email) VALUES ('$U', 'av-huerfano@example.test')" \
  -c "INSERT INTO public.profiles (id) VALUES ('$U') ON CONFLICT (id) DO UPDATE SET avatar_url = NULL" \
  -c "INSERT INTO public.ai_user_preferences (user_id, perfil_ia) VALUES ('$U', '{\"avatar_url\":\"https://x.supabase.co/storage/v1/object/public/travel-moments/avatars/$U/v2.png\"}')" >/dev/null
for f in "$MIG"/20261024200*.sql; do
  out=$($PSQL -v ON_ERROR_STOP=1 -d "$DB" -f "$f" 2>&1 >/dev/null | grep ERROR | head -1)
  if [ -n "$out" ]; then echo "FALLA $(basename "$f"): $out"; else echo "OK idempotente $(basename "$f")"; fi
done
GOT=$($PSQL -d "$DB" -At -c "SELECT avatar_url FROM public.profiles WHERE id = '$U'")
case "$GOT" in https://*/avatars/$U/v2.png) echo "OK AV0 el avatar que vivía solo en perfil_ia pasa a profiles.avatar_url (una sola fuente)";; *) echo "FALLA AV0 [$GOT]";; esac

echo "--- pruebas ---"
$PSQL -d "$DB" -f "$DIR/avatar.sql" 2>&1 | grep -o 'OK .*\|FALLA.*\|ERROR.*'
