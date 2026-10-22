// Números de emergencia para la pantalla SOS.
//
// Por qué: antes cualquier país fuera de la tabla (Canadá, Chile, "USA", "Japan"…)
// mostraba 112 como si fuera un hecho. Ahora:
//  - la búsqueda usa alias en español/inglés y códigos ISO (sin acentos, por palabra),
//  - si el país no está en la lista devolvemos `verified: false` y la UI lo dice claro.
// La tabla es la misma que ya tenía la app; no inventamos números nuevos.

export interface EmergencySet {
  policia: string;
  ambulancia: string;
  bomberos: string;
}

export interface EmergencyLookup {
  verified: boolean;
  country: string | null;
  numbers: EmergencySet | null;
}

const TABLE: Array<{ country: string; aliases: string[]; numbers: EmergencySet }> = [
  { country: "México", aliases: ["mexico", "mx", "mex"], numbers: { policia: "911", ambulancia: "911", bomberos: "911" } },
  { country: "Estados Unidos", aliases: ["estados unidos", "ee uu", "eeuu", "eua", "usa", "us", "united states", "estados unidos de america"], numbers: { policia: "911", ambulancia: "911", bomberos: "911" } },
  { country: "España", aliases: ["espana", "spain", "es"], numbers: { policia: "112", ambulancia: "112", bomberos: "112" } },
  { country: "Francia", aliases: ["francia", "france", "fr"], numbers: { policia: "17", ambulancia: "15", bomberos: "18" } },
  { country: "Italia", aliases: ["italia", "italy", "it"], numbers: { policia: "113", ambulancia: "118", bomberos: "115" } },
  { country: "Reino Unido", aliases: ["reino unido", "united kingdom", "uk", "gb", "inglaterra", "england", "escocia", "scotland", "gales", "wales"], numbers: { policia: "999", ambulancia: "999", bomberos: "999" } },
  { country: "Japón", aliases: ["japon", "japan", "jp"], numbers: { policia: "110", ambulancia: "119", bomberos: "119" } },
  { country: "Grecia", aliases: ["grecia", "greece", "gr"], numbers: { policia: "100", ambulancia: "166", bomberos: "199" } },
  { country: "Tailandia", aliases: ["tailandia", "thailand", "th"], numbers: { policia: "191", ambulancia: "1669", bomberos: "199" } },
  { country: "Indonesia", aliases: ["indonesia", "id", "bali"], numbers: { policia: "110", ambulancia: "118", bomberos: "113" } },
  { country: "Brasil", aliases: ["brasil", "brazil", "br"], numbers: { policia: "190", ambulancia: "192", bomberos: "193" } },
  { country: "Argentina", aliases: ["argentina", "ar"], numbers: { policia: "911", ambulancia: "107", bomberos: "100" } },
  { country: "Colombia", aliases: ["colombia", "co"], numbers: { policia: "123", ambulancia: "125", bomberos: "119" } },
  { country: "Perú", aliases: ["peru", "pe"], numbers: { policia: "105", ambulancia: "106", bomberos: "116" } },
  { country: "Marruecos", aliases: ["marruecos", "morocco", "ma"], numbers: { policia: "19", ambulancia: "15", bomberos: "15" } },
  { country: "Turquía", aliases: ["turquia", "turkey", "turkiye", "tr"], numbers: { policia: "155", ambulancia: "112", bomberos: "110" } },
];

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export function getEmergency(pais?: string | null): EmergencyLookup {
  if (!pais || !pais.trim()) return { verified: false, country: null, numbers: null };
  // "Roma, Italia" / "Italia / Grecia": probamos el texto completo y cada parte.
  const parts = [pais, ...pais.split(/[,/|·;()-]/)].map(norm).filter(Boolean);
  for (const row of TABLE) {
    if (parts.some((p) => row.aliases.includes(p) || norm(row.country) === p)) {
      return { verified: true, country: row.country, numbers: row.numbers };
    }
  }
  return { verified: false, country: null, numbers: null };
}

export const UNKNOWN_EMERGENCY_TEXT =
  "Número no confirmado para este país; en la mayoría de Europa es 112, en EE. UU. 911.";

export const EMERGENCY_SOURCE_NOTE =
  "Fuente: lista interna de IATOS con los números oficiales de cada país. Confírmalo al llegar con tu hotel o el consulado de México (SRE).";

export const UNKNOWN_EMERGENCY_SOURCE_NOTE =
  "No tenemos este país en nuestra lista. Confirma el número local con tu hotel, la oficina de turismo o el consulado de México (SRE).";
