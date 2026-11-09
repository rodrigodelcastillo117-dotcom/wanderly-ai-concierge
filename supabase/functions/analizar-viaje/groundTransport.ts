// Movido a _shared/groundTransport.ts (9-nov-2026): lo usa también _shared/llegadaTierra.ts (logistics-plan) y una
// función no puede importar archivos de la carpeta de otra. Este archivo solo lo re-exporta.
export * from "../_shared/groundTransport.ts";
