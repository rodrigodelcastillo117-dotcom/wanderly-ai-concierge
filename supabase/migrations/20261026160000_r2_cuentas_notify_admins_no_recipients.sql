-- Segunda auditoría · grupo cuentas · D-P3-3 (P3). Idempotente. REQUIERE AUTORIZACIÓN para aplicarse
-- en producción (y desplegar stripe-webhook, que lee el -1).
--
-- Problema: sin filas en public.admins, notify_admins devolvía 0, lo mismo que "ya se avisó de este
-- evento". El webhook lo leía como campana_ya_enviada y respondía 200: una disputa abierta (con plazo
-- para responder en Stripe) no le llegaba a nadie.
-- Ahora: -1 = no hay a quién avisar (el webhook lo trata como aviso NO enviado: intenta el correo de
-- HEALTH_ALERT_EMAIL y, si tampoco sale, responde 500 para que Stripe reintente y se vea en su panel);
-- 0 = ya se había avisado (llave de deduplicación); n > 0 = campanas nuevas.
--
-- Prueba: supabase/tests/payments/aud2_pagos_adversarial.sql (X09) y src/test/stripeAdminAlert.test.ts.

CREATE OR REPLACE FUNCTION public.notify_admins(_dedup_key text, _title text, _body text)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a record;
  v_n int := 0;
  v_admins int := 0;
BEGIN
  FOR a IN SELECT user_id FROM public.admins LOOP
    v_admins := v_admins + 1;
    IF public.notify_once(a.user_id, 'payment_alert', _title, _body, NULL, _dedup_key) IS NOT NULL THEN
      v_n := v_n + 1;
    END IF;
  END LOOP;
  IF v_admins = 0 THEN
    RETURN -1;  -- sin destinatarios: NO es "ya enviado"
  END IF;
  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION public.notify_admins(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_admins(text, text, text) TO service_role;
