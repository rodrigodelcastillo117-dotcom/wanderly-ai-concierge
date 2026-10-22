// Fuentes oficiales de los datos de road trips (grupo roadtrip, 22-oct-2026). Sin Deno: lo usan el
// cliente, logistics-plan, concierge-chat y las pruebas.
//
// Regla: cada aviso, precio oficial o ruta curada lleva la URL que se abrió con un GET público de
// solo lectura y la fecha de consulta. Si una regla no se pudo verificar, NO está aquí (ver
// docs/iatos/cierre2/ROADTRIP.md §BLOQUEADO: Eslovenia, peajes por tramo, etc.).

export const CONSULTED_AT = "2026-10-22";

export type Source = {
  /** Quién publica (lo que ve el usuario). */
  label: string;
  url: string;
  /** Día en que se abrió la URL (GET público) y se leyó el dato. */
  consulted_at: string;
  /** Fecha del dato según la propia fuente, si la publica (p. ej. semana del boletín). */
  data_date?: string;
};

const S = (label: string, url: string, data_date?: string): Source => ({ label, url, consulted_at: CONSULTED_AT, ...(data_date ? { data_date } : {}) });

export const SOURCES = {
  // Combustible
  EU_OIL_BULLETIN: S("Comisión Europea · Weekly Oil Bulletin (precios con impuestos)", "https://energy.ec.europa.eu/data-and-analysis/weekly-oil-bulletin_en", "2026-10-19"),
  UK_FUEL: S("Gobierno del Reino Unido · Weekly road fuel prices", "https://www.gov.uk/government/statistics/weekly-road-fuel-prices", "2026-10-19"),
  // ZTL Italia
  ECC_ZTL: S("Centro Europeo del Consumidor (ECC-Net, Alemania) · ZTL en Italia", "https://www.evz.de/en/topics/transport/car/fines-abroad/ztl-italy/", "2026-01-19"),
  ROMA_ZTL: S("Roma Servizi per la Mobilità (Roma Capitale) · ZTL", "https://romamobilita.it/servizi-al-pubblico/ztl/"),
  // Licencia
  IT_CDS_135: S("Normattiva (Italia) · Codice della Strada, art. 135", "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:decreto.legislativo:1992-04-30;285~art135"),
  ES_DGT: S("DGT (España) · Conducir con un permiso extranjero", "https://www.dgt.es/nuestros-servicios/permisos-de-conducir/permisos-extranjeros-y-de-fuerzas-y-cuerpos-de-seguridad/conducir-con-un-permiso-extranjero/"),
  FR_SERVICE_PUBLIC: S("Service-Public.fr (Francia) · Conducir con permiso no europeo en estancia corta", "https://www.service-public.gouv.fr/particuliers/vosdroits/F1459"),
  DE_BMV: S("Ministerio Federal de Transporte (Alemania) · Validez de licencias extranjeras", "https://www.bmv.de/SharedDocs/EN/Articles/StV/Roadtraffic/validity-foreign-driving-licences-in-germany.html"),
  PT_IMT: S("IMT (Portugal) · Licencias de países con acuerdo o convención", "https://www.imt-ip.pt/condutores/reconhecimento/troca-de-titulo-de-conducao-estrangeiro/paises-aderentes-as-convencoes-e-outras-situacoes/"),
  PT_IMT_CONVENCOES: S("IMT (Portugal) · Lista de países de las convenciones de Ginebra 1949 y Viena 1968 (PDF)", "https://www.imt-ip.pt/wp-content/uploads/2025/08/Os-paises-das-convencoes.pdf"),
  CH_LICENCE: S("ch.ch (Suiza) · Licencia internacional", "https://www.ch.ch/en/vehicles-and-traffic/driving-licence/international-driving-licence/"),
  GB_LICENCE: S("GOV.UK · Manejar en Gran Bretaña con licencia de otro país (visitante)", "https://www.gov.uk/driving-nongb-licence/y/a-visitor-to-great-britain/any-other-country"),
  IS_LICENCE: S("Island.is (Islandia) · ¿Valen las licencias extranjeras en Islandia?", "https://island.is/en/help/transport-authority/studies-and-rights/do-foreign-driving-licences-apply-in-iceland"),
  // Viñetas
  AT_VIGNETTE: S("Oesterreich.gv.at (Austria) · Viñeta para vehículos de hasta 3.5 t", "https://www.oesterreich.gv.at/en/themen/mobilitaet/kfz/10/Vignette-und-Maut/Vignette-fuer-Fahrzeuge-bis-3,5-t"),
  CH_VIGNETTE: S("Oficina Federal de Aduanas y Seguridad Fronteriza (BAZG, Suiza) · Viñeta", "https://www.bazg.admin.ch/en/e-vignette-and-adhesive-vignette-two-types"),
  CZ_VIGNETTE: S("eDalnice.gov.cz (Chequia) · Tienda oficial de la viñeta electrónica", "https://edalnice.gov.cz/en"),
  // Lado de manejo
  GB_HIGHWAY_CODE: S("GOV.UK · The Highway Code, regla 160", "https://www.gov.uk/guidance/the-highway-code/using-the-road-159-to-203"),
  IE_ROAD_RULES: S("Your Europe (Unión Europea) · Reglas de tránsito en Irlanda", "https://europa.eu/youreurope/citizens/travel/driving-abroad/road-rules-and-safety/ireland/index_en.htm", "2024-09-18"),
  // Cruce de frontera con auto rentado
  ECC_CZ_RENTAL: S("Centro Europeo del Consumidor (Chequia, gov.cz) · Rentar un auto en el extranjero", "https://evropskyspotrebitel.gov.cz/cars-and-traffic/how-to-avoid-problems-when-renting-a-car-abroad/"),
  // Rutas curadas (sitios oficiales de turismo)
  R_TOSCANA: S("Visit Tuscany (Región Toscana) · Cuatro días: Chianti senese y Val d'Orcia", "https://www.visittuscany.com/en/itineraries/four-days-in-tuscany-chianti-senese-and-val-dorcia/"),
  R_AMALFI: S("Italia.it (Ministerio de Turismo) · Costa Amalfitana", "https://www.italia.it/en/campania/things-to-do/the-amalfi-coast"),
  R_DOLOMITAS: S("Dolomiti.it · Bolzano y la Strada delle Dolomiti", "https://www.dolomiti.it/en/bolzano-and-environs"),
  R_SICILIA: S("Visit Sicily (Región Siciliana) · Sicilia oriental en coche", "https://www.visitsicily.info/en/itinerario/eastern-sicily-and-places-not-to-be-missed/"),
  R_PROVENZA: S("Provence-Alpes-Côte d'Azur Tourisme · Entre Provenza y la Riviera (5 días)", "https://provence-alpes-cotedazur.com/en/things-to-do/the-most-beautiful-routes/between-provence-and-french-riviera-unique-urban-and-natural-discoveries/"),
  R_ALGARVE: S("Visit Algarve (Turismo do Algarve) · Rotas e Caminhos: Rota de Sagres (PDF)", "https://api.visitalgarve.pt/uploads/1/1/BrochurasPT/guiarotasecaminhos_algarve_pt_web_nov2015_low.pdf"),
  R_ANDALUCIA: S("Spain.info (Turespaña) · Andalucía en coche en 7 días", "https://www.spain.info/en/route/andalusia-car/"),
  R_BAVIERA: S("Romantische Straße (asociación oficial de la ruta) · Ruta Romántica", "https://romantischestrasse.de/en/"),
  R_ESCOCIA: S("VisitScotland · North Coast 500", "https://www.visitscotland.com/planning/travel-in-scotland/driving-road-trips/north-coast-500"),
  R_ISLANDIA: S("Visit Iceland · The Ring Road (Ruta 1)", "https://www.visiticeland.com/article/the-ring-road/"),
  // Costo de la API de rutas
  GOOGLE_PRICING: S("Google Maps Platform · Precios por SKU", "https://developers.google.com/maps/billing-and-pricing/pricing"),
} as const;

export type SourceId = keyof typeof SOURCES;
