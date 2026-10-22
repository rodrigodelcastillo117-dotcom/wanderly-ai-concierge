// Datos curados de road trips (grupo roadtrip). Sin Deno.
//
// * Países: moneda, lado de manejo y precio oficial del combustible (con fuente y fecha).
// * Ciudades: coordenadas aproximadas del centro, SOLO para la estimación por línea recta cuando
//   Google Routes no responde (siempre etiquetada ESTIMADO) y para saber de qué país es cada parada.
// * Avisos por país: cada uno con la URL oficial abierta el 22-oct-2026 (sources.ts).
// * Rutas curadas: paradas y días tomados de la fuente oficial; lo que la fuente no dice (p. ej. la
//   mejor época) va marcado como sugerencia de IATOS.
import { type Source, SOURCES } from "./sources.ts";

export type Iso = "IT" | "FR" | "ES" | "PT" | "DE" | "AT" | "CH" | "CZ" | "SI" | "HR" | "GB" | "IE" | "IS" | "BE" | "NL" | "SK" | "HU";

export type FuelPrice = {
  /** Precio por litro con impuestos, en `currency`. */
  petrol: number;
  diesel: number;
  currency: "EUR" | "GBP";
  source: Source;
};

export type Country = {
  iso: Iso;
  name: string;
  currency: "EUR" | "GBP" | "CHF" | "CZK" | "ISK" | "HUF";
  drives: "right" | "left";
  /** Sin precio oficial verificado → el combustible queda "por confirmar". */
  fuel: FuelPrice | null;
};

// Euro-super 95 y diésel por 1,000 L del Weekly Oil Bulletin (semana del 19-oct-2026, publicado el
// 22-oct-2026), convertidos a €/L con 3 decimales. Reino Unido: ULSP/ULSD en peniques/L (DESNZ).
const eu = (petrolPer1000: number, dieselPer1000: number): FuelPrice => ({
  petrol: Math.round(petrolPer1000) / 1000, diesel: Math.round(dieselPer1000) / 1000, currency: "EUR", source: SOURCES.EU_OIL_BULLETIN,
});

export const COUNTRIES: Record<Iso, Country> = {
  IT: { iso: "IT", name: "Italia", currency: "EUR", drives: "right", fuel: eu(2015.74, 2244.44) },
  FR: { iso: "FR", name: "Francia", currency: "EUR", drives: "right", fuel: eu(2228.88, 2345.84) },
  ES: { iso: "ES", name: "España", currency: "EUR", drives: "right", fuel: eu(1780.47, 1889.22) },
  PT: { iso: "PT", name: "Portugal", currency: "EUR", drives: "right", fuel: eu(2099, 2175) },
  DE: { iso: "DE", name: "Alemania", currency: "EUR", drives: "right", fuel: eu(2179, 2266) },
  AT: { iso: "AT", name: "Austria", currency: "EUR", drives: "right", fuel: eu(1817, 2132) },
  CH: { iso: "CH", name: "Suiza", currency: "CHF", drives: "right", fuel: null },
  CZ: { iso: "CZ", name: "Chequia", currency: "CZK", drives: "right", fuel: eu(1862.18, 1953.37) },
  SI: { iso: "SI", name: "Eslovenia", currency: "EUR", drives: "right", fuel: eu(1750.63, 1893.35) },
  HR: { iso: "HR", name: "Croacia", currency: "EUR", drives: "right", fuel: eu(1806.5, 1954.13) },
  SK: { iso: "SK", name: "Eslovaquia", currency: "EUR", drives: "right", fuel: eu(1885, 1952) },
  HU: { iso: "HU", name: "Hungría", currency: "HUF", drives: "right", fuel: eu(1770.79, 1951.18) },
  BE: { iso: "BE", name: "Bélgica", currency: "EUR", drives: "right", fuel: eu(1988.68, 2350.54) },
  NL: { iso: "NL", name: "Países Bajos", currency: "EUR", drives: "right", fuel: eu(2390.74, 2456.26) },
  IE: { iso: "IE", name: "Irlanda", currency: "EUR", drives: "left", fuel: eu(1970.8, 2136.7) },
  GB: { iso: "GB", name: "Reino Unido", currency: "GBP", drives: "left", fuel: { petrol: 1.7457, diesel: 1.9933, currency: "GBP", source: SOURCES.UK_FUEL } },
  IS: { iso: "IS", name: "Islandia", currency: "ISK", drives: "right", fuel: null },
};

export type City = { key: string; name: string; en: string; iso: Iso; lat: number; lng: number; aliases: string[] };

const C = (key: string, name: string, en: string, iso: Iso, lat: number, lng: number, aliases: string[] = []): City =>
  ({ key, name, en, iso, lat, lng, aliases });

/** Coordenadas aproximadas del centro (para estimar y para el país). Nunca se muestran como dato exacto. */
export const CITIES: City[] = [
  // Italia
  C("florencia", "Florencia", "Florence", "IT", 43.7696, 11.2558, ["florencia", "florence", "firenze"]),
  C("roma", "Roma", "Rome", "IT", 41.9028, 12.4964, ["roma", "rome"]),
  C("pisa", "Pisa", "Pisa", "IT", 43.7228, 10.4017, ["pisa"]),
  C("siena", "Siena", "Siena", "IT", 43.3188, 11.3308, ["siena"]),
  C("san_gimignano", "San Gimignano", "San Gimignano", "IT", 43.4677, 11.0436, ["san gimignano"]),
  C("volterra", "Volterra", "Volterra", "IT", 43.4018, 10.8606, ["volterra"]),
  C("montalcino", "Montalcino", "Montalcino", "IT", 43.059, 11.489, ["montalcino"]),
  C("pienza", "Pienza", "Pienza", "IT", 43.0766, 11.679, ["pienza"]),
  C("montepulciano", "Montepulciano", "Montepulciano", "IT", 43.092, 11.781, ["montepulciano"]),
  C("radda", "Radda in Chianti", "Radda in Chianti", "IT", 43.4867, 11.375, ["radda in chianti", "radda"]),
  C("napoles", "Nápoles", "Naples", "IT", 40.8518, 14.2681, ["napoles", "naples", "napoli"]),
  C("sorrento", "Sorrento", "Sorrento", "IT", 40.6263, 14.3758, ["sorrento"]),
  C("positano", "Positano", "Positano", "IT", 40.6281, 14.485, ["positano"]),
  C("praiano", "Praiano", "Praiano", "IT", 40.612, 14.524, ["praiano"]),
  C("amalfi", "Amalfi", "Amalfi", "IT", 40.634, 14.6027, ["amalfi"]),
  C("ravello", "Ravello", "Ravello", "IT", 40.6492, 14.6119, ["ravello"]),
  C("minori", "Minori", "Minori", "IT", 40.65, 14.627, ["minori"]),
  C("maiori", "Maiori", "Maiori", "IT", 40.648, 14.64, ["maiori"]),
  C("cetara", "Cetara", "Cetara", "IT", 40.647, 14.701, ["cetara"]),
  C("vietri", "Vietri sul Mare", "Vietri sul Mare", "IT", 40.672, 14.729, ["vietri sul mare", "vietri"]),
  C("salerno", "Salerno", "Salerno", "IT", 40.6824, 14.7681, ["salerno"]),
  C("bolzano", "Bolzano", "Bolzano", "IT", 46.4983, 11.3548, ["bolzano", "bozen"]),
  C("cortina", "Cortina d'Ampezzo", "Cortina d'Ampezzo", "IT", 46.5405, 12.1357, ["cortina d ampezzo", "cortina"]),
  C("venecia", "Venecia", "Venice", "IT", 45.4408, 12.3155, ["venecia", "venice", "venezia"]),
  C("verona", "Verona", "Verona", "IT", 45.4384, 10.9916, ["verona"]),
  C("milan", "Milán", "Milan", "IT", 45.4642, 9.19, ["milan", "milano"]),
  C("taormina", "Taormina", "Taormina", "IT", 37.8516, 15.2853, ["taormina"]),
  C("alcantara", "Gargantas del Alcántara", "Alcantara Gorge", "IT", 37.877, 15.175, ["gargantas del alcantara", "alcantara"]),
  C("etna", "Etna (Nicolosi)", "Etna (Nicolosi)", "IT", 37.615, 15.023, ["etna", "nicolosi"]),
  C("catania", "Catania", "Catania", "IT", 37.5079, 15.083, ["catania"]),
  C("siracusa", "Siracusa", "Syracuse", "IT", 37.0755, 15.2866, ["siracusa", "syracuse", "ortigia"]),
  C("noto", "Noto", "Noto", "IT", 36.892, 15.069, ["noto"]),
  C("modica", "Modica", "Modica", "IT", 36.858, 14.76, ["modica"]),
  C("ragusa", "Ragusa", "Ragusa", "IT", 36.9269, 14.7255, ["ragusa", "ragusa ibla"]),
  C("caltagirone", "Caltagirone", "Caltagirone", "IT", 37.237, 14.512, ["caltagirone"]),
  C("palermo", "Palermo", "Palermo", "IT", 38.1157, 13.3615, ["palermo"]),
  C("agrigento", "Agrigento", "Agrigento", "IT", 37.311, 13.5765, ["agrigento"]),
  // Francia
  C("niza", "Niza", "Nice", "FR", 43.7102, 7.262, ["niza", "nice"]),
  C("saint_raphael", "Saint-Raphaël", "Saint-Raphael", "FR", 43.425, 6.768, ["saint raphael"]),
  C("frejus", "Fréjus", "Frejus", "FR", 43.433, 6.737, ["frejus"]),
  C("marsella", "Marsella", "Marseille", "FR", 43.2965, 5.3698, ["marsella", "marseille"]),
  C("cassis", "Cassis", "Cassis", "FR", 43.214, 5.539, ["cassis"]),
  C("aix", "Aix-en-Provence", "Aix-en-Provence", "FR", 43.5297, 5.4474, ["aix en provence", "aix"]),
  C("gordes", "Gordes", "Gordes", "FR", 43.911, 5.2, ["gordes"]),
  C("avignon", "Aviñón", "Avignon", "FR", 43.9493, 4.8055, ["avinon", "avignon"]),
  C("paris", "París", "Paris", "FR", 48.8566, 2.3522, ["paris"]),
  C("lyon", "Lyon", "Lyon", "FR", 45.764, 4.8357, ["lyon"]),
  // Portugal
  C("lisboa", "Lisboa", "Lisbon", "PT", 38.7223, -9.1393, ["lisboa", "lisbon"]),
  C("oporto", "Oporto", "Porto", "PT", 41.1579, -8.6291, ["oporto", "porto"]),
  C("faro", "Faro", "Faro", "PT", 37.0194, -7.9304, ["faro"]),
  C("lagos", "Lagos", "Lagos", "PT", 37.1028, -8.673, ["lagos portugal", "lagos"]),
  C("ponta_piedade", "Ponta da Piedade", "Ponta da Piedade", "PT", 37.081, -8.669, ["ponta da piedade"]),
  C("vila_do_bispo", "Vila do Bispo", "Vila do Bispo", "PT", 37.083, -8.911, ["vila do bispo"]),
  C("sagres", "Sagres", "Sagres", "PT", 37.009, -8.94, ["sagres"]),
  C("cabo_sao_vicente", "Cabo de São Vicente", "Cape St. Vincent", "PT", 37.023, -8.996, ["cabo de sao vicente", "cabo san vicente"]),
  C("tavira", "Tavira", "Tavira", "PT", 37.127, -7.648, ["tavira"]),
  // España
  C("madrid", "Madrid", "Madrid", "ES", 40.4168, -3.7038, ["madrid"]),
  C("barcelona", "Barcelona", "Barcelona", "ES", 41.3874, 2.1686, ["barcelona"]),
  C("malaga", "Málaga", "Malaga", "ES", 36.7213, -4.4214, ["malaga"]),
  C("ronda", "Ronda", "Ronda", "ES", 36.7423, -5.1671, ["ronda"]),
  C("arcos", "Arcos de la Frontera", "Arcos de la Frontera", "ES", 36.75, -5.806, ["arcos de la frontera", "arcos"]),
  C("jerez", "Jerez de la Frontera", "Jerez de la Frontera", "ES", 36.685, -6.126, ["jerez de la frontera", "jerez"]),
  C("cadiz", "Cádiz", "Cadiz", "ES", 36.5271, -6.2886, ["cadiz"]),
  C("sevilla", "Sevilla", "Seville", "ES", 37.3891, -5.9845, ["sevilla", "seville"]),
  C("cordoba", "Córdoba", "Cordoba", "ES", 37.8882, -4.7794, ["cordoba espana", "cordoba"]),
  C("granada", "Granada", "Granada", "ES", 37.1773, -3.5986, ["granada"]),
  // Alemania
  C("munich", "Múnich", "Munich", "DE", 48.1351, 11.582, ["munich", "muenchen", "munchen"]),
  C("wurzburg", "Würzburg", "Wurzburg", "DE", 49.7913, 9.9534, ["wurzburg", "wuerzburg"]),
  C("rothenburg", "Rothenburg ob der Tauber", "Rothenburg ob der Tauber", "DE", 49.3772, 10.1866, ["rothenburg ob der tauber", "rothenburg"]),
  C("dinkelsbuhl", "Dinkelsbühl", "Dinkelsbuhl", "DE", 49.07, 10.319, ["dinkelsbuhl", "dinkelsbuehl"]),
  C("nordlingen", "Nördlingen", "Nordlingen", "DE", 48.851, 10.488, ["nordlingen", "noerdlingen"]),
  C("augsburgo", "Augsburgo", "Augsburg", "DE", 48.3705, 10.8978, ["augsburgo", "augsburg"]),
  C("landsberg", "Landsberg am Lech", "Landsberg am Lech", "DE", 48.048, 10.883, ["landsberg am lech", "landsberg"]),
  C("schongau", "Schongau", "Schongau", "DE", 47.812, 10.897, ["schongau"]),
  C("fussen", "Füssen", "Fussen", "DE", 47.571, 10.701, ["fussen", "fuessen"]),
  C("frankfurt", "Fráncfort", "Frankfurt", "DE", 50.1109, 8.6821, ["francfort", "frankfurt"]),
  C("berlin", "Berlín", "Berlin", "DE", 52.52, 13.405, ["berlin"]),
  // Austria, Suiza, Chequia, Eslovenia
  C("salzburgo", "Salzburgo", "Salzburg", "AT", 47.8095, 13.055, ["salzburgo", "salzburg"]),
  C("innsbruck", "Innsbruck", "Innsbruck", "AT", 47.2692, 11.4041, ["innsbruck"]),
  C("viena", "Viena", "Vienna", "AT", 48.2082, 16.3738, ["viena", "vienna", "wien"]),
  C("zurich", "Zúrich", "Zurich", "CH", 47.3769, 8.5417, ["zurich"]),
  C("ginebra", "Ginebra", "Geneva", "CH", 46.2044, 6.1432, ["ginebra", "geneva", "geneve"]),
  C("lucerna", "Lucerna", "Lucerne", "CH", 47.0502, 8.3093, ["lucerna", "lucerne", "luzern"]),
  C("praga", "Praga", "Prague", "CZ", 50.0755, 14.4378, ["praga", "prague", "praha"]),
  C("cesky_krumlov", "Český Krumlov", "Cesky Krumlov", "CZ", 48.8127, 14.3175, ["cesky krumlov"]),
  C("liubliana", "Liubliana", "Ljubljana", "SI", 46.0569, 14.5058, ["liubliana", "ljubljana"]),
  // Reino Unido e Irlanda
  C("londres", "Londres", "London", "GB", 51.5074, -0.1278, ["londres", "london"]),
  C("edimburgo", "Edimburgo", "Edinburgh", "GB", 55.9533, -3.1883, ["edimburgo", "edinburgh"]),
  C("glasgow", "Glasgow", "Glasgow", "GB", 55.8642, -4.2518, ["glasgow"]),
  C("inverness", "Inverness", "Inverness", "GB", 57.4778, -4.2247, ["inverness"]),
  C("applecross", "Applecross", "Applecross", "GB", 57.433, -5.812, ["applecross"]),
  C("torridon", "Torridon", "Torridon", "GB", 57.546, -5.513, ["torridon"]),
  C("ullapool", "Ullapool", "Ullapool", "GB", 57.895, -5.16, ["ullapool"]),
  C("durness", "Durness", "Durness", "GB", 58.568, -4.747, ["durness"]),
  C("thurso", "Thurso", "Thurso", "GB", 58.593, -3.522, ["thurso"]),
  C("john_o_groats", "John o' Groats", "John o' Groats", "GB", 58.644, -3.07, ["john o groats"]),
  C("dublin", "Dublín", "Dublin", "IE", 53.3498, -6.2603, ["dublin"]),
  C("galway", "Galway", "Galway", "IE", 53.2707, -9.0568, ["galway"]),
  // Islandia
  C("reikiavik", "Reikiavik", "Reykjavik", "IS", 64.1466, -21.9426, ["reikiavik", "reykjavik"]),
  C("selfoss", "Selfoss", "Selfoss", "IS", 63.933, -21.0, ["selfoss"]),
  C("vik", "Vík", "Vik", "IS", 63.4186, -19.006, ["vik"]),
  C("hofn", "Höfn", "Hofn", "IS", 64.2539, -15.2082, ["hofn"]),
  C("egilsstadir", "Egilsstaðir", "Egilsstadir", "IS", 65.265, -14.395, ["egilsstadir"]),
  C("myvatn", "Mývatn", "Myvatn", "IS", 65.644, -16.911, ["myvatn"]),
  C("akureyri", "Akureyri", "Akureyri", "IS", 65.6885, -18.1262, ["akureyri"]),
  C("borgarnes", "Borgarnes", "Borgarnes", "IS", 64.5383, -21.9206, ["borgarnes"]),
];

export type NoticeKind = "ztl" | "vineta" | "licencia" | "lado" | "frontera" | "carreteras";

export type Notice = {
  id: string;
  iso: Iso | "*";
  kind: NoticeKind;
  title: string;
  body: string;
  sources: Source[];
  /** Precios oficiales publicados por duración (p. ej. viñeta), si la fuente los da. */
  prices?: { label: string; currency: string; tiers: Array<{ days: number; amount: number; name: string }> };
};

/** Avisos curados. Solo reglas verificadas en la fuente oficial (ver sources.ts). */
export const NOTICES: Notice[] = [
  {
    id: "it-ztl", iso: "IT", kind: "ztl", title: "ZTL: zonas de tráfico limitado con multa automática",
    body: "Muchos centros históricos de Italia son ZTL: solo entran residentes y vehículos autorizados en ciertos horarios. Cada acceso tiene cámara; cada pasada sin permiso es una multa (alrededor de 100 € por pasada, según la ciudad) que llega a tu domicilio aunque el auto sea rentado, y la arrendadora suele cobrar una comisión por pasar tus datos. Si tu hotel está dentro de una ZTL, pídele que registre tu placa para tu estancia (eso no te autoriza en otras ZTL de la ciudad). No confíes solo en el GPS.",
    sources: [SOURCES.ECC_ZTL, SOURCES.ROMA_ZTL],
  },
  {
    id: "it-licencia", iso: "IT", kind: "licencia", title: "Licencia mexicana: lleva permiso internacional o traducción oficial",
    body: "Con licencia de fuera de la UE puedes manejar en Italia si no vives ahí hace más de un año y llevas, junto con tu licencia vigente, un permiso internacional o una traducción oficial al italiano. Sin ellos la multa es de 408 € a 1,634 €.",
    sources: [SOURCES.IT_CDS_135],
  },
  {
    id: "es-licencia", iso: "ES", kind: "licencia", title: "Licencia mexicana: la DGT aconseja el permiso internacional",
    body: "Para licencias de fuera de la UE y el EEE, la DGT aconseja obtener en tu país el permiso internacional antes de viajar y llevarlo siempre con tu pasaporte y tu licencia vigente.",
    sources: [SOURCES.ES_DGT],
  },
  {
    id: "fr-licencia", iso: "FR", kind: "licencia", title: "Licencia mexicana: en francés, o con permiso internacional o traducción oficial",
    body: "En una estancia corta puedes manejar con una licencia no europea vigente si está en francés o si la acompañas de un permiso internacional o de una traducción oficial (legalizada o apostillada si se hizo fuera de Francia).",
    sources: [SOURCES.FR_SERVICE_PUBLIC],
  },
  {
    id: "de-licencia", iso: "DE", kind: "licencia", title: "Licencia mexicana: permiso internacional o traducción al alemán",
    body: "Si tu licencia no es de la UE/EEE ni está en alemán, debes llevar una traducción al alemán; si tienes permiso internacional, no necesitas la traducción.",
    sources: [SOURCES.DE_BMV],
  },
  {
    id: "pt-licencia", iso: "PT", kind: "licencia", title: "Licencia mexicana: confírmala antes de rentar en Portugal",
    body: "El IMT permite manejar hasta 185 días con licencia extranjera solo si el país que la emitió tiene acuerdo bilateral o reciprocidad con Portugal, o es parte de las convenciones de Ginebra (1949) o Viena (1968). México no aparece en las listas que publica el IMT (consultadas el 22-oct-2026): confirma con el IMT o el consulado de Portugal y con la arrendadora antes de reservar.",
    sources: [SOURCES.PT_IMT, SOURCES.PT_IMT_CONVENCOES],
  },
  {
    id: "ch-licencia", iso: "CH", kind: "licencia", title: "Licencia extranjera en Suiza",
    body: "Si vives fuera de Suiza, en algunos casos necesitas licencia internacional para manejar ahí; por ejemplo, si tu licencia no describe las categorías de vehículo en caracteres latinos.",
    sources: [SOURCES.CH_LICENCE],
  },
  {
    id: "gb-licencia", iso: "GB", kind: "licencia", title: "Licencia mexicana en Gran Bretaña: hasta 12 meses",
    body: "Como visitante puedes manejar autos o motos de las categorías de tu licencia completa y vigente durante 12 meses desde tu última entrada a Gran Bretaña.",
    sources: [SOURCES.GB_LICENCE],
  },
  {
    id: "is-licencia", iso: "IS", kind: "licencia", title: "Licencia de fuera del EEE en Islandia: válida 6 meses",
    body: "Las licencias de países fuera del EEE valen en Islandia durante 6 meses.",
    sources: [SOURCES.IS_LICENCE],
  },
  {
    id: "at-vineta", iso: "AT", kind: "vineta", title: "Austria: viñeta obligatoria en autopistas y vías rápidas",
    body: "Todo auto de hasta 3.5 t necesita viñeta (calcomanía o digital) para usar autopistas y vías rápidas. La de 1 y 10 días comprada en línea vale de inmediato; la anual y la de 2 meses compradas en línea empiezan 18 días después. Algunos pasos alpinos cobran peaje por tramo en lugar de viñeta. Precios 2026: 1 día 9.60 €, 10 días 12.80 €, 2 meses 32.00 €, anual 106.80 €.",
    sources: [SOURCES.AT_VIGNETTE],
    prices: { label: "Viñeta de Austria", currency: "EUR", tiers: [
      { days: 1, amount: 9.6, name: "1 día" }, { days: 10, amount: 12.8, name: "10 días" }, { days: 61, amount: 32, name: "2 meses" }, { days: 427, amount: 106.8, name: "anual" },
    ] },
  },
  {
    id: "ch-vineta", iso: "CH", kind: "vineta", title: "Suiza: viñeta de autopista de 40 CHF",
    body: "Las autopistas suizas se pagan con viñeta (e-viñeta en línea o calcomanía); cuesta 40 CHF y vale del 1 de diciembre del año anterior al 31 de enero del siguiente. Cómprala antes de entrar al país: la e-viñeta en el portal oficial (e-vignette.ch) o la calcomanía en clubes automovilísticos.",
    sources: [SOURCES.CH_VIGNETTE],
    prices: { label: "Viñeta de Suiza", currency: "CHF", tiers: [{ days: 427, amount: 40, name: "anual (única que existe)" }] },
  },
  {
    id: "cz-vineta", iso: "CZ", kind: "vineta", title: "Chequia: viñeta electrónica",
    body: "Las autopistas de peaje en Chequia requieren viñeta electrónica (tienda oficial eDalnice). Precio estándar: 1 día 210 CZK, 10 días 290 CZK, 30 días 460 CZK (hay precio eco según el vehículo). Manejar sin ella puede costar una multa de hasta 20,000 CZK.",
    sources: [SOURCES.CZ_VIGNETTE],
    prices: { label: "Viñeta de Chequia (precio estándar)", currency: "CZK", tiers: [
      { days: 1, amount: 210, name: "1 día" }, { days: 10, amount: 290, name: "10 días" }, { days: 30, amount: 460, name: "30 días" }, { days: 365, amount: 2440, name: "1 año" },
    ] },
  },
  {
    id: "gb-lado", iso: "GB", kind: "lado", title: "Reino Unido: se maneja por la izquierda",
    body: "Una vez en marcha, mantente a la izquierda salvo que señales o marcas indiquen otra cosa (regla 160 del Highway Code). Ojo en glorietas y al salir de estacionamientos.",
    sources: [SOURCES.GB_HIGHWAY_CODE],
  },
  {
    id: "ie-lado", iso: "IE", kind: "lado", title: "Irlanda: se maneja por la izquierda",
    body: "Todo el tránsito circula por la izquierda. En autopista quédate en el carril izquierdo salvo para rebasar; en glorietas entra girando a la izquierda y cede el paso a quien ya circula (viene por tu derecha).",
    sources: [SOURCES.IE_ROAD_RULES],
  },
  {
    id: "is-carreteras", iso: "IS", kind: "carreteras", title: "Islandia: revisa el estado de las carreteras cada día",
    body: "La Ruta 1 (Ring Road) no requiere 4x4, pero fuera del verano hay que vigilar cierres, nieve y viento; Visit Iceland remite a SafeTravel para el mapa actualizado.",
    sources: [SOURCES.R_ISLANDIA],
  },
  {
    id: "frontera", iso: "*", kind: "frontera", title: "Cruzar a otro país con el auto rentado",
    body: "Antes de firmar, pregunta por escrito a la arrendadora en qué países puedes circular, qué seguro aplica fuera del país de renta y qué cargos extra hay: las condiciones para cruzar fronteras y los cargos 'ocultos' suelen venir en la letra chica.",
    sources: [SOURCES.ECC_CZ_RENTAL],
  },
];

export type CuratedStop = { city: string; note?: string };

export type CuratedRoute = {
  id: string;
  name: string;
  region: string;
  countries: Iso[];
  /** Paradas en orden, tal como las da la fuente oficial (nombres de CITIES). */
  stops: string[];
  /** Días que da la fuente, o null si no los da. */
  days_source: { min: number; max: number } | null;
  /** Días que sugiere IATOS cuando la fuente no los da. */
  days_suggested: number;
  /** Mejor época: de la fuente si la da; si no, sugerencia de IATOS marcada. */
  best_season: { text: string; from: "fuente" | "sugerencia_iatos" };
  /** Distancia total que publica la fuente, si la da. */
  distance_source: string | null;
  source: Source;
  /** Búsqueda de la foto ilustrativa (Pexels). */
  photo_query: string;
  /** Sugerencia de recogida (IATOS): ciudad con aeropuerto o renta, cercana al inicio. */
  pickup_hint: string;
  aliases: string[];
  highlights: string;
};

export const CURATED_ROUTES: CuratedRoute[] = [
  {
    id: "toscana", name: "Toscana: Chianti y Val d'Orcia", region: "Toscana", countries: ["IT"],
    stops: ["San Gimignano", "Volterra", "Siena", "Montalcino", "Pienza", "Radda in Chianti"],
    days_source: { min: 4, max: 4 }, days_suggested: 5,
    best_season: { text: "Primavera, antes de Semana Santa (la fuente viajó entonces; tras lluvias fuertes los caminos de terracería se enlodan)", from: "fuente" },
    distance_source: null, source: SOURCES.R_TOSCANA, photo_query: "tuscany val d'orcia cypress road",
    pickup_hint: "Florencia", aliases: ["toscana", "tuscany", "chianti", "val d orcia", "valdorcia"],
    highlights: "Pueblos medievales, viñedos del Chianti y la abadía de Sant'Antimo.",
  },
  {
    id: "amalfi", name: "Costa Amalfitana", region: "Campania", countries: ["IT"],
    stops: ["Positano", "Praiano", "Amalfi", "Ravello", "Minori", "Maiori", "Cetara", "Vietri sul Mare"],
    days_source: null, days_suggested: 3,
    best_season: { text: "Primavera u otoño, fuera del pico del verano", from: "sugerencia_iatos" },
    distance_source: "De Positano a Vietri sul Mare (16 municipios)", source: SOURCES.R_AMALFI, photo_query: "amalfi coast positano road",
    pickup_hint: "Nápoles", aliases: ["costa amalfitana", "amalfi", "amalfi coast", "positano"],
    highlights: "Patrimonio UNESCO: acantilados, Ravello y Villa Cimbrone.",
  },
  {
    id: "dolomitas", name: "Dolomitas: Strada delle Dolomiti", region: "Alto Adige y Véneto", countries: ["IT"],
    stops: ["Bolzano", "Cortina d'Ampezzo"],
    days_source: null, days_suggested: 3,
    best_season: { text: "Verano: los puertos de montaña dependen de la temporada", from: "sugerencia_iatos" },
    distance_source: "Bolzano–Cortina d'Ampezzo por los puertos dolomíticos", source: SOURCES.R_DOLOMITAS, photo_query: "dolomites mountain pass road",
    pickup_hint: "Bolzano", aliases: ["dolomitas", "dolomites", "dolomiti", "cortina"],
    highlights: "La Strada delle Dolomiti une Bolzano con Cortina por puertos de montaña.",
  },
  {
    id: "sicilia", name: "Sicilia oriental", region: "Sicilia", countries: ["IT"],
    stops: ["Taormina", "Gargantas del Alcántara", "Etna (Nicolosi)", "Siracusa", "Noto", "Modica", "Ragusa", "Caltagirone"],
    days_source: null, days_suggested: 6,
    best_season: { text: "Primavera u otoño (el verano es muy caluroso)", from: "sugerencia_iatos" },
    distance_source: null, source: SOURCES.R_SICILIA, photo_query: "sicily taormina coast",
    pickup_hint: "Catania", aliases: ["sicilia", "sicily", "taormina", "etna"],
    highlights: "Teatro griego de Taormina, el Etna, Ortigia y el barroco del Val di Noto.",
  },
  {
    id: "provenza", name: "Provenza y Costa Azul", region: "Provence-Alpes-Côte d'Azur", countries: ["FR"],
    stops: ["Niza", "Saint-Raphaël", "Fréjus", "Marsella", "Cassis", "Aix-en-Provence"],
    days_source: { min: 5, max: 5 }, days_suggested: 5,
    best_season: { text: "Primavera y principios de otoño", from: "sugerencia_iatos" },
    distance_source: null, source: SOURCES.R_PROVENZA, photo_query: "provence french riviera coast road",
    pickup_hint: "Niza", aliases: ["provenza", "provence", "costa azul", "riviera francesa", "cote d azur", "french riviera"],
    highlights: "De la Riviera a Marsella, las calanques de Cassis y Aix-en-Provence.",
  },
  {
    id: "algarve", name: "Algarve: Rota de Sagres", region: "Algarve", countries: ["PT"],
    stops: ["Lagos", "Ponta da Piedade", "Vila do Bispo", "Sagres", "Cabo de São Vicente"],
    days_source: null, days_suggested: 2,
    best_season: { text: "Primavera u otoño", from: "sugerencia_iatos" },
    distance_source: "Unos 122 km (circuito desde y hasta Lagos)", source: SOURCES.R_ALGARVE, photo_query: "algarve ponta da piedade cliffs",
    pickup_hint: "Faro", aliases: ["algarve", "sagres", "lagos portugal"],
    highlights: "Acantilados de Ponta da Piedade, la fortaleza de Sagres y el Cabo de São Vicente.",
  },
  {
    id: "andalucia", name: "Andalucía en coche", region: "Andalucía", countries: ["ES"],
    stops: ["Málaga", "Ronda", "Arcos de la Frontera", "Jerez de la Frontera", "Cádiz", "Sevilla", "Córdoba", "Granada"],
    days_source: { min: 7, max: 7 }, days_suggested: 7,
    best_season: { text: "Primavera (en verano hace mucho calor)", from: "fuente" },
    distance_source: "740–800 km", source: SOURCES.R_ANDALUCIA, photo_query: "andalusia ronda white village",
    pickup_hint: "Málaga", aliases: ["andalucia", "andalusia", "pueblos blancos", "ronda"],
    highlights: "Ronda, pueblos blancos, Jerez, Cádiz, Sevilla, Córdoba y Granada.",
  },
  {
    id: "baviera", name: "Baviera: Ruta Romántica", region: "Baviera y Baden-Wurtemberg", countries: ["DE"],
    stops: ["Würzburg", "Rothenburg ob der Tauber", "Dinkelsbühl", "Nördlingen", "Augsburgo", "Landsberg am Lech", "Schongau", "Füssen"],
    days_source: null, days_suggested: 4,
    best_season: { text: "De primavera a otoño", from: "sugerencia_iatos" },
    distance_source: "460 km y 29 poblaciones", source: SOURCES.R_BAVIERA, photo_query: "rothenburg ob der tauber romantic road",
    pickup_hint: "Fráncfort", aliases: ["baviera", "bavaria", "ruta romantica", "romantische strasse", "romantic road", "neuschwanstein"],
    highlights: "De Würzburg a Füssen, cerca del castillo de Neuschwanstein.",
  },
  {
    id: "escocia", name: "Escocia: North Coast 500", region: "Highlands", countries: ["GB"],
    stops: ["Inverness", "Applecross", "Torridon", "Ullapool", "Durness", "Thurso", "John o' Groats", "Inverness"],
    days_source: { min: 5, max: 7 }, days_suggested: 6,
    best_season: { text: "Abril a junio, o septiembre y octubre (clima más templado y menos gente)", from: "fuente" },
    distance_source: "516 millas (unos 830 km)", source: SOURCES.R_ESCOCIA, photo_query: "scotland highlands single track road",
    pickup_hint: "Inverness", aliases: ["escocia", "scotland", "highlands", "nc500", "north coast 500"],
    highlights: "Bealach na Bà, Ullapool, la costa norte y John o' Groats; hay tramos de un solo carril.",
  },
  {
    id: "islandia", name: "Islandia: Ring Road (Ruta 1)", region: "Islandia", countries: ["IS"],
    stops: ["Reikiavik", "Selfoss", "Vík", "Höfn", "Egilsstaðir", "Mývatn", "Akureyri", "Borgarnes", "Reikiavik"],
    days_source: { min: 7, max: 7 }, days_suggested: 8,
    best_season: { text: "Todo el año; fuera del verano revisa cierres y clima", from: "fuente" },
    distance_source: "1,322 km", source: SOURCES.R_ISLANDIA, photo_query: "iceland ring road waterfall",
    pickup_hint: "Reikiavik", aliases: ["islandia", "iceland", "ring road", "ruta 1"],
    highlights: "Vuelta completa a la isla; no requiere 4x4.",
  },
];
