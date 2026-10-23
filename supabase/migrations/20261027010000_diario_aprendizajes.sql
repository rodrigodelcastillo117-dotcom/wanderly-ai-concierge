-- Diario de viaje: "IATOS aprende de tu viaje". Idempotente.
-- Pruebas: supabase/tests/diario/diario.sql (run.sh).
--
-- 1) trip_journal_entries.ai_learn_status / ai_learned_at: estado del aprendizaje de cada entrada.
--    Solo el servidor (aprender-diario, llave de servicio) lo escribe. Desde el cliente, una entrada
--    nueva nace 'pending' y si su texto cambia vuelve a 'pending'. Las entradas anteriores a esta
--    migración quedan en NULL (no se procesan solas).
-- 2) journal_learnings: gustos y disgustos concretos que la IA encontró en una entrada, ligados a
--    QUIEN la escribió (user_id = author_id de la entrada; en un viaje compartido lo que escribe un
--    colaborador alimenta SU perfil, no el del dueño). Cada punto guarda la frase literal de la
--    entrada que lo respalda (cita). Solo la persona ve, corrige (texto) o borra los suyos; las filas
--    las crea solo el servidor. Se borran con la entrada (y con el viaje, en cascada).
-- 3) Cada cambio en journal_learnings sube user_taste_profiles.rev: el perfil de gustos
--    (_shared/tasteProfile.ts) que leen concierge-chat, analizar-viaje, logistics-plan y
--    evolucionar-dna se recalcula con lo aprendido (y sin lo que la persona borró).
-- El audio de las notas de voz NO se guarda: solo el texto que la persona revisa y agrega.

-- ═══ 1. Estado del aprendizaje en cada entrada ═══
ALTER TABLE public.trip_journal_entries ADD COLUMN IF NOT EXISTS ai_learn_status text;
ALTER TABLE public.trip_journal_entries ADD COLUMN IF NOT EXISTS ai_learned_at timestamptz;
ALTER TABLE public.trip_journal_entries ALTER COLUMN ai_learn_status SET DEFAULT 'pending';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'trip_journal_ai_learn_status_check') THEN
    ALTER TABLE public.trip_journal_entries ADD CONSTRAINT trip_journal_ai_learn_status_check
      CHECK (ai_learn_status IS NULL OR ai_learn_status IN ('pending', 'running', 'done', 'empty', 'skipped', 'failed'));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.trip_journal_learn_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user NOT IN ('anon', 'authenticated') THEN
    RETURN NEW; -- llave de servicio (aprender-diario)
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.ai_learn_status := 'pending';
    NEW.ai_learned_at := NULL;
  ELSIF NEW.text IS DISTINCT FROM OLD.text THEN
    NEW.ai_learn_status := 'pending';
    NEW.ai_learned_at := NULL;
  ELSE
    NEW.ai_learn_status := OLD.ai_learn_status;
    NEW.ai_learned_at := OLD.ai_learned_at;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.trip_journal_learn_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trip_journal_learn_guard ON public.trip_journal_entries;
CREATE TRIGGER trip_journal_learn_guard BEFORE INSERT OR UPDATE ON public.trip_journal_entries
  FOR EACH ROW EXECUTE FUNCTION public.trip_journal_learn_guard();

-- ═══ 2. Lo aprendido ═══
CREATE TABLE IF NOT EXISTS public.journal_learnings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  entry_id uuid NOT NULL REFERENCES public.trip_journal_entries(id) ON DELETE CASCADE,
  trip_id uuid NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  categoria text NOT NULL,
  sentimiento text NOT NULL,
  texto text NOT NULL,
  lugar text,
  ciudad text,
  cita text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  edited_at timestamptz,
  CONSTRAINT journal_learnings_categoria_check CHECK (categoria IN (
    'comida', 'bebida', 'lugar', 'actividad', 'alojamiento', 'transporte', 'ritmo', 'ambiente', 'compras',
    'vida_nocturna', 'naturaleza', 'cultura', 'presupuesto', 'servicio', 'otro')),
  CONSTRAINT journal_learnings_sentimiento_check CHECK (sentimiento IN ('positivo', 'negativo')),
  CONSTRAINT journal_learnings_texto_len CHECK (char_length(btrim(texto)) BETWEEN 2 AND 140),
  CONSTRAINT journal_learnings_lugar_len CHECK (lugar IS NULL OR char_length(lugar) <= 120),
  CONSTRAINT journal_learnings_ciudad_len CHECK (ciudad IS NULL OR char_length(ciudad) <= 80),
  CONSTRAINT journal_learnings_cita_len CHECK (char_length(cita) BETWEEN 3 AND 240)
);
CREATE INDEX IF NOT EXISTS idx_journal_learnings_user ON public.journal_learnings (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_journal_learnings_entry ON public.journal_learnings (entry_id);
CREATE INDEX IF NOT EXISTS idx_journal_learnings_trip ON public.journal_learnings (trip_id, user_id);

ALTER TABLE public.journal_learnings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.journal_learnings FROM PUBLIC, anon, authenticated;
GRANT SELECT, DELETE ON public.journal_learnings TO authenticated;
-- Corregir un punto: solo su texto (categoría, sentimiento, cita y dueño no se cambian desde el cliente).
GRANT UPDATE (texto) ON public.journal_learnings TO authenticated;
GRANT ALL ON public.journal_learnings TO service_role;

DROP POLICY IF EXISTS journal_learnings_select_own ON public.journal_learnings;
CREATE POLICY journal_learnings_select_own ON public.journal_learnings FOR SELECT TO authenticated
  USING (user_id = auth.uid());
DROP POLICY IF EXISTS journal_learnings_update_own ON public.journal_learnings;
CREATE POLICY journal_learnings_update_own ON public.journal_learnings FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS journal_learnings_delete_own ON public.journal_learnings;
CREATE POLICY journal_learnings_delete_own ON public.journal_learnings FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- Corrección desde el cliente: texto limpio y marca de editado.
CREATE OR REPLACE FUNCTION public.journal_learnings_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.texto := left(regexp_replace(btrim(coalesce(NEW.texto, '')), '\s+', ' ', 'g'), 140);
  IF current_user IN ('anon', 'authenticated') AND TG_OP = 'UPDATE' THEN
    NEW.edited_at := now();
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.journal_learnings_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS journal_learnings_guard ON public.journal_learnings;
CREATE TRIGGER journal_learnings_guard BEFORE INSERT OR UPDATE ON public.journal_learnings
  FOR EACH ROW EXECUTE FUNCTION public.journal_learnings_guard();

-- ═══ 3. El perfil de gustos se entera ═══
DO $$
BEGIN
  IF to_regprocedure('public.taste_profile_bump()') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS taste_bump_journal_learnings ON public.journal_learnings';
    EXECUTE 'CREATE TRIGGER taste_bump_journal_learnings AFTER INSERT OR UPDATE OR DELETE ON public.journal_learnings
             FOR EACH ROW EXECUTE FUNCTION public.taste_profile_bump()';
  END IF;
END $$;
