-- Dependency-aware reconstruction of live views and nonconstraint indexes.
CREATE OR REPLACE VIEW public.mis_amigos WITH (security_invoker=true) AS SELECT CASE WHEN requester_id=auth.uid() THEN addressee_id ELSE requester_id END AS amigo_id,status,created_at FROM public.friendships WHERE (requester_id=auth.uid() OR addressee_id=auth.uid()) AND status='accepted';
CREATE OR REPLACE VIEW public.user_autonomy WITH (security_invoker=true) AS SELECT user_id,trip_count,visit_count,dna_version,CASE WHEN coalesce(trip_count,0)>=3 THEN 'autonomous'::text ELSE 'manual'::text END AS nivel FROM public.ai_user_preferences;
GRANT SELECT ON public.mis_amigos,public.user_autonomy TO authenticated;
GRANT ALL ON public.mis_amigos,public.user_autonomy TO service_role;
CREATE INDEX IF NOT EXISTS idx_friend_requester ON public.friendships(requester_id);
CREATE INDEX IF NOT EXISTS idx_friend_addressee ON public.friendships(addressee_id);
CREATE INDEX IF NOT EXISTS idx_friend_status ON public.friendships(status);
CREATE INDEX IF NOT EXISTS idx_user_badges_user ON public.user_badges(user_id);
CREATE INDEX IF NOT EXISTS idx_user_missions_user ON public.user_missions(user_id);