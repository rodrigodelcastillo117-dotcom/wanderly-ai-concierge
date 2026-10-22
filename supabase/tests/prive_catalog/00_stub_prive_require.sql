-- SOLO PARA PRUEBAS LOCALES (nunca en migraciones). La prive_require real la construye el grupo core
-- (sesiones con hash, PRO vigente, 90 días pagados, membresía activa, contraseña Privé). Este stub
-- reproduce su contrato público para probar el catálogo: SECURITY DEFINER, devuelve auth.uid() y
-- falla con SQLSTATE P0001 y uno de los mensajes PRIVE_* del contrato.
CREATE TABLE IF NOT EXISTS public.prive_test_sessions (
  token   text PRIMARY KEY,
  user_id uuid NOT NULL,
  revoked boolean NOT NULL DEFAULT false
);
REVOKE ALL ON public.prive_test_sessions FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.prive_require(_ps text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); s record;
BEGIN
  IF v_uid IS NULL OR _ps IS NULL OR btrim(_ps) = '' THEN
    RAISE EXCEPTION 'PRIVE_NO_SESSION' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO s FROM public.prive_test_sessions WHERE token = _ps;
  IF NOT FOUND OR s.user_id <> v_uid THEN
    RAISE EXCEPTION 'PRIVE_SESSION_INVALID' USING ERRCODE = 'P0001';
  END IF;
  IF s.revoked THEN RAISE EXCEPTION 'PRIVE_SESSION_EXPIRED' USING ERRCODE = 'P0001'; END IF;
  RETURN v_uid;
END $$;
REVOKE ALL ON FUNCTION public.prive_require(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prive_require(text) TO authenticated, service_role;
