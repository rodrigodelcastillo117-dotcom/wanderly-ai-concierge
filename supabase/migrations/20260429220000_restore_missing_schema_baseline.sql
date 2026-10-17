-- Retroactive live-schema baseline. IF NOT EXISTS preserves deployed tables and data.
CREATE TABLE IF NOT EXISTS public.badges (id text PRIMARY KEY, nombre text NOT NULL, descripcion text, icono text, categoria text, meta_tipo text, meta_valor integer);
GRANT SELECT ON public.badges TO authenticated;
GRANT ALL ON public.badges TO service_role;
ALTER TABLE public.badges ENABLE ROW LEVEL SECURITY;
CREATE TABLE IF NOT EXISTS public.missions (id text PRIMARY KEY, titulo text NOT NULL, descripcion text, icono text, meta_tipo text, meta_valor integer NOT NULL, recompensa_badge_id text REFERENCES public.badges(id) ON DELETE SET NULL, vigente boolean DEFAULT true);
GRANT SELECT ON public.missions TO authenticated;
GRANT ALL ON public.missions TO service_role;
ALTER TABLE public.missions ENABLE ROW LEVEL SECURITY;
CREATE TABLE IF NOT EXISTS public.user_badges (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, badge_id text NOT NULL REFERENCES public.badges(id) ON DELETE CASCADE, unlocked_at timestamptz DEFAULT now(), UNIQUE(user_id,badge_id));
GRANT SELECT ON public.user_badges TO authenticated;
GRANT ALL ON public.user_badges TO service_role;
ALTER TABLE public.user_badges ENABLE ROW LEVEL SECURITY;
CREATE TABLE IF NOT EXISTS public.user_missions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, mission_id text NOT NULL REFERENCES public.missions(id) ON DELETE CASCADE, progreso integer DEFAULT 0, completada boolean DEFAULT false, completed_at timestamptz, updated_at timestamptz DEFAULT now(), UNIQUE(user_id,mission_id));
GRANT SELECT ON public.user_missions TO authenticated;
GRANT ALL ON public.user_missions TO service_role;
ALTER TABLE public.user_missions ENABLE ROW LEVEL SECURITY;
CREATE TABLE IF NOT EXISTS public.friendships (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), requester_id uuid NOT NULL, addressee_id uuid NOT NULL, status text NOT NULL DEFAULT 'pending', created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), UNIQUE(requester_id,addressee_id), CONSTRAINT no_self_friend CHECK(requester_id <> addressee_id));
GRANT SELECT,INSERT,UPDATE,DELETE ON public.friendships TO authenticated;
GRANT ALL ON public.friendships TO service_role;
ALTER TABLE public.friendships ENABLE ROW LEVEL SECURITY;
CREATE TABLE IF NOT EXISTS public.destination_daily_costs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), destination_code varchar(3) NOT NULL UNIQUE, city_name varchar(100) NOT NULL, hotel_3_star_usd numeric(10,2) NOT NULL, hotel_4_star_usd numeric(10,2) NOT NULL, hotel_5_star_usd numeric(10,2) NOT NULL, food_standard_usd numeric(10,2) NOT NULL, food_premium_usd numeric(10,2) NOT NULL, food_michelin_usd numeric(10,2) NOT NULL, exp_standard_usd numeric(10,2) NOT NULL, exp_vip_usd numeric(10,2) NOT NULL, transport_public_usd numeric(10,2) NOT NULL, transport_private_usd numeric(10,2) NOT NULL);
GRANT SELECT ON public.destination_daily_costs TO anon,authenticated;
GRANT ALL ON public.destination_daily_costs TO service_role;
ALTER TABLE public.destination_daily_costs ENABLE ROW LEVEL SECURITY;
CREATE TABLE IF NOT EXISTS public.historical_flight_prices (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), origin_code varchar(3) DEFAULT 'MEX', destination_city varchar(100) NOT NULL, destination_code varchar(3) NOT NULL, region varchar(50) NOT NULL, avg_price_usd numeric(10,2) NOT NULL, cheapest_months varchar(100), updated_at timestamptz DEFAULT now());
GRANT SELECT ON public.historical_flight_prices TO anon,authenticated;
GRANT ALL ON public.historical_flight_prices TO service_role;
ALTER TABLE public.historical_flight_prices ENABLE ROW LEVEL SECURITY;
DO $$ DECLARE p record; BEGIN
FOR p IN SELECT * FROM (VALUES
('badges','badges_read_all','SELECT','authenticated','true',NULL),
('missions','missions_read_all','SELECT','authenticated','true',NULL),
('user_badges','user_badges_own','SELECT','authenticated','auth.uid() = user_id',NULL),
('user_missions','user_missions_own','SELECT','authenticated','auth.uid() = user_id',NULL),
('friendships','friend_select_involved','SELECT','authenticated','auth.uid() = requester_id OR auth.uid() = addressee_id',NULL),
('friendships','friend_insert_self','INSERT','authenticated',NULL,'auth.uid() = requester_id'),
('friendships','friend_update_involved','UPDATE','authenticated','auth.uid() = requester_id OR auth.uid() = addressee_id',NULL),
('friendships','friend_delete_involved','DELETE','authenticated','auth.uid() = requester_id OR auth.uid() = addressee_id',NULL),
('destination_daily_costs','destination_daily_costs_public_read','SELECT','anon, authenticated','true',NULL),
('historical_flight_prices','historical_flight_prices_public_read','SELECT','anon, authenticated','true',NULL)
) AS x(tbl,nm,cmd,roles,qual,chk)
LOOP
IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=p.tbl AND policyname=p.nm) THEN
EXECUTE format('CREATE POLICY %I ON public.%I FOR %s TO %s%s%s',p.nm,p.tbl,p.cmd,p.roles,CASE WHEN p.qual IS NULL THEN '' ELSE ' USING ('||p.qual||')' END,CASE WHEN p.chk IS NULL THEN '' ELSE ' WITH CHECK ('||p.chk||')' END);
END IF;
END LOOP; END $$;
-- mis_amigos and user_autonomy are views, not tables. Define them in their dependency-aware migration separately.