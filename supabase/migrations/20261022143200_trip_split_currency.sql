-- D-18 · Gastos compartidos (TripSplit). Idempotente.
--  * Cada gasto guarda su moneda (antes todo se sumaba como si fuera la misma). Los saldos se
--    calculan por moneda y nunca se convierte 1:1 (mismas reglas que src/lib/fx.ts).
--  * El monto debe ser mayor a 0 (se aceptaba -500). NOT VALID: no rechaza filas viejas, sí nuevas.
--  * Quitar a una persona ya no borra en cascada lo que pagó (cambiaba los saldos de todos): con
--    pagos registrados la base lo impide y la pantalla lo explica. Borrar el viaje sigue borrando
--    todo, porque gastos y personas caen en la misma sentencia.

ALTER TABLE public.trip_split_expenses ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'MXN';

ALTER TABLE public.trip_split_expenses DROP CONSTRAINT IF EXISTS trip_split_expenses_currency_iso;
ALTER TABLE public.trip_split_expenses ADD CONSTRAINT trip_split_expenses_currency_iso
  CHECK (currency ~ '^[A-Z]{3}$');

ALTER TABLE public.trip_split_expenses DROP CONSTRAINT IF EXISTS trip_split_expenses_amount_positive;
ALTER TABLE public.trip_split_expenses ADD CONSTRAINT trip_split_expenses_amount_positive
  CHECK (amount > 0) NOT VALID;

ALTER TABLE public.trip_split_expenses DROP CONSTRAINT IF EXISTS trip_split_expenses_payer_id_fkey;
ALTER TABLE public.trip_split_expenses ADD CONSTRAINT trip_split_expenses_payer_id_fkey
  FOREIGN KEY (payer_id) REFERENCES public.trip_split_people(id) ON DELETE NO ACTION;
