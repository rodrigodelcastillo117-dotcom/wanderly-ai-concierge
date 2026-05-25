
-- Concierge requests (reservations, pickups, transport, jets)
CREATE TABLE public.concierge_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  trip_id UUID,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.concierge_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own concierge_requests" ON public.concierge_requests FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own concierge_requests" ON public.concierge_requests FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own concierge_requests" ON public.concierge_requests FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own concierge_requests" ON public.concierge_requests FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER trg_concierge_requests_updated
BEFORE UPDATE ON public.concierge_requests
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Notifications (in-app)
CREATE TABLE public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  type TEXT NOT NULL DEFAULT 'info',
  title TEXT NOT NULL,
  body TEXT,
  related_id UUID,
  read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own notifications" ON public.notifications FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own notifications" ON public.notifications FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own notifications" ON public.notifications FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own notifications" ON public.notifications FOR DELETE USING (auth.uid() = user_id);

-- Realtime for notifications + requests
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
ALTER PUBLICATION supabase_realtime ADD TABLE public.concierge_requests;
ALTER TABLE public.notifications REPLICA IDENTITY FULL;
ALTER TABLE public.concierge_requests REPLICA IDENTITY FULL;

CREATE INDEX idx_concierge_requests_user ON public.concierge_requests(user_id, created_at DESC);
CREATE INDEX idx_notifications_user ON public.notifications(user_id, read, created_at DESC);
