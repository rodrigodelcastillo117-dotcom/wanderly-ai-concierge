/** Lo que acompaña a un destino y no es un lugar: tipo de viaje, temporada, ocasión, con quién ("Cancún, todo
 *  incluido", "Madrid, en Semana Santa", "Oaxaca, con niños"). Antes se leía como otro lugar por confirmar y el
 *  botón «Siguiente» quedaba gris sin pregunta visible (aviso de Lovable, 4-nov-2026). "Isla de Pascua" sí es lugar. */
export const TRIP_EXTRAS = new RegExp(
  "(?<![a-záéíóúñ])(?:(?:en|para|de|por|durante|esta|este|la|el|las|los|con|sin)\\s+)?(?:" + [
    "todo\\s+incluido", "all[\\s-]+inclusive",
    "semana\\s+santa", "semana\\s+de\\s+pascua", "(?<!isla\\s+de\\s+)pascuas?", "(?<!barra\\s+de\\s+)navidad(?:es)?", "nochebuena", "a[nñ]o\\s+nuevo", "fin\\s+de\\s+a[nñ]o",
    "fiestas\\s+patrias", "d[ií]a\\s+de\\s+muertos", "verano", "invierno", "primavera", "oto[nñ]o", "temporada\\s+(?:alta|baja)",
    "luna\\s+de\\s+miel", "aniversario", "cumplea[nñ]os", "despedida\\s+de\\s+solter[oa]s?",
    "(?:los\\s+|mis\\s+|nuestros\\s+)?(?:ni[nñ]os|ni[nñ]as|hijos|hijas|beb[eé]s?|peques|abuelos|pap[aá]s)", "en\\s+familia",
    "negocios", "trabajo", "lujo", "econ[oó]mico", "barato", "mochilero", "rom[aá]ntico",
  ].join("|") + ")(?![a-záéíóúñ])",
  "gi",
);

/** La frase sin lo que no es lugar (cada extra deja una coma, para que no pegue dos lugares). */
export const stripTripExtras = (text: string): string => String(text ?? "").replace(TRIP_EXTRAS, " , ");
