-- Alertas de precio en la moneda del proveedor (auditoría C-09 / D-09). Antes se comparaban pesos
-- convertidos con el tipo de cambio de cada día: si el peso se apreciaba, la misma tarifa en dólares
-- "bajaba" y se avisaba "Bajó tu vuelo". Ahora se guarda el monto original y su moneda, y la regla
-- compara solo eso; los pesos son solo para mostrar. Idempotente.

ALTER TABLE public.price_watches
  ADD COLUMN IF NOT EXISTS baseline_currency text,
  ADD COLUMN IF NOT EXISTS baseline_amount_original numeric,
  ADD COLUMN IF NOT EXISTS last_amount_original numeric,
  ADD COLUMN IF NOT EXISTS last_alert_amount_original numeric;

ALTER TABLE public.price_watch_checks
  ADD COLUMN IF NOT EXISTS amount_original numeric,
  ADD COLUMN IF NOT EXISTS currency text,
  ADD COLUMN IF NOT EXISTS fx_rate numeric;

-- Las vigilancias existentes no tienen el monto original (convertirlo de vuelta con un tipo de cambio
-- adivinado sería inventarlo): price-watch-cron toma la siguiente tarifa exacta como nueva base,
-- sin avisar.
