#!/bin/bash
# Pruebas SQL de 20261029030000_fix_herramientas.sql (auditoría 10/10 de herramientas, 28-oct-2026):
#   - P1-10: "Wanderly" → "IATOS" en medallas y misiones (en una COPIA con filas viejas, aplicando la
#     migración: así se prueba el UPDATE real; se vuelve a aplicar para probar que es idempotente).
#   - amigo_existe(uuid): solo dice si existe un perfil, a una sesión iniciada; anon no la puede llamar.
# Construye la base con TODAS las migraciones en orden en un Postgres local desechable. Uso:
#   PGHOST=/ruta/socket PGPORT=5432 supabase/tests/fix_herramientas/run.sh [nombre_db]
# Salida OK/FALLA/AVISO y un RESUMEN; sale con 1 si algo falla (../lib.sh).
set -u
DIR=$(cd "$(dirname "$0")" && pwd); DB=${1:-iatos_fix_herramientas_test}
. "$DIR/../lib.sh"
PSQL="psql -U ${PGUSER:-postgres} -q -X"
MIG="$T_MIG/20261029030000_fix_herramientas.sql"
# 1 idempotencia + 5 de medallas (copia) + 6 de amigo_existe.
ESPERADOS=12

main() {
t_build_db "$DB"
T_IDEM_OK=1 t_idempotency "$DB" "$MIG"

# Medallas: copia con las filas como estaban en producción, la migración y otra pasada.
local copy="${DB}_badges"
t_copy_db "$DB" "$copy" || { echo "FALLA no se pudo copiar la base para medallas"; return; }
$PSQL -d "$copy" -c "
  INSERT INTO public.badges (id, nombre, descripcion, icono, categoria) VALUES
    ('primer_viaje', 'Primer Vuelo', 'Creaste tu primer viaje en Wanderly', '✈️', 'viajes'),
    ('explorador_x', 'Explorador', 'Planeaste 5 viajes', '🧭', 'viajes')
  ON CONFLICT (id) DO UPDATE SET nombre = EXCLUDED.nombre, descripcion = EXCLUDED.descripcion;
  INSERT INTO public.missions (id, titulo, descripcion, meta_valor) VALUES
    ('mision_wanderly_x', 'Reto Wanderly', 'Comparte Wanderly con 3 amigos', 3)
  ON CONFLICT (id) DO UPDATE SET titulo = EXCLUDED.titulo, descripcion = EXCLUDED.descripcion;" >/dev/null 2>&1
t_apply "$copy" "$MIG" "(medallas) " && echo "OK B0 la migración se aplica sobre filas con Wanderly"
$PSQL -At -d "$copy" -c "SELECT 'B1 primer_viaje dice IATOS [Creaste tu primer viaje en IATOS]: ' || descripcion FROM public.badges WHERE id = 'primer_viaje'" | t_brackets
$PSQL -At -d "$copy" -c "SELECT 'B2 ninguna medalla ni misión dice Wanderly [0]: ' || ((SELECT count(*) FROM public.badges WHERE nombre ~* 'wanderly' OR descripcion ~* 'wanderly') + (SELECT count(*) FROM public.missions WHERE titulo ~* 'wanderly' OR descripcion ~* 'wanderly'))" | t_brackets
$PSQL -At -d "$copy" -c "SELECT 'B3 las demás medallas no cambian [Planeaste 5 viajes]: ' || descripcion FROM public.badges WHERE id = 'explorador_x'" | t_brackets
t_apply "$copy" "$MIG" "(medallas, segunda pasada) " >/dev/null
$PSQL -At -d "$copy" -c "SELECT 'B4 segunda pasada sin cambios [Reto IATOS|Comparte IATOS con 3 amigos]: ' || titulo || '|' || descripcion FROM public.missions WHERE id = 'mision_wanderly_x'" | t_brackets
$PSQL -d postgres -c "DROP DATABASE IF EXISTS $copy" >/dev/null 2>&1

$PSQL -d "$DB" -f "$DIR/herramientas.sql" 2>&1 | t_brackets
}

main 2>&1 | t_verdict fix_herramientas "$ESPERADOS"
exit "${PIPESTATUS[1]}"
