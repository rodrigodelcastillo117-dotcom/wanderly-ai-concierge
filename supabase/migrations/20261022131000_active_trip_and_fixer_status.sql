-- Viaje activo único (auditoría B, hallazgos B-08/B-09, diseño C-2) y estado real de las
-- escalaciones al Fixer (B-12). Idempotente: se puede aplicar más de una vez.

-- 1) profiles.active_trip_id: el viaje que el usuario fijó como "activo". Lo usan el concierge
--    (y deben usarlo Dashboard, Cercanos, Gastos y Fixer) en lugar de adivinar por fecha de creación.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS active_trip_id uuid;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_active_trip_fk') THEN
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_active_trip_fk
      FOREIGN KEY (active_trip_id) REFERENCES public.trips(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_profiles_active_trip ON public.profiles(active_trip_id)
  WHERE active_trip_id IS NOT NULL;

-- La política de profiles ya limita la fila a su dueño; esto además impide fijar un viaje
-- ajeno (de otro usuario y sin ser colaborador aceptado).
CREATE OR REPLACE FUNCTION public.profiles_guard_active_trip()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.active_trip_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.active_trip_id IS DISTINCT FROM OLD.active_trip_id)
     AND NOT public.has_trip_access(NEW.active_trip_id, NEW.id) THEN
    RAISE EXCEPTION 'No tienes acceso a ese viaje' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.profiles_guard_active_trip() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS profiles_guard_active_trip ON public.profiles;
CREATE TRIGGER profiles_guard_active_trip
  BEFORE INSERT OR UPDATE OF active_trip_id ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_guard_active_trip();

-- Si a alguien lo quitan de un viaje compartido, deja de tenerlo como activo.
CREATE OR REPLACE FUNCTION public.clear_active_trip_on_collab_removed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.profiles SET active_trip_id = NULL
   WHERE id = OLD.user_id AND active_trip_id = OLD.trip_id
     AND NOT public.is_trip_owner(OLD.trip_id, OLD.user_id);
  RETURN OLD;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.clear_active_trip_on_collab_removed() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS clear_active_trip_on_collab_removed ON public.trip_collaborators;
CREATE TRIGGER clear_active_trip_on_collab_removed
  AFTER DELETE ON public.trip_collaborators
  FOR EACH ROW EXECUTE FUNCTION public.clear_active_trip_on_collab_removed();

-- 2) fixer_escalations: el botón guardaba status 'email_enviado' ANTES de mandar el correo, y ese
--    valor ni siquiera estaba permitido por el CHECK (la fila nunca se guardaba). Ahora se inserta
--    'pendiente' y se actualiza con el resultado real del envío.
ALTER TABLE public.fixer_escalations DROP CONSTRAINT IF EXISTS fixer_escalations_status_check;
ALTER TABLE public.fixer_escalations ADD CONSTRAINT fixer_escalations_status_check
  CHECK (status IN ('iniciado', 'whatsapp_abierto', 'resuelto', 'pendiente', 'email_enviado', 'email_fallido'));
