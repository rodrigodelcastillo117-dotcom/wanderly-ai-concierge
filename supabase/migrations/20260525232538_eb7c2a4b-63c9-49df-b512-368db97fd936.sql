-- AI USER PREFERENCES (onboarding 10 preguntas)
CREATE TABLE IF NOT EXISTS public.ai_user_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  ritmo_viaje text,
  hospedaje_preferencias text[] DEFAULT '{}',
  nivel_presupuesto text,
  estilo_comida text[] DEFAULT '{}',
  restricciones_alimentarias text[] DEFAULT '{}',
  actividades_tarde text[] DEFAULT '{}',
  deal_breakers text[] DEFAULT '{}',
  companeros_viaje text,
  mejor_viaje_descripcion text,
  nivel_planificacion text,
  proposito_viaje text,
  perfil_ia jsonb,
  completado boolean DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ai_user_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own ai_preferences" ON public.ai_user_preferences
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own ai_preferences" ON public.ai_user_preferences
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own ai_preferences" ON public.ai_user_preferences
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own ai_preferences" ON public.ai_user_preferences
  FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER ai_user_preferences_set_updated_at
  BEFORE UPDATE ON public.ai_user_preferences
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- USER VAULT BENEFITS (bóveda de beneficios)
CREATE TABLE IF NOT EXISTS public.user_vault_benefits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  credit_cards jsonb NOT NULL DEFAULT '[]'::jsonb,
  airline_alliances jsonb NOT NULL DEFAULT '[]'::jsonb,
  hotel_loyalty jsonb NOT NULL DEFAULT '[]'::jsonb,
  car_rentals jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_vault_benefits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own vault" ON public.user_vault_benefits
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own vault" ON public.user_vault_benefits
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own vault" ON public.user_vault_benefits
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own vault" ON public.user_vault_benefits
  FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER user_vault_benefits_set_updated_at
  BEFORE UPDATE ON public.user_vault_benefits
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();