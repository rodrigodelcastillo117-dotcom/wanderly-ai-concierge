// Catálogo CURADO de programas para la Bóveda. Regla: nunca inventar beneficios.
// · Un nivel solo trae `benefits` si se revisaron en la fuente oficial (`sourceUrl`) en la fecha
//   `verifiedAt`. Se escriben en corto y conservadores ("sujeto a disponibilidad"), sin montos que
//   cambian seguido.
// · Programas de aerolínea: se muestran los beneficios de la ALIANZA (Star Alliance, oneworld,
//   SkyTeam) que corresponden al nivel; los propios de cada aerolínea los agrega la persona.
// · Todo lo que no está curado devuelve null: la UI dice "Agrega tus beneficios o consulta la
//   fuente" con el sitio oficial si lo hay. src/test/bovedaCatalog.test.ts lo vigila.

export type CatalogCategory = "aerolinea" | "hotel" | "auto" | "crucero" | "sala" | "tarjeta" | "viajero_confiable";

export const VERIFIED_AT = "2026-10-22";

export type AllianceTierId = "star-silver" | "star-gold" | "ow-ruby" | "ow-sapphire" | "ow-emerald" | "st-elite" | "st-elite-plus";

type BenefitSet = { label: string; benefits: readonly string[]; sourceUrl: string; verifiedAt: string };

export const ALLIANCE_TIERS: Record<AllianceTierId, BenefitSet> = {
  "star-silver": {
    label: "Star Alliance Silver",
    benefits: ["Prioridad en lista de espera de reservaciones", "Prioridad en espera (standby) en el aeropuerto"],
    sourceUrl: "https://www.staralliance.com/en/benefits", verifiedAt: VERIFIED_AT,
  },
  "star-gold": {
    label: "Star Alliance Gold",
    benefits: [
      "Acceso a salas VIP de Star Alliance para ti y un acompañante (viajes internacionales)",
      "Documentación prioritaria en mostradores Star Alliance Gold",
      "Abordaje prioritario, junto con Primera y Business",
      "Equipaje adicional: 1 pieza más o 20 kg extra",
      "Manejo prioritario de equipaje",
      "Prioridad en lista de espera y standby",
      "Filas Gold Track en seguridad donde existan",
    ],
    sourceUrl: "https://www.staralliance.com/en/benefits", verifiedAt: VERIFIED_AT,
  },
  "ow-ruby": {
    label: "oneworld Ruby",
    benefits: ["Documentación prioritaria en mostradores de Business", "Prioridad en lista de espera y standby"],
    sourceUrl: "https://www.oneworld.com/travel-benefits", verifiedAt: VERIFIED_AT,
  },
  "ow-sapphire": {
    label: "oneworld Sapphire",
    benefits: [
      "Documentación prioritaria en mostradores de Business",
      "Acceso a salas Business o de viajero frecuente para ti y un acompañante",
      "Equipaje documentado adicional",
      "Prioridad en lista de espera y standby",
    ],
    sourceUrl: "https://www.oneworld.com/travel-benefits", verifiedAt: VERIFIED_AT,
  },
  "ow-emerald": {
    label: "oneworld Emerald",
    benefits: [
      "Documentación en mostradores de Primera Clase",
      "Acceso a salas de Primera, Business o viajero frecuente para ti y un acompañante",
      "Abordaje prioritario",
      "Equipaje adicional (20 kg extra en itinerarios por peso)",
      "Fast track en seguridad en aeropuertos seleccionados",
      "Prioridad en lista de espera y standby",
    ],
    sourceUrl: "https://www.oneworld.com/travel-benefits", verifiedAt: VERIFIED_AT,
  },
  "st-elite": {
    label: "SkyTeam Elite",
    benefits: [
      "Documentación prioritaria",
      "Abordaje prioritario",
      "Prioridad en lista de espera",
      "Equipaje adicional: 1 pieza más o 10 kg extra",
    ],
    sourceUrl: "https://www.skyteam.com/en/about/faq/elite-elite-plus", verifiedAt: VERIFIED_AT,
  },
  "st-elite-plus": {
    label: "SkyTeam Elite Plus",
    benefits: [
      "Acceso a salas SkyTeam para ti y un acompañante del mismo vuelo (internacionales y, desde abril de 2025, nacionales)",
      "Documentación y abordaje prioritarios",
      "Equipaje adicional: 1 pieza más o 20 kg extra",
      "Entrega prioritaria de equipaje",
      "Reservación garantizada en económica (tarifa completa) en vuelos largos llenos, pidiéndola 24 h antes",
      "Prioridad en mostradores de conexión y filas rápidas de seguridad e inmigración donde existan",
    ],
    sourceUrl: "https://www.skyteam.com/en/about/faq/elite-elite-plus", verifiedAt: VERIFIED_AT,
  },
};

export type CatalogTier = {
  id: string;
  name: string;
  /** Beneficios de la alianza que da este nivel (programas de aerolínea). */
  alliance?: AllianceTierId;
  /** Beneficios propios del nivel, revisados en `sourceUrl` del nivel o del programa. */
  benefits?: readonly string[];
  sourceUrl?: string;
};

export type CatalogProgram = {
  id: string;
  name: string;
  category: CatalogCategory;
  aliases?: readonly string[];
  /** Sitio oficial del programa (para "consulta la fuente"). */
  officialUrl?: string;
  /** Fuente de los beneficios curados del programa. */
  sourceUrl?: string;
  verifiedAt?: string;
  tiers: readonly CatalogTier[];
  note?: string;
};

const star = (id: string, name: string, alliance: "star-silver" | "star-gold"): CatalogTier => ({ id, name, alliance });
const ow = (id: string, name: string, alliance: "ow-ruby" | "ow-sapphire" | "ow-emerald"): CatalogTier => ({ id, name, alliance });
const st = (id: string, name: string, alliance: "st-elite" | "st-elite-plus"): CatalogTier => ({ id, name, alliance });

const ALLIANCE_NOTE = "Mostramos los beneficios de la alianza para tu nivel; tu aerolínea puede dar más (agrégalos).";

export const CATALOG: readonly CatalogProgram[] = [
  // ── Aerolíneas ──
  {
    id: "aeromexico-rewards", name: "Aeroméxico Rewards", category: "aerolinea", aliases: ["club premier", "aeromexico"],
    officialUrl: "https://www.aeromexico.com/",
    tiers: [st("skyteam-elite", "Nivel con SkyTeam Elite", "st-elite"), st("skyteam-elite-plus", "Nivel con SkyTeam Elite Plus", "st-elite-plus")],
    note: "Los niveles de Aeroméxico Rewards cambiaron en 2024: elige la equivalencia SkyTeam que aparece en tu cuenta y escribe tu nivel. " + ALLIANCE_NOTE,
  },
  {
    id: "united-mileageplus", name: "United MileagePlus", category: "aerolinea", aliases: ["united"],
    officialUrl: "https://www.united.com/",
    tiers: [star("premier-silver", "Premier Silver", "star-silver"), star("premier-gold", "Premier Gold", "star-gold"),
      star("premier-platinum", "Premier Platinum", "star-gold"), star("premier-1k", "Premier 1K", "star-gold")],
    note: ALLIANCE_NOTE,
  },
  {
    id: "aa-aadvantage", name: "American Airlines AAdvantage", category: "aerolinea", aliases: ["american airlines", "aadvantage"],
    officialUrl: "https://www.aa.com/",
    tiers: [ow("gold", "Gold", "ow-ruby"), ow("platinum", "Platinum", "ow-sapphire"), ow("platinum-pro", "Platinum Pro", "ow-sapphire"),
      ow("executive-platinum", "Executive Platinum", "ow-emerald")],
    note: ALLIANCE_NOTE,
  },
  {
    id: "delta-skymiles", name: "Delta SkyMiles", category: "aerolinea", aliases: ["delta"],
    officialUrl: "https://www.delta.com/",
    tiers: [st("silver", "Silver Medallion", "st-elite"), st("gold", "Gold Medallion", "st-elite-plus"),
      st("platinum", "Platinum Medallion", "st-elite-plus"), st("diamond", "Diamond Medallion", "st-elite-plus")],
    note: ALLIANCE_NOTE,
  },
  {
    id: "iberia-club", name: "Iberia Club", category: "aerolinea", aliases: ["iberia plus", "iberia"],
    officialUrl: "https://www.iberia.com/",
    tiers: [ow("plata", "Plata", "ow-ruby"), ow("oro", "Oro", "ow-sapphire"), ow("platino", "Platino", "ow-emerald"), ow("infinita", "Infinita", "ow-emerald")],
    note: ALLIANCE_NOTE,
  },
  {
    id: "ba-executive-club", name: "British Airways Club", category: "aerolinea", aliases: ["british airways", "executive club"],
    officialUrl: "https://www.britishairways.com/",
    tiers: [ow("bronze", "Bronze", "ow-ruby"), ow("silver", "Silver", "ow-sapphire"), ow("gold", "Gold", "ow-emerald")],
    note: ALLIANCE_NOTE,
  },
  {
    id: "avianca-lifemiles", name: "Avianca lifemiles", category: "aerolinea", aliases: ["avianca", "lifemiles"],
    officialUrl: "https://www.lifemiles.com/",
    tiers: [star("silver", "Elite Silver", "star-silver"), star("gold", "Elite Gold", "star-gold"), star("diamond", "Elite Diamond", "star-gold")],
    note: ALLIANCE_NOTE,
  },
  {
    id: "copa-connectmiles", name: "Copa ConnectMiles", category: "aerolinea", aliases: ["copa"],
    officialUrl: "https://www.copaair.com/",
    tiers: [star("silver", "Silver", "star-silver"), star("gold", "Gold", "star-gold"), star("platinum", "Platinum", "star-gold"),
      star("presidential-platinum", "Presidential Platinum", "star-gold")],
    note: ALLIANCE_NOTE,
  },
  {
    id: "aircanada-aeroplan", name: "Air Canada Aeroplan", category: "aerolinea", aliases: ["air canada", "aeroplan"],
    officialUrl: "https://www.aircanada.com/",
    tiers: [star("25k", "25K", "star-silver"), star("35k", "35K", "star-gold"), star("50k", "50K", "star-gold"),
      star("75k", "75K", "star-gold"), star("super-elite", "Super Elite", "star-gold")],
    note: ALLIANCE_NOTE,
  },
  {
    id: "lufthansa-miles-more", name: "Lufthansa Miles & More", category: "aerolinea", aliases: ["lufthansa", "miles & more", "miles and more"],
    officialUrl: "https://www.miles-and-more.com/",
    tiers: [star("frequent-traveller", "Frequent Traveller", "star-silver"), star("senator", "Senator", "star-gold"), star("hon-circle", "HON Circle", "star-gold")],
    note: ALLIANCE_NOTE,
  },
  {
    id: "flying-blue", name: "Air France-KLM Flying Blue", category: "aerolinea", aliases: ["air france", "klm", "flying blue"],
    officialUrl: "https://www.flyingblue.com/",
    tiers: [st("silver", "Silver", "st-elite"), st("gold", "Gold", "st-elite-plus"), st("platinum", "Platinum", "st-elite-plus")],
    note: ALLIANCE_NOTE,
  },
  { id: "volaris", name: "Volaris (v.club / Altitude)", category: "aerolinea", aliases: ["volaris", "vuela volaris", "v.club"], officialUrl: "https://www.volaris.com/", tiers: [] },
  { id: "vivaaerobus", name: "Viva Aerobus", category: "aerolinea", aliases: ["viva"], officialUrl: "https://www.vivaaerobus.com/", tiers: [] },
  { id: "latam-pass", name: "LATAM Pass", category: "aerolinea", aliases: ["latam"], officialUrl: "https://www.latamairlines.com/", tiers: [] },

  // ── Hoteles ──
  {
    id: "marriott-bonvoy", name: "Marriott Bonvoy", category: "hotel", aliases: ["marriott", "bonvoy"],
    officialUrl: "https://www.marriott.com/loyalty.mi", sourceUrl: "https://www.marriott.com/loyalty/member-benefits.mi", verifiedAt: VERIFIED_AT,
    tiers: [
      { id: "member", name: "Member" },
      { id: "silver", name: "Silver Elite", sourceUrl: "https://www.marriott.com/loyalty/member-benefits/silver.mi",
        benefits: ["10% de puntos extra", "Salida tardía prioritaria (sujeta a disponibilidad)"] },
      { id: "gold", name: "Gold Elite", sourceUrl: "https://www.marriott.com/loyalty/member-benefits/gold.mi",
        benefits: ["25% de puntos extra", "Salida tardía hasta las 2 p.m. (sujeta a disponibilidad)", "Regalo de bienvenida en puntos", "Mejora de habitación (sujeta a disponibilidad)"] },
      { id: "platinum", name: "Platinum Elite", sourceUrl: "https://www.marriott.com/loyalty/member-benefits/platinum.mi",
        benefits: ["50% de puntos extra", "Regalo de bienvenida (varía por marca)", "Salida tardía (horario según marca y hotel)", "Mejora de habitación, incluso a suites seleccionadas (sujeta a disponibilidad)", "Acceso a sala ejecutiva en hoteles participantes"] },
      { id: "titanium", name: "Titanium Elite",
        benefits: ["Beneficios de Platinum Elite", "75% de puntos extra", "Habitación garantizada si reservas con 48 h de anticipación", "Estatus United MileagePlus Premier Silver"] },
      { id: "ambassador", name: "Ambassador Elite",
        benefits: ["Beneficios de Titanium Elite", "Servicio Ambassador dedicado"] },
    ],
  },
  {
    id: "hilton-honors", name: "Hilton Honors", category: "hotel", aliases: ["hilton"],
    officialUrl: "https://www.hilton.com/en/hilton-honors/",
    sourceUrl: "https://www.hilton.com/en/help-center/hilton-honors-benefits/tiers-and-benefits/", verifiedAt: VERIFIED_AT,
    tiers: [
      { id: "member", name: "Member" },
      { id: "silver", name: "Silver", benefits: ["20% de puntos extra", "Quinta noche gratis en estancias con puntos", "Agua embotellada en hoteles seleccionados"] },
      { id: "gold", name: "Gold", benefits: ["80% de puntos extra", "Crédito diario de alimentos y bebidas en tarifas elegibles (según tu elección y región)", "Mejora de habitación (sujeta a disponibilidad)"] },
      { id: "diamond", name: "Diamond", benefits: ["100% de puntos extra", "Crédito diario de alimentos y bebidas en tarifas elegibles", "Acceso a sala ejecutiva en hoteles participantes", "Mejora de habitación (sujeta a disponibilidad)"] },
      { id: "diamond-reserve", name: "Diamond Reserve", benefits: ["120% de puntos extra", "Beneficios de Diamond"] },
    ],
  },
  {
    id: "world-of-hyatt", name: "World of Hyatt", category: "hotel", aliases: ["hyatt"],
    officialUrl: "https://world.hyatt.com/", sourceUrl: "https://world.hyatt.com/content/gp/en/tiers-and-benefits.html", verifiedAt: VERIFIED_AT,
    tiers: [
      { id: "member", name: "Member" },
      { id: "discoverist", name: "Discoverist", benefits: ["10% de puntos extra", "Habitación preferida dentro de tu categoría", "Salida tardía al pedirla (hoteles participantes)", "Internet premium donde exista"] },
      { id: "explorist", name: "Explorist", benefits: ["20% de puntos extra", "Mejor habitación disponible al llegar (sin suites ni Club)", "Habitación garantizada en reservas directas hechas 72 h antes", "Beneficios de Discoverist"] },
      { id: "globalist", name: "Globalist", benefits: ["30% de puntos extra", "Mejor habitación disponible, incluso suites estándar y habitaciones Club", "Acceso a sala Club o desayuno completo diario donde no haya sala", "Beneficios de Explorist"] },
    ],
  },
  { id: "ihg-one-rewards", name: "IHG One Rewards", category: "hotel", aliases: ["ihg", "intercontinental", "holiday inn"], officialUrl: "https://www.ihg.com/onerewards/", tiers: [] },
  { id: "accor-all", name: "ALL – Accor Live Limitless", category: "hotel", aliases: ["accor", "all accor"], officialUrl: "https://all.accor.com/", tiers: [] },

  // ── Renta de autos ──
  {
    id: "hertz-gold-plus", name: "Hertz Gold Plus Rewards", category: "auto", aliases: ["hertz"],
    officialUrl: "https://www.hertz.com/", sourceUrl: "https://www.hertz.com/rentacar/misc/index.jsp?targetPage=lamc_membership_benefits.jsp", verifiedAt: VERIFIED_AT,
    tiers: [
      { id: "gold", name: "Gold", benefits: ["Pasar directo a tu auto sin mostrador en ubicaciones participantes", "1 punto por cada dólar en rentas elegibles"] },
      { id: "five-star", name: "Five Star", benefits: ["Mejora de auto sujeta a disponibilidad", "1.25 puntos por dólar", "Pasar directo a tu auto en ubicaciones participantes"] },
      { id: "presidents-circle", name: "President's Circle", benefits: ["Mejora garantizada de una categoría (en EUA, hasta tamaño completo)", "Elección de auto Ultimate Choice en ubicaciones participantes", "1.5 puntos por dólar"] },
    ],
  },
  {
    id: "avis-preferred", name: "Avis Preferred", category: "auto", aliases: ["avis"],
    officialUrl: "https://www.avis.com/en/avis-preferred", sourceUrl: "https://www.avis.com/en/avis-preferred", verifiedAt: VERIFIED_AT,
    tiers: [
      { id: "preferred", name: "Preferred", benefits: ["Pasar directo a tu auto sin mostrador en ubicaciones participantes"] },
      { id: "preferred-plus", name: "Preferred Plus", benefits: ["Mejora gratuita de una categoría de auto", "Más puntos por renta que Preferred"] },
      { id: "presidents-club", name: "President's Club", benefits: ["Mejora gratuita de dos categorías de auto", "Más puntos por renta que Preferred Plus"] },
    ],
  },
  {
    id: "national-emerald-club", name: "National Emerald Club", category: "auto", aliases: ["national", "emerald club"],
    officialUrl: "https://www.nationalcar.com/en/emerald-club.html", sourceUrl: "https://www.nationalcar.com/en/emerald-club/benefits.html", verifiedAt: VERIFIED_AT,
    tiers: [
      { id: "emerald", name: "Emerald Club", benefits: ["Emerald Aisle: elige cualquier auto mediano o superior y paga la tarifa de mediano (EUA y Canadá)", "Día de renta gratis cada 7 créditos"] },
      { id: "executive", name: "Executive", benefits: ["Día de renta gratis cada 6 créditos", "Precio especial en mejoras Premier Selection"] },
      { id: "executive-elite", name: "Executive Elite", benefits: ["Mejora garantizada a autos de tamaño completo a lujo (EUA y Canadá)", "Día de renta gratis cada 5 créditos", "Precio especial en mejoras Premier Selection"] },
    ],
  },
  { id: "sixt", name: "Sixt", category: "auto", officialUrl: "https://www.sixt.com/", tiers: [] },
  { id: "enterprise-plus", name: "Enterprise Plus", category: "auto", aliases: ["enterprise"], officialUrl: "https://www.enterprise.com/", tiers: [] },

  // ── Cruceros ──
  {
    id: "royal-caribbean-cas", name: "Royal Caribbean Crown & Anchor Society", category: "crucero", aliases: ["royal caribbean", "crown & anchor", "crown and anchor"],
    officialUrl: "https://www.royalcaribbean.com/",
    sourceUrl: "https://www.royalcaribbean.com/content/dam/royal/resources/pdf/crown-and-anchor-society-benefit-grid.pdf", verifiedAt: VERIFIED_AT,
    tiers: [
      { id: "gold", name: "Gold" }, { id: "platinum", name: "Platinum" }, { id: "emerald", name: "Emerald" },
      { id: "diamond", name: "Diamond", benefits: ["4 cupones de bebida diarios", "Acceso a la sala de Diamond en barcos seleccionados"] },
      { id: "diamond-plus", name: "Diamond Plus", benefits: ["5 cupones de bebida diarios", "Asientos prioritarios en espectáculos", "Acceso a la sala de Diamond en barcos seleccionados"] },
      { id: "pinnacle", name: "Pinnacle Club" },
    ],
  },
  { id: "carnival-vifp", name: "Carnival VIFP Club", category: "crucero", aliases: ["carnival"], officialUrl: "https://www.carnival.com/", tiers: [] },
  { id: "msc-voyagers", name: "MSC Voyagers Club", category: "crucero", aliases: ["msc"], officialUrl: "https://www.msccruises.com/", tiers: [] },
  { id: "ncl-latitudes", name: "Norwegian Latitudes Rewards", category: "crucero", aliases: ["norwegian", "ncl"], officialUrl: "https://www.ncl.com/", tiers: [] },

  // ── Salas VIP ──
  {
    id: "priority-pass", name: "Priority Pass", category: "sala",
    officialUrl: "https://www.prioritypass.com/", sourceUrl: "https://memberhelp.prioritypass.com/en-GB/support/product-info/what-plans-are-available", verifiedAt: VERIFIED_AT,
    note: "Si tu Priority Pass viene con una tarjeta, las visitas e invitados los define tu banco.",
    tiers: [
      { id: "standard", name: "Standard", benefits: ["Acceso a las salas de la red pagando cada visita"] },
      { id: "standard-plus", name: "Standard Plus", benefits: ["10 visitas sin costo por año de membresía; después se cobran"] },
      { id: "prestige", name: "Prestige", benefits: ["Visitas ilimitadas sin costo para el titular"] },
    ],
  },
  { id: "amex-centurion-lounge", name: "Amex Centurion Lounge", category: "sala", aliases: ["centurion lounge"], officialUrl: "https://www.americanexpress.com/es-mx/", tiers: [],
    note: "El acceso y la política de invitados dependen de tu tarjeta y del país donde se emitió." },
  { id: "loungekey", name: "LoungeKey", category: "sala", officialUrl: "https://www.loungekey.com/", tiers: [] },
  { id: "dragonpass", name: "DragonPass", category: "sala", aliases: ["dragon pass"], tiers: [] },

  // ── Tarjetas ──
  {
    id: "amex-platinum-mx", name: "The Platinum Card® American Express (México)", category: "tarjeta", aliases: ["amex platinum", "platinum card"],
    officialUrl: "https://www.americanexpress.com/es-mx/tarjetas-de-servicio/the-platinum-card/",
    sourceUrl: "https://www.americanexpress.com/es-mx/tarjetas-de-servicio/the-platinum-card/", verifiedAt: VERIFIED_AT,
    note: "Montos, requisitos y vigencias los define American Express; revisa los términos de cada beneficio.",
    tiers: [{ id: "titular", name: "Titular", benefits: [
      "Membresía Priority Pass nivel Prestige sin costo",
      "1 punto Membership Rewards por cada dólar (o su equivalente) de compras",
      "Cobertura de emergencias médicas en viaje",
      "Hasta 2 tarjetas adicionales sin costo",
    ] }],
  },
  { id: "amex-centurion", name: "Centurion® American Express", category: "tarjeta", aliases: ["centurion", "black card"], officialUrl: "https://www.americanexpress.com/es-mx/", tiers: [] },
  { id: "bbva-mx", name: "BBVA México", category: "tarjeta", aliases: ["bbva", "bancomer"], officialUrl: "https://www.bbva.mx/", tiers: [] },
  { id: "santander-mx", name: "Santander México", category: "tarjeta", aliases: ["santander"], officialUrl: "https://www.santander.com.mx/", tiers: [] },
  { id: "banamex", name: "Banamex", category: "tarjeta", aliases: ["citibanamex"], officialUrl: "https://www.banamex.com/", tiers: [] },
  { id: "banorte", name: "Banorte", category: "tarjeta", officialUrl: "https://www.banorte.com/", tiers: [] },
  { id: "hsbc-mx", name: "HSBC México", category: "tarjeta", aliases: ["hsbc"], officialUrl: "https://www.hsbc.com.mx/", tiers: [] },

  // ── Viajero confiable ──
  {
    id: "global-entry", name: "Global Entry", category: "viajero_confiable",
    officialUrl: "https://www.cbp.gov/travel/trusted-traveler-programs/global-entry",
    sourceUrl: "https://www.cbp.gov/travel/trusted-traveler-programs/global-entry", verifiedAt: VERIFIED_AT,
    tiers: [{ id: "miembro", name: "Miembro", benefits: [
      "Entrada agilizada a EUA en aeropuertos participantes",
      "Incluye TSA PreCheck: agrega tu número de membresía (KTN) a cada reservación",
      "Membresía de 5 años",
    ] }],
  },
  {
    id: "tsa-precheck", name: "TSA PreCheck", category: "viajero_confiable",
    officialUrl: "https://www.tsa.gov/precheck", sourceUrl: "https://www.tsa.gov/precheck/faq", verifiedAt: VERIFIED_AT,
    tiers: [{ id: "miembro", name: "Miembro", benefits: [
      "Revisión de seguridad agilizada en aeropuertos de EUA con aerolíneas participantes",
      "Agrega tu Known Traveler Number (KTN) a cada reservación",
      "Membresía de 5 años",
    ] }],
  },
  {
    id: "viajero-confiable", name: "Viajero Confiable (INM)", category: "viajero_confiable", aliases: ["viajero confiable"],
    officialUrl: "https://www.gob.mx/inm", sourceUrl: "https://catalogonacional.gob.mx/FichaTramite?traHomoclave=INM-03-001", verifiedAt: VERIFIED_AT,
    tiers: [{ id: "miembro", name: "Miembro", benefits: [
      "Entrada a México por quioscos automatizados en aeropuertos participantes (como CDMX, Cancún y Los Cabos)",
      "Membresía de 5 años",
    ] }],
  },
  { id: "nexus", name: "NEXUS", category: "viajero_confiable", officialUrl: "https://www.cbp.gov/travel/trusted-traveler-programs/nexus", tiers: [] },
];

const BY_ID = new Map(CATALOG.map((p) => [p.id, p]));

export function getProgram(id: string | null | undefined): CatalogProgram | null {
  return (id && BY_ID.get(id)) || null;
}

export function programsFor(category: CatalogCategory): CatalogProgram[] {
  return CATALOG.filter((p) => p.category === category);
}

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** Busca un programa por nombre o alias (para sugerir el vínculo). null si no hay uno claro. */
export function findProgramByName(name: string, category?: CatalogCategory): CatalogProgram | null {
  const q = norm(name);
  if (q.length < 3) return null;
  const pool = category ? programsFor(category) : CATALOG;
  return pool.find((p) => norm(p.name) === q || (p.aliases ?? []).some((a) => norm(a) === q))
    ?? pool.find((p) => norm(p.name).includes(q) || (p.aliases ?? []).some((a) => q.includes(norm(a)) && norm(a).length >= 4))
    ?? null;
}

export type CuratedBenefits = {
  benefits: readonly string[];
  sourceUrl: string;
  verifiedAt: string;
  /** "Beneficios de Star Alliance Gold", etc. */
  scopeLabel: string;
  note?: string;
};

/**
 * Beneficios CURADOS para un programa y nivel. null si no hay nada curado (nunca se rellena con
 * suposiciones): la UI entonces muestra los que escribió la persona o "Agrega tus beneficios o
 * consulta la fuente".
 */
export function curatedBenefits(programId: string | null | undefined, tierId: string | null | undefined): CuratedBenefits | null {
  const program = getProgram(programId);
  if (!program || !tierId) return null;
  const tier = program.tiers.find((t) => t.id === tierId);
  if (!tier) return null;
  if (tier.alliance) {
    const a = ALLIANCE_TIERS[tier.alliance];
    return { benefits: a.benefits, sourceUrl: a.sourceUrl, verifiedAt: a.verifiedAt, scopeLabel: `Beneficios de ${a.label}`, note: program.note };
  }
  const sourceUrl = tier.sourceUrl ?? program.sourceUrl;
  if (!tier.benefits?.length || !sourceUrl || !program.verifiedAt) return null;
  return { benefits: tier.benefits, sourceUrl, verifiedAt: program.verifiedAt, scopeLabel: `Beneficios de ${program.name} ${tier.name}`, note: program.note };
}

export const NO_BENEFITS_COPY = "Agrega tus beneficios o consulta la fuente";

/** Categoría del catálogo para un tipo de la bóveda (null = no hay catálogo, p. ej. documentos). */
export function catalogCategoryForKind(kind: string): CatalogCategory | null {
  switch (kind) {
    case "aerolinea": case "hotel": case "auto": case "crucero": case "sala": case "tarjeta": case "viajero_confiable":
      return kind;
    default:
      return null;
  }
}
