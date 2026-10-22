-- AUD-SEG-05 (auditoría de cierre, grupo seguridad; reportado por aud-iato). Idempotente.
-- Confirmar una acción de Iato (o el botón de solicitud al Fixer) y tocar "Reintentar" tras un timeout
-- volvía a ejecutarla: dos concierge_requests (dos correos al equipo) o dos viajes. El cliente manda una
-- clave por confirmación; concierge-chat (modo action) y concierge-action la apartan aquí antes de
-- ejecutar y, si ya terminó, devuelven la misma respuesta. Solo service_role (las funciones Edge).
-- Pruebas: supabase/tests/security/action_idempotency.sql y src/test/audSegIdempotency.test.tsx.
CREATE TABLE IF NOT EXISTS public.action_idempotency (
  user_id uuid NOT NULL,
  scope text NOT NULL CHECK (scope ~ '^[a-z0-9_-]{2,40}$'),
  idem_key text NOT NULL CHECK (idem_key ~ '^[A-Za-z0-9_-]{16,80}$'),
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'done')),
  response jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, scope, idem_key)
);
ALTER TABLE public.action_idempotency ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.action_idempotency FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.action_idempotency TO service_role;
CREATE INDEX IF NOT EXISTS action_idempotency_created_idx ON public.action_idempotency (created_at);

-- Aparta la clave. 'new' = ejecuta; 'running' = otro intento sigue en curso; 'done' = respuesta guardada.
-- Una clave "en curso" de más de 10 min (la función murió a medias) se puede volver a apartar.
-- Las claves de más de 7 días se borran aquí mismo (sin tarea programada).
CREATE OR REPLACE FUNCTION public.action_idem_claim(_user_id uuid, _scope text, _key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.action_idempotency%ROWTYPE;
BEGIN
  IF _user_id IS NULL OR _key IS NULL OR _key !~ '^[A-Za-z0-9_-]{16,80}$' OR _scope !~ '^[a-z0-9_-]{2,40}$' THEN
    RETURN jsonb_build_object('state', 'invalid');
  END IF;
  DELETE FROM public.action_idempotency WHERE user_id = _user_id AND created_at < now() - interval '7 days';
  INSERT INTO public.action_idempotency (user_id, scope, idem_key) VALUES (_user_id, _scope, _key)
  ON CONFLICT (user_id, scope, idem_key) DO NOTHING;
  IF FOUND THEN RETURN jsonb_build_object('state', 'new'); END IF;
  SELECT * INTO r FROM public.action_idempotency WHERE user_id = _user_id AND scope = _scope AND idem_key = _key FOR UPDATE;
  IF r.status = 'done' THEN RETURN jsonb_build_object('state', 'done', 'response', r.response); END IF;
  IF r.updated_at < now() - interval '10 minutes' THEN
    UPDATE public.action_idempotency SET updated_at = now() WHERE user_id = _user_id AND scope = _scope AND idem_key = _key;
    RETURN jsonb_build_object('state', 'new');
  END IF;
  RETURN jsonb_build_object('state', 'running');
END $$;

-- Cierra la clave: con respuesta queda 'done'; con NULL se libera (la acción falló, se puede reintentar).
CREATE OR REPLACE FUNCTION public.action_idem_finish(_user_id uuid, _scope text, _key text, _response jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF _response IS NULL THEN
    DELETE FROM public.action_idempotency WHERE user_id = _user_id AND scope = _scope AND idem_key = _key AND status = 'running';
  ELSE
    UPDATE public.action_idempotency SET status = 'done', response = _response, updated_at = now()
     WHERE user_id = _user_id AND scope = _scope AND idem_key = _key;
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.action_idem_claim(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.action_idem_finish(uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.action_idem_claim(uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.action_idem_finish(uuid, text, text, jsonb) TO service_role;
