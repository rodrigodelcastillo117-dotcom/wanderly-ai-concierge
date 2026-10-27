// Taquillas OFICIALES de museos y monumentos principales (tabla curada). Sin dependencias de Deno: la
// usan concierge-chat (Iato), experiencias-top y la pantalla (cards de lugar, pestaña Experiencias).
//
// Regla: cada URL es del dominio oficial del museo (o la que su sitio oficial enlaza como "comprar
// boletos"), comprobada el 2026-10-27 (curl con la red de la sesión y WebFetch). La nota solo dice lo
// que publica la fuente oficial (`nota_fuente`); si la fuente no lo dice, no hay nota. Nada de
// "se agota" ni "reserva obligatoria" de blogs o revendedores.
// `verificacion.estado`:
//   * "responde": la taquilla respondió (200 o redirección propia) a la comprobación automática;
//   * "bloquea_robots": el sitio oficial rechaza la comprobación automática (403/503 anti-robot) o
//     no se pudo abrir desde la red de pruebas; el dominio sale del sitio oficial o de su ficha pública.
// "Con guía o sin fila en Viator" es una BÚSQUEDA de Viator (afiliado de IATOS), no una taquilla.
import { VIATOR_MCID, VIATOR_PID } from "./viator.ts";

export type OfficialTicket = {
  id: string;
  /** Nombre en español. */
  nombre: string;
  /** Ciudad en español (la de los viajes). */
  ciudad: string;
  iso2: string;
  /** Nombres con que lo nombran Google Maps, el usuario o Iato (italiano, inglés, español). */
  aliases: string[];
  /** Taquilla oficial (boletos). */
  taquilla_url: string;
  /** Quién vende en la taquilla oficial. */
  operador: string;
  sitio_oficial: string;
  /** Solo lo que dice la fuente oficial; null si no lo dice. */
  nota: string | null;
  nota_fuente: string | null;
  /** true solo si la fuente oficial lo dice. */
  reserva_obligatoria: boolean | null;
  /** Qué buscar en Viator para "con guía o sin fila". */
  viator_query: string;
  verificacion: { fecha: string; estado: "responde" | "bloquea_robots"; detalle: string };
};

const V = "2026-10-27";

export const OFFICIAL_TICKETS: OfficialTicket[] = [
  // ─── Roma ───
  {
    id: "musei-vaticani", nombre: "Museos Vaticanos y Capilla Sixtina", ciudad: "Roma", iso2: "VA",
    aliases: ["musei vaticani", "vatican museums", "museos vaticanos", "capilla sixtina", "cappella sistina", "sistine chapel", "museo vaticano"],
    taquilla_url: "https://tickets.museivaticani.va/home", operador: "Musei Vaticani", sitio_oficial: "https://www.museivaticani.va/",
    nota: "El único sitio oficial para comprar boletos en línea es tickets.museivaticani.va.",
    nota_fuente: "https://www.museivaticani.va/content/museivaticani/en.html", reserva_obligatoria: null,
    viator_query: "Museos Vaticanos Capilla Sixtina",
    verificacion: { fecha: V, estado: "responde", detalle: "tickets.museivaticani.va/home respondió 200; museivaticani.va redirige a su contenido oficial." },
  },
  {
    id: "colosseo", nombre: "Coliseo, Foro Romano y Palatino", ciudad: "Roma", iso2: "IT",
    aliases: ["colosseo", "colosseum", "coliseo", "coliseo romano", "anfiteatro flavio", "foro romano", "roman forum", "palatino", "palatine hill", "parco archeologico del colosseo"],
    taquilla_url: "https://ticketing.colosseo.it/", operador: "Parco archeologico del Colosseo", sitio_oficial: "https://colosseo.it/",
    nota: "El boleto es nominativo: en la entrada piden tu identificación junto con el boleto.",
    nota_fuente: "https://colosseo.it/", reserva_obligatoria: null,
    viator_query: "Coliseo Foro Romano Palatino",
    verificacion: { fecha: V, estado: "responde", detalle: "ticketing.colosseo.it respondió 200 (con página de verificación anti-robot); colosseo.it no respondió a la comprobación automática." },
  },
  {
    id: "galleria-borghese", nombre: "Galería Borghese", ciudad: "Roma", iso2: "IT",
    aliases: ["galleria borghese", "borghese gallery", "galeria borghese", "museo borghese", "villa borghese gallery"],
    taquilla_url: "https://galleriaborghese.cultura.gov.it/en/info/", operador: "Galleria Borghese (Ministero della Cultura)", sitio_oficial: "https://galleriaborghese.cultura.gov.it/",
    nota: "Reserva obligatoria para todos los boletos, incluso los gratuitos.",
    nota_fuente: "https://galleriaborghese.cultura.gov.it/en/info/", reserva_obligatoria: true,
    viator_query: "Galería Borghese",
    verificacion: { fecha: V, estado: "bloquea_robots", detalle: "galleriaborghese.cultura.gov.it no respondió a la comprobación automática (503 / conexión cortada); la regla de reserva sale de su página de información." },
  },
  {
    id: "cupola-san-pietro", nombre: "Basílica de San Pedro (cúpula)", ciudad: "Roma", iso2: "VA",
    aliases: ["basilica di san pietro", "st peter's basilica", "st peters basilica", "basilica de san pedro", "cupola di san pietro", "cupola san pietro", "cupula de san pedro", "st peter's dome"],
    taquilla_url: "https://www.basilicasanpietro.va/en/products/the-dome", operador: "Fabbrica di San Pietro", sitio_oficial: "https://www.basilicasanpietro.va/",
    nota: "La reserva de la cúpula trae un horario de entrada.",
    nota_fuente: "https://www.basilicasanpietro.va/en/products/the-dome", reserva_obligatoria: null,
    viator_query: "Basílica de San Pedro cúpula",
    verificacion: { fecha: V, estado: "responde", detalle: "basilicasanpietro.va/en/products/the-dome respondió 200." },
  },
  // ─── Florencia ───
  {
    id: "uffizi", nombre: "Galería Uffizi", ciudad: "Florencia", iso2: "IT",
    aliases: ["galleria degli uffizi", "uffizi gallery", "galeria uffizi", "galeria de los uffizi", "uffizi", "gallerie degli uffizi"],
    taquilla_url: "https://tickets.uffizi.it/", operador: "Gallerie degli Uffizi", sitio_oficial: "https://www.uffizi.it/",
    nota: "El boleto comprado antes del día de la visita es nominativo (precio con reserva); el Corredor Vasariano requiere reserva y tiene cupo limitado.",
    nota_fuente: "https://www.uffizi.it/en/tickets", reserva_obligatoria: null,
    viator_query: "Galería Uffizi",
    verificacion: { fecha: V, estado: "responde", detalle: "tickets.uffizi.it respondió 200; uffizi.it/en/tickets enlaza ahí todos los botones de compra." },
  },
  {
    id: "galleria-accademia", nombre: "Galería de la Academia (el David)", ciudad: "Florencia", iso2: "IT",
    aliases: ["galleria dell'accademia", "galleria dell accademia", "galleria accademia", "accademia gallery", "galeria de la academia", "david di michelangelo", "david de miguel angel", "david of michelangelo"],
    taquilla_url: "https://www.galleriaaccademiafirenze.it/", operador: "Galleria dell'Accademia di Firenze", sitio_oficial: "https://www.galleriaaccademiafirenze.it/",
    nota: null, nota_fuente: null, reserva_obligatoria: null,
    viator_query: "Galería de la Academia David",
    verificacion: { fecha: V, estado: "bloquea_robots", detalle: "galleriaaccademiafirenze.it no se pudo abrir en la comprobación automática (503 y cadena TLS incompleta para curl); no se encontró en la fuente oficial una regla de reserva." },
  },
  {
    id: "duomo-firenze", nombre: "Duomo y cúpula de Brunelleschi", ciudad: "Florencia", iso2: "IT",
    aliases: ["duomo di firenze", "cattedrale di santa maria del fiore", "santa maria del fiore", "cupola del brunelleschi", "brunelleschi's dome", "brunelleschi dome", "florence cathedral", "catedral de florencia", "duomo de florencia", "campanile di giotto", "battistero di san giovanni"],
    taquilla_url: "https://tickets.duomo.firenze.it/", operador: "Opera di Santa Maria del Fiore", sitio_oficial: "https://duomo.firenze.it/",
    nota: "La taquilla oficial vende el Brunelleschi Pass, el Giotto Pass y el Ghiberti Pass.",
    nota_fuente: "https://tickets.duomo.firenze.it/it/", reserva_obligatoria: null,
    viator_query: "Duomo Florencia cúpula Brunelleschi",
    verificacion: { fecha: V, estado: "responde", detalle: "tickets.duomo.firenze.it redirige a /it/ (\"Biglietteria ufficiale\"); duomo.firenze.it rechaza la comprobación automática (403)." },
  },
  {
    id: "palazzo-pitti", nombre: "Palacio Pitti", ciudad: "Florencia", iso2: "IT",
    aliases: ["palazzo pitti", "pitti palace", "palacio pitti", "giardino di boboli", "boboli gardens", "jardin de boboli", "jardines de boboli"],
    taquilla_url: "https://tickets.uffizi.it/", operador: "Gallerie degli Uffizi", sitio_oficial: "https://www.uffizi.it/palazzo-pitti",
    nota: "Se compra en la taquilla oficial de las Galerías Uffizi (tickets.uffizi.it).",
    nota_fuente: "https://www.uffizi.it/en/tickets", reserva_obligatoria: null,
    viator_query: "Palacio Pitti Jardines de Bóboli",
    verificacion: { fecha: V, estado: "responde", detalle: "uffizi.it/palazzo-pitti y tickets.uffizi.it respondieron 200." },
  },
  // ─── Venecia ───
  {
    id: "palazzo-ducale", nombre: "Palacio Ducal", ciudad: "Venecia", iso2: "IT",
    aliases: ["palazzo ducale", "doge's palace", "doges palace", "palacio ducal", "palacio ducal de venecia", "palacio de los dogos"],
    taquilla_url: "https://muve.vivaticket.it/en/tour/palazzo-ducale/2478", operador: "Fondazione Musei Civici di Venezia (venta en Vivaticket)", sitio_oficial: "https://palazzoducale.visitmuve.it/",
    nota: "El precio en línea más bajo solo aplica comprando con al menos 30 días de anticipación.",
    nota_fuente: "https://palazzoducale.visitmuve.it/en/visitor-information/", reserva_obligatoria: null,
    viator_query: "Palacio Ducal Venecia",
    verificacion: { fecha: V, estado: "responde", detalle: "El botón \"Buy your ticket\" de palazzoducale.visitmuve.it lleva a muve.vivaticket.it, que respondió 200." },
  },
  {
    id: "basilica-san-marco", nombre: "Basílica de San Marcos", ciudad: "Venecia", iso2: "IT",
    aliases: ["basilica di san marco", "st mark's basilica", "st marks basilica", "basilica de san marcos", "san marco basilica", "pala d'oro"],
    taquilla_url: "https://tickets.basilicasanmarco.it/en/store", operador: "Procuratoria di San Marco", sitio_oficial: "https://www.basilicasanmarco.it/",
    nota: null, nota_fuente: null, reserva_obligatoria: null,
    viator_query: "Basílica de San Marcos",
    verificacion: { fecha: V, estado: "responde", detalle: "basilicasanmarco.it enlaza \"Buy Tickets\" a tickets.basilicasanmarco.it, que respondió 200." },
  },
  // ─── Toscana ───
  {
    id: "torre-pisa", nombre: "Torre de Pisa", ciudad: "Pisa", iso2: "IT",
    aliases: ["torre di pisa", "leaning tower of pisa", "torre pendente", "torre pendente di pisa", "torre inclinada de pisa", "torre de pisa", "piazza dei miracoli", "campanile di pisa"],
    taquilla_url: "https://www.opapisa.it/en/tickets/buy/", operador: "Opera della Primaziale Pisana", sitio_oficial: "https://www.opapisa.it/",
    nota: "Puedes comprar boletos por adelantado hasta el mismo día de la visita.",
    nota_fuente: "https://www.opapisa.it/en/", reserva_obligatoria: null,
    viator_query: "Torre de Pisa",
    verificacion: { fecha: V, estado: "responde", detalle: "opapisa.it/en/tickets/buy/ respondió 200." },
  },
  // ─── Principales del mundo ───
  {
    id: "louvre", nombre: "Museo del Louvre", ciudad: "París", iso2: "FR",
    aliases: ["musee du louvre", "louvre museum", "museo del louvre", "louvre"],
    taquilla_url: "https://ticket.louvre.fr/en", operador: "Musée du Louvre", sitio_oficial: "https://www.louvre.fr/",
    nota: "El museo recomienda reservar un horario, incluso para visitas gratuitas.",
    nota_fuente: "https://www.louvre.fr/en/visit", reserva_obligatoria: null,
    viator_query: "Museo del Louvre",
    verificacion: { fecha: V, estado: "bloquea_robots", detalle: "louvre.fr/en/visit enlaza a ticket.louvre.fr/en; esa taquilla rechaza la comprobación automática (403)." },
  },
  {
    id: "sagrada-familia", nombre: "Sagrada Familia", ciudad: "Barcelona", iso2: "ES",
    aliases: ["sagrada familia", "basilica de la sagrada familia", "temple expiatori de la sagrada familia", "sagrada família"],
    taquilla_url: "https://sagradafamilia.org/en/tickets", operador: "Junta Constructora del Temple Expiatori de la Sagrada Família", sitio_oficial: "https://sagradafamilia.org/",
    nota: "El 27 de octubre de 2026 su sitio oficial decía que la Basílica está cerrada temporalmente al público: revisa antes de ir.",
    nota_fuente: "https://sagradafamilia.org/en/tickets", reserva_obligatoria: null,
    viator_query: "Sagrada Familia",
    verificacion: { fecha: V, estado: "responde", detalle: "sagradafamilia.org/en/tickets respondió 200." },
  },
  {
    id: "alhambra", nombre: "Alhambra", ciudad: "Granada", iso2: "ES",
    aliases: ["alhambra", "la alhambra", "alhambra y generalife", "generalife", "alhambra palace"],
    taquilla_url: "https://tickets.alhambra-patronato.es/en/", operador: "Patronato de la Alhambra y Generalife", sitio_oficial: "https://www.alhambra-patronato.es/",
    nota: null, nota_fuente: null, reserva_obligatoria: null,
    viator_query: "Alhambra Granada",
    verificacion: { fecha: V, estado: "bloquea_robots", detalle: "alhambra-patronato.es respondió 200 y enlaza \"Buy tickets\" a tickets.alhambra-patronato.es, que rechaza la comprobación automática (403)." },
  },
  {
    id: "museo-prado", nombre: "Museo del Prado", ciudad: "Madrid", iso2: "ES",
    aliases: ["museo del prado", "museo nacional del prado", "prado museum", "museo prado"],
    taquilla_url: "https://www.museodelprado.es/", operador: "Museo Nacional del Prado", sitio_oficial: "https://www.museodelprado.es/",
    nota: null, nota_fuente: null, reserva_obligatoria: null,
    viator_query: "Museo del Prado",
    verificacion: { fecha: V, estado: "bloquea_robots", detalle: "museodelprado.es rechaza la comprobación automática (403); no se pudo leer el enlace exacto de su taquilla." },
  },
];

const norm = (v: unknown) => String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/['’]/g, " ").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();

const CITY_ALIASES: Record<string, string[]> = {
  roma: ["roma", "rome", "ciudad del vaticano", "vatican city", "vaticano"],
  florencia: ["florencia", "florence", "firenze"],
  venecia: ["venecia", "venice", "venezia"],
  pisa: ["pisa"],
  paris: ["paris"],
  barcelona: ["barcelona"],
  granada: ["granada"],
  madrid: ["madrid"],
};

/** ¿La ciudad del viaje es la del museo? ("Firenze", "Florence" y "Florencia" son la misma). */
export function sameTicketCity(a: unknown, b: unknown): boolean {
  const x = norm(a), y = norm(b);
  if (!x || !y) return false;
  if (x === y) return true;
  for (const list of Object.values(CITY_ALIASES)) if (list.includes(x) && list.includes(y)) return true;
  return false;
}

/** Museos y monumentos de la tabla en esa ciudad (Roma incluye el Vaticano). */
export function officialTicketsForCity(city: unknown): OfficialTicket[] {
  return OFFICIAL_TICKETS.filter((t) => sameTicketCity(t.ciudad, city));
}

/**
 * Museo de la tabla que nombra un lugar o una consulta ("Galleria degli Uffizi", "boletos para el
 * Coliseo", "Duomo di Firenze"). Solo coincide un alias completo (palabras enteras); con ciudad, el
 * museo debe ser de esa ciudad. null si no hay coincidencia clara.
 */
export function matchOfficialTicket(text: unknown, city?: unknown): OfficialTicket | null {
  const t = ` ${norm(text)} `;
  if (t.trim().length < 4) return null;
  let best: { e: OfficialTicket; len: number } | null = null;
  for (const e of OFFICIAL_TICKETS) {
    if (city && norm(city) && !sameTicketCity(e.ciudad, city)) continue;
    for (const a of e.aliases) {
      const n = norm(a);
      if (n.length < 4) continue;
      if (t.includes(` ${n} `) && (!best || n.length > best.len)) best = { e, len: n.length };
    }
  }
  return best?.e ?? null;
}

/** "Con guía o sin fila en Viator": búsqueda de Viator con el afiliado de IATOS (no es una taquilla). */
export function viatorAlternativeUrl(e: Pick<OfficialTicket, "viator_query" | "ciudad">): string {
  const q = new URLSearchParams({ text: `${e.viator_query} ${e.ciudad}`.trim(), pid: VIATOR_PID, mcid: VIATOR_MCID, medium: "link", medium_version: "selector", campaign: "IATOS" });
  return `https://www.viator.com/searchResults/all?${q.toString()}`;
}

/** Datos compactos para una card o para el modelo (sin la tabla entera). */
export function ticketSummary(e: OfficialTicket) {
  return {
    id: e.id, nombre: e.nombre, ciudad: e.ciudad, taquilla_oficial: e.taquilla_url, operador: e.operador, nota: e.nota,
    reserva_obligatoria: e.reserva_obligatoria, sin_fila_viator: viatorAlternativeUrl(e), verificado: e.verificacion.fecha,
  };
}
