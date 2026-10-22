-- Avisos sin duplicados (auditoría C-06). Antes, dos corridas encimadas (o un reintento después de
-- un error al guardar) insertaban el mismo aviso dos veces. Ahora cada aviso automático lleva una
-- llave única por usuario; se inserta con ON CONFLICT DO NOTHING y el push solo sale si se insertó.
-- Idempotente.

ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS dedup_key text;

CREATE UNIQUE INDEX IF NOT EXISTS notifications_user_dedup_key_uniq
  ON public.notifications (user_id, dedup_key) WHERE dedup_key IS NOT NULL;

-- Devuelve el id del aviso creado, o NULL si ya existía uno con la misma llave.
-- Solo el servidor (service_role) la usa; PostgREST no sabe usar índices parciales en on_conflict.
CREATE OR REPLACE FUNCTION public.notify_once(
  p_user_id uuid,
  p_type text,
  p_title text,
  p_body text,
  p_related_id uuid,
  p_dedup_key text
) RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  INSERT INTO public.notifications (user_id, type, title, body, related_id, dedup_key)
  VALUES (p_user_id, coalesce(p_type, 'info'), p_title, p_body, p_related_id, p_dedup_key)
  ON CONFLICT (user_id, dedup_key) WHERE dedup_key IS NOT NULL DO NOTHING
  RETURNING id;
$$;
REVOKE ALL ON FUNCTION public.notify_once(uuid, text, text, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_once(uuid, text, text, text, uuid, text) TO service_role;
