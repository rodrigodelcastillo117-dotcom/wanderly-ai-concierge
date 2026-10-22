-- SEG-N4 / P3-6 (segunda auditoría, JR4): trip_journal_entries.photo_url aceptaba cualquier URL; los
-- demás miembros del viaje la cargaban con <img> (píxel de rastreo). Idempotente.
--
-- Desde T-P2-2 la app guarda photo_path (bucket privado) y ya no escribe photo_url. Aquí:
--   * las photo_url que ya tienen photo_path (relleno de 20261026120000) o que no son nuestras se
--     borran (la entrada se conserva);
--   * CHECK: photo_url solo puede ser una foto de journal-photos de NUESTRO proyecto, de la carpeta de
--     su autor y de su viaje (lo que escribía la app vieja). El proyecto va fijo (supabase/config.toml,
--     project_id): en otro proyecto, una app vieja no podría guardar photo_url, y la nueva no la usa.
UPDATE public.trip_journal_entries e
   SET photo_url = NULL
 WHERE e.photo_url IS NOT NULL
   AND (e.photo_path IS NOT NULL
        OR e.photo_url !~ ('^https://uhkdewinscffhdonhhmt\.supabase\.co/storage/v1/object/public/journal-photos/'
                           || e.author_id::text || '/' || e.trip_id::text || '/[A-Za-z0-9._-]+$'));

ALTER TABLE public.trip_journal_entries DROP CONSTRAINT IF EXISTS trip_journal_photo_url_storage;
ALTER TABLE public.trip_journal_entries ADD CONSTRAINT trip_journal_photo_url_storage CHECK (
  photo_url IS NULL
  OR photo_url ~ ('^https://uhkdewinscffhdonhhmt\.supabase\.co/storage/v1/object/public/journal-photos/'
                  || author_id::text || '/' || trip_id::text || '/[A-Za-z0-9._-]+$'));
