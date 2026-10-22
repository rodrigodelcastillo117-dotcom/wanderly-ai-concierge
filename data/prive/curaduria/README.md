# Curaduría de IATOS Privé (datos fuente)

Cada carpeta `AAAA-MM/` guarda los archivos `content_g*.json` que produjo una ronda de curaduría:
lugares y experiencias investigados en fuentes abiertas (sitio oficial, Guía Michelin vía listas
públicas, The World's 50 Best, etc.), con su fuente, fecha de verificación y estado
(`verificado` / `no_confirmado`).

- **No se publican directo.** El cargador (`node scripts/prive/load_curation.mjs --month AAAA-MM`) los
  valida y produce un ensayo. Lo `verificado` entra como CURADO (pasa a VERIFICADO solo con el muestreo
  humano del lote); lo `no_confirmado` entra PENDIENTE y queda oculto hasta que una persona lo revise.
- Rondas mensuales: `AAAA-MM/content_new.json` y `AAAA-MM/content_updates.json` (mismo formato).
- Los reportes del ensayo se escriben en `_reportes/AAAA-MM/` (fuera del control de versiones).
- Reglas de curaduría: `docs/iatos/prive_curaduria/` (formato, universos, imágenes de Pexels) y
  `docs/iatos/IATOS_PRIVE_CURATION_STANDARD.md`.
- No hay convenios con ningún lugar: un archivo de curaduría nunca crea etiquetas de partner ni
  beneficios exclusivos.
