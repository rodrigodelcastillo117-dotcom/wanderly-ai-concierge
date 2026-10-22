-- Personalización: "Mejores momentos" con viaje, lugar y etiquetas + caché del perfil de gustos.
-- Idempotente. Pruebas: supabase/tests/security/taste_profile.sql (run.sh).
--
-- 1) travel_moments: hasta hoy solo guardaba la foto y el nombre del ARCHIVO como "viaje"
--    (IMG_1234). Ahora: viaje (trip_id, solo uno al que la persona tiene acceso), destino, lugar,
--    etiquetas que eligió y etiquetas de visión (ai_tags) que escribe SOLO el servidor (tag-moment).
-- 2) user_taste_profiles: perfil de gustos calculado (_shared/tasteProfile.ts) por persona. Lo
--    escribe solo la llave de servicio; cada quien lee el suyo. Los triggers suben `rev` cuando
--    cambia una señal (viaje, momento, visita, favorito, perfil declarado, gasto): el perfil
--    guardado sirve mientras computed_rev = rev.

-- ═══ 1. travel_moments ═══
ALTER TABLE public.travel_moments ADD COLUMN IF NOT EXISTS trip_id uuid REFERENCES public.trips(id) ON DELETE SET NULL;
ALTER TABLE public.travel_moments ADD COLUMN IF NOT EXISTS destino text;
ALTER TABLE public.travel_moments ADD COLUMN IF NOT EXISTS place_name text;
ALTER TABLE public.travel_moments ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}'::text[];
ALTER TABLE public.travel_moments ADD COLUMN IF NOT EXISTS ai_tags jsonb;
ALTER TABLE public.travel_moments ADD COLUMN IF NOT EXISTS ai_tag_status text NOT NULL DEFAULT 'pending';
ALTER TABLE public.travel_moments ADD COLUMN IF NOT EXISTS ai_tagged_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'travel_moments_ai_tag_status_check') THEN
    ALTER TABLE public.travel_moments ADD CONSTRAINT travel_moments_ai_tag_status_check
      CHECK (ai_tag_status IN ('pending', 'done', 'skipped', 'failed'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_travel_moments_trip ON public.travel_moments(trip_id) WHERE trip_id IS NOT NULL;
-- Tope de costo del etiquetado: cuenta las fotos etiquetadas hoy (por persona y en total).
CREATE INDEX IF NOT EXISTS idx_travel_moments_tagged ON public.travel_moments(ai_tagged_at) WHERE ai_tagged_at IS NOT NULL;

-- Solo se puede ligar un momento a un viaje propio o compartido contigo (no al de un desconocido).
DROP POLICY IF EXISTS "Users insert own moments" ON public.travel_moments;
CREATE POLICY "Users insert own moments" ON public.travel_moments FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND (trip_id IS NULL OR public.has_trip_access(trip_id, auth.uid())));
DROP POLICY IF EXISTS "Users update own moments" ON public.travel_moments;
CREATE POLICY "Users update own moments" ON public.travel_moments FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id AND (trip_id IS NULL OR public.has_trip_access(trip_id, auth.uid())));

-- Desde el cliente: las etiquetas de visión no se pueden escribir y los textos se recortan.
CREATE OR REPLACE FUNCTION public.travel_moments_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.caption := left(nullif(btrim(NEW.caption), ''), 280);
  NEW.destino := left(nullif(btrim(NEW.destino), ''), 80);
  NEW.place_name := left(nullif(btrim(NEW.place_name), ''), 120);
  NEW.trip_name := left(NEW.trip_name, 120);
  NEW.tags := coalesce((
    SELECT array_agg(t) FROM (
      SELECT DISTINCT left(lower(btrim(x)), 40) AS t FROM unnest(coalesce(NEW.tags, '{}'::text[])) AS x
      WHERE btrim(x) <> '' LIMIT 10
    ) s), '{}'::text[]);
  IF current_user NOT IN ('anon', 'authenticated') THEN
    RETURN NEW; -- service role (tag-moment) escribe ai_tags
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.ai_tags := NULL;
    NEW.ai_tag_status := 'pending';
    NEW.ai_tagged_at := NULL;
  ELSIF NEW.image_url IS DISTINCT FROM OLD.image_url THEN
    NEW.ai_tags := NULL;
    NEW.ai_tag_status := 'pending';
    NEW.ai_tagged_at := NULL;
  ELSE
    NEW.ai_tags := OLD.ai_tags;
    NEW.ai_tag_status := OLD.ai_tag_status;
    NEW.ai_tagged_at := OLD.ai_tagged_at;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.travel_moments_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS travel_moments_guard ON public.travel_moments;
CREATE TRIGGER travel_moments_guard BEFORE INSERT OR UPDATE ON public.travel_moments
  FOR EACH ROW EXECUTE FUNCTION public.travel_moments_guard();

-- ═══ 2. Caché del perfil de gustos ═══
CREATE TABLE IF NOT EXISTS public.user_taste_profiles (
  user_id uuid PRIMARY KEY,
  profile jsonb,
  hash text,
  version integer,
  rev bigint NOT NULL DEFAULT 0,
  computed_rev bigint,
  computed_for date,
  computed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.user_taste_profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_taste_profiles FROM anon, authenticated;
GRANT SELECT ON public.user_taste_profiles TO authenticated;
GRANT ALL ON public.user_taste_profiles TO service_role;
DROP POLICY IF EXISTS user_taste_profiles_select_own ON public.user_taste_profiles;
CREATE POLICY user_taste_profiles_select_own ON public.user_taste_profiles FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- Marca el perfil como desactualizado. Solo ACTUALIZA (no crea filas): la primera fila la escribe
-- el servidor al calcular, y así borrar una cuenta no deja una fila nueva detrás.
CREATE OR REPLACE FUNCTION public.taste_profile_bump()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new uuid;
  v_old uuid;
BEGIN
  IF TG_OP <> 'DELETE' THEN v_new := nullif(to_jsonb(NEW) ->> 'user_id', '')::uuid; END IF;
  IF TG_OP <> 'INSERT' THEN v_old := nullif(to_jsonb(OLD) ->> 'user_id', '')::uuid; END IF;
  UPDATE public.user_taste_profiles SET rev = rev + 1, updated_at = now()
   WHERE user_id IN (v_new, v_old);
  RETURN NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.taste_profile_bump() FROM PUBLIC, anon, authenticated;

-- Viajes: crear/borrar, o cambiar lo que entra al perfil (no cada guardado del itinerario).
DROP TRIGGER IF EXISTS taste_bump_trips_ins_del ON public.trips;
CREATE TRIGGER taste_bump_trips_ins_del AFTER INSERT OR DELETE ON public.trips
  FOR EACH ROW EXECUTE FUNCTION public.taste_profile_bump();
DROP TRIGGER IF EXISTS taste_bump_trips_upd ON public.trips;
CREATE TRIGGER taste_bump_trips_upd AFTER UPDATE ON public.trips
  FOR EACH ROW WHEN (
    (OLD.user_id, OLD.destino, OLD.pais_destino, OLD.fecha_salida, OLD.fecha_regreso, OLD.num_viajeros, OLD.status, OLD.hospedaje_json, OLD.selections)
    IS DISTINCT FROM
    (NEW.user_id, NEW.destino, NEW.pais_destino, NEW.fecha_salida, NEW.fecha_regreso, NEW.num_viajeros, NEW.status, NEW.hospedaje_json, NEW.selections)
  ) EXECUTE FUNCTION public.taste_profile_bump();

DROP TRIGGER IF EXISTS taste_bump_moments ON public.travel_moments;
CREATE TRIGGER taste_bump_moments AFTER INSERT OR UPDATE OR DELETE ON public.travel_moments
  FOR EACH ROW EXECUTE FUNCTION public.taste_profile_bump();
DROP TRIGGER IF EXISTS taste_bump_visited_places ON public.visited_places;
CREATE TRIGGER taste_bump_visited_places AFTER INSERT OR UPDATE OR DELETE ON public.visited_places
  FOR EACH ROW EXECUTE FUNCTION public.taste_profile_bump();
DROP TRIGGER IF EXISTS taste_bump_user_visits ON public.user_visits;
CREATE TRIGGER taste_bump_user_visits AFTER INSERT OR UPDATE OR DELETE ON public.user_visits
  FOR EACH ROW EXECUTE FUNCTION public.taste_profile_bump();
DROP TRIGGER IF EXISTS taste_bump_travel_profiles ON public.travel_profiles;
CREATE TRIGGER taste_bump_travel_profiles AFTER INSERT OR UPDATE ON public.travel_profiles
  FOR EACH ROW EXECUTE FUNCTION public.taste_profile_bump();

-- Favoritos (recomendaciones guardadas). Las recomendaciones nuevas sin guardar no cuentan.
DROP TRIGGER IF EXISTS taste_bump_recos_ins ON public.recomendaciones;
CREATE TRIGGER taste_bump_recos_ins AFTER INSERT ON public.recomendaciones
  FOR EACH ROW WHEN (NEW.guardado IS TRUE) EXECUTE FUNCTION public.taste_profile_bump();
DROP TRIGGER IF EXISTS taste_bump_recos_upd ON public.recomendaciones;
CREATE TRIGGER taste_bump_recos_upd AFTER UPDATE ON public.recomendaciones
  FOR EACH ROW WHEN (OLD.guardado IS DISTINCT FROM NEW.guardado) EXECUTE FUNCTION public.taste_profile_bump();
DROP TRIGGER IF EXISTS taste_bump_recos_del ON public.recomendaciones;
CREATE TRIGGER taste_bump_recos_del AFTER DELETE ON public.recomendaciones
  FOR EACH ROW WHEN (OLD.guardado IS TRUE) EXECUTE FUNCTION public.taste_profile_bump();

-- Preferencias: cada mensaje a Iato actualiza dna_signal; eso NO invalida el perfil.
DROP TRIGGER IF EXISTS taste_bump_ai_prefs_ins ON public.ai_user_preferences;
CREATE TRIGGER taste_bump_ai_prefs_ins AFTER INSERT ON public.ai_user_preferences
  FOR EACH ROW EXECUTE FUNCTION public.taste_profile_bump();
DROP TRIGGER IF EXISTS taste_bump_ai_prefs_upd ON public.ai_user_preferences;
CREATE TRIGGER taste_bump_ai_prefs_upd AFTER UPDATE ON public.ai_user_preferences
  FOR EACH ROW WHEN (
    (OLD.perfil_ia, OLD.deal_breakers, OLD.ritmo_viaje, OLD.nivel_presupuesto, OLD.estilo_comida, OLD.restricciones_alimentarias, OLD.companeros_viaje, OLD.actividades_tarde)
    IS DISTINCT FROM
    (NEW.perfil_ia, NEW.deal_breakers, NEW.ritmo_viaje, NEW.nivel_presupuesto, NEW.estilo_comida, NEW.restricciones_alimentarias, NEW.companeros_viaje, NEW.actividades_tarde)
  ) EXECUTE FUNCTION public.taste_profile_bump();

-- Gastos reales de los viajes (precio que de verdad pagaste).
DROP TRIGGER IF EXISTS taste_bump_expenses_ins_del ON public.expenses;
CREATE TRIGGER taste_bump_expenses_ins_del AFTER INSERT OR DELETE ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.taste_profile_bump();
DROP TRIGGER IF EXISTS taste_bump_expenses_upd ON public.expenses;
CREATE TRIGGER taste_bump_expenses_upd AFTER UPDATE ON public.expenses
  FOR EACH ROW WHEN ((OLD.amount, OLD.currency, OLD.trip_id) IS DISTINCT FROM (NEW.amount, NEW.currency, NEW.trip_id))
  EXECUTE FUNCTION public.taste_profile_bump();
