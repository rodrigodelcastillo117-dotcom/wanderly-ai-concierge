// La búsqueda de vuelos vive en _shared/flight-search.ts para que también la use el Operador IATOS
// (_shared/operador/runtime.ts) sin importar archivos de otra función (cada función se empaqueta sola).
export * from "../_shared/flight-search.ts";
