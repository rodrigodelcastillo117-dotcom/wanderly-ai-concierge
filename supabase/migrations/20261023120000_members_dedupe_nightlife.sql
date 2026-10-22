-- Members Only mostraba lugares repetidos (p. ej. 4 bares de París dos veces): la carga inicial de
-- nightlife_premium corrió dos veces el 2026-05-29 y dejó 17 pares idénticos. Se oculta (active =
-- false) la copia más reciente de cada par; no se borra nada, así que se puede revertir con
-- UPDATE ... SET active = true. Llave: ciudad + nombre normalizado (solo letras y números).
-- Idempotente: si ya no hay duplicados activos, no cambia nada.
WITH ranked AS (
  SELECT id, row_number() OVER (
    PARTITION BY ciudad, lower(regexp_replace(nombre, '[^a-zA-Z0-9]', '', 'g'))
    ORDER BY created_at, id
  ) AS n
  FROM public.nightlife_premium
  WHERE active
)
UPDATE public.nightlife_premium p SET active = false
FROM ranked r
WHERE p.id = r.id AND r.n > 1;
