-- IATOS Privé · THE PRIVATE EDITION (equipo edition, segunda tanda) · estado honesto de la revista y
-- correcciones de la siembra del Nº 01. Idempotente. REQUIERE AUTORIZACIÓN para aplicarse en producción.
--
-- 1) prive_edition_status(_ps): lo mínimo para que FOR YOU e INSIDER presenten la revista con honestidad
--    ANTES de que haya un número publicado ("primer número en revisión editorial"), sin exponer títulos,
--    textos ni fotos de piezas no aprobadas. Exige sesión Privé (prive_require), como toda la lectura.
-- 2) Correcciones de contenido detectadas en la revisión del 22-oct-2026 (la siembra 20261025100200 ya
--    está aplicada en producción y no se edita): solo tocan filas que el editor NO ha revisado todavía.

CREATE OR REPLACE FUNCTION public.prive_edition_status(_ps text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid; v_latest public.edition_issues;
BEGIN
  v_uid := public.prive_require(_ps);
  SELECT * INTO v_latest FROM public.edition_issues s WHERE public.edition_is_live(s.status, s.scheduled_for)
   ORDER BY s.period_start DESC, s.number DESC LIMIT 1;
  RETURN jsonb_build_object(
    -- Número publicado más reciente (o null): solo metadatos públicos del número.
    'latest', CASE WHEN v_latest.id IS NULL THEN NULL ELSE jsonb_build_object('slug', v_latest.slug, 'number', v_latest.number,
       'period_label', v_latest.period_label, 'published_at', v_latest.published_at) END,
    'published_count', (SELECT count(*) FROM public.edition_issues s WHERE public.edition_is_live(s.status, s.scheduled_for)),
    -- ¿Hay un número en revisión, aprobado o programado (aún no visible)? Solo un sí/no y la fecha programada.
    'in_review', EXISTS (SELECT 1 FROM public.edition_issues s WHERE s.status IN ('draft','pending_review','approved')
                          OR (s.status = 'scheduled' AND s.scheduled_for > now())),
    'next_scheduled_for', (SELECT min(s.scheduled_for) FROM public.edition_issues s WHERE s.status = 'scheduled' AND s.scheduled_for > now()),
    'prefs_saved', EXISTS (SELECT 1 FROM public.edition_member_prefs p WHERE p.user_id = v_uid),
    'generated_at', now());
END $$;
REVOKE ALL ON FUNCTION public.prive_edition_status(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prive_edition_status(text) TO authenticated, service_role;

-- Corrección 1: la firma de la carta no puede decir "borrador" una vez publicada; el crédito del editor
-- sale de approved_by_label al aprobar.
UPDATE public.edition_articles
   SET byline = jsonb_build_object('es', 'Dirección editorial de IATOS Privé', 'en', 'IATOS Privé editorial direction'),
       version = version + 1
 WHERE slug = 'carta-del-editor-n01' AND status IN ('draft','pending_review')
   AND byline->>'es' LIKE '%borrador pendiente de firma%';

-- Corrección 2: la motivación del Nobel ya se confirmó en la página oficial (antes respondía 403).
UPDATE public.edition_sources
   SET verification = 'Página oficial leída el 22-oct-2026: «for microeconomic foundations of macroeconomic stabilisation», Robert E. Hall y Michael Woodford. Corroborado con AAP (The Senior) y APA/Reuters.'
 WHERE key = 'nobel_econ_2026' AND verification LIKE 'La página oficial respondió 403%';

-- Corrección 3: el párrafo del Nobel del explicador de Banxico citaba solo agencias; ahora que la página oficial
-- está verificada, se vincula como fuente primaria (el texto no cambia).
INSERT INTO public.edition_article_sources (article_id, source_id, used_for)
SELECT a.id, s.id, 'Motivación oficial del Nobel (fuente primaria, leída el 22-oct-2026)'
  FROM public.edition_articles a, public.edition_sources s
 WHERE a.slug = 'banxico-pausa-6-50' AND a.status IN ('draft','pending_review') AND s.key = 'nobel_econ_2026'
ON CONFLICT DO NOTHING;

INSERT INTO public.edition_reviews (entity, entity_key, action, note)
SELECT 'article', 'carta-del-editor-n01', 'edit', 'Corrección de siembra (20261025110000): firma sin la palabra «borrador»; Banxico: fuente primaria del Nobel vinculada.'
 WHERE NOT EXISTS (SELECT 1 FROM public.edition_reviews WHERE entity_key = 'carta-del-editor-n01' AND note LIKE 'Corrección de siembra (20261025110000)%');
