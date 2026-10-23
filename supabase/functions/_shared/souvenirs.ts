// Recuerdos de viaje del avatar ("souvenirs"): cada viaje terminado o importado agrega un detalle
// discreto del destino al avatar (CDMX → pin del Ángel, Nueva York → llavero de taxi amarillo…).
// Sin dependencias de Deno: lo usan generate-avatar, avatar-evolve y las pruebas de Vitest.
//
// Reglas de diseño (para que el avatar siga elegante y la cara no cambie):
// - Nada en la cabeza ni en la cara (sin sombreros, boinas ni lentes): cambian el pelo y la
//   silueta, y el modelo tiende a redibujar el rostro. Solo pines, dijes, pulseras, pañuelos.
// - Cada recuerdo tiene un "lugar" en el atuendo (pin en la solapa, dije colgando de la correa,
//   algo en la muñeca o el cuello) para que tres a la vez no se encimen.
// - Máximo AVATAR_MAX_VISIBLE visibles; los demás quedan en la colección del perfil.

export const AVATAR_MAX_VISIBLE = 3;

export type SouvenirSlot = "pin" | "dije" | "accesorio";

export type Souvenir = {
  /** "ciudad:cdmx", "pais:FR" o "generico:viajero". Un recuerdo por llave en la colección. */
  key: string;
  /** Lugar que lo desbloquea, en español: "Ciudad de México", "Francia". */
  lugar: string;
  /** ISO 3166-1 alfa-2 del país, o null si no se reconoció. */
  pais: string | null;
  /** Nombre del detalle en español: "Pin del Ángel de la Independencia". */
  nombre: string;
  emoji: string;
  slot: SouvenirSlot;
  /** Descripción física del objeto, en inglés, para el modelo de imagen. */
  prompt: string;
};

type CityDef = {
  id: string;
  lugar: string;
  pais: string;
  aliases: string[];
  iata?: string[];
  nombre: string;
  emoji: string;
  slot: SouvenirSlot;
  prompt: string;
};

const pin = (what: string) => `a small, elegant enamel lapel pin with gold edges shaped like ${what}`;
const charm = (what: string) => `a tiny ${what} charm hanging from a slim leather strap or keyring`;

// Destinos más frecuentes de viajeros mexicanos (nacionales, EE. UU., Canadá, Europa, Latinoamérica,
// Asia y otros). Los alias van sin acentos ni mayúsculas (ver norm()).
const CITIES: CityDef[] = [
  // ── México ──
  { id: "cdmx", lugar: "Ciudad de México", pais: "MX", aliases: ["ciudad de mexico", "cdmx", "mexico city", "df", "distrito federal", "mexico df"], iata: ["MEX", "NLU"], nombre: "Pin del Ángel de la Independencia", emoji: "👼", slot: "pin", prompt: pin("the golden Angel of Independence statue on its column (Mexico City)") },
  { id: "cancun", lugar: "Cancún", pais: "MX", aliases: ["cancun"], iata: ["CUN"], nombre: "Pulsera turquesa del Caribe", emoji: "🐚", slot: "accesorio", prompt: "a thin woven turquoise-and-white bracelet with a tiny seashell charm, worn on the wrist" },
  { id: "tulum", lugar: "Tulum", pais: "MX", aliases: ["tulum"], iata: ["TQO"], nombre: "Dije de jade maya", emoji: "🌴", slot: "accesorio", prompt: "a small carved green jade pendant shaped like a Mayan pyramid on a thin black cord necklace" },
  { id: "playa-del-carmen", lugar: "Playa del Carmen", pais: "MX", aliases: ["playa del carmen", "riviera maya", "cozumel"], iata: ["CZM"], nombre: "Dije de tortuga marina", emoji: "🐢", slot: "dije", prompt: charm("silver sea turtle") },
  { id: "puerto-vallarta", lugar: "Puerto Vallarta", pais: "MX", aliases: ["puerto vallarta", "vallarta"], iata: ["PVR"], nombre: "Pin del caballito de mar del Malecón", emoji: "🌅", slot: "pin", prompt: pin("a seahorse over a sunset sea (Puerto Vallarta boardwalk)") },
  { id: "riviera-nayarit", lugar: "Riviera Nayarit", pais: "MX", aliases: ["sayulita", "punta mita", "nuevo vallarta", "riviera nayarit"], nombre: "Dije de tabla de surf huichol", emoji: "🏄", slot: "dije", prompt: charm("colorful Huichol beaded surfboard") },
  { id: "los-cabos", lugar: "Los Cabos", pais: "MX", aliases: ["los cabos", "cabo san lucas", "san jose del cabo", "cabo"], iata: ["SJD"], nombre: "Pin del Arco de Cabo San Lucas", emoji: "🌊", slot: "pin", prompt: pin("the rock arch of Cabo San Lucas over a deep blue sea") },
  { id: "oaxaca", lugar: "Oaxaca", pais: "MX", aliases: ["oaxaca", "oaxaca de juarez"], iata: ["OAX"], nombre: "Alebrije en miniatura", emoji: "🦎", slot: "dije", prompt: charm("hand-painted colorful Oaxacan alebrije") },
  { id: "huatulco", lugar: "Huatulco", pais: "MX", aliases: ["huatulco", "puerto escondido"], iata: ["HUX", "PXM"], nombre: "Pin de bahía con palmera", emoji: "🏝️", slot: "pin", prompt: pin("a small bay with a palm tree") },
  { id: "guadalajara", lugar: "Guadalajara", pais: "MX", aliases: ["guadalajara", "tlaquepaque", "zapopan"], iata: ["GDL"], nombre: "Pin de sombrero de charro", emoji: "🎺", slot: "pin", prompt: pin("a black-and-silver mariachi charro hat") },
  { id: "tequila", lugar: "Tequila", pais: "MX", aliases: ["tequila jalisco", "pueblo de tequila"], nombre: "Pin de agave azul", emoji: "🌵", slot: "pin", prompt: pin("a blue agave plant") },
  { id: "monterrey", lugar: "Monterrey", pais: "MX", aliases: ["monterrey", "san pedro garza garcia"], iata: ["MTY"], nombre: "Pin del Cerro de la Silla", emoji: "⛰️", slot: "pin", prompt: pin("the saddle-shaped Cerro de la Silla mountain") },
  { id: "merida", lugar: "Mérida", pais: "MX", aliases: ["merida", "yucatan", "valladolid yucatan", "izamal"], iata: ["MID"], nombre: "Pañuelo bordado yucateco", emoji: "🌺", slot: "accesorio", prompt: "a neatly folded white pocket square with colorful Yucatecan floral embroidery, in the chest pocket" },
  { id: "san-miguel", lugar: "San Miguel de Allende", pais: "MX", aliases: ["san miguel de allende", "san miguel allende"], nombre: "Pin de la Parroquia de San Miguel", emoji: "⛪", slot: "pin", prompt: pin("the pink neo-gothic Parroquia church of San Miguel de Allende") },
  { id: "guanajuato", lugar: "Guanajuato", pais: "MX", aliases: ["guanajuato"], iata: ["BJX"], nombre: "Dije de casitas de colores", emoji: "🏘️", slot: "dije", prompt: charm("enamel row of colorful hillside houses") },
  { id: "puebla", lugar: "Puebla", pais: "MX", aliases: ["puebla", "cholula", "atlixco"], iata: ["PBC"], nombre: "Dije de Talavera", emoji: "🏺", slot: "dije", prompt: charm("blue-and-white Talavera ceramic") },
  { id: "queretaro", lugar: "Querétaro", pais: "MX", aliases: ["queretaro", "bernal", "tequisquiapan"], iata: ["QRO"], nombre: "Pin del Acueducto", emoji: "🌉", slot: "pin", prompt: pin("the stone arches of the Queretaro aqueduct") },
  { id: "acapulco", lugar: "Acapulco", pais: "MX", aliases: ["acapulco"], iata: ["ACA"], nombre: "Pin del clavadista de La Quebrada", emoji: "🤿", slot: "pin", prompt: pin("a cliff diver mid-dive over the sea") },
  { id: "mazatlan", lugar: "Mazatlán", pais: "MX", aliases: ["mazatlan"], iata: ["MZT"], nombre: "Dije de pulmonía", emoji: "🚙", slot: "dije", prompt: charm("open-air white Mazatlan 'pulmonia' taxi") },
  { id: "bacalar", lugar: "Bacalar", pais: "MX", aliases: ["bacalar", "laguna de bacalar"], nombre: "Pulsera de los siete colores", emoji: "💎", slot: "accesorio", prompt: "a delicate bracelet of seven glass beads in seven shades of blue, worn on the wrist" },
  { id: "holbox", lugar: "Holbox", pais: "MX", aliases: ["holbox", "isla holbox", "isla mujeres"], nombre: "Dije de tiburón ballena", emoji: "🦈", slot: "dije", prompt: charm("spotted whale shark") },
  { id: "chiapas", lugar: "Chiapas", pais: "MX", aliases: ["san cristobal de las casas", "chiapas", "palenque", "tuxtla gutierrez"], iata: ["TGZ"], nombre: "Pulsera de textil chiapaneco", emoji: "🧶", slot: "accesorio", prompt: "a narrow hand-woven Chiapas textile bracelet in red, purple and gold, worn on the wrist" },
  { id: "valle-guadalupe", lugar: "Valle de Guadalupe", pais: "MX", aliases: ["valle de guadalupe", "ensenada"], nombre: "Pin de copa de vino", emoji: "🍷", slot: "pin", prompt: pin("a red wine glass with grape leaves") },
  // ── Estados Unidos y Canadá ──
  { id: "nueva-york", lugar: "Nueva York", pais: "US", aliases: ["nueva york", "new york", "nyc", "manhattan", "brooklyn", "new york city"], iata: ["JFK", "LGA", "EWR"], nombre: "Llavero de taxi amarillo", emoji: "🚕", slot: "dije", prompt: charm("yellow New York taxi cab") },
  { id: "los-angeles", lugar: "Los Ángeles", pais: "US", aliases: ["los angeles", "hollywood", "santa monica", "beverly hills"], iata: ["LAX"], nombre: "Pin de claqueta y palmera", emoji: "🎬", slot: "pin", prompt: pin("a film clapperboard with a palm tree") },
  { id: "las-vegas", lugar: "Las Vegas", pais: "US", aliases: ["las vegas", "vegas"], iata: ["LAS"], nombre: "Ficha de casino dorada", emoji: "🎰", slot: "pin", prompt: pin("a gold-and-black casino chip") },
  { id: "miami", lugar: "Miami", pais: "US", aliases: ["miami", "miami beach", "south beach"], iata: ["MIA"], nombre: "Pin de flamenco rosa", emoji: "🦩", slot: "pin", prompt: pin("a pink flamingo in art-deco style") },
  { id: "orlando", lugar: "Orlando", pais: "US", aliases: ["orlando", "kissimmee"], iata: ["MCO"], nombre: "Pin de castillo con fuegos artificiales", emoji: "🏰", slot: "pin", prompt: pin("a fairytale castle with tiny fireworks (generic, no brand)") },
  { id: "san-francisco", lugar: "San Francisco", pais: "US", aliases: ["san francisco"], iata: ["SFO"], nombre: "Pin del Golden Gate", emoji: "🌉", slot: "pin", prompt: pin("the red Golden Gate Bridge") },
  { id: "chicago", lugar: "Chicago", pais: "US", aliases: ["chicago"], iata: ["ORD", "MDW"], nombre: "Pin del Cloud Gate", emoji: "🫘", slot: "pin", prompt: pin("the mirrored Cloud Gate 'bean' sculpture") },
  { id: "houston", lugar: "Houston", pais: "US", aliases: ["houston"], iata: ["IAH", "HOU"], nombre: "Pin de cohete espacial", emoji: "🚀", slot: "pin", prompt: pin("a white space rocket") },
  { id: "san-antonio", lugar: "San Antonio", pais: "US", aliases: ["san antonio texas", "san antonio tx"], iata: ["SAT"], nombre: "Pin de la misión de El Álamo", emoji: "🤠", slot: "pin", prompt: pin("the stone facade of the Alamo mission") },
  { id: "dallas", lugar: "Dallas", pais: "US", aliases: ["dallas", "fort worth"], iata: ["DFW"], nombre: "Pin de estrella texana", emoji: "⭐", slot: "pin", prompt: pin("a lone silver Texas star") },
  { id: "san-diego", lugar: "San Diego", pais: "US", aliases: ["san diego", "la jolla"], iata: ["SAN"], nombre: "Dije de lobo marino", emoji: "🦭", slot: "dije", prompt: charm("silver sea lion") },
  { id: "hawai", lugar: "Hawái", pais: "US", aliases: ["hawai", "hawaii", "honolulu", "maui", "oahu"], iata: ["HNL", "OGG"], nombre: "Collar de flores lei", emoji: "🌺", slot: "accesorio", prompt: "a delicate lei of small white plumeria flowers resting around the neck" },
  { id: "washington", lugar: "Washington D. C.", pais: "US", aliases: ["washington dc", "washington d c", "washington"], iata: ["IAD", "DCA"], nombre: "Pin del Capitolio", emoji: "🏛️", slot: "pin", prompt: pin("the white domed US Capitol building") },
  { id: "toronto", lugar: "Toronto", pais: "CA", aliases: ["toronto", "niagara", "cataratas del niagara"], iata: ["YYZ"], nombre: "Pin de la CN Tower", emoji: "🗼", slot: "pin", prompt: pin("the slender CN Tower") },
  { id: "vancouver", lugar: "Vancouver", pais: "CA", aliases: ["vancouver", "whistler", "banff"], iata: ["YVR", "YYC"], nombre: "Pin de hoja de maple y montaña", emoji: "🍁", slot: "pin", prompt: pin("a red maple leaf in front of a snowy mountain") },
  { id: "montreal", lugar: "Montreal", pais: "CA", aliases: ["montreal", "quebec city", "ciudad de quebec"], iata: ["YUL", "YQB"], nombre: "Pin de farol de calle antigua", emoji: "🏮", slot: "pin", prompt: pin("an old-town wrought-iron street lantern") },
  // ── Europa ──
  { id: "madrid", lugar: "Madrid", pais: "ES", aliases: ["madrid", "toledo", "segovia"], iata: ["MAD"], nombre: "Abanico español en miniatura", emoji: "🪭", slot: "dije", prompt: charm("folded red-and-gold Spanish hand fan") },
  { id: "barcelona", lugar: "Barcelona", pais: "ES", aliases: ["barcelona", "costa brava"], iata: ["BCN"], nombre: "Pin de lagartija de mosaico", emoji: "🦎", slot: "pin", prompt: pin("a colorful broken-tile mosaic lizard in Gaudi style") },
  { id: "sevilla", lugar: "Sevilla", pais: "ES", aliases: ["sevilla", "seville", "granada", "cordoba espana", "malaga", "andalucia"], iata: ["SVQ", "AGP", "GRX"], nombre: "Pin de azulejo andaluz", emoji: "💠", slot: "pin", prompt: pin("a square blue-and-yellow Andalusian ceramic tile") },
  { id: "paris", lugar: "París", pais: "FR", aliases: ["paris"], iata: ["CDG", "ORY"], nombre: "Pin de la Torre Eiffel", emoji: "🗼", slot: "pin", prompt: pin("the Eiffel Tower") },
  { id: "roma", lugar: "Roma", pais: "IT", aliases: ["roma", "rome", "vaticano", "vatican"], iata: ["FCO", "CIA"], nombre: "Pin del Coliseo", emoji: "🏛️", slot: "pin", prompt: pin("the Roman Colosseum") },
  { id: "florencia", lugar: "Florencia", pais: "IT", aliases: ["florencia", "florence", "firenze", "toscana", "tuscany", "siena", "pisa"], iata: ["FLR", "PSA"], nombre: "Dije de lirio florentino", emoji: "⚜️", slot: "dije", prompt: charm("golden Florentine fleur-de-lis (giglio)") },
  { id: "venecia", lugar: "Venecia", pais: "IT", aliases: ["venecia", "venice", "venezia"], iata: ["VCE"], nombre: "Antifaz veneciano en miniatura", emoji: "🎭", slot: "dije", prompt: charm("gold-and-black Venetian carnival mask") },
  { id: "milan", lugar: "Milán", pais: "IT", aliases: ["milan", "milano", "lago de como", "lake como"], iata: ["MXP", "LIN"], nombre: "Pin del Duomo de Milán", emoji: "⛪", slot: "pin", prompt: pin("the white gothic Milan Cathedral") },
  { id: "amalfi", lugar: "Costa Amalfitana", pais: "IT", aliases: ["amalfi", "costa amalfitana", "positano", "capri", "napoles", "naples", "sorrento"], iata: ["NAP"], nombre: "Pin de limón de Amalfi", emoji: "🍋", slot: "pin", prompt: pin("a yellow Amalfi lemon with two green leaves") },
  { id: "londres", lugar: "Londres", pais: "GB", aliases: ["londres", "london"], iata: ["LHR", "LGW", "STN", "LCY"], nombre: "Llavero de autobús rojo de dos pisos", emoji: "🚌", slot: "dije", prompt: charm("red double-decker London bus") },
  { id: "amsterdam", lugar: "Ámsterdam", pais: "NL", aliases: ["amsterdam"], iata: ["AMS"], nombre: "Pin de tulipán y bicicleta", emoji: "🌷", slot: "pin", prompt: pin("a red tulip next to a tiny bicycle") },
  { id: "berlin", lugar: "Berlín", pais: "DE", aliases: ["berlin"], iata: ["BER"], nombre: "Pin de la Puerta de Brandeburgo", emoji: "🏛️", slot: "pin", prompt: pin("the Brandenburg Gate") },
  { id: "munich", lugar: "Múnich", pais: "DE", aliases: ["munich", "muenchen", "baviera", "bavaria"], iata: ["MUC"], nombre: "Pin de pretzel", emoji: "🥨", slot: "pin", prompt: pin("a golden Bavarian pretzel") },
  { id: "lisboa", lugar: "Lisboa", pais: "PT", aliases: ["lisboa", "lisbon", "sintra", "oporto", "porto"], iata: ["LIS", "OPO"], nombre: "Pin de tranvía amarillo", emoji: "🚋", slot: "pin", prompt: pin("a yellow Lisbon tram") },
  { id: "atenas", lugar: "Atenas", pais: "GR", aliases: ["atenas", "athens"], iata: ["ATH"], nombre: "Pin del Partenón", emoji: "🏛️", slot: "pin", prompt: pin("the Parthenon temple") },
  { id: "santorini", lugar: "Islas griegas", pais: "GR", aliases: ["santorini", "mykonos", "mikonos", "islas griegas", "creta", "crete"], iata: ["JTR", "JMK", "HER"], nombre: "Pin de cúpula azul", emoji: "🔵", slot: "pin", prompt: pin("a whitewashed chapel with a blue dome") },
  { id: "praga", lugar: "Praga", pais: "CZ", aliases: ["praga", "prague", "praha"], iata: ["PRG"], nombre: "Pin del reloj astronómico", emoji: "🕰️", slot: "pin", prompt: pin("the Prague astronomical clock") },
  { id: "viena", lugar: "Viena", pais: "AT", aliases: ["viena", "vienna", "wien", "salzburgo", "salzburg"], iata: ["VIE", "SZG"], nombre: "Pin de violín vienés", emoji: "🎻", slot: "pin", prompt: pin("a small violin with a musical note") },
  { id: "budapest", lugar: "Budapest", pais: "HU", aliases: ["budapest"], iata: ["BUD"], nombre: "Pin del Parlamento de Budapest", emoji: "🏰", slot: "pin", prompt: pin("the neo-gothic Hungarian Parliament on the Danube") },
  { id: "estambul", lugar: "Estambul", pais: "TR", aliases: ["estambul", "istanbul", "capadocia", "cappadocia"], iata: ["IST", "SAW"], nombre: "Dije de ojo turco", emoji: "🧿", slot: "dije", prompt: charm("blue glass Turkish nazar evil-eye") },
  { id: "dublin", lugar: "Dublín", pais: "IE", aliases: ["dublin", "irlanda", "ireland"], iata: ["DUB"], nombre: "Pin de trébol", emoji: "☘️", slot: "pin", prompt: pin("a green shamrock") },
  { id: "islandia", lugar: "Islandia", pais: "IS", aliases: ["reikiavik", "reykjavik", "islandia", "iceland"], iata: ["KEF"], nombre: "Pin de aurora boreal", emoji: "🌌", slot: "pin", prompt: pin("green northern lights over a snowy peak") },
  // ── Latinoamérica y el Caribe ──
  { id: "bogota", lugar: "Bogotá", pais: "CO", aliases: ["bogota"], iata: ["BOG"], nombre: "Pin de esmeralda colombiana", emoji: "💚", slot: "pin", prompt: pin("a faceted green emerald") },
  { id: "cartagena", lugar: "Cartagena", pais: "CO", aliases: ["cartagena", "cartagena de indias"], iata: ["CTG"], nombre: "Pin de balcón con buganvilias", emoji: "🌸", slot: "pin", prompt: pin("a colonial balcony covered in pink bougainvillea") },
  { id: "medellin", lugar: "Medellín", pais: "CO", aliases: ["medellin", "guatape"], iata: ["MDE"], nombre: "Pin de orquídea", emoji: "🌺", slot: "pin", prompt: pin("a purple orchid flower") },
  { id: "cusco", lugar: "Cusco y Machu Picchu", pais: "PE", aliases: ["cusco", "cuzco", "machu picchu", "valle sagrado"], iata: ["CUZ"], nombre: "Pin de Machu Picchu", emoji: "⛰️", slot: "pin", prompt: pin("the Machu Picchu ruins with Huayna Picchu peak") },
  { id: "lima", lugar: "Lima", pais: "PE", aliases: ["lima"], iata: ["LIM"], nombre: "Pulsera de textil andino", emoji: "🧶", slot: "accesorio", prompt: "a narrow woven Andean textile bracelet in red, orange and gold, worn on the wrist" },
  { id: "buenos-aires", lugar: "Buenos Aires", pais: "AR", aliases: ["buenos aires"], iata: ["EZE", "AEP"], nombre: "Pin de bandoneón de tango", emoji: "🪗", slot: "pin", prompt: pin("a tango bandoneon accordion") },
  { id: "patagonia", lugar: "Patagonia", pais: "AR", aliases: ["patagonia", "el calafate", "bariloche", "ushuaia", "torres del paine"], iata: ["FTE", "BRC", "USH"], nombre: "Pin de glaciar", emoji: "🧊", slot: "pin", prompt: pin("an icy blue glacier under a mountain") },
  { id: "santiago", lugar: "Santiago de Chile", pais: "CL", aliases: ["santiago de chile", "valparaiso", "vina del mar"], iata: ["SCL"], nombre: "Pin de la cordillera de los Andes", emoji: "🏔️", slot: "pin", prompt: pin("the snowy Andes mountain range") },
  { id: "rio", lugar: "Río de Janeiro", pais: "BR", aliases: ["rio de janeiro", "rio"], iata: ["GIG", "SDU"], nombre: "Pin del Cristo Redentor", emoji: "🙌", slot: "pin", prompt: pin("the Christ the Redeemer statue on a green hill") },
  { id: "la-habana", lugar: "La Habana", pais: "CU", aliases: ["la habana", "habana", "havana", "varadero"], iata: ["HAV", "VRA"], nombre: "Llavero de auto clásico", emoji: "🚗", slot: "dije", prompt: charm("turquoise 1950s classic convertible car") },
  { id: "punta-cana", lugar: "Punta Cana", pais: "DO", aliases: ["punta cana", "santo domingo", "republica dominicana", "la romana"], iata: ["PUJ", "SDQ"], nombre: "Pin de palmera caribeña", emoji: "🌴", slot: "pin", prompt: pin("a leaning coconut palm over turquoise water") },
  { id: "costa-rica", lugar: "Costa Rica", pais: "CR", aliases: ["san jose costa rica", "costa rica", "guanacaste", "arenal"], iata: ["SJO", "LIR"], nombre: "Pin de tucán", emoji: "🦜", slot: "pin", prompt: pin("a toucan with a bright orange beak") },
  { id: "panama", lugar: "Panamá", pais: "PA", aliases: ["ciudad de panama", "panama city", "bocas del toro"], iata: ["PTY"], nombre: "Pin de barco en el Canal", emoji: "🚢", slot: "pin", prompt: pin("a ship passing through canal locks") },
  { id: "galapagos", lugar: "Galápagos", pais: "EC", aliases: ["galapagos", "islas galapagos"], iata: ["GPS"], nombre: "Dije de tortuga gigante", emoji: "🐢", slot: "dije", prompt: charm("bronze giant Galapagos tortoise") },
  // ── Asia, Medio Oriente, África y Oceanía ──
  { id: "tokio", lugar: "Tokio", pais: "JP", aliases: ["tokio", "tokyo"], iata: ["HND", "NRT"], nombre: "Omamori de Tokio", emoji: "⛩️", slot: "dije", prompt: charm("red silk Japanese omamori amulet with gold embroidery") },
  { id: "kioto", lugar: "Kioto", pais: "JP", aliases: ["kioto", "kyoto", "nara"], nombre: "Pin de torii rojo", emoji: "⛩️", slot: "pin", prompt: pin("a red Japanese torii gate") },
  { id: "osaka", lugar: "Osaka", pais: "JP", aliases: ["osaka"], iata: ["KIX", "ITM"], nombre: "Pin de gato de la suerte", emoji: "🐱", slot: "pin", prompt: pin("a white maneki-neko lucky cat") },
  { id: "seul", lugar: "Seúl", pais: "KR", aliases: ["seul", "seoul", "busan"], iata: ["ICN", "GMP", "PUS"], nombre: "Dije de nudo coreano", emoji: "🎐", slot: "dije", prompt: charm("colorful Korean maedeup silk knot") },
  { id: "bangkok", lugar: "Bangkok", pais: "TH", aliases: ["bangkok", "phuket", "chiang mai", "tailandia", "thailand"], iata: ["BKK", "DMK", "HKT", "CNX"], nombre: "Pin de tuk-tuk", emoji: "🛺", slot: "pin", prompt: pin("a colorful Thai tuk-tuk") },
  { id: "bali", lugar: "Bali", pais: "ID", aliases: ["bali", "ubud", "seminyak"], iata: ["DPS"], nombre: "Pulsera de flor de frangipani", emoji: "🌼", slot: "accesorio", prompt: "a thin bracelet with a tiny white-and-yellow frangipani flower, worn on the wrist" },
  { id: "dubai", lugar: "Dubái", pais: "AE", aliases: ["dubai", "abu dhabi"], iata: ["DXB", "AUH"], nombre: "Pin del Burj Khalifa", emoji: "🏙️", slot: "pin", prompt: pin("the Burj Khalifa skyscraper") },
  { id: "singapur", lugar: "Singapur", pais: "SG", aliases: ["singapur", "singapore"], iata: ["SIN"], nombre: "Pin del Merlión", emoji: "🦁", slot: "pin", prompt: pin("the white Merlion statue") },
  { id: "india", lugar: "India", pais: "IN", aliases: ["nueva delhi", "new delhi", "agra", "jaipur", "mumbai"], iata: ["DEL", "BOM", "JAI"], nombre: "Pin del Taj Mahal", emoji: "🕌", slot: "pin", prompt: pin("the white marble Taj Mahal") },
  { id: "maldivas", lugar: "Maldivas", pais: "MV", aliases: ["maldivas", "maldives", "male"], iata: ["MLE"], nombre: "Dije de concha marina", emoji: "🐚", slot: "dije", prompt: charm("pearly white seashell") },
  { id: "el-cairo", lugar: "Egipto", pais: "EG", aliases: ["el cairo", "cairo", "giza", "luxor"], iata: ["CAI", "LXR"], nombre: "Dije de escarabajo egipcio", emoji: "🪲", slot: "dije", prompt: charm("turquoise-and-gold Egyptian scarab") },
  { id: "marrakech", lugar: "Marruecos", pais: "MA", aliases: ["marrakech", "marrakesh", "fez", "chefchaouen"], iata: ["RAK", "FEZ"], nombre: "Pin de farol marroquí", emoji: "🏮", slot: "pin", prompt: pin("a pierced brass Moroccan lantern") },
  { id: "sidney", lugar: "Sídney", pais: "AU", aliases: ["sidney", "sydney", "melbourne"], iata: ["SYD", "MEL"], nombre: "Pin de la Ópera de Sídney", emoji: "🎶", slot: "pin", prompt: pin("the Sydney Opera House sails") },
];

// Respaldo por país: colores de la bandera + un símbolo. [ISO2, nombre, nombre en inglés,
// alias extra, colores (inglés), símbolo (inglés), emoji].
type CountryRow = [string, string, string, string[], string, string, string];
const COUNTRIES: CountryRow[] = [
  ["MX", "México", "Mexico", ["mexico", "estados unidos mexicanos"], "green, white and red", "an eagle on a cactus", "🇲🇽"],
  ["US", "Estados Unidos", "the United States", ["estados unidos", "eeuu", "ee uu", "usa", "united states", "eua"], "red, white and blue", "a star", "🇺🇸"],
  ["CA", "Canadá", "Canada", ["canada"], "red and white", "a maple leaf", "🇨🇦"],
  ["ES", "España", "Spain", ["espana", "spain"], "red and yellow", "a castle", "🇪🇸"],
  ["FR", "Francia", "France", ["francia", "france"], "blue, white and red", "a fleur-de-lis", "🇫🇷"],
  ["IT", "Italia", "Italy", ["italia", "italy"], "green, white and red", "a Roman column", "🇮🇹"],
  ["GB", "Reino Unido", "the United Kingdom", ["reino unido", "inglaterra", "england", "united kingdom", "escocia", "scotland", "uk"], "red, white and blue", "a crown", "🇬🇧"],
  ["DE", "Alemania", "Germany", ["alemania", "germany"], "black, red and gold", "an oak leaf", "🇩🇪"],
  ["NL", "Países Bajos", "the Netherlands", ["paises bajos", "holanda", "netherlands", "holland"], "red, white and blue", "a windmill", "🇳🇱"],
  ["BE", "Bélgica", "Belgium", ["belgica", "belgium", "bruselas", "brujas", "brussels", "bruges"], "black, yellow and red", "a waffle", "🇧🇪"],
  ["CH", "Suiza", "Switzerland", ["suiza", "switzerland", "zurich", "ginebra", "geneva", "zermatt", "interlaken", "lucerna"], "red and white", "the Matterhorn peak", "🇨🇭"],
  ["AT", "Austria", "Austria", ["austria"], "red and white", "an edelweiss flower", "🇦🇹"],
  ["PT", "Portugal", "Portugal", ["portugal"], "green and red", "a rooster", "🇵🇹"],
  ["GR", "Grecia", "Greece", ["grecia", "greece"], "blue and white", "an olive branch", "🇬🇷"],
  ["CZ", "República Checa", "Czechia", ["republica checa", "chequia", "czech republic", "czechia"], "white, red and blue", "a castle tower", "🇨🇿"],
  ["HU", "Hungría", "Hungary", ["hungria", "hungary"], "red, white and green", "a paprika pepper", "🇭🇺"],
  ["PL", "Polonia", "Poland", ["polonia", "poland", "cracovia", "varsovia", "krakow", "warsaw"], "white and red", "an eagle", "🇵🇱"],
  ["HR", "Croacia", "Croatia", ["croacia", "croatia", "dubrovnik", "split"], "red, white and blue", "a checkerboard shield", "🇭🇷"],
  ["IE", "Irlanda", "Ireland", ["irlanda", "ireland"], "green, white and orange", "a harp", "🇮🇪"],
  ["IS", "Islandia", "Iceland", ["islandia", "iceland"], "blue, white and red", "a volcano", "🇮🇸"],
  ["NO", "Noruega", "Norway", ["noruega", "norway", "oslo", "fiordos", "tromso"], "red, white and blue", "a fjord", "🇳🇴"],
  ["SE", "Suecia", "Sweden", ["suecia", "sweden", "estocolmo", "stockholm"], "blue and yellow", "a Dala horse", "🇸🇪"],
  ["DK", "Dinamarca", "Denmark", ["dinamarca", "denmark", "copenhague", "copenhagen"], "red and white", "a little mermaid", "🇩🇰"],
  ["FI", "Finlandia", "Finland", ["finlandia", "finland", "helsinki", "laponia", "lapland"], "white and blue", "a reindeer", "🇫🇮"],
  ["TR", "Turquía", "Turkey", ["turquia", "turkey", "turkiye"], "red and white", "a crescent and star", "🇹🇷"],
  ["RU", "Rusia", "Russia", ["rusia", "russia", "moscu", "moscow"], "white, blue and red", "an onion dome", "🇷🇺"],
  ["MA", "Marruecos", "Morocco", ["marruecos", "morocco"], "red and green", "a star", "🇲🇦"],
  ["EG", "Egipto", "Egypt", ["egipto", "egypt"], "red, white and black", "a pyramid", "🇪🇬"],
  ["ZA", "Sudáfrica", "South Africa", ["sudafrica", "south africa", "ciudad del cabo", "cape town", "johannesburgo"], "green, gold, red and blue", "a protea flower", "🇿🇦"],
  ["KE", "Kenia", "Kenya", ["kenia", "kenya", "nairobi", "masai mara"], "black, red and green", "an acacia tree", "🇰🇪"],
  ["TZ", "Tanzania", "Tanzania", ["tanzania", "zanzibar", "serengeti"], "green, blue and black", "Mount Kilimanjaro", "🇹🇿"],
  ["AE", "Emiratos Árabes Unidos", "the United Arab Emirates", ["emiratos arabes unidos", "emiratos", "uae"], "green, white, black and red", "a falcon", "🇦🇪"],
  ["QA", "Catar", "Qatar", ["catar", "qatar", "doha"], "maroon and white", "a dhow boat", "🇶🇦"],
  ["IL", "Israel", "Israel", ["israel", "jerusalen", "jerusalem", "tel aviv"], "blue and white", "an olive branch", "🇮🇱"],
  ["JO", "Jordania", "Jordan", ["jordania", "jordan", "petra"], "black, white, green and red", "the Petra treasury", "🇯🇴"],
  ["IN", "India", "India", ["india"], "saffron, white and green", "a lotus flower", "🇮🇳"],
  ["CN", "China", "China", ["china", "pekin", "beijing", "shanghai"], "red and gold", "a paper lantern", "🇨🇳"],
  ["HK", "Hong Kong", "Hong Kong", ["hong kong"], "red and white", "a bauhinia flower", "🇭🇰"],
  ["JP", "Japón", "Japan", ["japon", "japan"], "white and red", "Mount Fuji", "🇯🇵"],
  ["KR", "Corea del Sur", "South Korea", ["corea del sur", "corea", "south korea", "korea"], "white, red, blue and black", "a hibiscus flower", "🇰🇷"],
  ["TH", "Tailandia", "Thailand", ["tailandia", "thailand"], "red, white and blue", "an elephant", "🇹🇭"],
  ["VN", "Vietnam", "Vietnam", ["vietnam", "hanoi", "ho chi minh", "halong"], "red and yellow", "a conical non la hat", "🇻🇳"],
  ["KH", "Camboya", "Cambodia", ["camboya", "cambodia", "angkor", "siem reap"], "blue, red and white", "the Angkor Wat temple", "🇰🇭"],
  ["ID", "Indonesia", "Indonesia", ["indonesia"], "red and white", "a frangipani flower", "🇮🇩"],
  ["PH", "Filipinas", "the Philippines", ["filipinas", "philippines", "manila", "palawan"], "blue, red, white and yellow", "a sun", "🇵🇭"],
  ["SG", "Singapur", "Singapore", ["singapur", "singapore"], "red and white", "a crescent moon", "🇸🇬"],
  ["MY", "Malasia", "Malaysia", ["malasia", "malaysia", "kuala lumpur"], "red, white, blue and yellow", "twin towers", "🇲🇾"],
  ["MV", "Maldivas", "the Maldives", ["maldivas", "maldives"], "red, green and white", "a palm island", "🇲🇻"],
  ["AU", "Australia", "Australia", ["australia"], "blue, red and white", "a kangaroo", "🇦🇺"],
  ["NZ", "Nueva Zelanda", "New Zealand", ["nueva zelanda", "new zealand", "auckland", "queenstown"], "blue, red and white", "a silver fern", "🇳🇿"],
  ["CO", "Colombia", "Colombia", ["colombia"], "yellow, blue and red", "a coffee bean", "🇨🇴"],
  ["PE", "Perú", "Peru", ["peru"], "red and white", "a llama", "🇵🇪"],
  ["AR", "Argentina", "Argentina", ["argentina", "mendoza"], "light blue and white", "a sun", "🇦🇷"],
  ["CL", "Chile", "Chile", ["chile", "atacama", "san pedro de atacama"], "red, white and blue", "a star", "🇨🇱"],
  ["BR", "Brasil", "Brazil", ["brasil", "brazil", "sao paulo", "florianopolis", "salvador de bahia"], "green, yellow and blue", "a toucan", "🇧🇷"],
  ["UY", "Uruguay", "Uruguay", ["uruguay", "montevideo", "punta del este"], "blue and white", "a sun", "🇺🇾"],
  ["EC", "Ecuador", "Ecuador", ["ecuador", "quito"], "yellow, blue and red", "a condor", "🇪🇨"],
  ["BO", "Bolivia", "Bolivia", ["bolivia", "uyuni", "la paz bolivia"], "red, yellow and green", "a salt flat", "🇧🇴"],
  ["CU", "Cuba", "Cuba", ["cuba"], "blue, white and red", "a palm tree", "🇨🇺"],
  ["DO", "República Dominicana", "the Dominican Republic", ["republica dominicana", "dominicana"], "blue, white and red", "a palm tree", "🇩🇴"],
  ["PR", "Puerto Rico", "Puerto Rico", ["puerto rico", "san juan puerto rico"], "red, white and blue", "a coqui frog", "🇵🇷"],
  ["CR", "Costa Rica", "Costa Rica", ["costa rica"], "blue, white and red", "a sloth", "🇨🇷"],
  ["PA", "Panamá", "Panama", ["panama"], "red, white and blue", "a harpy eagle", "🇵🇦"],
  ["GT", "Guatemala", "Guatemala", ["guatemala", "antigua guatemala", "tikal", "atitlan"], "sky blue and white", "a quetzal bird", "🇬🇹"],
  ["BZ", "Belice", "Belize", ["belice", "belize"], "blue, red and white", "a mahogany tree", "🇧🇿"],
  ["SV", "El Salvador", "El Salvador", ["el salvador"], "blue and white", "a volcano", "🇸🇻"],
  ["HN", "Honduras", "Honduras", ["honduras", "roatan"], "blue and white", "a scarlet macaw", "🇭🇳"],
  ["NI", "Nicaragua", "Nicaragua", ["nicaragua"], "blue and white", "a volcano", "🇳🇮"],
  ["JM", "Jamaica", "Jamaica", ["jamaica", "montego bay"], "green, gold and black", "a hummingbird", "🇯🇲"],
  ["BS", "Bahamas", "the Bahamas", ["bahamas", "nassau"], "aquamarine, gold and black", "a conch shell", "🇧🇸"],
  ["AW", "Aruba", "Aruba", ["aruba"], "blue, yellow and red", "a divi-divi tree", "🇦🇼"],
];

/** Texto sin acentos, en minúsculas, solo letras/números separados por un espacio. */
export function norm(s: unknown): string {
  return String(s ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

const hasPhrase = (text: string, phrase: string) => phrase.length > 0 && ` ${text} `.includes(` ${phrase} `);

function citySouvenir(c: CityDef): Souvenir {
  return { key: `ciudad:${c.id}`, lugar: c.lugar, pais: c.pais, nombre: c.nombre, emoji: c.emoji, slot: c.slot, prompt: c.prompt };
}

function countrySouvenir(r: CountryRow): Souvenir {
  const [code, nombre, en, , colors, symbol, emoji] = r;
  return {
    key: `pais:${code}`,
    lugar: nombre,
    pais: code,
    nombre: `Pin con los colores de ${nombre}`,
    emoji,
    slot: "pin",
    prompt: pin(`${symbol}, enameled in the flag colors of ${en} (${colors})`),
  };
}

export const GENERIC_SOUVENIR: Souvenir = {
  key: "generico:viajero",
  lugar: "Un nuevo destino",
  pais: null,
  nombre: "Etiqueta de equipaje dorada",
  emoji: "🧳",
  slot: "dije",
  prompt: charm("polished brass luggage tag with no text"),
};

/** Ciudad del catálogo mencionada en el texto (el alias más largo gana: "Roma, CDMX" → CDMX). */
export function matchCity(text: unknown): CityDef | null {
  const t = norm(text);
  if (!t) return null;
  let best: { c: CityDef; len: number } | null = null;
  for (const c of CITIES) {
    for (const a of c.aliases) {
      if (hasPhrase(t, a) && (!best || a.length > best.len)) best = { c, len: a.length };
    }
  }
  return best?.c ?? null;
}

/** Ciudad por código IATA de aeropuerto ("CDG" → París). */
export function matchIata(code: unknown): CityDef | null {
  const c = String(code ?? "").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(c)) return null;
  return CITIES.find((x) => x.iata?.includes(c)) ?? null;
}

/** País por nombre/alias o por código ISO2 exacto. */
export function matchCountry(text: unknown): CountryRow | null {
  const raw = String(text ?? "").trim();
  if (/^[A-Z]{2}$/.test(raw)) return COUNTRIES.find((r) => r[0] === raw) ?? null;
  const t = norm(raw);
  if (!t) return null;
  let best: { r: CountryRow; len: number } | null = null;
  for (const r of COUNTRIES) {
    for (const a of [norm(r[1]), ...r[3]]) {
      if (hasPhrase(t, a) && (!best || a.length > best.len)) best = { r, len: a.length };
    }
  }
  return best?.r ?? null;
}

export type TripLike = {
  destino?: string | null;
  pais_destino?: string | null;
  ciudad_origen?: string | null;
  itinerario_json?: unknown;
  vuelos_json?: unknown;
};

const arr = (v: unknown): any[] => (Array.isArray(v) ? v : []);

/** Lugares del viaje en orden de prioridad: ciudades de la ruta, el destino, aeropuertos de llegada y el país. */
export function tripPlaces(trip: TripLike): { texts: string[]; iatas: string[] } {
  const itin = (trip.itinerario_json && typeof trip.itinerario_json === "object") ? trip.itinerario_json as Record<string, unknown> : {};
  const texts = [
    ...arr(itin.destinations).map(String),
    String(trip.destino ?? ""),
    String(trip.pais_destino ?? ""),
  ].filter((s) => s.trim());
  const iatas = arr(trip.vuelos_json).map((v) => v?.to_iata).filter(Boolean).map(String);
  return { texts, iatas };
}

/**
 * Recuerdo que gana este viaje. Prefiere una ciudad del catálogo que el usuario aún no tenga
 * (viaje multidestino: la primera nueva), sin contar su ciudad de origen. Si no hay ciudad conocida,
 * el del país; si tampoco, uno genérico. `owned` = llaves que ya tiene en su colección.
 */
export function resolveSouvenir(trip: TripLike, owned: Iterable<string> = []): Souvenir {
  const have = new Set(owned);
  const origin = matchCity(trip.ciudad_origen);
  const { texts, iatas } = tripPlaces(trip);

  const cities: CityDef[] = [];
  const push = (c: CityDef | null) => {
    if (c && c.id !== origin?.id && !cities.some((x) => x.id === c.id)) cities.push(c);
  };
  for (const t of texts) push(matchCity(t));
  for (const i of iatas) push(matchIata(i));

  const fresh = cities.find((c) => !have.has(`ciudad:${c.id}`));
  if (fresh) return citySouvenir(fresh);

  let country: CountryRow | null = null;
  for (const t of texts) {
    country = matchCountry(t);
    if (country) break;
  }
  if (!country && cities[0]) country = COUNTRIES.find((r) => r[0] === cities[0].pais) ?? null;
  const countryS = country ? countrySouvenir(country) : null;
  // Ya tiene todas las ciudades del viaje: si el país es nuevo, gana el pin del país.
  if (cities.length && countryS && !have.has(countryS.key)) return countryS;
  if (cities.length) return citySouvenir(cities[0]);
  if (countryS) return countryS;
  return GENERIC_SOUVENIR;
}

/** Número de ciudades y países del catálogo (para pruebas y documentación). */
export const SOUVENIR_CATALOG_SIZE = { ciudades: CITIES.length, paises: COUNTRIES.length };

/** Todas las ciudades del catálogo (solo lectura, para pruebas). */
export function catalogCities(): ReadonlyArray<Pick<CityDef, "id" | "lugar" | "pais" | "aliases" | "iata">> {
  return CITIES;
}

/** Países del respaldo por país: [código ISO2, nombre en español] (solo lectura; avatar-inventory). */
export function catalogCountries(): ReadonlyArray<readonly [string, string]> {
  return COUNTRIES.map((r) => [r[0], r[1]] as const);
}

/** Qué recuerdos se dibujan: los últimos AVATAR_MAX_VISIBLE aplicados (el más nuevo al final). */
export function visibleSouvenirs<T extends { key: string }>(appliedOldestFirst: T[], max = AVATAR_MAX_VISIBLE): T[] {
  const seen = new Set<string>();
  const unique = appliedOldestFirst.filter((s) => (seen.has(s.key) ? false : (seen.add(s.key), true)));
  return unique.slice(-max);
}
