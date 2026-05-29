ALTER TABLE public.profiles ALTER COLUMN tier SET DEFAULT 'pro';
UPDATE public.profiles SET tier = 'pro' WHERE tier IS NULL OR tier = 'free';