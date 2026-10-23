-- IATOS Privé · "Ideas" de la Ruleta de inspiración (Explorar, 27-oct-2026).
-- En la ruleta, "Me late" guarda el DESTINO en la lista personal "Ideas" (Para ti la muestra). Reglas del contrato Privé:
--  * Toda RPC empieza con prive_require(_ps): sin sesión Privé válida no se guarda ni se lee nada.
--  * Solo se guardan REFERENCIAS: el destino (debe existir, estar activo y ser destino de la lista del dueño), el
--    universo/mood, el mes y el presupuesto elegidos. Nombre y foto se vuelven a leer del catálogo al mostrarlo.
--  * Sin privilegios directos sobre la tabla (ni el dueño la lee directo): solo prive_ideas / prive_idea_save.
--  * Tope de 60 ideas por persona (código LIMIT); repetir el mismo destino no duplica (actualiza mood/mes).
--  * Al borrar la cuenta (auth.users) se borran sus ideas (ON DELETE CASCADE).
-- Idempotente. REQUIERE AUTORIZACIÓN para aplicarse en producción.

CREATE TABLE IF NOT EXISTS public.prive_ideas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  destination_id uuid NOT NULL REFERENCES public.prive_destinations(id) ON DELETE CASCADE,
  universe text CHECK (universe IS NULL OR universe IN ('the_table','after_dark','casino_grand_nights','yacht_sea','private_stays','iconic_events',
                                                        'culture_access','wellness_escape','adventure_elite','sport_leisure','celebrations','signature_mexico')),
  month smallint CHECK (month IS NULL OR month BETWEEN 1 AND 12),
  budget text CHECK (budget IS NULL OR budget IN ('any','moderate','high','top')),
  source text NOT NULL DEFAULT 'ruleta' CHECK (source IN ('ruleta','mapa')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, destination_id)
);
CREATE INDEX IF NOT EXISTS prive_ideas_user_time ON public.prive_ideas (user_id, updated_at DESC);
ALTER TABLE public.prive_ideas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.prive_ideas FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.prive_ideas TO service_role;
-- Sin políticas para anon/authenticated a propósito: se lee y escribe solo con las RPC de abajo.

-- Mis ideas: lo más reciente primero, con nombre y región del catálogo (nada que el cliente haya escrito).
CREATE OR REPLACE FUNCTION public.prive_ideas(_ps text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid;
BEGIN
  v_uid := public.prive_require(_ps);
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object('slug', d.slug, 'name', d.name_es, 'name_en', d.name_en, 'region_group', d.region_group,
             'universe', i.universe, 'month', i.month, 'budget', i.budget, 'source', i.source, 'saved_at', i.updated_at)
           ORDER BY i.updated_at DESC, d.slug)
      FROM public.prive_ideas i JOIN public.prive_destinations d ON d.id = i.destination_id AND d.active
     WHERE i.user_id = v_uid), '[]'::jsonb);
END $$;

-- Guardar (o quitar) un destino en Ideas. _month es 0–11 como en la interfaz (se guarda 1–12).
CREATE OR REPLACE FUNCTION public.prive_idea_save(_ps text, _destination text, _saved boolean DEFAULT true,
  _universe text DEFAULT NULL, _month int DEFAULT NULL, _budget text DEFAULT NULL, _source text DEFAULT 'ruleta')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid; v_dest uuid; v_n int;
BEGIN
  v_uid := public.prive_require(_ps);
  SELECT d.id INTO v_dest FROM public.prive_destinations d
   WHERE d.id = public.prive_resolve_destination(_destination) AND d.active AND d.is_destination;
  IF v_dest IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
  IF NOT coalesce(_saved, true) THEN
    DELETE FROM public.prive_ideas WHERE user_id = v_uid AND destination_id = v_dest;
    RETURN jsonb_build_object('ok', true, 'saved', false);
  END IF;
  IF _universe IS NOT NULL AND _universe NOT IN ('the_table','after_dark','casino_grand_nights','yacht_sea','private_stays','iconic_events',
       'culture_access','wellness_escape','adventure_elite','sport_leisure','celebrations','signature_mexico')
     OR (_month IS NOT NULL AND _month NOT BETWEEN 0 AND 11)
     OR (_budget IS NOT NULL AND _budget NOT IN ('any','moderate','high','top'))
     OR coalesce(_source, 'ruleta') NOT IN ('ruleta','mapa') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID');
  END IF;
  SELECT count(*) INTO v_n FROM public.prive_ideas WHERE user_id = v_uid AND destination_id <> v_dest;
  IF v_n >= 60 THEN RETURN jsonb_build_object('ok', false, 'code', 'LIMIT'); END IF;
  INSERT INTO public.prive_ideas (user_id, destination_id, universe, month, budget, source)
  VALUES (v_uid, v_dest, _universe, CASE WHEN _month IS NULL THEN NULL ELSE _month + 1 END, _budget, coalesce(_source, 'ruleta'))
  ON CONFLICT (user_id, destination_id) DO UPDATE
    SET universe = EXCLUDED.universe, month = EXCLUDED.month, budget = EXCLUDED.budget, source = EXCLUDED.source, updated_at = now();
  RETURN jsonb_build_object('ok', true, 'saved', true);
END $$;

REVOKE ALL ON FUNCTION public.prive_ideas(text), public.prive_idea_save(text, text, boolean, text, int, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prive_ideas(text), public.prive_idea_save(text, text, boolean, text, int, text, text) TO authenticated, service_role;
