-- Aviso a administradores cuando el servicio de imágenes de IA se queda sin créditos (oct 2026).
-- Idempotente.
--
-- Pasó en producción: el gateway de IA respondió 402 (sin saldo) al crear un Travel Avatar. La persona
-- vio el mensaje amable ("El servicio de imágenes no está disponible en este momento") pero nadie del
-- equipo se enteró. health-check ya mide el saldo de Lovable, pero lo trata como "respaldo" (aviso, no
-- falla) y corre una vez al día; generate-avatar usa ese gateway como servicio PRINCIPAL de imágenes.
--
-- alert_admins_ai_credits(p_service, p_reason) deja una campana a cada administrador (public.admins),
-- UNA vez por servicio, motivo y día (UTC): notify_once con dedup_key
-- 'ia_sin_creditos:<servicio>:<motivo>:<AAAA-MM-DD>'. El texto es fijo (el cliente no manda texto).
-- Devuelve lo mismo que notify_admins: n > 0 campanas nuevas, 0 ya avisado hoy, -1 sin administradores.
-- Solo la llave de servicio puede llamarla.

CREATE OR REPLACE FUNCTION public.alert_admins_ai_credits(p_service text, p_reason text)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a record;
  v_n int := 0;
  v_admins int := 0;
  v_day text := to_char((now() AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD');
  v_title text;
  v_body text;
BEGIN
  IF p_service IS NULL OR p_service NOT IN ('imagenes') THEN RAISE EXCEPTION 'servicio_invalido'; END IF;
  IF p_reason IS NULL OR p_reason NOT IN ('sin_saldo', 'sin_llave') THEN RAISE EXCEPTION 'motivo_invalido'; END IF;
  v_title := 'Se acabaron los créditos de IA (imágenes)';
  v_body := CASE p_reason
    WHEN 'sin_saldo' THEN 'El gateway de IA de Lovable respondió sin saldo (HTTP 402) al crear un Travel Avatar. '
      || 'Las personas ven «El servicio de imágenes no está disponible en este momento». Recarga los créditos de IA en Lovable.'
    ELSE 'Falta la llave LOVABLE_API_KEY en las funciones: no se pueden crear Travel Avatars. '
      || 'Las personas ven «El servicio de imágenes no está disponible en este momento».'
  END;
  FOR a IN SELECT user_id FROM public.admins LOOP
    v_admins := v_admins + 1;
    IF public.notify_once(a.user_id, 'system_alert', v_title, v_body, NULL,
                          'ia_sin_creditos:' || p_service || ':' || p_reason || ':' || v_day) IS NOT NULL THEN
      v_n := v_n + 1;
    END IF;
  END LOOP;
  IF v_admins = 0 THEN RETURN -1; END IF;
  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION public.alert_admins_ai_credits(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.alert_admins_ai_credits(text, text) TO service_role;

COMMENT ON FUNCTION public.alert_admins_ai_credits(text, text) IS
  'Campana a administradores cuando la IA de imágenes se queda sin créditos; una vez por servicio, motivo y día (UTC).';
