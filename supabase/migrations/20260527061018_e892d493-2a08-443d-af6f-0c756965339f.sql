GRANT SELECT, INSERT, UPDATE, DELETE ON public.concierge_requests TO authenticated;
GRANT ALL ON public.concierge_requests TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;