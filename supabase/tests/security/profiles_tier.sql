-- Prueba de 20261022145000: vista previa, aplicación, bitácora, reversa y que el acceso no cambia.
\set ON_ERROR_STOP off
\pset tuples_only on
RESET ROLE;
INSERT INTO auth.users(id,email) VALUES ('d1000000-0000-0000-0000-000000000001','pro@example.test'),('d2000000-0000-0000-0000-000000000002','free@example.test') ON CONFLICT DO NOTHING;
UPDATE public.profiles SET tier='pro' WHERE id IN ('d1000000-0000-0000-0000-000000000001','d2000000-0000-0000-0000-000000000002');
INSERT INTO public.subscriptions(user_id,status,plan) VALUES ('d1000000-0000-0000-0000-000000000001','comped','pro') ON CONFLICT (user_id) DO UPDATE SET status='comped';
SELECT 'T1 vista previa (1 cambio: free sigue en pro): '||count(*) FROM public.sync_profile_tier(true) WHERE profile_id IN ('d1000000-0000-0000-0000-000000000001','d2000000-0000-0000-0000-000000000002');
SELECT 'T2 la vista previa no escribió: '||tier FROM public.profiles WHERE id='d2000000-0000-0000-0000-000000000002';
SELECT batch_id AS b FROM public.sync_profile_tier(false) WHERE profile_id='d2000000-0000-0000-0000-000000000002' \gset
SELECT 'T3 tras aplicar: '||(SELECT tier FROM public.profiles WHERE id='d2000000-0000-0000-0000-000000000002')||' / pro sigue '||(SELECT tier FROM public.profiles WHERE id='d1000000-0000-0000-0000-000000000001');
SELECT 'T4 acceso intacto: is_pro(pro)='||public.is_pro('d1000000-0000-0000-0000-000000000001')||' is_pro(free)='||public.is_pro('d2000000-0000-0000-0000-000000000002');
SELECT 'T5 bitácora: '||count(*)||' fila(s) old='||max(old_tier)||' new='||max(new_tier) FROM public.profiles_tier_audit WHERE batch_id=:'b' AND profile_id='d2000000-0000-0000-0000-000000000002';
SELECT 'T6 revertidos: '||public.revert_profile_tier(:'b');
SELECT 'T7 tras revertir: '||tier FROM public.profiles WHERE id='d2000000-0000-0000-0000-000000000002';
SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','d2000000-0000-0000-0000-000000000002',false);
SELECT * FROM public.sync_profile_tier(false);
SELECT 'T8 bitácora visible para usuarios: '||count(*) FROM public.profiles_tier_audit;
RESET ROLE;
