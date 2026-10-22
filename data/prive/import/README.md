# Lotes listos para cargar en producción

`curaduria_2026-10.json` lo generó `scripts/prive/load_curation.mjs --month 2026-10` a partir de
`data/prive/curaduria/2026-10/` (1,260 filas aceptadas: CURADO o PENDIENTE; nada entra como
VERIFICADO hasta el muestreo humano). Se carga con `public.prive_import_batch(filas, 'curaduria_2026-10',
dry_run)`, primero en ensayo (`true`) y luego real (`false`). El paso a paso con verificación de
SHA-256 está en `docs/ops/LEEME.md` (sección Privé).
