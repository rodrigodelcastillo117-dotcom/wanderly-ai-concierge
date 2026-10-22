-- Prueba de 20261022145000: vista previa, aplicación, bitácora, reversa y que el acceso no cambia.
-- Formato: "<ID> <qué> [<esperado>]: <observado>"; run.sh lo convierte en OK/FALLA (t_brackets de ../lib.sh).
\set ON_ERROR_STOP off
\pset tuples_only on
RESET ROLE;
INSERT INTO auth.users(id,email) VALUES ('d1000000-0000-0000-0000-000000000001','pro@example.test'),('d2000000-0000-0000-0000-000000000002','free@example.test') ON CONFLICT DO NOTHING;
UPDATE public.profiles SET tier='pro' WHERE id IN ('d1000000-0000-0000-0000-000000000001','d2000000-0000-0000-0000-000000000002');
INSERT INTO public.subscriptions(user_id,status,plan) VALUES ('d1000000-0000-0000-0000-000000000001','comped','pro') ON CONFLICT (user_id) DO UPDATE SET status='comped';
SELECT 'T1 vista previa (1 cambio: free sigue en pro) [1]: '||count(*) FROM public.sync_profile_tier(true) WHERE profile_id IN ('d1000000-0000-0000-0000-000000000001','d2000000-0000-0000-0000-000000000002');
SELECT 'T2 la vista previa no escribió [pro]: '||tier FROM public.profiles WHERE id='d2000000-0000-0000-0000-000000000002';
SELECT batch_id AS b FROM public.sync_profile_tier(false) WHERE profile_id='d2000000-0000-0000-0000-000000000002' \gset
SELECT 'T3 tras aplicar [free / pro sigue pro]: '||(SELECT tier FROM public.profiles WHERE id='d2000000-0000-0000-0000-000000000002')||' / pro sigue '||(SELECT tier FROM public.profiles WHERE id='d1000000-0000-0000-0000-000000000001');
SELECT 'T4 acceso intacto [is_pro(pro)=true is_pro(free)=false]: is_pro(pro)='||public.is_pro('d1000000-0000-0000-0000-000000000001')||' is_pro(free)='||public.is_pro('d2000000-0000-0000-0000-000000000002');
SELECT 'T5 bitácora [1 fila(s) old=pro new=free]: '||count(*)||' fila(s) old='||max(old_tier)||' new='||max(new_tier) FROM public.profiles_tier_audit WHERE batch_id=:'b' AND profile_id='d2000000-0000-0000-0000-000000000002';
-- T6: revierte exactamente las filas que cambió el lote (las de su bitácora), ni más ni menos.
SELECT count(*) AS nb FROM public.profiles_tier_audit WHERE batch_id=:'b' \gset
SELECT 'T6 revertidos = filas del lote [true]: '||(public.revert_profile_tier(:'b') = :nb);
SELECT 'T7 tras revertir [pro]: '||tier FROM public.profiles WHERE id='d2000000-0000-0000-0000-000000000002';
SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','d2000000-0000-0000-0000-000000000002',false);
DO $$ BEGIN PERFORM * FROM public.sync_profile_tier(false);
  RAISE NOTICE 'T8 un usuario no ejecuta sync_profile_tier [permission denied]: la ejecutó';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'T8 un usuario no ejecuta sync_profile_tier [permission denied]: permission denied'; END $$;
DO $$ DECLARE n bigint; BEGIN SELECT count(*) INTO n FROM public.profiles_tier_audit;
  RAISE NOTICE 'T9 la bitácora no es visible para usuarios [permission denied]: leyó % fila(s)', n;
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'T9 la bitácora no es visible para usuarios [permission denied]: permission denied'; END $$;
RESET ROLE;
