-- PROFILES
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  email TEXT,
  pais_origen TEXT DEFAULT 'México',
  ciudad_origen TEXT,
  fecha_nacimiento DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own profile" ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users insert own profile" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "Users update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Users delete own profile" ON public.profiles FOR DELETE USING (auth.uid() = id);

-- TRAVEL PROFILES
CREATE TABLE public.travel_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  estilo_viaje TEXT[],
  presupuesto_rango TEXT,
  ritmo_viaje TEXT,
  preferencias_comida TEXT[],
  alergias_restricciones TEXT[],
  intereses TEXT[],
  tipo_alojamiento_preferido TEXT[],
  duracion_viaje_ideal TEXT,
  acompanantes_tipico TEXT,
  destinos_visitados TEXT[],
  destinos_pendientes TEXT[],
  idiomas_hablados TEXT[],
  movilidad_especial BOOLEAN DEFAULT false,
  notas_adicionales TEXT,
  completado BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.travel_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own travel_profile" ON public.travel_profiles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own travel_profile" ON public.travel_profiles FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own travel_profile" ON public.travel_profiles FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own travel_profile" ON public.travel_profiles FOR DELETE USING (auth.uid() = user_id);

-- TRIPS
CREATE TABLE public.trips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  destino TEXT NOT NULL,
  pais_destino TEXT,
  ciudad_origen TEXT,
  fecha_salida DATE,
  fecha_regreso DATE,
  num_viajeros INT DEFAULT 1,
  presupuesto_objetivo NUMERIC,
  status TEXT DEFAULT 'analizando',
  total_estimado NUMERIC,
  moneda TEXT DEFAULT 'MXN',
  itinerario_json JSONB,
  vuelos_json JSONB,
  hospedaje_json JSONB,
  restaurantes_json JSONB,
  tours_json JSONB,
  desglose_presupuesto JSONB,
  analisis_ai TEXT,
  tips_personalizados JSONB,
  match_score INT,
  cover_image_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.trips ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own trips" ON public.trips FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own trips" ON public.trips FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own trips" ON public.trips FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own trips" ON public.trips FOR DELETE USING (auth.uid() = user_id);

-- SUBSCRIPTIONS
CREATE TABLE public.subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  status TEXT DEFAULT 'trialing',
  trial_end TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own subscription" ON public.subscriptions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own subscription" ON public.subscriptions FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own subscription" ON public.subscriptions FOR UPDATE USING (auth.uid() = user_id);

-- RECOMENDACIONES
CREATE TABLE public.recomendaciones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tipo TEXT,
  titulo TEXT,
  descripcion TEXT,
  imagen_url TEXT,
  match_score INT,
  metadata JSONB,
  guardado BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.recomendaciones ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own recomendaciones" ON public.recomendaciones FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own recomendaciones" ON public.recomendaciones FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own recomendaciones" ON public.recomendaciones FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own recomendaciones" ON public.recomendaciones FOR DELETE USING (auth.uid() = user_id);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_travel_profiles_updated BEFORE UPDATE ON public.travel_profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_trips_updated BEFORE UPDATE ON public.trips FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_subscriptions_updated BEFORE UPDATE ON public.subscriptions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', ''));
  RETURN NEW;
END; $$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();