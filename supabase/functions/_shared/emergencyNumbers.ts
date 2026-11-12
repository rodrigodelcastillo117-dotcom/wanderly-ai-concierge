// Números de emergencia por país (lista cerrada: fuera de ella no se da ningún número como dato).
// Compartido por la app (pantalla SOS, src/lib/emergencyNumbers.ts) e Iato (concierge-chat/planner.ts).
// Puro: sin Deno ni navegador.

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
  // Unión Europea: el 112 es el número único de emergencias en todos los Estados miembros (Directiva (UE) 2018/1972, art. 109).
  { country: "Portugal", aliases: ["portugal", "pt"], numbers: { policia: "112", ambulancia: "112", bomberos: "112" } },
  { country: "Alemania", aliases: ["alemania", "germany", "deutschland", "de"], numbers: { policia: "112", ambulancia: "112", bomberos: "112" } },
  { country: "Países Bajos", aliases: ["paises bajos", "holanda", "netherlands", "nl"], numbers: { policia: "112", ambulancia: "112", bomberos: "112" } },
  { country: "Austria", aliases: ["austria", "at"], numbers: { policia: "112", ambulancia: "112", bomberos: "112" } },
  { country: "Hungría", aliases: ["hungria", "hungary", "hu"], numbers: { policia: "112", ambulancia: "112", bomberos: "112" } },
  { country: "República Checa", aliases: ["republica checa", "chequia", "czechia", "czech republic", "cz"], numbers: { policia: "112", ambulancia: "112", bomberos: "112" } },
  { country: "Bélgica", aliases: ["belgica", "belgium", "be"], numbers: { policia: "112", ambulancia: "112", bomberos: "112" } },
  { country: "Irlanda", aliases: ["irlanda", "ireland", "ie"], numbers: { policia: "112", ambulancia: "112", bomberos: "112" } },
  { country: "Croacia", aliases: ["croacia", "croatia", "hr"], numbers: { policia: "112", ambulancia: "112", bomberos: "112" } },
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

