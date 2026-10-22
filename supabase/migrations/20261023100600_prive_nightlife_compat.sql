-- IATOS Privé (grupo catalog) · 9/9 · Vista de compatibilidad con nightlife_premium (SIN renombrar nada).
-- Diseño: docs/iatos/IATOS_PRIVE_MODELO_DE_DATOS.md §5.3 (fase 6). El diseño renombra la tabla vieja a
-- nightlife_premium_legacy y pone una vista con su nombre; eso cambia Members Only y members_teaser, así que
-- queda para cuando el dueño lo apruebe. Aquí solo se crea la vista con OTRO nombre, para que el equipo
-- pueda comparar las dos fuentes y para que el cambio de fase 6 sea un simple renombre.
-- La vista lee como el dueño de la función que la use (no se expone a clientes). Idempotente.
CREATE OR REPLACE VIEW public.prive_nightlife_compat AS
SELECT coalesce(e.legacy_nightlife_id, e.id) AS id,
       coalesce(d.legacy_ciudad_key, d.slug) AS ciudad, d.name_es AS ciudad_display, c.name_es AS pais,
       e.subcategory AS categoria, NULL::text AS emoji, e.name AS nombre,
       e.why_fact_es AS por_que, e.description_es AS descripcion, e.dress_code_es AS dress_code,
       nullif(repeat('$', coalesce(e.price_level, 0)), '') AS precio_estimado,
       (e.booking_method <> 'walk_in') AS reserva_requerida,
       e.tags, e.address, e.website, e.lat, e.lng,
       (e.effective_state IN ('VERIFICADO','CURADO','ESTIMADO')) AS active, e.created_at,
       e.effective_state, e.effective_label
  FROM public.prive_experiences_v e
  JOIN public.prive_destinations d ON d.id = e.destination_id
  LEFT JOIN public.prive_destinations c ON c.kind = 'country' AND c.iso_country = d.iso_country
 WHERE e.universe IN ('after_dark','casino_grand_nights');
REVOKE ALL ON public.prive_nightlife_compat FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.prive_nightlife_compat TO service_role;
