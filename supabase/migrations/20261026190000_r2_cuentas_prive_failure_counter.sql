-- Segunda auditoría · grupo cuentas · P3-5 (Privé, P3). Idempotente. REQUIERE AUTORIZACIÓN para
-- aplicarse en producción.
--
-- Problema (C6d de aud2_prive.sql): prive_register_failure reiniciaba el contador de fallos a las 24 h
-- del último fallo. Con 14 intentos por día (la escalera 5→1 min, 8→5, 10→15, 12→60 los permite) nunca
-- se llegaba al bloqueo total de 15: 42 fallos en 3 días, hard_locked=false.
-- Corrección: el contador solo se reinicia con una entrada correcta (prive_unlock lo pone en 0), con el
-- cambio de contraseña o con el restablecimiento por correo (que además quita el bloqueo total). Quien
-- se equivoca y después entra no acumula nada; quien solo falla llega al bloqueo total en 15 intentos,
-- aunque los reparta en varios días. El aviso de "nuevo acceso tras varios fallos" no cambia.
--
-- Prueba: supabase/tests/prive/r2_cuentas_prive.sql (RP10–RP12).

-- Registra un fallo de contraseña de la cuenta (la fila de credenciales ya está bloqueada FOR UPDATE
-- por quien llama) y aplica la escalera de bloqueos y el límite por ip_hash.
CREATE OR REPLACE FUNCTION public.prive_register_failure(_user uuid, _ip_hash text, _kind text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c public.prive_credentials%ROWTYPE;
  v_ip text := public.prive_clean_ip(_ip_hash);
  v_n int;
  v_lock interval;
  v_hard boolean;
BEGIN
  SELECT * INTO c FROM public.prive_credentials WHERE user_id = _user;
  -- P3-5: el contador ya no vuelve a 0 a las 24 h sin fallos. Solo lo reinicia una entrada correcta
  -- (prive_unlock), cambiar la contraseña o restablecerla por correo. Antes cabían 14 intentos por día
  -- sin llegar nunca al bloqueo total (15).
  v_n := c.failed_count + 1;
  v_lock := CASE v_n WHEN 5 THEN interval '1 minute' WHEN 8 THEN interval '5 minutes'
                     WHEN 10 THEN interval '15 minutes' WHEN 12 THEN interval '60 minutes' END;
  v_hard := v_n >= 15;
  UPDATE public.prive_credentials
     SET failed_count = v_n, last_failed_at = now(), hard_locked = hard_locked OR v_hard,
         locked_until = CASE WHEN v_lock IS NOT NULL THEN now() + v_lock ELSE locked_until END
   WHERE user_id = _user;
  PERFORM public.prive_record_attempt(_user, v_ip, _kind, false, 'wrong_password');

  IF v_ip IS NOT NULL AND (SELECT count(*) FROM public.prive_auth_attempts a
                            WHERE a.ip_hash = v_ip AND NOT a.success AND a.reason IN ('wrong_password', 'reset_invalid')
                              AND a.at > now() - interval '1 hour') > 30 THEN
    INSERT INTO public.prive_ip_blocks (ip_hash, blocked_until) VALUES (v_ip, now() + interval '60 minutes')
    ON CONFLICT (ip_hash) DO UPDATE SET blocked_until = EXCLUDED.blocked_until;
  END IF;

  IF v_hard THEN
    PERFORM public.prive_revoke_sessions(_user, 'hard_lock');
    PERFORM public.notify_once(_user, 'prive', 'Bloqueamos tu contraseña Privé',
      'Hubo demasiados intentos fallidos. Para volver a entrar, restablece tu contraseña Privé desde el correo de tu cuenta.',
      NULL, 'prive_hardlock:' || _user::text || ':' || c.version::text || ':' || (extract(epoch FROM now()))::bigint);
    PERFORM public.prive_audit(_user, 'hard_locked', 'system', jsonb_build_object('failed_count', v_n, 'kind', _kind));
    RETURN jsonb_build_object('ok', false, 'reason', 'HARD_LOCKED', 'notice', 'hard_lock');
  END IF;
  IF v_lock IS NOT NULL THEN
    PERFORM public.prive_audit(_user, 'locked', 'system', jsonb_build_object('failed_count', v_n, 'minutes', extract(epoch FROM v_lock) / 60));
    RETURN jsonb_build_object('ok', false, 'reason', 'LOCKED', 'locked_until', now() + v_lock);
  END IF;
  RETURN jsonb_build_object('ok', false, 'reason', 'WRONG_PASSWORD');
END $$;
REVOKE ALL ON FUNCTION public.prive_register_failure(uuid, text, text) FROM PUBLIC, anon, authenticated;
