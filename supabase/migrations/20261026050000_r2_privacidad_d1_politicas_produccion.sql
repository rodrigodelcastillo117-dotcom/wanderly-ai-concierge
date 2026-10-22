-- D1 (INFORME_produccion.md, deriva de producción). Idempotente.
--
-- Producción tiene 50 políticas *_own creadas fuera de git (patrón de Lovable). Son PERMISIVAS: se
-- combinan con OR con las del repositorio. En expenses y user_visits el repositorio exige en
-- INSERT/UPDATE que el viaje, si viene, sea uno al que la persona tiene acceso
-- (20261022141600_sec2_trip_id_checks.sql, "Users insert/update own expenses|visits"); las *_own de
-- producción solo piden auth.uid() = user_id, así que anulan esa verificación.
--
-- Aquí se quitan SOLO esas cuatro. Las demás *_own (ai_user_preferences, behavioral_insights,
-- concierge_requests, notifications, profiles, recomendaciones, travel_profiles, trips,
-- user_vault_benefits, storage.objects recibos_* y las SELECT/DELETE de expenses y user_visits) son
-- equivalentes a las del repositorio o no tienen GRANT que las haga efectivas: no se tocan.
-- En una base sin la deriva (local, CI) no hace nada.

DROP POLICY IF EXISTS expenses_insert_own ON public.expenses;
DROP POLICY IF EXISTS expenses_update_own ON public.expenses;
DROP POLICY IF EXISTS user_visits_insert_own ON public.user_visits;
DROP POLICY IF EXISTS user_visits_update_own ON public.user_visits;
