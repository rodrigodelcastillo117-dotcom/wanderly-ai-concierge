-- Datos de 20261029070000_pexels_sin_foto.sql. Imprime "<ID> <descripción> [esperado]: observado"
-- (run.sh lo convierte en OK/FALLA con t_brackets). Corre en una COPIA de la base con todas las
-- migraciones; recibe la ruta de la migración en :mig y la aplica sobre filas sembradas.
\set ON_ERROR_STOP off
\pset tuples_only on
RESET ROLE;
DELETE FROM public.serp_cache;
INSERT INTO public.serp_cache (key_hash, engine, response, fetched_at, ttl_seconds, hits) VALUES
  (repeat('a', 64), 'pexels_photo', '{"image": null, "photographer": null, "photographer_url": null, "page_url": null, "alt": null}', now() - interval '1 day', 604800, 26),
  (repeat('b', 64), 'pexels_photo', '{"image": null}', now() - interval '2 hours', 604800, 3),
  (repeat('c', 64), 'pexels_photo', '{"image": "https://images.pexels.com/photos/1/madrid.jpeg", "photographer": "Ana"}', now(), 604800, 9),
  (repeat('d', 64), 'pexels_video', '{"url": null, "poster": null}', now(), 604800, 1),
  (repeat('e', 64), 'google_maps', '{"image": null, "local_results": []}', now(), 604800, 0),
  (repeat('f', 64), 'pexels_photo', '{"photographer": "Sin llave image"}', now(), 604800, 0),
  (repeat('1', 64), 'pexels_photo', '{"image": ""}', now(), 604800, 0);

\i :mig

SELECT 'P1 "sin foto" de Pexels (image null, 26 usos) se borra [0]: ' || count(*) FROM public.serp_cache WHERE key_hash = repeat('a', 64);
SELECT 'P2 "sin foto" mínima ({"image": null}) se borra [0]: ' || count(*) FROM public.serp_cache WHERE key_hash = repeat('b', 64);
SELECT 'P3 una foto válida se queda [https://images.pexels.com/photos/1/madrid.jpeg]: ' || coalesce((SELECT response->>'image' FROM public.serp_cache WHERE key_hash = repeat('c', 64)), '<borrada>');
SELECT 'P4 el video de Pexels sin url se queda (no es "image") [1]: ' || count(*) FROM public.serp_cache WHERE key_hash = repeat('d', 64);
SELECT 'P5 otro motor con image null se queda [1]: ' || count(*) FROM public.serp_cache WHERE key_hash = repeat('e', 64);
SELECT 'P6 respuesta de Pexels sin la llave image se queda [1]: ' || count(*) FROM public.serp_cache WHERE key_hash = repeat('f', 64);
SELECT 'P7 image vacía ("") no es null: se queda [1]: ' || count(*) FROM public.serp_cache WHERE key_hash = repeat('1', 64);

\i :mig

SELECT 'P8 una segunda pasada no borra nada más [5]: ' || count(*) FROM public.serp_cache;
