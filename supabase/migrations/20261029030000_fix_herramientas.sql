-- Auditoría 10/10 (herramientas y técnica, 28-oct-2026). Idempotente: se puede aplicar dos veces.
--
-- 1) P1-10 · Social > Logros: la medalla «Primer Vuelo» decía "Creaste tu primer viaje en Wanderly"
--    (marca vieja). Se cambia "Wanderly" por "IATOS" en los textos del catálogo de medallas y misiones.
--    Solo filas que aún dicen "Wanderly"; la segunda pasada no encuentra ninguna.
UPDATE public.badges
   SET nombre = regexp_replace(nombre, 'Wanderly', 'IATOS', 'gi'),
       descripcion = regexp_replace(descripcion, 'Wanderly', 'IATOS', 'gi')
 WHERE nombre ~* 'wanderly' OR descripcion ~* 'wanderly';

UPDATE public.missions
   SET titulo = regexp_replace(titulo, 'Wanderly', 'IATOS', 'gi'),
       descripcion = regexp_replace(descripcion, 'Wanderly', 'IATOS', 'gi')
 WHERE titulo ~* 'wanderly' OR descripcion ~* 'wanderly';

-- 2) Técnica P2 · perfil de amigo con un id que no existe decía "Este perfil es privado". amigo_perfil
--    responde "privado" igual para un no-amigo que para una cuenta inexistente (no se toca). Esta función
--    solo dice si existe el perfil, sin devolver ningún dato de él, y solo a una sesión iniciada.
CREATE OR REPLACE FUNCTION public.amigo_existe(p_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (SELECT 1 FROM public.profiles WHERE id = p_id);
$$;
REVOKE ALL ON FUNCTION public.amigo_existe(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.amigo_existe(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.amigo_existe(uuid) TO authenticated;
