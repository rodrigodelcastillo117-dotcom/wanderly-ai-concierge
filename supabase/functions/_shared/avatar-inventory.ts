// Inventario del avatar por capas (grupo avatar-inventario). Sin Deno ni red: lo usan avatar-capas,
// generate-avatar, avatar-evolve, el cliente (Perfil) y el script scripts/avatar-assets/generate.mjs.
//
//   · FONDOS: hasta 3 por país de ORIGEN de la persona (su fondo siempre es de su país). Ilustrados una
//     sola vez por nosotros, con el mismo estilo del avatar, en el bucket público avatar-assets.
//   · OBJETOS: 2 por cada lugar de souvenirs.ts (cada ciudad, cada país y el genérico). PNG
//     transparentes generados una vez (sobre verde croma y recortados con avatar-cutout.ts); el
//     principal va en la mano del avatar de cuerpo completo y los demás a sus pies.
//   · Componer fondo + persona + objetos es aritmética (avatar-layers.ts): cambiar cuesta 0 USD.
//
// Reglas: nada de personas reales (Argentina = camiseta albiceleste con el 10 SIN nombre, nunca un
// jugador), ni marcas, escudos o logotipos; nada verde brillante en los objetos (es el color croma);
// los objetos nunca van sobre la cara ni la cabeza (las posiciones viven en avatar-layers.ts).
import { catalogCities, catalogCountries, matchCity, matchCountry, norm } from "./souvenirs.ts";

export const ASSETS_BUCKET = "avatar-assets";
/** USD por imagen con el modelo de mejor calidad (el mismo del avatar). Estimación: la factura manda. */
export const ASSET_IMAGE_COST_USD = 0.134;
export const MAX_FONDOS_POR_PAIS = 3;
export const OBJETOS_POR_LUGAR = 2;
export const MAX_OBJETOS_VISIBLES = 3;

export type Fondo = { id: string; pais: string; nombre: string; prompt: string };
export type Objeto = { id: string; souvenir: string; nombre: string; emoji: string; prompt: string };

// ───────────────────────── fondos por país de origen ─────────────────────────
// [código, nombre del país, alias extra (sin acentos), [id corto, nombre en español, escena en inglés]…]
type FondoRow = [string, string, string[], Array<[string, string, string]>];

const FONDO_ROWS: FondoRow[] = [
  ["MX", "México", ["mexico", "mexicana", "mexicano"], [
    ["angel", "Ángel de la Independencia", "the golden Angel of Independence on its tall column on Paseo de la Reforma, Mexico City, with jacaranda trees in bloom"],
    ["bellas-artes", "Palacio de Bellas Artes", "the white marble Palacio de Bellas Artes with its golden-orange domes in Mexico City, seen from the Alameda gardens"],
    ["teotihuacan", "Pirámide del Sol, Teotihuacan", "the Pyramid of the Sun at Teotihuacan under a soft sunrise sky with a few hot-air balloons far away"],
  ]],
  ["US", "Estados Unidos", ["usa", "eeuu", "estadounidense"], [
    ["times-square", "Times Square", "Times Square in New York at blue hour, glowing billboards rendered as abstract colorful light panels with no readable text or brands, yellow taxis softly blurred"],
    ["casa-blanca", "La Casa Blanca", "the north facade of the White House in Washington D.C. with its lawn and fountain, clear spring sky"],
    ["golden-gate", "Golden Gate", "the Golden Gate Bridge in San Francisco at golden hour with soft fog rolling under it"],
  ]],
  ["ES", "España", ["espana", "espanola", "espanol"], [
    ["puerta-alcala", "Puerta de Alcalá", "the Puerta de Alcalá monument in Madrid at sunset with flower beds around it"],
    ["bernabeu", "Estadio Santiago Bernabéu", "the exterior of the modern Santiago Bernabéu stadium in Madrid with its silver curved facade at dusk, no crests, no logos, no text"],
    ["sagrada-familia", "Sagrada Familia", "the Sagrada Familia basilica in Barcelona with its spires against a warm Mediterranean sky"],
  ]],
  ["FR", "Francia", ["france", "francesa", "frances"], [
    ["eiffel", "Torre Eiffel", "the Eiffel Tower in Paris seen from the Trocadéro gardens at golden hour"],
    ["arco-triunfo", "Arco del Triunfo", "the Arc de Triomphe at the top of the Champs-Élysées in Paris at sunset"],
    ["mont-saint-michel", "Mont-Saint-Michel", "Mont-Saint-Michel abbey on its tidal island in Normandy at dawn"],
  ]],
  ["IT", "Italia", ["italy", "italiana", "italiano"], [
    ["coliseo", "Coliseo", "the Colosseum in Rome at golden hour with umbrella pines"],
    ["venecia", "Gran Canal de Venecia", "the Grand Canal in Venice with gondolas and the Rialto Bridge in warm evening light"],
    ["pisa", "Torre de Pisa", "the Leaning Tower of Pisa and its cathedral square under a clear blue sky"],
  ]],
  ["GB", "Reino Unido", ["inglaterra", "united kingdom", "uk", "britanica", "britanico"], [
    ["big-ben", "Big Ben", "the Elizabeth Tower (Big Ben) and the Houses of Parliament by the Thames at dusk"],
    ["tower-bridge", "Tower Bridge", "Tower Bridge over the Thames in London in soft morning light"],
    ["autobus-rojo", "Calle de Londres", "an elegant London street with a red double-decker bus softly blurred and Georgian townhouses, no text or logos"],
  ]],
  ["AR", "Argentina", ["argentina", "argentino"], [
    ["obelisco", "Obelisco de Buenos Aires", "the Obelisco of Buenos Aires on Avenida 9 de Julio at dusk with jacaranda trees"],
    ["caminito", "Caminito, La Boca", "the colorful painted houses of Caminito in La Boca, Buenos Aires, with no people and no signs"],
    ["perito-moreno", "Glaciar Perito Moreno", "the blue ice wall of the Perito Moreno Glacier in Patagonia over a calm lake"],
  ]],
  ["BR", "Brasil", ["brazil", "brasilena", "brasileno", "brasileira", "brasileiro"], [
    ["pan-de-azucar", "Pan de Azúcar", "Sugarloaf Mountain over Guanabara Bay in Rio de Janeiro at sunset with sailboats"],
    ["copacabana", "Playa de Copacabana", "Copacabana beach in Rio de Janeiro with its wave-patterned promenade, palm trees and turquoise sea, no people"],
    ["iguazu", "Cataratas del Iguazú", "the Iguazu Falls on the Brazilian side with a soft rainbow in the mist"],
  ]],
  ["CO", "Colombia", ["colombiana", "colombiano"], [
    ["cartagena", "Cartagena amurallada", "the colorful colonial balconies with bougainvillea in the walled city of Cartagena, Colombia"],
    ["cocora", "Valle del Cocora", "the tall wax palms of the Cocora Valley in Colombia with misty hills"],
    ["monserrate", "Cerro de Monserrate", "the Monserrate hill sanctuary above Bogotá at golden hour"],
  ]],
  ["CL", "Chile", ["chilena", "chileno"], [
    ["torres-del-paine", "Torres del Paine", "the granite towers of Torres del Paine over a turquoise lake in Chilean Patagonia"],
    ["valparaiso", "Cerros de Valparaíso", "the colorful hillside houses and a funicular of Valparaíso, Chile, overlooking the Pacific"],
    ["rapa-nui", "Moáis de Rapa Nui", "a row of moai statues on Easter Island at sunset by the ocean"],
  ]],
  ["PE", "Perú", ["peru", "peruana", "peruano"], [
    ["machu-picchu", "Machu Picchu", "the citadel of Machu Picchu with Huayna Picchu peak in soft morning clouds"],
    ["vinicunca", "Montaña de Siete Colores", "the striped Rainbow Mountain (Vinicunca) in the Peruvian Andes under a deep blue sky"],
    ["cusco", "Plaza de Armas de Cusco", "the Plaza de Armas of Cusco with its cathedral and colonial arcades at dusk"],
  ]],
  ["CA", "Canadá", ["canada", "canadiense"], [
    ["moraine", "Lago Moraine", "Moraine Lake in Banff with its turquoise water and the Valley of the Ten Peaks"],
    ["niagara", "Cataratas del Niágara", "the Horseshoe Falls of Niagara with mist and a soft rainbow"],
    ["toronto", "Toronto", "the Toronto skyline with the CN Tower seen across Lake Ontario at sunset"],
  ]],
  ["JP", "Japón", ["japon", "japan", "japonesa", "japones"], [
    ["fuji", "Monte Fuji", "Mount Fuji with the red Chureito Pagoda and cherry blossoms in the foreground"],
    ["fushimi-inari", "Fushimi Inari, Kioto", "the tunnel of vermilion torii gates at Fushimi Inari shrine in Kyoto, no text on the gates"],
    ["shibuya", "Tokio de noche", "a Tokyo street at night with soft neon light rendered as abstract glowing panels, no readable text or brands, gentle rain reflections"],
  ]],
  ["GR", "Grecia", ["greece", "griega", "griego"], [
    ["santorini", "Santorini", "the white houses and blue domes of Oia, Santorini, over the Aegean Sea at sunset"],
    ["partenon", "Partenón", "the Parthenon on the Acropolis of Athens in warm golden light"],
    ["meteora", "Meteora", "the monasteries perched on the rock pillars of Meteora in soft morning mist"],
  ]],
  ["DE", "Alemania", ["germany", "alemana", "aleman"], [
    ["brandeburgo", "Puerta de Brandeburgo", "the Brandenburg Gate in Berlin at golden hour"],
    ["neuschwanstein", "Castillo de Neuschwanstein", "Neuschwanstein Castle on its hill in the Bavarian Alps in autumn"],
    ["colonia", "Catedral de Colonia", "the twin gothic spires of Cologne Cathedral by the Rhine at dusk"],
  ]],
  ["PT", "Portugal", ["portuguesa", "portugues"], [
    ["belem", "Torre de Belém", "the Belém Tower on the Tagus river in Lisbon at sunset"],
    ["alfama", "Tranvía de Lisboa", "a yellow vintage tram climbing a tiled street of Alfama in Lisbon, no text or numbers"],
    ["oporto", "Ribeira de Oporto", "the Ribeira riverside of Porto with the Dom Luís I bridge and rabelo boats"],
  ]],
  // Más países de origen frecuentes (2 fondos cada uno; el máximo sigue siendo 3).
  ["UY", "Uruguay", ["uruguaya", "uruguayo"], [
    ["montevideo", "Montevideo", "the Palacio Salvo and Plaza Independencia in Montevideo at golden hour"],
    ["colonia", "Colonia del Sacramento", "the cobbled Calle de los Suspiros in Colonia del Sacramento with old colonial houses"],
  ]],
  ["EC", "Ecuador", ["ecuatoriana", "ecuatoriano"], [
    ["quito", "Centro de Quito", "the colonial historic center of Quito with the gothic Basílica del Voto Nacional and the Andes"],
    ["galapagos", "Galápagos", "a turquoise bay of the Galápagos Islands with black volcanic rocks"],
  ]],
  ["VE", "Venezuela", ["venezolana", "venezolano"], [
    ["salto-angel", "Salto Ángel", "Angel Falls plunging from a tepui in Canaima, Venezuela, with soft clouds"],
    ["los-roques", "Los Roques", "the white sand and turquoise shallows of the Los Roques archipelago"],
  ]],
  ["GT", "Guatemala", ["guatemalteca", "guatemalteco"], [
    ["antigua", "Antigua Guatemala", "the yellow Santa Catalina Arch in Antigua Guatemala with the Agua volcano behind"],
    ["tikal", "Tikal", "the Mayan temples of Tikal rising above the jungle canopy at sunrise"],
  ]],
  ["CR", "Costa Rica", ["costarricense", "tica", "tico"], [
    ["arenal", "Volcán Arenal", "the cone of Arenal Volcano over the rainforest and lake in Costa Rica"],
    ["manuel-antonio", "Manuel Antonio", "a jungle-fringed beach of Manuel Antonio, Costa Rica, at sunset"],
  ]],
  ["PA", "Panamá", ["panama", "panamena", "panameno"], [
    ["canal", "Canal de Panamá", "the locks of the Panama Canal with a ship passing at golden hour"],
    ["casco-viejo", "Casco Viejo", "the colonial balconies of Casco Viejo in Panama City with the modern skyline behind"],
  ]],
  ["DO", "República Dominicana", ["dominicana", "dominicano"], [
    ["zona-colonial", "Zona Colonial", "the Zona Colonial of Santo Domingo with its colonial cathedral and palm trees"],
    ["punta-cana", "Punta Cana", "a palm-lined white-sand beach of Punta Cana with turquoise water"],
  ]],
  ["CU", "Cuba", ["cubana", "cubano"], [
    ["malecon", "Malecón de La Habana", "the Malecón of Havana at sunset with pastel colonial facades and a classic 1950s car"],
    ["trinidad", "Trinidad", "the cobbled streets and colorful houses of Trinidad, Cuba, with a bell tower"],
  ]],
  ["PR", "Puerto Rico", ["puertorriquena", "puertorriqueno", "boricua"], [
    ["el-morro", "El Morro", "the Castillo San Felipe del Morro fortress in Old San Juan by the ocean"],
    ["viejo-san-juan", "Viejo San Juan", "the colorful colonial houses and blue cobblestones of Old San Juan"],
  ]],
  ["BO", "Bolivia", ["boliviana", "boliviano"], [
    ["uyuni", "Salar de Uyuni", "the mirror-like Salar de Uyuni salt flat reflecting a pastel sky"],
    ["la-paz", "La Paz e Illimani", "the city of La Paz in its valley with the snowy Illimani mountain behind"],
  ]],
  ["PY", "Paraguay", ["paraguaya", "paraguayo"], [
    ["asuncion", "Palacio de los López", "the white Palacio de los López in Asunción at golden hour"],
    ["trinidad", "Ruinas jesuíticas", "the red-stone Jesuit mission ruins of Trinidad, Paraguay, under a warm sky"],
  ]],
  ["SV", "El Salvador", ["salvadorena", "salvadoreno"], [
    ["coatepeque", "Lago de Coatepeque", "the blue crater lake of Coatepeque surrounded by green hills in El Salvador"],
    ["el-tunco", "Playa El Tunco", "the rocky Pacific beach of El Tunco, El Salvador, at sunset"],
  ]],
  ["HN", "Honduras", ["hondurena", "hondureno"], [
    ["copan", "Ruinas de Copán", "the carved Mayan stelae and plaza of Copán ruins in Honduras"],
    ["roatan", "Roatán", "a turquoise Caribbean bay of Roatán with wooden piers"],
  ]],
  ["NI", "Nicaragua", ["nicaraguense"], [
    ["granada", "Granada", "the yellow cathedral of Granada, Nicaragua, with colonial houses"],
    ["ometepe", "Isla de Ometepe", "the twin volcanoes of Ometepe Island rising from Lake Nicaragua"],
  ]],
];

export const FONDOS: Fondo[] = FONDO_ROWS.flatMap(([pais, , , rows]) =>
  rows.map(([slug, nombre, escena]) => ({ id: `${pais.toLowerCase()}-${slug}`, pais, nombre, prompt: escena })));

/** Países con fondos ilustrados, para preguntar "¿De qué país eres?" (orden: el del catálogo). */
export const PAISES_CON_FONDO: Array<{ code: string; nombre: string }> = FONDO_ROWS.map(([code, nombre]) => ({ code, nombre }));

/**
 * Países para "¿De qué país eres?": primero los que tienen fondos ilustrados, luego los demás del
 * catálogo (su fondo es el degradado elegante hasta que se ilustren).
 */
export function paisesOrigen(): Array<{ code: string; nombre: string; conFondo: boolean }> {
  const con = PAISES_CON_FONDO.map((p) => ({ ...p, conFondo: true }));
  const resto = catalogCountries()
    .filter(([code]) => !con.some((p) => p.code === code))
    .map(([code, nombre]) => ({ code, nombre, conFondo: false }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  return [...con, ...resto];
}

export const paisValido = (code: string): boolean => paisesOrigen().some((p) => p.code === code);

export function fondosDePais(pais: string | null | undefined): Fondo[] {
  const p = String(pais ?? "").toUpperCase();
  return FONDOS.filter((f) => f.pais === p).slice(0, MAX_FONDOS_POR_PAIS);
}

/** El fondo elegido si es de su país; si no, el primero de su país; null si su país no tiene fondos. */
export function resolverFondo(pais: string | null | undefined, fondoId: string | null | undefined): Fondo | null {
  const lista = fondosDePais(pais);
  return lista.find((f) => f.id === fondoId) ?? lista[0] ?? null;
}

/**
 * País de origen a partir del perfil (profiles.pais_origen es texto libre con 'México' por defecto,
 * nationality, ciudad_origen). Regresa el código ISO2 o null.
 */
export function paisDesdePerfil(p: { pais_origen?: string | null; nationality?: string | null; ciudad_origen?: string | null }): string | null {
  for (const raw of [p.nationality, p.pais_origen]) {
    const s = String(raw ?? "").trim();
    if (!s) continue;
    if (/^[A-Za-z]{2}$/.test(s)) return s.toUpperCase();
    const t = norm(s);
    for (const [code, nombre, alias] of FONDO_ROWS) {
      if (t === norm(nombre) || alias.includes(t)) return code;
    }
    const c = matchCountry(s);
    if (c) return c[0];
  }
  return matchCity(p.ciudad_origen)?.pais ?? null;
}

export const nombrePais = (code: string | null | undefined): string | null =>
  paisesOrigen().find((r) => r.code === String(code ?? "").toUpperCase())?.nombre ?? null;

// ───────────────────────── objetos (stickers) por lugar ─────────────────────────
type O = [string, string, string]; // nombre en español, emoji, descripción del objeto en inglés

const CIUDAD_OBJETOS: Record<string, [O, O]> = {
  // México
  "cdmx": [["Ángel de la Independencia", "👼", "a small golden statuette of the Angel of Independence standing on its column"], ["Trajinera de Xochimilco", "🛶", "a small colorful Xochimilco trajinera boat with a flower-painted arch, no lettering"]],
  "cancun": [["Coco con popote", "🥥", "a fresh brown coconut with a paper straw and a tiny pink hibiscus flower"], ["Sombrilla de playa", "⛱️", "a turquoise-and-white striped beach umbrella over a folded beach towel"]],
  "tulum": [["Templo maya de Tulum", "🛕", "a small stone model of the Mayan El Castillo temple of Tulum on a cliff"], ["Atrapasueños", "🪶", "a woven boho dreamcatcher with cream feathers and wooden beads"]],
  "playa-del-carmen": [["Tortuga marina", "🐢", "a cute sea turtle swimming, warm brown and teal shell"], ["Esnórquel y aletas", "🤿", "a snorkel set and a pair of blue diving fins, not being worn"]],
  "puerto-vallarta": [["Caballito de mar", "🌅", "a bronze seahorse sculpture on a small base"], ["Mango con chile", "🥭", "a mango carved like a flower on a stick, sprinkled with red chili powder"]],
  "riviera-nayarit": [["Tabla de surf", "🏄", "a colorful vintage surfboard with a sunset stripe"], ["Ballena jorobada", "🐋", "a humpback whale breaching with a small splash"]],
  "los-cabos": [["El Arco de Cabo San Lucas", "🪨", "a small sculpted model of the rock arch of Cabo San Lucas over blue water"], ["Marlín azul", "🐟", "a leaping blue marlin with a small splash"]],
  "oaxaca": [["Alebrije", "🦎", "a vividly painted Oaxacan alebrije figurine of a fantastical jaguar with patterns in orange, pink and blue"], ["Jarrón de barro negro", "🏺", "a glossy Oaxacan black clay (barro negro) vase with carved patterns"]],
  "huatulco": [["Café de Oaxaca", "☕", "a clay cup of Oaxacan coffee with a few roasted coffee beans"], ["Caracol marino", "🐚", "a pink conch seashell"]],
  "guadalajara": [["Guitarra de mariachi", "🎸", "a small mariachi vihuela guitar with a decorated rosette"], ["Torta ahogada", "🥖", "a Guadalajara torta ahogada sandwich drenched in red sauce on a plate"]],
  "tequila": [["Agave azul", "🌵", "a blue-grey agave plant in a terracotta pot"], ["Caballito de tequila", "🥃", "a small tequila shot glass (caballito) with a lime wedge and salt, no label"]],
  "monterrey": [["Cerro de la Silla", "⛰️", "a small sculpted model of the saddle-shaped Cerro de la Silla mountain"], ["Carne asada", "🥩", "sizzling carne asada on a small cast-iron grill with grilled onions"]],
  "merida": [["Hamaca yucateca", "🏝️", "a colorful woven Yucatán hammock folded with tassels"], ["Taco de cochinita pibil", "🌮", "a cochinita pibil taco with pickled red onion on a banana leaf plate"]],
  "san-miguel": [["Parroquia de San Miguel", "⛪", "a small model of the pink neo-gothic Parroquia church of San Miguel de Allende"], ["Papel picado", "🎉", "a string of colorful Mexican papel picado flags in pink, orange and blue"]],
  "guanajuato": [["Ranita de Guanajuato", "🐸", "a small glazed ceramic frog figurine in warm yellow and blue"], ["Farol de callejón", "🏮", "a wrought-iron colonial street lantern glowing warm"]],
  "puebla": [["Plato de talavera", "🍽️", "a blue-and-white Puebla Talavera ceramic plate with floral patterns"], ["Camotes poblanos", "🍬", "traditional Puebla sweet potato candies (camotes) wrapped in waxed paper"]],
  "queretaro": [["Acueducto de Querétaro", "🌉", "a small stone model of the arched aqueduct of Querétaro"], ["Vino y queso", "🍷", "a glass of red wine next to a wedge of cheese"]],
  "acapulco": [["Coctel de camarón", "🍤", "a glass cup of Mexican shrimp cocktail with lime"], ["Silla de playa", "🏖️", "a wooden beach chair with a striped canvas seat"]],
  "mazatlan": [["Pulmonía de Mazatlán", "🚗", "a small white open-air Mazatlán pulmonía taxi cart, no text"], ["Camarones", "🦐", "a plate of grilled shrimp with lime"]],
  "bacalar": [["Kayak de la laguna", "🛶", "a small yellow kayak with a paddle"], ["Frasco de siete colores", "🫙", "a small glass bottle filled with layered turquoise, blue and sand-colored layers"]],
  "holbox": [["Tiburón ballena", "🦈", "a gentle whale shark with white spots"], ["Flamenco", "🦩", "a pink flamingo standing on one leg"]],
  "chiapas": [["Café de Chiapas", "☕", "a ceramic cup of coffee with a small burlap sack of coffee beans"], ["Dije de ámbar", "🟠", "a polished honey-colored amber stone pendant on a cord"]],
  "valle-guadalupe": [["Copa de vino tinto", "🍷", "a glass of red wine with a cork"], ["Racimo de uvas", "🍇", "a bunch of purple grapes"]],
  // Estados Unidos y Canadá
  "nueva-york": [["Taxi amarillo", "🚕", "a classic yellow New York taxi cab, no text, no logos"], ["Estatua de la Libertad", "🗽", "a small verdigris-teal souvenir figurine of the Statue of Liberty"]],
  "los-angeles": [["Claqueta de cine", "🎬", "a black-and-white film clapperboard with no text"], ["Palmera al atardecer", "🌴", "a tall palm tree in front of a small orange sunset disc"]],
  "las-vegas": [["Dados", "🎲", "a pair of glossy red casino dice"], ["Ficha de casino", "🪙", "a red-and-white casino chip with no text"]],
  "miami": [["Flamenco rosa", "🦩", "a pink flamingo with art-deco pastel styling"], ["Coctel tropical", "🍹", "a tropical cocktail with a tiny paper umbrella and a pineapple wedge"]],
  "orlando": [["Montaña rusa", "🎢", "a small roller coaster loop with a red car"], ["Naranja de Florida", "🍊", "a fresh orange with a leaf"]],
  "san-francisco": [["Tranvía de San Francisco", "🚋", "a classic San Francisco cable car, no text"], ["Golden Gate", "🌉", "a small model of the red Golden Gate Bridge"]],
  "chicago": [["Pizza estilo Chicago", "🍕", "a slice of Chicago deep-dish pizza"], ["Rascacielos art déco", "🏙️", "a miniature art-deco skyscraper"]],
  "houston": [["Cohete", "🚀", "a white space rocket with red stripes"], ["Casco de astronauta", "🧑‍🚀", "an empty white astronaut helmet with a golden visor"]],
  "san-antonio": [["El Álamo", "🏰", "a small model of the Alamo mission facade"], ["Espuela vaquera", "⭐", "a silver cowboy spur with a star rowel"]],
  "dallas": [["Bota vaquera", "👢", "a tooled brown leather cowboy boot"], ["Brisket texano", "🥩", "sliced Texas barbecue brisket on butcher paper"]],
  "san-diego": [["Lobo marino", "🦭", "a cute sea lion lying on a rock"], ["Tabla de surf", "🏄", "a turquoise surfboard with a white stripe"]],
  "hawai": [["Collar de flores", "🌺", "a Hawaiian lei of pink and yellow flowers"], ["Ukulele", "🎸", "a small wooden ukulele"]],
  "washington": [["Capitolio", "🏛️", "a small white model of the U.S. Capitol dome"], ["Flor de cerezo", "🌸", "a branch of pink cherry blossoms"]],
  "toronto": [["Torre CN", "🗼", "a small model of the CN Tower"], ["Disco y bastón de hockey", "🏒", "a wooden hockey stick and a black puck"]],
  "vancouver": [["Hidroavión", "🛩️", "a small red seaplane"], ["Salmón", "🐟", "a leaping silver-pink salmon"]],
  "montreal": [["Bagel de Montreal", "🥯", "a sesame Montreal-style bagel"], ["Poutine", "🍟", "a bowl of poutine with fries, cheese curds and gravy"]],
  // Europa
  "madrid": [["Toro bravo de cerámica", "🐂", "a small glossy black ceramic figurine of a Spanish fighting bull"], ["Churros con chocolate", "🍫", "churros with a cup of thick hot chocolate"]],
  "barcelona": [["Lagartija de mosaico", "🦎", "a colorful broken-tile mosaic lizard in Gaudí style"], ["Sagrada Familia", "⛪", "a small model of the Sagrada Familia basilica"]],
  "sevilla": [["Abanico flamenco", "🪭", "an open red flamenco hand fan with lace"], ["Azulejo andaluz", "💠", "a square blue-and-yellow Andalusian ceramic tile"]],
  "paris": [["Croissant", "🥐", "a golden flaky butter croissant"], ["Torre Eiffel", "🗼", "a small bronze souvenir model of the Eiffel Tower"]],
  "roma": [["Coliseo", "🏛️", "a small stone model of the Roman Colosseum"], ["Gelato", "🍨", "a cone of Italian gelato with strawberry and vanilla scoops"]],
  "florencia": [["Duomo de Florencia", "⛪", "a small model of the Florence Cathedral dome"], ["Lirio florentino", "⚜️", "a red Florentine lily emblem in enamel"]],
  "venecia": [["Góndola", "🛶", "a small black Venetian gondola with a red cushion"], ["Copa de Murano", "🍷", "a colorful Murano glass goblet in blue and gold"]],
  "milan": [["Espresso", "☕", "a tiny white espresso cup on a saucer"], ["Duomo de Milán", "⛪", "a small white model of the gothic Milan Cathedral"]],
  "amalfi": [["Limón de Amalfi", "🍋", "a large Amalfi lemon with a leaf"], ["Botella de limoncello", "🍾", "a small bottle of limoncello with no label"]],
  "londres": [["Autobús de dos pisos", "🚌", "a red double-decker London bus, no text"], ["Taza de té", "🫖", "a fine porcelain teapot and teacup with roses"]],
  "amsterdam": [["Tulipanes", "🌷", "a bunch of red and yellow tulips"], ["Bicicleta holandesa", "🚲", "a vintage Dutch bicycle with a flower basket"]],
  "berlin": [["Oso de Berlín", "🐻", "a cheerful painted bear figurine standing upright"], ["Currywurst", "🌭", "a currywurst with fries on a paper tray"]],
  "munich": [["Pretzel", "🥨", "a large Bavarian pretzel with salt"], ["Tarro de cerveza", "🍺", "a stoneware beer stein with a pewter lid, no logo"]],
  "lisboa": [["Tranvía amarillo", "🚋", "a yellow vintage Lisbon tram, no text or numbers"], ["Pastel de nata", "🥧", "a Portuguese pastel de nata custard tart"]],
  "atenas": [["Búho de Atenea", "🦉", "a small bronze figurine of the owl of Athena"], ["Corona de olivo", "🫒", "a golden olive-leaf crown resting flat"]],
  "santorini": [["Capilla de cúpula azul", "⛪", "a small white chapel with a blue dome"], ["Burrito de Santorini", "🫏", "a cute small grey donkey"]],
  "praga": [["Reloj astronómico", "🕰️", "a small model of the Prague astronomical clock"], ["Trdelník", "🥐", "a chimney cake pastry (trdelník) dusted with sugar"]],
  "viena": [["Tarta Sacher", "🍰", "a slice of Sachertorte chocolate cake with whipped cream"], ["Violín", "🎻", "a classical violin with its bow"]],
  "budapest": [["Parlamento de Budapest", "🏛️", "a small model of the Hungarian Parliament building"], ["Lángos", "🫓", "a Hungarian lángos flatbread with sour cream and cheese"]],
  "estambul": [["Ojo turco", "🧿", "a blue glass nazar amulet hanging from a thread"], ["Té turco", "🫖", "a tulip-shaped Turkish tea glass on a red saucer"]],
  "dublin": [["Puerta georgiana", "🚪", "a bright red Georgian door with a fanlight"], ["Violín irlandés", "🎻", "an Irish fiddle with its bow"]],
  "islandia": [["Frailecillo", "🐧", "a cute Atlantic puffin"], ["Caballo islandés", "🐴", "a small shaggy Icelandic horse"]],
  // Latinoamérica y el Caribe
  "bogota": [["Teleférico de Monserrate", "🚡", "a small red cable car cabin"], ["Chocolate santafereño", "🍫", "a cup of hot chocolate with a slice of cheese and bread"]],
  "cartagena": [["Balcón colonial", "🌺", "a small colonial wooden balcony with pink bougainvillea"], ["Canasta de frutas", "🍍", "a woven basket of tropical fruits"]],
  "medellin": [["Silleta de flores", "💐", "a wooden silleta carrying a round colorful flower arrangement"], ["Arepa", "🫓", "a golden arepa with melted cheese"]],
  "cusco": [["Llama", "🦙", "a cute llama with colorful woven tassels"], ["Machu Picchu", "⛰️", "a small sculpted model of Machu Picchu and its peak"]],
  "lima": [["Ceviche", "🍤", "a bowl of Peruvian ceviche with sweet potato and corn"], ["Pisco sour", "🍸", "a glass of pisco sour with foam"]],
  "buenos-aires": [["Bandoneón", "🪗", "a black tango bandoneon"], ["Balón de fútbol clásico", "⚽", "a classic brown leather football with laces"]],
  "patagonia": [["Glaciar", "🧊", "a small sculpted chunk of blue glacier ice"], ["Pingüino", "🐧", "a cute Magellanic penguin"]],
  "santiago": [["Empanada chilena", "🥟", "a baked Chilean empanada"], ["Cóndor andino", "🦅", "an Andean condor with spread wings"]],
  "rio": [["Pan de Azúcar", "⛰️", "a small sculpted model of Sugarloaf Mountain with its cable car"], ["Coco frío", "🥥", "a cold opened tan coconut with a paper straw"]],
  "la-habana": [["Auto clásico", "🚗", "a pastel pink 1950s classic car"], ["Maracas", "🪇", "a pair of painted wooden maracas"]],
  "punta-cana": [["Dije de larimar", "💎", "a sky-blue larimar stone pendant"], ["Piña colada", "🍍", "a piña colada served in a pineapple"]],
  "costa-rica": [["Perezoso", "🦥", "a cute three-toed sloth hanging from a branch"], ["Carreta típica", "🛞", "a miniature painted Costa Rican oxcart wheel in red and orange patterns"]],
  "panama": [["Barco del Canal", "🚢", "a miniature container ship in a canal lock"], ["Rana dorada", "🐸", "a Panamanian golden frog in yellow and black"]],
  "galapagos": [["Tortuga gigante", "🐢", "a giant Galápagos tortoise"], ["Piquero de patas azules", "🐦", "a blue-footed booby bird"]],
  // Asia, Medio Oriente, África y Oceanía
  "tokio": [["Omamori", "🎐", "a small red Japanese omamori charm pouch with no text"], ["Sushi", "🍣", "a small wooden board with salmon and tuna nigiri"]],
  "kioto": [["Torii", "⛩️", "a small vermilion torii gate"], ["Farol de papel", "🏮", "a red paper lantern with no text"]],
  "osaka": [["Takoyaki", "🐙", "a boat-shaped tray of takoyaki with sauce"], ["Gato de la suerte", "🐱", "a white maneki-neko lucky cat figurine with a raised paw"]],
  "seul": [["Bibimbap", "🍲", "a hot stone bowl of bibimbap with an egg on top"], ["Linterna de loto", "🏮", "a pink lotus lantern"]],
  "bangkok": [["Tuk-tuk", "🛺", "a colorful Thai tuk-tuk, no text"], ["Elefante tailandés", "🐘", "a small decorated Thai elephant figurine"]],
  "bali": [["Flor de frangipani", "🌸", "a white-and-yellow frangipani flower"], ["Gong balinés", "🔔", "a small bronze gamelan gong on a carved stand"]],
  "dubai": [["Halcón", "🦅", "a peregrine falcon perched"], ["Lámpara árabe", "🪔", "an ornate brass Arabian lantern"]],
  "singapur": [["Orquídea", "🌸", "a purple orchid flower"], ["Cangrejo al chile", "🦀", "a red chili crab on a plate"]],
  "india": [["Elefante decorado", "🐘", "a small painted Indian elephant figurine with ornaments"], ["Taza de chai", "☕", "a clay cup of masala chai with cardamom pods"]],
  "maldivas": [["Bungalow sobre el agua", "🏝️", "a tiny overwater bungalow on stilts"], ["Mantarraya", "🐟", "a gliding manta ray"]],
  "el-cairo": [["Pirámide", "🔺", "a small golden sandstone pyramid"], ["Escarabajo sagrado", "🪲", "a turquoise-blue ceramic Egyptian scarab amulet"]],
  "marrakech": [["Tetera marroquí", "🫖", "an engraved silver Moroccan teapot"], ["Babuchas", "🥿", "a pair of yellow leather Moroccan babouche slippers"]],
  "sidney": [["Tabla de surf", "🏄", "a blue-and-white surfboard"], ["Koala", "🐨", "a cute koala hugging a branch"]],
};

const PAIS_OBJETOS: Record<string, [O, O]> = {
  "MX": [["Taco al pastor", "🌮", "a taco al pastor with pineapple and cilantro"], ["Piñata de estrella", "🪅", "a colorful seven-point star piñata"]],
  "US": [["Hamburguesa", "🍔", "a classic American cheeseburger"], ["Bate y pelota de béisbol", "⚾", "a wooden baseball bat and a baseball"]],
  "CA": [["Jarabe de maple", "🍁", "a small glass bottle of maple syrup next to a red maple leaf, no label"], ["Alce", "🫎", "a friendly moose"]],
  "ES": [["Paella", "🥘", "a pan of Spanish seafood paella"], ["Jamón ibérico", "🍖", "a cured Iberian ham leg on a wooden stand"]],
  "FR": [["Baguette", "🥖", "a crusty French baguette"], ["Macarons", "🍬", "a small stack of pink, lavender and lemon macarons"]],
  "IT": [["Pizza margherita", "🍕", "a small Neapolitan pizza margherita"], ["Plato de pasta", "🍝", "a plate of spaghetti al pomodoro"]],
  "GB": [["Paraguas británico", "☂️", "a classic black umbrella with a curved wooden handle"], ["Fish and chips", "🐟", "fish and chips in a paper cone"]],
  "DE": [["Reloj cucú", "🕰️", "a carved Black Forest cuckoo clock"], ["Bratwurst", "🌭", "a grilled bratwurst with mustard in a bun"]],
  "NL": [["Zuecos de madera", "👞", "a pair of painted wooden clogs"], ["Molino de viento", "🌬️", "a small Dutch windmill"]],
  "BE": [["Waffle belga", "🧇", "a Belgian waffle with strawberries"], ["Bombones", "🍫", "a small box of Belgian chocolate pralines"]],
  "CH": [["Reloj de bolsillo", "⌚", "a silver pocket watch with its chain"], ["Fondue de queso", "🫕", "a small cheese fondue pot with bread"]],
  "AT": [["Edelweiss", "🌼", "a white edelweiss flower"], ["Strudel de manzana", "🥧", "a slice of apple strudel dusted with sugar"]],
  "PT": [["Gallo de Barcelos", "🐓", "a black painted Rooster of Barcelos figurine with red hearts"], ["Sardinas", "🐟", "grilled sardines on a small ceramic plate"]],
  "GR": [["Columna jónica", "🏛️", "a small white marble Ionic column"], ["Ánfora griega", "🏺", "a Greek amphora with black-figure meander patterns, no human figures"]],
  "CZ": [["Copa de cristal de Bohemia", "🍷", "a cut Bohemian crystal goblet in ruby red"], ["Tarro de cerveza checa", "🍺", "a dimpled glass mug of golden Czech lager, no logo"]],
  "HU": [["Pimentón húngaro", "🌶️", "a string of dried red paprika peppers"], ["Gulash", "🍲", "a small bowl of Hungarian goulash"]],
  "PL": [["Pierogi", "🥟", "a plate of Polish pierogi"], ["Cerámica de Bolesławiec", "🫖", "a blue polka-dot Bolesławiec stoneware teapot"]],
  "HR": [["Corbata croata", "👔", "a folded red silk necktie with a subtle pattern"], ["Higos y aceite de oliva", "🫒", "fresh figs next to a small bottle of olive oil with no label"]],
  "IE": [["Arpa celta", "🪕", "a small Celtic harp"], ["Pinta de cerveza negra", "🍺", "a pint of Irish stout with a creamy head, no logo"]],
  "IS": [["Volcán", "🌋", "a small erupting volcano with glowing lava"], ["Suéter islandés", "🧶", "a folded Icelandic lopapeysa wool sweater"]],
  "NO": [["Barco vikingo", "⛵", "a small Viking longship with a striped sail"], ["Salmón ahumado", "🐟", "slices of smoked salmon on rye bread"]],
  "SE": [["Caballito de Dala", "🐴", "a red painted Swedish Dala horse"], ["Rollo de canela", "🥐", "a Swedish cinnamon bun"]],
  "DK": [["Pastel danés", "🥐", "a Danish pastry with custard"], ["Casitas de Nyhavn", "🏘️", "a small row of colorful Nyhavn harbor houses"]],
  "FI": [["Reno", "🦌", "a cute reindeer"], ["Cubeta de sauna", "🪣", "a wooden sauna bucket with a ladle"]],
  "TR": [["Globo de Capadocia", "🎈", "a colorful hot-air balloon"], ["Delicias turcas", "🍬", "Turkish delight cubes dusted with sugar"]],
  "RU": [["Matrioska", "🪆", "a painted Russian matryoshka doll"], ["Cúpula de cebolla", "⛪", "a small colorful onion-dome tower"]],
  "MA": [["Tajín", "🍲", "a terracotta tagine pot"], ["Farol marroquí", "🏮", "a pierced metal Moroccan lantern glowing warm"]],
  "EG": [["Camello", "🐪", "a camel with a colorful saddle blanket"], ["Papiro con flor de loto", "📜", "a rolled papyrus scroll with painted lotus flowers, no hieroglyphs"]],
  "ZA": [["Protea", "🌸", "a pink king protea flower"], ["Pingüino africano", "🐧", "an African penguin"]],
  "KE": [["Jirafa", "🦒", "a cute giraffe"], ["Collar masái", "📿", "a round beaded Maasai collar necklace in red, white and blue"]],
  "TZ": [["Kilimanjaro", "🏔️", "a small sculpted model of snow-capped Mount Kilimanjaro"], ["Cebra", "🦓", "a cute zebra"]],
  "AE": [["Cafetera árabe", "☕", "a brass Arabic dallah coffee pot"], ["Dátiles", "🌴", "a small bowl of dates"]],
  "QA": [["Barco dhow", "⛵", "a small wooden dhow sailing boat"], ["Perla", "🦪", "an open oyster shell with a pearl"]],
  "IL": [["Granada", "🍎", "a ripe pomegranate cut open"], ["Naranja de Jaffa", "🍊", "a Jaffa orange with a leaf"]],
  "JO": [["Tesoro de Petra", "🏜️", "a small rose-colored model of the Petra Treasury facade"], ["Botella de arena", "🫙", "a small glass bottle filled with layered colored sand"]],
  "IN": [["Taj Mahal", "🕌", "a small white marble model of the Taj Mahal"], ["Flor de loto", "🪷", "a pink lotus flower"]],
  "CN": [["Farol chino", "🏮", "a red Chinese paper lantern with golden tassels, no text"], ["Panda", "🐼", "a cute giant panda"]],
  "HK": [["Dim sum", "🥟", "a bamboo steamer with dim sum dumplings"], ["Junco chino", "⛵", "a small Chinese junk boat with red sails"]],
  "JP": [["Monte Fuji", "🗻", "a small sculpted model of snow-capped Mount Fuji"], ["Grulla de origami", "🕊️", "a red-and-white origami crane"]],
  "KR": [["Flor de hibisco", "🌺", "a pink mugunghwa hibiscus flower"], ["Tambor coreano", "🥁", "a traditional Korean janggu drum"]],
  "TH": [["Mango con arroz", "🥭", "mango sticky rice on a small plate"], ["Barca del mercado flotante", "🛶", "a small wooden boat loaded with tropical fruit"]],
  "VN": [["Pho", "🍜", "a bowl of Vietnamese pho with chopsticks"], ["Café vietnamita", "☕", "a Vietnamese coffee with a metal phin filter"]],
  "KH": [["Angkor Wat", "🛕", "a small stone model of Angkor Wat temple"], ["Krama de seda", "🧣", "a folded red-and-white checkered silk krama scarf"]],
  "ID": [["Batik", "🧵", "a folded piece of brown-and-indigo Indonesian batik fabric"], ["Dragón de Komodo", "🦎", "a friendly Komodo dragon"]],
  "PH": [["Jeepney", "🚌", "a colorful Filipino jeepney, no text"], ["Mango filipino", "🥭", "a ripe yellow mango"]],
  "SG": [["Tostada kaya", "🍞", "kaya toast with butter and a cup of coffee"], ["Durián", "🍈", "a spiky durian fruit cut open"]],
  "MY": [["Cometa wau", "🪁", "a colorful Malaysian wau moon kite"], ["Satay", "🍢", "chicken satay skewers with peanut sauce"]],
  "MV": [["Delfín", "🐬", "a leaping dolphin"], ["Concha de cauri", "🐚", "a glossy cowrie seashell"]],
  "AU": [["Canguro", "🦘", "a cute kangaroo"], ["Bumerán", "🪃", "a painted wooden boomerang"]],
  "NZ": [["Kiwi", "🥝", "a cute brown kiwi bird"], ["Oveja", "🐑", "a fluffy white sheep"]],
  "CO": [["Café colombiano", "☕", "a cup of Colombian coffee with a small burlap sack of beans"], ["Mochila wayuu", "👜", "a colorful woven Wayuu bag with tassels"]],
  "PE": [["Toro de Pucará", "🐂", "a painted ceramic Pucará bull figurine"], ["Maíz morado", "🌽", "a cob of Peruvian purple corn"]],
  "AR": [["Camiseta albiceleste con el 10", "👕", "a light-blue and white vertically striped football jersey seen from the back with a large number 10 and NO name, no crest, no brand logos"], ["Mate con bombilla", "🧉", "a gourd of yerba mate with a silver bombilla straw"]],
  "CL": [["Moái", "🗿", "a small stone moai statue"], ["Lapislázuli", "💎", "a polished blue lapis lazuli stone"]],
  "BR": [["Sandalias de Copacabana", "🩴", "a pair of colorful beach flip-flops in yellow and blue, no brand"], ["Pandeiro de samba", "🪘", "a samba pandeiro tambourine"]],
  "UY": [["Chivito", "🥪", "a Uruguayan chivito steak sandwich"], ["Tambor de candombe", "🥁", "a painted candombe drum"]],
  "EC": [["Chocolate ecuatoriano", "🍫", "a cacao pod cut open next to a bar of dark chocolate with no label"], ["Rosa ecuatoriana", "🌹", "a long-stemmed red rose"]],
  "BO": [["Aguayo", "🧶", "a folded colorful Andean aguayo textile"], ["Salteña", "🥟", "a golden Bolivian salteña pastry"]],
  "CU": [["Café cubano", "☕", "a small cup of Cuban coffee on a saucer"], ["Bongós", "🥁", "a pair of wooden bongo drums"]],
  "DO": [["Cacao dominicano", "🍫", "a cacao pod and a few cacao beans"], ["Güira", "🪇", "a metal Dominican güira scraper instrument"]],
  "PR": [["Coquí", "🐸", "a tiny brown coquí tree frog on a leaf"], ["Piragua", "🍧", "a cone-shaped piragua shaved ice with red syrup"]],
  "CR": [["Mariposa morfo azul", "🦋", "an iridescent blue morpho butterfly"], ["Gallo pinto", "🍛", "a plate of gallo pinto rice and beans with fried plantain"]],
  "PA": [["Mola", "🧵", "a colorful Guna mola textile panel with abstract patterns"], ["Café geisha", "☕", "a cup of specialty coffee with a coffee cherry branch"]],
  "GT": [["Quetzal", "🐦", "a resplendent quetzal bird in deep emerald and crimson with a long tail"], ["Huipil tejido", "🧵", "a folded colorful Guatemalan woven huipil textile"]],
  "BZ": [["Pez loro", "🐠", "a colorful reef parrotfish"], ["Cacao maya", "🍫", "a cacao pod and a cup of Mayan hot chocolate"]],
  "SV": [["Pupusa", "🫓", "a pupusa with curtido slaw"], ["Volcán", "🌋", "a small sculpted volcano cone"]],
  "HN": [["Guacamaya roja", "🦜", "a scarlet macaw"], ["Baleada", "🌯", "a Honduran baleada flour tortilla folded with beans"]],
  "NI": [["Mecedora", "🪑", "a woven wooden Nicaraguan rocking chair"], ["Volcán de Ometepe", "🌋", "a small sculpted twin-volcano island"]],
  "JM": [["Tambor de acero", "🥁", "a Caribbean steelpan drum"], ["Colibrí", "🐦", "a black-and-emerald streamertail hummingbird with long tail feathers"]],
  "BS": [["Caracola", "🐚", "a pink queen conch shell"], ["Cerdito nadador", "🐷", "a cute pink pig swimming"]],
  "AW": [["Árbol divi-divi", "🌳", "a wind-bent divi-divi tree"], ["Flamenco", "🦩", "a pink flamingo"]],
};

const GENERICO_OBJETOS: [O, O] = [
  ["Maleta vintage", "🧳", "a vintage leather suitcase with brass corners, no stickers with text"],
  ["Brújula dorada", "🧭", "a polished brass compass"],
];

/** Todos los objetos del inventario, con su llave de recuerdo (ciudad:x, pais:XX, generico:viajero). */
export const OBJETOS: Objeto[] = [
  ...Object.entries(CIUDAD_OBJETOS).flatMap(([id, pair]) => pair.map((o, i) => ({
    id: `c-${id}-${i + 1}`, souvenir: `ciudad:${id}`, nombre: o[0], emoji: o[1], prompt: o[2],
  }))),
  ...Object.entries(PAIS_OBJETOS).flatMap(([code, pair]) => pair.map((o, i) => ({
    id: `p-${code.toLowerCase()}-${i + 1}`, souvenir: `pais:${code}`, nombre: o[0], emoji: o[1], prompt: o[2],
  }))),
  ...GENERICO_OBJETOS.map((o, i) => ({ id: `g-viajero-${i + 1}`, souvenir: "generico:viajero", nombre: o[0], emoji: o[1], prompt: o[2] })),
];

const BY_ID = new Map(OBJETOS.map((o) => [o.id, o]));
export const objetoPorId = (id: string): Objeto | null => BY_ID.get(id) ?? null;
export const fondoPorId = (id: string): Fondo | null => FONDOS.find((f) => f.id === id) ?? null;

export function objetosDeRecuerdo(souvenirKey: string): Objeto[] {
  return OBJETOS.filter((o) => o.souvenir === souvenirKey);
}

/** Nombre del lugar de un recuerdo ("ciudad:paris" → "París", "pais:FR" → "Francia"). */
export function lugarDeRecuerdo(key: string): string {
  if (key.startsWith("ciudad:")) return catalogCities().find((c) => c.id === key.slice(7))?.lugar ?? "";
  if (key.startsWith("pais:")) return nombrePais(key.slice(5)) ?? "";
  return "";
}

/** Ciudades de souvenirs.ts sin sus 2 objetos (debe ser []; lo revisan las pruebas). */
export function ciudadesSinObjetos(): string[] {
  return catalogCities().map((c) => c.id).filter((id) => objetosDeRecuerdo(`ciudad:${id}`).length !== OBJETOS_POR_LUGAR);
}

/** Inventario desbloqueado: los objetos de cada recuerdo ganado, en el orden en que se ganaron. */
export function inventario(recuerdosOldestFirst: string[]): Objeto[] {
  const seen = new Set<string>();
  const out: Objeto[] = [];
  for (const k of recuerdosOldestFirst) {
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(...objetosDeRecuerdo(k));
  }
  return out;
}

/** Lo que pidió la persona, limpio: solo objetos de su inventario, sin repetir, máximo 3. */
export function validarObjetos(pedidos: unknown, recuerdos: string[]): string[] {
  const own = new Set(inventario(recuerdos).map((o) => o.id));
  const list = Array.isArray(pedidos) ? pedidos : [];
  const out: string[] = [];
  for (const p of list) {
    const id = String(p ?? "");
    if (own.has(id) && !out.includes(id)) out.push(id);
    if (out.length >= MAX_OBJETOS_VISIBLES) break;
  }
  return out;
}

/** Al ganar un recuerdo nuevo: se muestra su primer objeto; si ya hay 3, sale el más viejo. */
export function objetosConNuevo(actuales: string[], nuevoRecuerdo: string): string[] {
  const nuevo = objetosDeRecuerdo(nuevoRecuerdo)[0];
  if (!nuevo) return actuales.slice(-MAX_OBJETOS_VISIBLES);
  if (actuales.some((id) => objetoPorId(id)?.souvenir === nuevoRecuerdo)) return actuales.slice(-MAX_OBJETOS_VISIBLES);
  return [...actuales.filter((id) => id !== nuevo.id), nuevo.id].slice(-MAX_OBJETOS_VISIBLES);
}

/** Al estrenar avatar: el primer objeto de cada uno de los últimos 3 recuerdos. */
export function objetosIniciales(recuerdosOldestFirst: string[]): string[] {
  const uniq = [...new Set(recuerdosOldestFirst)];
  return uniq.slice(-MAX_OBJETOS_VISIBLES).map((k) => objetosDeRecuerdo(k)[0]?.id).filter((x): x is string => !!x);
}

/** Llaves de recuerdo de unos objetos (para marcar avatar_souvenirs.visible). */
export const recuerdosDeObjetos = (ids: string[]): string[] =>
  [...new Set(ids.map((id) => objetoPorId(id)?.souvenir).filter((x): x is string => !!x))];

// ───────────────────────── prompts de generación (una sola vez) ─────────────────────────

const ASSET_STYLE = `Style: refined, semi-realistic 3D illustrated rendering with premium animated-film quality and soft painterly shading — the same art style as a premium illustrated travel avatar portrait.`;

/** Fondo ilustrado de un país (cuadrado; la persona va al centro, adelante). */
export function fondoPrompt(f: Fondo): string {
  return [
    `Illustrated travel backdrop: ${f.prompt}.`,
    ASSET_STYLE,
    `Lighting: warm golden-hour light, gentle atmospheric depth and a slight depth-of-field blur so it reads as a background.`,
    `Composition: vertical 4:5 image (square is acceptable), eye-level camera. A full-body standing person will be placed in front of the center, feet near the bottom edge: keep the landmark clearly recognizable in the UPPER HALF and toward the sides, and a calm, simple ground (pavement, terrace, sand or grass in deep natural tones) along the bottom where the feet will stand.`,
    `No people, no faces, no animals in the foreground. No text, letters, numbers, signs, logos, crests, brands or watermarks.`,
  ].join("\n\n");
}

/** Objeto del inventario sobre verde croma (se recorta en código; va en la mano o a los pies). */
export function objetoPrompt(o: Objeto): string {
  return [
    `A single object: ${o.prompt}.`,
    ASSET_STYLE,
    `Present it as an isolated souvenir object, centered, three-quarter view, filling about 80% of the frame, at a size that a person could hold up in one hand, with crisp clean edges and soft studio lighting. SQUARE 1:1.`,
    `Background: perfectly flat, solid, uniform pure chroma-key green (#00FF00) from edge to edge — no gradient, no texture, no floor, no shadow or reflection on the background, no glow.`,
    `Do not use bright or neon green anywhere in the object (use deep natural greens only if needed).`,
    `No people, no hands, no faces of real people. No text, letters or numbers unless described above. No logos, crests, brands or watermarks.`,
  ].join("\n\n");
}

export type AssetPlan = { kind: "fondo" | "objeto"; id: string; path: string; prompt: string };

/** Lista completa de imágenes a generar una vez (fondos + objetos). */
export function planDeAssets(): AssetPlan[] {
  return [
    ...FONDOS.map((f) => ({ kind: "fondo" as const, id: f.id, path: `fondos/${f.id}.png`, prompt: fondoPrompt(f) })),
    ...OBJETOS.map((o) => ({ kind: "objeto" as const, id: o.id, path: `objetos/${o.id}.png`, prompt: objetoPrompt(o) })),
  ];
}

/** Huella corta del prompt: si cambia, el script vuelve a generar esa imagen (idempotente). */
export function promptHash(prompt: string): string {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < prompt.length; i++) {
    const c = prompt.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}

export function costoEstimado(imagenes: number, usdPorImagen = ASSET_IMAGE_COST_USD): number {
  return Math.round(imagenes * usdPorImagen * 1000) / 1000;
}
