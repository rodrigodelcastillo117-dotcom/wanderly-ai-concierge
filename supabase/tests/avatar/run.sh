#!/bin/bash
# Pruebas SQL del grupo avatar-viajes (avatar que evoluciona, recuerdos por viaje, importación de
# viajes pasados) sobre un Postgres local desechable (nunca producción).
# Uso: PGHOST=/ruta/socket PGPORT=5432 ./run.sh [nombre_db]
# Base con TODAS las migraciones en orden (la de pg_cron falla en local y sale como AVISO). AV0 prueba
# la parte de datos de 20261024200*: siembra un avatar huérfano y vuelve a aplicar esas migraciones
# sobre la misma base (ninguna migración posterior redefine sus objetos: run_all.sh lo comprueba con el
# md5 de las funciones contra una base aplicada solo en orden). Salida OK/FALLA/AVISO y un RESUMEN; sale
# con 1 si algo falla (../lib.sh).
set -u
DIR=$(cd "$(dirname "$0")" && pwd); MIG="$DIR/../../migrations"; DB=${1:-iatos_avatar_test}
. "$DIR/../lib.sh"
PSQL="psql -U ${PGUSER:-postgres} -q -X"
ESPERADOS=41

main() {
  "$DIR/../security/run.sh" "$DB" 2>&1 | grep -E '^FALLA (migración|stubs|no se pudo)'

  echo "--- rescate del avatar huérfano + idempotencia (segunda pasada de 20261024200*) ---"
  local U=a7000000-0000-4000-8000-0000000000f1 f GOT
  $PSQL -d "$DB" -c "INSERT INTO auth.users (id, email) VALUES ('$U', 'av-huerfano@example.test')" \
    -c "INSERT INTO public.profiles (id) VALUES ('$U') ON CONFLICT (id) DO UPDATE SET avatar_url = NULL" \
    -c "INSERT INTO public.ai_user_preferences (user_id, perfil_ia) VALUES ('$U', '{\"avatar_url\":\"https://x.supabase.co/storage/v1/object/public/travel-moments/avatars/$U/v2.png\"}')" >/dev/null
  for f in "$MIG"/20261024200*.sql; do
    t_apply "$DB" "$f" "(segunda pasada) " && echo "OK idempotente $(basename "$f")"
  done
  GOT=$($PSQL -d "$DB" -At -c "SELECT avatar_url FROM public.profiles WHERE id = '$U'")
  case "$GOT" in https://*/avatars/$U/v2.png) echo "OK AV0 el avatar que vivía solo en perfil_ia pasa a profiles.avatar_url (una sola fuente)";; *) echo "FALLA AV0 [$GOT]";; esac

  echo "--- pruebas ---"
  $PSQL -d "$DB" -f "$DIR/avatar.sql" 2>&1 | grep -o 'OK .*\|FALLA.*\|ERROR.*' | sed 's/^ERROR/FALLA ERROR/'
}

main 2>&1 | t_verdict avatar "$ESPERADOS"
exit "${PIPESTATUS[1]}"
