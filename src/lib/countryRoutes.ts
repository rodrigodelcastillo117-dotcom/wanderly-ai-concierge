// Destino de tipo país ("india", "Italia", "Japón", "Europa") → ruta de ciudades propuesta. Caso del
// dueño (23-oct-2026): escribió "india", 14 noches, y el viaje quedó con UNA "ciudad" llamada India (un
// vuelo "Ciudad de México → india" y un hotel "india · 14 noches"), aunque las experiencias del propio
// análisis estaban en Delhi, Agra, Jaipur y Ranthambore.
//
// Las rutas son circuitos clásicos (no ofertas ni precios): la persona las ve como PROPUESTA y las
// ajusta antes de generar. Cada ciudad lleva un peso para repartir las noches; con pocas noches se quitan
// las de menor prioridad. La primera y la última tienen aeropuerto internacional (DEL, FCO, NRT…).
import { splitNights } from "../../supabase/functions/_shared/booking/tripRoute.ts";
import { sameCity } from "../../supabase/functions/_shared/booking/tripRoute.ts";
import { basesForNights, findRegion } from "../../supabase/functions/_shared/regions.ts";

type Stop = { city: string; weight: number; /** 1 = imprescindible; más alto se quita primero. */ prio: number; /** Qué tiene (lugares conocidos, sin precios). */ why: string; tags: string[] };
type CountryRoute = { country: string; aliases: string[]; stops: Stop[] };

const S = (city: string, weight: number, prio = 1, why = "", tags: string[] = []): Stop => ({ city, weight, prio, why, tags });

export const COUNTRY_ROUTES: CountryRoute[] = [
  // Triángulo de Oro + Ranthambore, de regreso a Delhi para el vuelo internacional (DEL).
  { country: "India", aliases: ["india"], stops: [
    S("Delhi", 4, 1, "Llegada internacional (DEL): Fuerte Rojo, Qutab Minar y Chandni Chowk.", ["historia", "cultura", "gastronomia", "mercado"]),
    S("Agra", 2, 1, "El Taj Mahal al amanecer y el Fuerte de Agra (a ~2 h de Delhi en tren).", ["historia", "arte", "cultura"]),
    S("Jaipur", 4, 1, "La Ciudad Rosa: Fuerte Amber, Hawa Mahal y Jal Mahal.", ["historia", "arte", "cultura", "compras"]),
    S("Ranthambore", 2, 3, "Safari para ver tigres en el parque nacional (a ~3 h de Jaipur).", ["naturaleza", "aventura"]),
    S("Delhi", 2, 2, "Regreso a Delhi para el vuelo internacional, sin correr.", ["compras", "gastronomia"]),
  ] },
  { country: "Italia", aliases: ["italia", "italy"], stops: [
    S("Roma", 4, 1, "Coliseo, Foro Romano y Vaticano; llegada internacional (FCO).", ["historia", "arte", "cultura"]),
    S("Florencia", 3, 1, "Uffizi, el Duomo y la Toscana (1 h 30 en tren desde Roma).", ["arte", "gastronomia", "vino"]),
    S("Venecia", 2, 2, "Canales, San Marcos y la salida internacional (VCE).", ["arte", "romance"]),
    S("Milán", 2, 3, "La Última Cena, el Duomo y la moda.", ["arte", "compras"]),
  ] },
  { country: "Japón", aliases: ["japon", "japan"], stops: [
    S("Tokio", 5, 1, "Shibuya, Asakusa y la mejor comida del mundo; llegada (HND/NRT).", ["gastronomia", "cultura", "nocturna", "compras"]),
    S("Kioto", 4, 1, "Templos, Fushimi Inari y Gion (2 h 15 en shinkansen).", ["historia", "cultura", "arte"]),
    S("Osaka", 2, 2, "Comida callejera en Dotonbori y salida por KIX.", ["gastronomia", "nocturna"]),
  ] },
  { country: "Francia", aliases: ["francia", "france"], stops: [
    S("París", 5, 1, "Louvre, Torre Eiffel y Montmartre; llegada (CDG).", ["arte", "historia", "gastronomia", "romance"]),
    S("Lyon", 2, 3, "Capital gastronómica de Francia (2 h en TGV).", ["gastronomia", "vino"]),
    S("Niza", 3, 2, "Costa Azul, la Promenade y pueblos como Èze.", ["playa", "relax"]),
  ] },
  { country: "España", aliases: ["espana", "spain"], stops: [
    S("Madrid", 4, 1, "El Prado, el Retiro y tapas; llegada (MAD).", ["arte", "gastronomia", "nocturna"]),
    S("Sevilla", 3, 2, "Alcázar, catedral y flamenco (2 h 30 en AVE).", ["historia", "cultura"]),
    S("Barcelona", 4, 1, "Gaudí, el Gótico y la playa; salida (BCN).", ["arte", "playa", "gastronomia"]),
  ] },
  { country: "Grecia", aliases: ["grecia", "greece"], stops: [
    S("Atenas", 3, 1, "Acrópolis y Plaka; llegada internacional (ATH).", ["historia", "cultura"]),
    S("Santorini", 3, 1, "Atardecer en Oia y caldera (ferry o vuelo corto).", ["romance", "playa", "relax"]),
    S("Mykonos", 2, 2, "Playas y vida nocturna.", ["playa", "nocturna"]),
  ] },
  { country: "Portugal", aliases: ["portugal"], stops: [
    S("Lisboa", 4, 1, "Alfama, Belém y Sintra cerca; llegada (LIS).", ["historia", "gastronomia"]),
    S("Oporto", 3, 1, "Ribeira y bodegas de vino de Oporto (3 h en tren).", ["vino", "gastronomia"]),
  ] },
  { country: "Perú", aliases: ["peru"], stops: [
    S("Lima", 3, 1, "Capital gastronómica de América; llegada (LIM).", ["gastronomia"]),
    S("Cusco", 5, 1, "Valle Sagrado y Machu Picchu (vuelo de 1 h 20).", ["historia", "aventura", "naturaleza"]),
  ] },
  { country: "Marruecos", aliases: ["marruecos", "morocco"], stops: [
    S("Marrakech", 5, 1, "Medina, Jemaa el-Fna y jardín Majorelle; llegada (RAK).", ["cultura", "compras", "gastronomia"]),
    S("Fez", 3, 2, "La medina medieval más grande del mundo.", ["historia", "cultura"]),
  ] },
  { country: "Egipto", aliases: ["egipto", "egypt"], stops: [
    S("El Cairo", 4, 1, "Pirámides de Giza y el Gran Museo Egipcio; llegada (CAI).", ["historia", "cultura"]),
    S("Luxor", 3, 1, "Valle de los Reyes y Karnak (vuelo de 1 h).", ["historia", "arte"]),
  ] },
  { country: "Tailandia", aliases: ["tailandia", "thailand"], stops: [
    S("Bangkok", 4, 1, "Templos, mercados y comida callejera; llegada (BKK).", ["gastronomia", "cultura", "nocturna"]),
    S("Chiang Mai", 3, 2, "Templos del norte y santuarios de elefantes.", ["naturaleza", "cultura"]),
    S("Phuket", 4, 1, "Playas e islas del mar de Andamán.", ["playa", "relax"]),
  ] },
  { country: "Estados Unidos", aliases: ["estados unidos", "usa", "eeuu", "ee uu"], stops: [
    S("Nueva York", 4, 1, "Manhattan, museos y Broadway.", ["arte", "cultura", "compras", "nocturna"]),
    S("Chicago", 2, 3, "Arquitectura y jazz.", ["arte", "nocturna"]),
    S("San Francisco", 3, 2, "Golden Gate y valle de Napa cerca.", ["naturaleza", "vino"]),
    S("Los Ángeles", 3, 1, "Hollywood, playas y salida (LAX).", ["playa", "cultura"]),
  ] },
  // Región, no país: la persona elige; se propone un clásico de primera vez.
  { country: "Europa", aliases: ["europa", "europe"], stops: [
    S("Madrid", 3, 1, "Llegada directa desde México (MAD) y El Prado.", ["arte", "gastronomia"]),
    S("París", 4, 1, "Louvre, Torre Eiffel y Montmartre.", ["arte", "romance"]),
    S("Roma", 4, 1, "Coliseo y Vaticano; salida (FCO).", ["historia", "arte"]),
    S("Ámsterdam", 3, 3, "Canales y museos (Rijksmuseum, Van Gogh).", ["arte", "cultura"]),
  ] },
];

const norm = (v: unknown) => String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

/** Ruta del país o región ("india", "Japón", "Europa"); null si no tenemos una propuesta. */
export function countryRouteFor(country: unknown): CountryRoute | null {
  const k = norm(country);
  return COUNTRY_ROUTES.find((r) => norm(r.country) === k || r.aliases.includes(k)) ?? null;
}

/** Todas las ciudades de las rutas por país (para reconocerlas en una frase: "Agra", "Ranthambore"). */
export const ROUTE_CITIES: Array<{ city: string; country: string }> = COUNTRY_ROUTES.filter((r) => r.country !== "Europa")
  .flatMap((r) => r.stops.map((s) => ({ city: s.city, country: r.country })));

/** Noches por peso (suma exacta `total`, al menos 1 por ciudad). */
export function weightedNights(weights: number[], total: number): number[] | null {
  const n = weights.length;
  if (!n || total < n) return null;
  const sum = weights.reduce((a, b) => a + b, 0) || n;
  const raw = weights.map((w) => (w / sum) * total);
  const out = raw.map((x) => Math.max(1, Math.floor(x)));
  let diff = total - out.reduce((a, b) => a + b, 0);
  // Reparte lo que falta (o quita lo que sobra) según la parte decimal / el mayor.
  const order = raw.map((x, i) => [x - Math.floor(x), i] as const).sort((a, b) => b[0] - a[0]).map(([, i]) => i);
  for (let k = 0; diff > 0; k++, diff--) out[order[k % n]] += 1;
  while (diff < 0) {
    const i = out.indexOf(Math.max(...out));
    if (out[i] <= 1) break;
    out[i] -= 1; diff++;
  }
  return out.reduce((a, b) => a + b, 0) === total ? out : splitNights(total, n);
}

export type RouteProposal = { country: string; cities: string[]; weights: number[]; nights: number[] | null; why: string[] };

/**
 * Propuesta para un país con `total` noches (o null si aún no hay fechas: solo el orden). Con pocas
 * noches se quitan las paradas de menor prioridad (al menos ~2 noches por ciudad). Con `prefer` (las
 * ciudades donde el análisis ya puso experiencias o restaurantes), se quedan las de la ruta que el
 * análisis recomendó, si son 2 o más.
 */
export function proposeCountryRoute(country: unknown, total: number | null, prefer: string[] = []): RouteProposal | null {
  const r = countryRouteFor(country);
  if (!r) return null;
  let stops = [...r.stops];
  const liked = prefer.length ? stops.filter((s) => prefer.some((p) => sameCity(p, s.city))) : [];
  if (new Set(liked.map((s) => s.city)).size >= 2) {
    stops = stops.filter((s) => liked.includes(s) || (s === stops[stops.length - 1] && sameCity(s.city, stops[0].city) && liked.includes(stops[0])));
  }
  if (total != null) {
    const maxStops = Math.max(1, Math.floor(total / 2));
    while (stops.length > maxStops && stops.length > 1) {
      const worst = stops.reduce((w, s, i) => (s.prio > stops[w].prio || (s.prio === stops[w].prio && i > w) ? i : w), 0);
      stops.splice(worst, 1);
    }
  }
  // Una sola ciudad no es ruta.
  if (stops.length < 2) return null;
  const cities = stops.map((s) => s.city);
  const weights = stops.map((s) => s.weight);
  return { country: r.country, cities, weights, nights: total != null ? weightedNights(weights, total) : null, why: stops.map((s) => s.why) };
}

/**
 * Propuesta para una región ("Toscana 5 días"): sus bases (Florencia, Siena…) según las noches, como la caja
 * de Iato (regions.ts). Antes la página Planear decía "Entendimos: Toscana" y buscaba una "ciudad" Toscana.
 */
export function proposeRegionRoute(region: unknown, total: number | null): RouteProposal | null {
  const r = findRegion(region);
  if (!r) return null;
  const cities = r.bases.slice(0, basesForNights(total)).map((b) => b[0]);
  if (cities.length < 2) return null;
  const weights = cities.map(() => 1);
  return { country: r.name, cities, weights, nights: total != null ? weightedNights(weights, total) : null, why: cities.map(() => `Base para recorrer ${r.name}.`) };
}

/** "Delhi (4) → Agra (2) → …" */
export function describeProposal(cities: string[], nights: number[] | null): string {
  return cities.map((c, i) => (nights ? `${c} (${nights[i]})` : c)).join(" → ");
}

/**
 * "Por qué" de cada ciudad de la propuesta: lo que el análisis ya encontró ahí (experiencias con su
 * calificación y fuente) y, si coincide, el gusto de la persona (DNA / perfil). Sin datos, la línea
 * del circuito.
 */
export function cityReasons(proposal: Pick<RouteProposal, "country" | "cities" | "why">, analysis: { tours?: any[]; restaurants?: any[] } = {},
  taste: { declared?: string[] } | null = null): string[] {
  const r = countryRouteFor(proposal.country);
  const tastes = (taste?.declared ?? []).map(norm);
  return proposal.cities.map((city, i) => {
    const found = (analysis.tours ?? []).filter((t) => sameCity(t?.ciudad, city)).slice(0, 2);
    const base = found.length
      ? `Tu análisis ya tiene aquí: ${found.map((t) => `${t.nombre}${Number(t?.rating) > 0 ? ` (${Number(t.rating).toLocaleString("es-MX", { maximumFractionDigits: 1 })}${t?.fuente === "tripadvisor" ? " en Tripadvisor" : String(t?.fuente ?? "").startsWith("google") ? " en Google" : ""})` : ""}`).join(" y ")}.`
      : proposal.why[i] || "";
    const stop = r?.stops.find((s) => sameCity(s.city, city));
    const hit = stop?.tags.find((t) => tastes.some((x) => x.startsWith(t.slice(0, 5)) || t.startsWith(x.slice(0, 5))));
    return hit ? `${base} Va con tu gusto por ${hit === "gastronomia" ? "la gastronomía" : hit === "nocturna" ? "la vida nocturna" : `${hit}`}.`.trim() : base;
  });
}
