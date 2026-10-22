-- Concierge 2.0 (Iato): configuración de modelos sin desplegar código y tope diario opcional del
-- Modo exigente. Idempotente: re-correrla no pisa valores ya editados.
--
--  * app_flags.concierge_models: qué modelo atiende cada nivel (rápido / capaz), su esfuerzo, el
--    respaldo (gateway de Lovable) y el enfriamiento del circuit breaker. concierge-chat lo lee en cada
--    mensaje (con caché de 60 s por instancia); un valor inválido se ignora y se usa el de fábrica.
--  * app_flags.concierge_exigente_daily_limit: mensajes en Modo exigente por día y por usuario.
--    null = sin tope (comportamiento de hoy). DECISIÓN DEL DUEÑO: el valor propuesto (p. ej. 20 para
--    PRO) solo se aplica cuando el dueño lo cambie. Al pasar el tope NO se bloquea: Iato responde en
--    modo normal y lo dice.
--  * concierge_runtime_config(_user_id): devuelve ambas cosas + cuántos mensajes exigentes lleva hoy
--    (reservas de cuota COMMITTED con llave 'x:' del día UTC). Solo service_role.

INSERT INTO public.app_flags (key, value, note) VALUES
  ('concierge_models',
   '{"anthropic_enabled": true, "fast_model": "claude-haiku-5-5", "smart_model": "claude-sonnet-5-5", "fast_effort": "low", "smart_effort": "low", "exigente_effort": "medium", "fallback_model": "google/gemini-2.5-flash", "breaker_cooldown_s": 120, "force_tier": null}'::jsonb,
   'Concierge 2.0: modelos de Iato por nivel (rápido/capaz), esfuerzo, respaldo y enfriamiento del breaker'),
  ('concierge_exigente_daily_limit', 'null'::jsonb,
   'Concierge 2.0: mensajes en Modo exigente por día y usuario (null = sin tope). DECISIÓN DEL DUEÑO')
ON CONFLICT (key) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_quota_reservations_user_kind_created
  ON public.quota_reservations (user_id, kind, created_at DESC);

CREATE OR REPLACE FUNCTION public.concierge_runtime_config(_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_models jsonb;
  v_limit jsonb;
  v_used int := 0;
BEGIN
  SELECT value INTO v_models FROM public.app_flags WHERE key = 'concierge_models';
  SELECT value INTO v_limit FROM public.app_flags WHERE key = 'concierge_exigente_daily_limit';
  IF _user_id IS NOT NULL THEN
    SELECT count(*) INTO v_used FROM public.quota_reservations
     WHERE user_id = _user_id AND kind = 'concierge' AND status = 'COMMITTED'
       AND left(request_key, 2) = 'x:' AND created_at >= date_trunc('day', now());
  END IF;
  RETURN jsonb_build_object(
    'models', coalesce(v_models, '{}'::jsonb),
    'exigente', jsonb_build_object(
      'limit', CASE WHEN jsonb_typeof(v_limit) = 'number' THEN v_limit ELSE 'null'::jsonb END,
      'used', v_used));
END;
$$;
REVOKE ALL ON FUNCTION public.concierge_runtime_config(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.concierge_runtime_config(uuid) TO service_role;
