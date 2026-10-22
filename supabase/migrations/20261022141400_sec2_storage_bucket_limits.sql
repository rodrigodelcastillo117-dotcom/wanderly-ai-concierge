-- F-11 (IATOS-054): validación de uploads en el SERVIDOR. Idempotente.
-- Sin file_size_limit ni allowed_mime_types, cualquiera con sesión podía subir HTML o SVG (que el
-- dominio de storage sirve tal cual) o archivos enormes a los buckets públicos. Storage rechaza
-- ahora lo que no sea imagen (o PDF en recibos) o pase de 10 MB, aunque el cliente se salte sus
-- propias revisiones (src/lib/uploadRules.ts, que debe coincidir con esta lista).
-- SVG queda fuera a propósito: puede llevar scripts.
UPDATE storage.buckets
   SET file_size_limit = 10485760,
       allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf']
 WHERE id = 'recibos';

UPDATE storage.buckets
   SET file_size_limit = 10485760,
       allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/gif']
 WHERE id IN ('journal-photos', 'travel-moments');
