-- DIAGNÓSTICO DE SOLO LECTURA (IATOS-P1-FREE-02). No modifica nada.
-- Busca cuentas SIN PRO cuyo análisis gratuito figura como usado (trips_analyzed_used >= 1) pero que
-- no tienen un viaje guardado cerca del momento en que se usó: probablemente el análisis falló
-- (IA, proveedor, guardado) después de descontarse, que era el comportamiento anterior.
-- Cómo usarlo: pegar en el SQL Editor de Supabase y revisar el resultado. Para corregir, ver
-- reparacion-cuotas-PROPUESTA.sql (NO se ejecuta sin revisión del dueño).
--
-- Limitaciones (por qué es un candidato y no una certeza):
-- - usage_limits no guarda CUÁNDO se usó el análisis; usamos su created_at/updated_at como ventana.
--   updated_at también cambia con los mensajes del concierge, así que la ventana puede ser amplia.
-- - Si la persona borró su viaje después, aparece como "sin viaje" aunque el análisis sí funcionó.
-- - Los planes multi-ciudad los guarda el navegador; si el guardado del navegador falló, también aparece.

WITH sin_pro AS (
  SELECT ul.user_id, ul.trips_analyzed_used, ul.created_at AS uso_desde, ul.updated_at AS uso_hasta
    FROM public.usage_limits ul
   WHERE ul.trips_analyzed_used >= 1
     AND NOT EXISTS (
       SELECT 1 FROM public.subscriptions s
        WHERE s.user_id = ul.user_id
          AND s.status IN ('active', 'trialing', 'comped')
          AND (s.status = 'comped' OR s.current_period_end IS NULL OR s.current_period_end > now()))
), datos AS (
  SELECT f.*,
         u.email,
         (SELECT count(*) FROM public.trips t WHERE t.user_id = f.user_id) AS viajes_total,
         (SELECT count(*) FROM public.trips t
           WHERE t.user_id = f.user_id
             AND t.created_at BETWEEN f.uso_desde - interval '10 minutes' AND f.uso_hasta + interval '15 minutes') AS viajes_en_ventana,
         (SELECT max(t.created_at) FROM public.trips t WHERE t.user_id = f.user_id) AS ultimo_viaje
    FROM sin_pro f
    JOIN auth.users u ON u.id = f.user_id
)
SELECT user_id, email, trips_analyzed_used, uso_desde, uso_hasta, viajes_total, viajes_en_ventana, ultimo_viaje,
       CASE WHEN viajes_total = 0 THEN 'FUERTE: análisis usado y ningún viaje guardado'
            ELSE 'DÉBIL: hay viajes, pero ninguno cerca del uso' END AS diagnostico
  FROM datos
 WHERE viajes_total = 0 OR viajes_en_ventana = 0
 ORDER BY (viajes_total = 0) DESC, uso_hasta DESC;

-- Después de aplicar la migración 20261022135000 (reservas): análisis liberados por fallo, por motivo.
-- (Descomentar cuando exista public.quota_reservations.)
-- SELECT release_reason, count(*) FROM public.quota_reservations
--  WHERE kind = 'trip_analysis' AND status = 'RELEASED' GROUP BY 1 ORDER BY 2 DESC;
