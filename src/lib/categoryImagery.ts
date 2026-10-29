/**
 * Consultas en inglés para Pexels según la categoría o la cocina ("Italiana" → "italian food pasta").
 * Solo para fotos ILUSTRATIVAS (se marcan así): muestran el tipo de comida o de experiencia, nunca
 * el lugar. Si se propone un restaurante italiano sin foto propia, se ve comida italiana.
 */

const norm = (v: unknown) =>
  String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

type Rule = [RegExp, string];

// Más específicas primero.
const CUISINE: Rule[] = [
  [/\b(sushi|omakase|japones|japonesa|japanese|ramen|izakaya)\b/, "japanese sushi omakase"],
  [/\b(pizza|pizzeria)\b/, "neapolitan pizza wood oven"],
  [/\b(italian|italiano|italiana|trattoria|osteria|pasta)\b/, "italian food pasta"],
  [/\b(poblan|mole|chiles en nogada)/, "mexican mole dish"],
  [/\b(taco|tacos|taqueria|al pastor)\b/, "mexican tacos"],
  [/\b(oaxaque|yucatec|mexican|mexicana|mexicano|antojitos|cocina de autor mexicana)/, "mexican cuisine gourmet"],
  [/\b(marisc|seafood|pescado|ostion|oyster|ceviche|cevicheria)/, "seafood platter"],
  [/\b(peruan|peruvian|nikkei)/, "peruvian ceviche"],
  [/\b(steak|carne|carnes|asador|parrilla|grill|churrasc|corte)/, "steak grill"],
  [/\b(frances|francesa|french|bistro|brasserie)\b/, "french bistro food"],
  [/\b(espanol|espanola|spanish|tapas|paella)\b/, "spanish tapas"],
  [/\b(griega|griego|greek)\b/, "greek food"],
  [/\b(mediterrane|mediterranean)/, "mediterranean food"],
  [/\b(chin|chinese|dim sum|cantones)/, "chinese dim sum"],
  [/\b(thai|tailandes)/, "thai food"],
  [/\b(india|indian|hindu|curry)\b/, "indian curry"],
  [/\b(coreana|coreano|korean)\b/, "korean bbq"],
  [/\b(vegan|vegetarian|vegetariana|plant based)/, "vegan bowl"],
  [/\b(hamburgues|burger)/, "gourmet burger"],
  [/\b(cafe|cafeteria|coffee|panaderia|bakery|pasteleria)\b/, "coffee shop pastry"],
  [/\b(brunch|desayuno|breakfast)\b/, "brunch table"],
  [/\b(postre|helado|dessert|chocolate)/, "dessert plating"],
  [/\b(mezcal|mezcaleria)\b/, "mezcal cocktail bar"],
  [/\b(cocteleria|cocktail|speakeasy|bar|cantina|pub)\b/, "cocktail bar"],
  [/\b(vino|wine|vinoteca|enoteca)\b/, "wine bar"],
  [/\b(alta cocina|fine dining|degustacion|tasting|gourmet|autor|michelin)\b/, "fine dining plating"],
];

const ACTIVITY: Rule[] = [
  [/\b(kayak|canoa|paddle|sup)\b/, "kayak tour"],
  [/\b(snorkel|buceo|scuba|diving)\b/, "snorkeling reef"],
  [/\b(cenote|cenotes)\b/, "cenote swimming"],
  [/\b(globo|hot air balloon|balloon)\b/, "hot air balloon sunrise"],
  [/\b(vino|vinedo|wine|winery|cata)\b/, "vineyard wine tasting"],
  [/\b(cocina|cooking|clase de cocina)\b/, "cooking class"],
  [/\b(gastronom|food tour|comida|mercado|market|tasting)\b/, "street food tour market"],
  [/\b(museo|museum|galeria|gallery|arte|art)\b/, "art museum gallery"],
  [/\b(catedral|cathedral|iglesia|church|basilica|templo|convento)\b/, "cathedral architecture"],
  [/\b(piramide|pyramid|zona arqueologica|ruinas|ruins|arqueolog)\b/, "ancient pyramid ruins"],
  [/\b(playa|beach|isla|island)\b/, "tropical beach"],
  [/\b(yate|yacht|velero|sailing|barco|boat|catamaran)\b/, "yacht sailing"],
  [/\b(senderismo|hiking|hike|trek|montana|volcan|volcano)\b/, "mountain hiking trail"],
  [/\b(bici|bicicleta|bike|cycling)\b/, "city bike tour"],
  [/\b(spa|masaje|temazcal|wellness|yoga)\b/, "luxury spa"],
  [/\b(tequila|mezcal|destileria|distillery)\b/, "agave tequila distillery"],
  [/\b(show|espectaculo|teatro|opera|concierto|lucha libre)\b/, "theater show stage"],
  [/\b(nocturn|night|antro|club)\b/, "city nightlife"],
  [/\b(caminata|walking|a pie|centro historico|old town|recorrido|tour)\b/, "historic old town walking tour"],
  [/\b(golf)\b/, "golf course"],
  [/\b(safari|wildlife|ballena|whale|tortuga|turtle)\b/, "wildlife safari"],
];

const VENUE: Record<string, string> = {
  cabaret: "cabaret stage lights",
  burlesque: "burlesque show stage",
  members_club: "private members club lounge",
  speakeasy: "speakeasy cocktail bar",
  rooftop: "rooftop bar city night",
  casino_vip: "casino roulette table",
  jazz_lounge: "jazz club live music",
  evento_vip: "champagne gala event",
};

const first = (rules: Rule[], text: string) => rules.find(([re]) => re.test(text))?.[1] ?? null;

/**
 * Variante estable: por posición en la lista (número: tarjetas seguidas nunca repiten) o por nombre
 * (texto). Como mucho 2–3 consultas por tipo en toda la app.
 */
export type Seed = string | number | null | undefined;
function pick(options: string[], seed?: Seed): string {
  if (typeof seed === "number" && Number.isFinite(seed)) return options[Math.abs(Math.trunc(seed)) % options.length];
  const s = norm(seed);
  if (!s) return options[0];
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return options[h % options.length];
}

/**
 * Comida de la cocina del restaurante ("Italiana" → pasta). Con `name`, una de dos variantes estables
 * para que dos restaurantes poblanos seguidos no muestren la misma foto.
 */
export function cuisineQuery(cuisine?: string | null, name?: string | null, seed?: Seed): string {
  const q = first(CUISINE, norm(cuisine)) ?? first(CUISINE, norm(name)) ?? "fine dining restaurant dish";
  // Segunda variante con otra consulta (Pexels da la misma primera foto a consultas casi iguales).
  const alt = `${q.split(" ")[0]} cuisine restaurant table`;
  return seed !== undefined && seed !== null ? pick([q, alt], seed) : q;
}

/**
 * Experiencia o tour por su nombre ("Tour en kayak" → kayak). Si el nombre no dice el tipo, la ciudad
 * (con variante por posición: tres tours seguidos no repiten foto).
 */
export function activityQuery(name?: string | null, city?: string | null, seed?: Seed): string {
  const hit = first(ACTIVITY, norm(name));
  if (hit) return hit;
  const c = String(city ?? "").trim();
  return c ? pick([`${c} landmark`, `${c} street architecture`, `${c} old town`], seed ?? 0) : "travel experience";
}

/** Fondo de una tarjeta de vuelo (el logo real va encima): tres variantes estables. */
export function flightBackdropQuery(seed?: Seed): string {
  return pick(["airplane wing above clouds", "airplane window view sunset", "airliner on runway golden hour"], seed);
}

/**
 * Hotel sin foto propia: interiores de hotel (nunca la fachada de "otro" hotel). `seed` elige una de
 * tres variantes (como mucho tres consultas por tipo en toda la app).
 */
export function hotelQuery(tier?: string | null, seed?: Seed): string {
  const t = norm(tier);
  if (/\b(econom|hostal|hostel)/.test(t)) return pick(["cozy hotel room", "hotel room window light", "minimalist hotel bedroom"], seed);
  if (/\b(boutique|colonial|historic)/.test(t)) return pick(["boutique hotel room interior", "colonial hotel courtyard", "boutique hotel lobby"], seed);
  if (/\b(resort|playa|beach|todo incluido|all inclusive)/.test(t)) return pick(["luxury beach resort pool", "resort infinity pool ocean", "beach resort suite"], seed);
  return pick(["luxury hotel suite interior", "luxury hotel lobby", "hotel bed white linen"], seed);
}

/** Venue de Members Only por su categoría. */
export function venueQuery(category?: string | null): string {
  const c = String(category ?? "").trim().toLowerCase();
  return VENUE[c] ?? first(CUISINE, norm(c)) ?? "luxury cocktail lounge";
}

/**
 * Primer lugar de una ruta escrita: "Tokio → Kioto → Osaka" → "Tokio"; "Los Cabos (2)" → "Los Cabos".
 * Caso Carlo (29-oct-2026): con la ruta completa la consulta quedaba «tokio → kioto → osaka japón
 * travel» y Pexels no regresaba foto (la tarjeta se quedaba con el ícono).
 */
export function firstPlaceOf(text?: string | null): string {
  return String(text ?? "").split(/\s*(?:→|->|\||;)\s*/)[0]
    .replace(/\s*\(\d+\)\s*$/, "").replace(/[….\s]+$/, "").trim();
}

/** Destino (ciudad o país) para portadas de viaje y comparaciones. Con una ruta, su primera ciudad. */
export function destinationQuery(city?: string | null, country?: string | null): string {
  return [firstPlaceOf(city), country].map((v) => String(v ?? "").trim()).filter(Boolean).join(" ") + " travel";
}

/** Categoría de "Mis reservas" (y similares). */
export function bookingCategoryQuery(category?: string | null, city?: string | null, seed?: Seed): string {
  switch (category) {
    case "flight": return flightBackdropQuery(seed);
    case "hotel": return hotelQuery(null, seed);
    case "restaurant": return cuisineQuery(null, null, seed);
    case "activity": return activityQuery(null, city);
    case "train": return "high speed train europe";
    case "ferry": return "ferry sea island";
    case "car": return "convertible car coastal road";
    case "esim": return "smartphone travel map";
    case "insurance": return "airport terminal travelers";
    default: return "luxury travel";
  }
}

/**
 * ¿El título de una reserva/visita nombra UN lugar ("Hotel Morada") y no una búsqueda ("Hoteles en
 * Roma", "Reservar mesa en CDMX", "MEX → MAD")? Solo entonces se busca su foto real.
 */
export function isSpecificVenueTitle(category: string | null | undefined, title: string | null | undefined): boolean {
  if (!["hotel", "restaurant", "activity"].includes(String(category ?? ""))) return false;
  const t = String(title ?? "").trim();
  if (t.length < 3 || t.length > 90) return false;
  if (/→|->|\bvs\.?\b/.test(t)) return false;
  return !/^(hoteles|hospedaje|reservar|reserva|buscar|busca|mesa|mesas|restaurantes|tours?|actividades|experiencias|vuelos?|autos?|trenes?|ferr(y|ies)|cruceros?|seguros?|esim)\b/i.test(norm(t));
}
