// Números de emergencia para la pantalla SOS.
//
// Por qué: antes cualquier país fuera de la tabla (Canadá, Chile, "USA", "Japan"…)
// mostraba 112 como si fuera un hecho. Ahora:
//  - la búsqueda usa alias en español/inglés y códigos ISO (sin acentos, por palabra),
//  - si el país no está en la lista devolvemos `verified: false` y la UI lo dice claro.
// La tabla es la misma que ya tenía la app; no inventamos números nuevos.

export { getEmergency, type EmergencyLookup, type EmergencySet } from "../../supabase/functions/_shared/emergencyNumbers.ts";

export const UNKNOWN_EMERGENCY_TEXT =
  "Número no confirmado para este país; en la mayoría de Europa es 112, en EE. UU. 911.";

export const EMERGENCY_SOURCE_NOTE =
  "Fuente: lista interna de IATOS con los números oficiales de cada país. Confírmalo al llegar con tu hotel o el consulado de México (SRE).";

export const UNKNOWN_EMERGENCY_SOURCE_NOTE =
  "No tenemos este país en nuestra lista. Confirma el número local con tu hotel, la oficina de turismo o el consulado de México (SRE).";
