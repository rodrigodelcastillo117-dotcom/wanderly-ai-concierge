-- Ferry bookings were being mislabeled as "train" because the bookings.category
-- check constraint had no "ferry" value. Add it (additive, non-breaking).
ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_category_check;
ALTER TABLE public.bookings ADD CONSTRAINT bookings_category_check
  CHECK (category IN ('flight','hotel','restaurant','train','ferry','car','activity','esim','insurance','other'));
