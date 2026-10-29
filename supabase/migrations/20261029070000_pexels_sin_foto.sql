-- Ronda 4 de cuenta y técnica, P2-4 (29-oct-2026): Favoritos mostraba Madrid sin foto porque
-- pexels-image guardaba también "sin foto" ({"image": null}) con el TTL de 7 días de una foto real.
-- El código ya guarda "sin foto" solo 1 h (responseTtlSeconds en _shared/serpCache.ts); esta migración
-- borra las entradas "sin foto" que ya estaban en la caché compartida para que la siguiente visita
-- vuelva a preguntar a Pexels.
--
-- Solo DELETE, y solo de filas de Pexels cuya respuesta tiene la llave "image" con valor null. No toca
-- fotos válidas, ni videos de Pexels (pexels_video guarda "url", no "image"), ni otros motores.
-- Idempotente: una segunda pasada no encuentra nada que borrar.
DO $$
BEGIN
  IF to_regclass('public.serp_cache') IS NULL THEN
    RAISE NOTICE 'pexels_sin_foto: public.serp_cache no existe, nada que limpiar';
    RETURN;
  END IF;
  DELETE FROM public.serp_cache
   WHERE engine LIKE 'pexels%'
     AND jsonb_typeof(response) = 'object'
     AND response ? 'image'
     AND jsonb_typeof(response -> 'image') = 'null';
END
$$;
