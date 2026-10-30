// Requisitos de entrada con pasaporte MEXICANO (reglas revisadas en sitios oficiales) y nombres de países.
// Puro (sin Deno ni React): lo usan la Bóveda de la app (src/lib/boveda/alerts.ts) y la vigilancia proactiva del
// servidor (_shared/vigilancia/avisos.ts), para que las dos digan exactamente lo mismo. Movido tal cual desde
// src/lib/boveda/alerts.ts (30-oct-2026); nada de esto sustituye la consulta oficial: los requisitos cambian.

export type EntryLevel = "critica" | "aviso" | "info";

/** Países con regla curada para pasaporte mexicano + Schengen. */
export const ENTRY_RULES_MX: Record<string, { level: EntryLevel; needs: "visa" | "eta_o_visa" | "eta" | null; title: string; detail: string; sourceUrl: string; sourceLabel: string }> = {
  US: {
    level: "critica", needs: "visa", title: "EUA pide visa con pasaporte mexicano",
    detail: "No vemos una visa de EUA vigente para las fechas de tu viaje en tus documentos. Si ya la tienes, agrégala.",
    sourceUrl: "https://travel.state.gov/content/travel/en/us-visas/tourism-visit/visitor.html", sourceLabel: "travel.state.gov",
  },
  CA: {
    level: "aviso", needs: "eta_o_visa", title: "Canadá: eTA o visa según tu caso",
    detail: "Con pasaporte mexicano y llegando en avión, pides eTA si tienes visa de EUA vigente o tuviste visa canadiense en los últimos 10 años; si no, necesitas visa de visitante (también por tierra o crucero).",
    sourceUrl: "https://www.canada.ca/en/immigration-refugees-citizenship/campaigns/eta-work-visa-mexico-es.html", sourceLabel: "canada.ca",
  },
  GB: {
    level: "aviso", needs: "eta", title: "Reino Unido pide ETA",
    detail: "Con pasaporte mexicano necesitas una Autorización Electrónica de Viaje (ETA) si no tienes visa británica; tramítala con el mismo pasaporte con el que viajarás.",
    sourceUrl: "https://www.gov.uk/guidance/check-when-you-can-get-an-electronic-travel-authorisation-eta", sourceLabel: "gov.uk",
  },
  SCHENGEN: {
    level: "info", needs: null, title: "Espacio Schengen sin visa para estancias cortas",
    detail: "Con pasaporte mexicano no necesitas visa para turismo de hasta 90 días en 180. Tu entrada se registra en el sistema EES; revisa si ya aplica ETIAS antes de volar.",
    sourceUrl: "https://travel-europe.europa.eu/", sourceLabel: "travel-europe.europa.eu",
  },
  JP: {
    level: "info", needs: null, title: "Japón sin visa hasta 90 días",
    detail: "Con pasaporte mexicano entras sin visa para turismo de hasta 90 días; lleva boleto de salida.",
    sourceUrl: "https://www.mofa.go.jp/j_info/visit/visa/short/novisa.html", sourceLabel: "mofa.go.jp",
  },
};

export const SCHENGEN = new Set(["AT", "BE", "BG", "CH", "CZ", "DE", "DK", "EE", "ES", "FI", "FR", "GR", "HR", "HU", "IS", "IT", "LI", "LT", "LU", "LV", "MT", "NL", "NO", "PL", "PT", "RO", "SE", "SI", "SK"]);

export const COUNTRY_NAME: Record<string, string> = {
  MX: "México", US: "EUA", CA: "Canadá", GB: "Reino Unido", JP: "Japón", EU: "Espacio Schengen",
  ES: "España", FR: "Francia", IT: "Italia", DE: "Alemania", PT: "Portugal", GR: "Grecia", NL: "Países Bajos",
  BE: "Bélgica", CH: "Suiza", AT: "Austria", CZ: "República Checa", HU: "Hungría", PL: "Polonia", HR: "Croacia",
  DK: "Dinamarca", SE: "Suecia", NO: "Noruega", FI: "Finlandia", IS: "Islandia", MT: "Malta", LU: "Luxemburgo",
  SI: "Eslovenia", SK: "Eslovaquia", EE: "Estonia", LV: "Letonia", LT: "Lituania", LI: "Liechtenstein", BG: "Bulgaria", RO: "Rumania",
  IE: "Irlanda", AR: "Argentina", BR: "Brasil", CO: "Colombia", CL: "Chile", PE: "Perú", CR: "Costa Rica", CU: "Cuba",
  DO: "República Dominicana", GT: "Guatemala", PA: "Panamá", CN: "China", KR: "Corea del Sur", IN: "India", AU: "Australia",
  NZ: "Nueva Zelanda", AE: "Emiratos Árabes Unidos", TR: "Turquía", EG: "Egipto", MA: "Marruecos", ZA: "Sudáfrica",
  TH: "Tailandia", SG: "Singapur", IL: "Israel",
};

// Nombres de país y destinos frecuentes → ISO 3166-1 alfa-2. Sin coincidencia = país desconocido.
const ALIASES: Record<string, readonly string[]> = {
  MX: ["mexico", "cdmx", "ciudad de mexico", "cancun", "tulum", "playa del carmen", "riviera maya", "los cabos", "cabo san lucas", "puerto vallarta",
    "oaxaca", "puebla", "guadalajara", "monterrey", "merida", "san miguel de allende", "queretaro", "acapulco", "huatulco", "mazatlan", "chiapas",
    "valle de guadalupe", "holbox", "bacalar", "zihuatanejo", "ixtapa", "guanajuato", "morelia", "veracruz", "nayarit", "sayulita", "punta mita"],
  US: ["estados unidos", "estados unidos de america", "eua", "ee uu", "eeuu", "usa", "united states", "nueva york", "new york", "miami", "orlando",
    "los angeles", "las vegas", "san francisco", "chicago", "houston", "dallas", "san antonio", "austin", "boston", "washington", "seattle",
    "san diego", "hawai", "hawaii", "honolulu", "maui", "phoenix", "atlanta", "nashville", "nueva orleans", "new orleans", "filadelfia", "aspen", "vail", "napa"],
  CA: ["canada", "toronto", "vancouver", "montreal", "quebec", "calgary", "banff", "ottawa", "whistler"],
  GB: ["reino unido", "inglaterra", "united kingdom", "gran bretana", "escocia", "gales", "londres", "london", "edimburgo", "manchester", "liverpool"],
  JP: ["japon", "japan", "tokio", "tokyo", "kioto", "kyoto", "osaka", "hokkaido", "okinawa"],
  ES: ["espana", "spain", "madrid", "barcelona", "sevilla", "valencia", "ibiza", "mallorca", "bilbao", "malaga", "granada", "san sebastian", "marbella"],
  FR: ["francia", "france", "paris", "niza", "nice", "lyon", "marsella", "burdeos", "provenza", "cannes", "saint tropez"],
  IT: ["italia", "italy", "roma", "rome", "milan", "florencia", "venecia", "napoles", "toscana", "amalfi", "capri", "sicilia", "cerdena", "lago de como", "positano"],
  DE: ["alemania", "germany", "berlin", "munich", "frankfurt", "hamburgo"],
  PT: ["portugal", "lisboa", "oporto", "algarve", "madeira", "azores"],
  GR: ["grecia", "greece", "atenas", "santorini", "mykonos", "creta"],
  NL: ["paises bajos", "holanda", "amsterdam"],
  BE: ["belgica", "bruselas", "brujas"],
  CH: ["suiza", "zurich", "ginebra", "zermatt", "st moritz"],
  AT: ["austria", "viena", "salzburgo"],
  CZ: ["republica checa", "chequia", "praga"],
  HU: ["hungria", "budapest"],
  PL: ["polonia", "cracovia", "varsovia"],
  HR: ["croacia", "dubrovnik", "split", "zagreb"],
  DK: ["dinamarca", "copenhague"],
  SE: ["suecia", "estocolmo"],
  NO: ["noruega", "oslo"],
  FI: ["finlandia", "helsinki", "laponia"],
  IS: ["islandia", "reikiavik", "reykjavik"],
  MT: ["malta"], LU: ["luxemburgo"], SI: ["eslovenia", "liubliana"], SK: ["eslovaquia"], EE: ["estonia"], LV: ["letonia"], LT: ["lituania"],
  LI: ["liechtenstein"], BG: ["bulgaria"], RO: ["rumania"],
};

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const ALIAS_LIST: Array<[string, string]> = Object.entries(ALIASES)
  .flatMap(([code, names]) => names.map((n) => [norm(n), code] as [string, string]))
  .sort((a, b) => b[0].length - a[0].length);

/** País (ISO2) de un texto libre como "Roma, Italia" o "Nueva York". null si no lo reconocemos. */
export function countryFromText(text: string | null | undefined): string | null {
  const t = norm(text ?? "");
  if (!t) return null;
  if (/^[a-z]{2}$/.test(t) && COUNTRY_NAME[t.toUpperCase()]) return t.toUpperCase();
  const padded = ` ${t} `;
  for (const [alias, code] of ALIAS_LIST) if (padded.includes(` ${alias} `)) return code;
  return null;
}
