// El orden de lugares de emergencia vive en _shared/places-rank.ts para que también lo use el Operador IATOS
// (_shared/operador/runtime.ts) sin importar archivos de otra función (cada función se empaqueta sola).
export * from "../_shared/places-rank.ts";
