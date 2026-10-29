// Datos del motor de derechos: países, aerolíneas, organismos y contactos de reclamación.
// Sin Deno ni red. Cada contacto dice CÓMO se verificó (ver fuentes.ts):
//   "pagina_leida"  → leímos hoy la página o el documento oficial; si trae correo, se puede usar.
//   "indice_oficial"→ solo lo vimos en el índice de búsqueda del dominio oficial (el sitio bloquea
//                      lectura automática). Se da el enlace con aviso; un correo así NUNCA se usa
//                      para enviar automáticamente.
//   "no_verificado" → no se pudo comprobar: se dice "búscalo en el sitio oficial" y no se inventa nada.
// Regla de oro: NUNCA se adivina un correo. Si no hay correo con verificación "pagina_leida", el reclamo
// se prepara para pegarlo en el formulario oficial.
import { CONSULTADO } from "./fuentes.ts";

/** UE-27 + EEE (Islandia, Noruega, Liechtenstein) + Suiza: donde aplica el Reglamento 261/2004
 *  (Your Europe y lista de organismos de la Comisión, actualizada el 13-oct-2026). */
export const EU_261_COUNTRIES = new Set([
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT",
  "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE", "IS", "NO", "LI", "CH",
]);
export const UK = "GB";

/**
 * País de la licencia de la aerolínea (código IATA → ISO2). Es dato general NO verificado hoy contra el
 * registro de licencias de cada país: por eso, cuando un régimen depende SOLO de la nacionalidad de la
 * aerolínea (p. ej. un vuelo que LLEGA a la UE), el motor nunca dice "te corresponde", solo "probablemente".
 */
export const AIRLINE_COUNTRY: Record<string, string> = {
  AM: "MX", Y4: "MX", VB: "MX",
  AA: "US", UA: "US", DL: "US", AS: "US", WN: "US", B6: "US", NK: "US", F9: "US", HA: "US",
  AC: "CA", WS: "CA",
  IB: "ES", UX: "ES", VY: "ES", AF: "FR", KL: "NL", LH: "DE", LX: "CH", OS: "AT", SN: "BE", EI: "IE", AZ: "IT",
  TP: "PT", SK: "SE", AY: "FI", LO: "PL", A3: "GR", FR: "IE", W6: "HU",
  BA: "GB", VS: "GB",
  CM: "PA", AV: "CO", LA: "CL", AR: "AR", G3: "BR", AD: "BR", TK: "TR", EK: "AE", QR: "QA",
};

export const AIRLINE_NAMES: Record<string, string> = {
  AM: "Aeroméxico", Y4: "Volaris", VB: "Viva Aerobus", AA: "American Airlines", UA: "United Airlines", DL: "Delta Air Lines",
  IB: "Iberia", AF: "Air France", KL: "KLM", LH: "Lufthansa", AV: "Avianca", CM: "Copa Airlines", AC: "Air Canada",
  BA: "British Airways", UX: "Air Europa", LA: "LATAM", G3: "GOL", AD: "Azul", TP: "TAP Air Portugal",
};

/** Idioma de la carta formal para la aerolínea (el de su país; inglés si no se habla es/pt/fr). */
export function idiomaProveedor(iso2: string | null | undefined): "es" | "en" | "pt" | "fr" {
  const c = String(iso2 ?? "").toUpperCase();
  if (["MX", "ES", "CO", "PA", "PE", "AR", "CL", "EC", "UY", "PY", "BO", "VE", "GT", "SV", "HN", "NI", "CR", "DO", "CU"].includes(c)) return "es";
  if (["BR", "PT"].includes(c)) return "pt";
  if (["FR"].includes(c)) return "fr";
  return "en";
}

export type Verificacion = "pagina_leida" | "indice_oficial" | "no_verificado";

export type ContactoProveedor = {
  codigo: string;
  nombre: string;
  /** Canal oficial para reclamar. "formulario": se prepara el texto para pegarlo. */
  canal: "formulario" | "correo" | "telefono";
  url: string | null;
  /** Solo con verificación "pagina_leida". */
  correo: string | null;
  telefono: string | null;
  notas: string;
  verificacion: Verificacion;
  fuente_url: string | null;
  consultado: string;
};

const K = (c: Omit<ContactoProveedor, "consultado">): ContactoProveedor => ({ ...c, consultado: CONSULTADO });

/** Contactos de reclamación de las aerolíneas que más vuelan desde y hacia México (29-oct-2026). */
export const AIRLINE_CONTACTS: Record<string, ContactoProveedor> = {
  Y4: K({
    codigo: "Y4", nombre: "Volaris", canal: "formulario", url: "https://tuexperiencia.volaris.com", correo: null, telefono: null,
    notas: "Su plan de servicio al cliente dice: «Todas las reclamaciones deben enviarse a Volaris levantando un folio en el Centro de asistencia - Tu experiencia». No atiende quejas por redes sociales. Acusa recibo en 30 días. Equipaje: formulario de reclamo de equipaje.",
    verificacion: "pagina_leida", fuente_url: "https://cms.volaris.com/globalassets/pdfs/esp/plandeservicioalcliente.pdf",
  }),
  DL: K({
    codigo: "DL", nombre: "Delta Air Lines", canal: "formulario", url: "https://www.delta.com/us/en/need-help/overview?commentComplaintsForm", correo: null, telefono: null,
    notas: "Formulario «Comment & Complaint»; reembolsos por interrupción: formulario de reembolso en delta.com. Correo postal: Delta Air Lines, Inc. Customer Care, P.O. Box 20980, Department 980, Atlanta, GA 30320-2980. No publica correo electrónico para quejas.",
    verificacion: "pagina_leida", fuente_url: "https://www.delta.com/us/en/need-help/overview",
  }),
  AM: K({
    codigo: "AM", nombre: "Aeroméxico", canal: "formulario", url: "https://world.aeromexico.com/es/contactanos/?site=mx", correo: null, telefono: "55 5133 4000",
    notas: "Su página de contacto remite la atención posterior al viaje a un formulario web. No pudimos leer la página hoy (bloqueada para lectura automática); confírmalo al abrirla.",
    verificacion: "indice_oficial", fuente_url: "https://world.aeromexico.com/es/contactanos/?site=mx",
  }),
  VB: K({
    codigo: "VB", nombre: "Viva Aerobus", canal: "telefono", url: "https://www.vivaaerobus.com/mx/info/terminos-y-condiciones-completos", correo: null, telefono: "81 8215 0150",
    notas: "Sus términos piden comunicarse al Call Center con clave de reservación, número de vuelo y destino para reclamar compensación por demora. No encontramos un formulario de quejas verificable.",
    verificacion: "indice_oficial", fuente_url: "https://www.vivaaerobus.com/mx/info/terminos-y-condiciones-completos",
  }),
  AA: K({
    codigo: "AA", nombre: "American Airlines", canal: "formulario", url: "https://www.aa.com/contact/forms?topic=CR", correo: null, telefono: null,
    notas: "Quejas: «Compliments and complaints» (Customer Relations). Reembolsos: https://www.aa.com/refunds/. La página bloquea lectura automática; confírmalo al abrirla.",
    verificacion: "indice_oficial", fuente_url: "https://www.aa.com/i18n/customer-service/support/customer-service-plan.jsp",
  }),
  UA: K({
    codigo: "UA", nombre: "United Airlines", canal: "formulario", url: null, correo: null, telefono: null,
    notas: "Tiene formularios de Customer Care y de reembolso, pero solo los vimos en un dominio de pruebas (gtmpreview.united.com). NO VERIFICADO: entra a united.com → Help → Contact us.",
    verificacion: "no_verificado", fuente_url: null,
  }),
  IB: K({
    codigo: "IB", nombre: "Iberia", canal: "formulario", url: "https://www.iberia.com/us/claims-receipts/", correo: null, telefono: null,
    notas: "Sección «Reclamaciones» con formularios para vuelo cancelado y vuelo retrasado (código de reserva y número de billete). Bloquea lectura automática; confírmalo al abrirla.",
    verificacion: "indice_oficial", fuente_url: "https://www.iberia.com/us/claims-receipts/",
  }),
  AF: K({
    codigo: "AF", nombre: "Air France", canal: "formulario", url: null, correo: null, telefono: null,
    notas: "Sus condiciones piden reclamar primero por el formulario de su sitio y darle 28 días. Solo vimos copias regionales del formulario: NO VERIFICADO el enlace exacto; entra a airfrance.com → Ayuda → Reclamaciones.",
    verificacion: "no_verificado", fuente_url: null,
  }),
  KL: K({
    codigo: "KL", nombre: "KLM", canal: "formulario", url: "https://www.klm.com/information/refund-compensation/compensation", correo: null, telefono: null,
    notas: "La compensación se pide en línea (no en el aeropuerto). Bloquea lectura automática; confírmalo al abrirla.",
    verificacion: "indice_oficial", fuente_url: "https://www.klm.com/information/refund-compensation/compensation",
  }),
  LH: K({
    codigo: "LH", nombre: "Lufthansa", canal: "formulario", url: "https://www.lufthansa.com/us/en/fast-compensation", correo: null, telefono: null,
    notas: "Formulario de compensación por retraso, cancelación o conexión perdida (art. 7 del Reglamento 261/2004). Bloquea lectura automática; confírmalo al abrirla.",
    verificacion: "indice_oficial", fuente_url: "https://www.lufthansa.com/us/en/fast-compensation",
  }),
  AV: K({
    codigo: "AV", nombre: "Avianca", canal: "formulario", url: "https://www.avianca.com/co/es/te-ayudamos/soluciones-en-linea/sugerencias-reclamos/", correo: null, telefono: null,
    notas: "Formulario de sugerencias, quejas y reclamos (la compensación se pide por ahí). Bloquea lectura automática; confírmalo al abrirla.",
    verificacion: "indice_oficial", fuente_url: "https://www.avianca.com/co/es/te-ayudamos/soluciones-en-linea/sugerencias-reclamos/",
  }),
  CM: K({
    codigo: "CM", nombre: "Copa Airlines", canal: "formulario", url: "https://help.copaair.com/hc/es-419/requests/new", correo: null, telefono: null,
    notas: "Formulario del Centro de Ayuda; el reclamo va a la última aerolínea operadora del itinerario; responde en máximo 15 días. Su página en inglés menciona un correo de atención, pero no pudimos leerla hoy: no lo usamos.",
    verificacion: "indice_oficial", fuente_url: "https://www.copaair.com/en/web/us/comments-and-complaints",
  }),
};

export function contactoAerolinea(code: string | null | undefined): ContactoProveedor | null {
  return AIRLINE_CONTACTS[String(code ?? "").toUpperCase()] ?? null;
}

/** Un correo de proveedor es utilizable para enviar SOLO si se leyó en la página oficial hoy. */
export const correoUtilizable = (c: ContactoProveedor | null) => !!(c && c.correo && c.verificacion === "pagina_leida");

// ───────────────────────────── Organismos ─────────────────────────────
export type Organismo = {
  id: string;
  nombre: string;
  pais: string;
  url: string | null;
  formulario: string | null;
  correo: string | null;
  telefono: string | null;
  idioma: "es" | "en" | "pt" | "fr";
  notas: string;
  fuente: string; // id en FUENTES
  verificacion: Verificacion;
};

export const PROFECO: Organismo = {
  id: "PROFECO", nombre: "Procuraduría Federal del Consumidor (PROFECO)", pais: "MX",
  url: "https://concilianet.profeco.gob.mx/Concilianet/inicio.jsp", formulario: "https://concilianet.profeco.gob.mx/Concilianet/inicio.jsp",
  correo: null, telefono: "55 5568 8722 / 800 468 8722", idioma: "es",
  notas: "Concilianet solo funciona con proveedores registrados; si el proveedor no está, queja en la oficina de PROFECO o por el Teléfono del Consumidor. Desde el extranjero: extranjeros@profeco.gob.mx.",
  fuente: "PROFECO_CONCILIANET", verificacion: "pagina_leida",
};
export const DOT: Organismo = {
  id: "DOT", nombre: "U.S. Department of Transportation — Office of Aviation Consumer Protection", pais: "US",
  url: "https://airconsumer.dot.gov/consumer/s/complaint-form", formulario: "https://airconsumer.dot.gov/consumer/s/complaint-form",
  correo: null, telefono: null, idioma: "en",
  notas: "Primero la aerolínea; si no lo resuelve, formulario del DOT (la aerolínea debe responderte directamente).",
  fuente: "US_DOT_QUEJA", verificacion: "indice_oficial",
};
export const CTA: Organismo = {
  id: "CTA", nombre: "Canadian Transportation Agency", pais: "CA",
  url: "https://protection-passager-passenger.otc-cta.gc.ca/en", formulario: "https://protection-passager-passenger.otc-cta.gc.ca/en",
  correo: null, telefono: null, idioma: "en",
  notas: "Primero por escrito a la aerolínea; si no responde en 30 días o no estás conforme, queja ante la CTA.",
  fuente: "CA_CTA_QUEJA", verificacion: "indice_oficial",
};
export const ANAC_BR: Organismo = {
  id: "ANAC_BR", nombre: "ANAC — Anac Passageiro", pais: "BR",
  url: "https://www.gov.br/anac/pt-br/canais_atendimento/anacpassageiro", formulario: "https://www.gov.br/anac/pt-br/canais_atendimento/anacpassageiro",
  correo: null, telefono: null, idioma: "pt",
  notas: "Primero la aerolínea; si no lo resuelve, registro en Anac Passageiro (desde el 13-abr-2026).",
  fuente: "BR_ANAC_PASSAGEIRO", verificacion: "indice_oficial",
};
export const CAA_UK: Organismo = {
  id: "CAA", nombre: "UK Civil Aviation Authority — PACT (o el ADR de la aerolínea)", pais: "GB",
  url: "https://www.caa.co.uk/air-passengers/travel-problems-and-rights/flight-delays-and-cancellations/delays/", formulario: null,
  correo: null, telefono: null, idioma: "en",
  notas: "Si la aerolínea está adherida a un esquema ADR, se escala ahí; si no, al equipo PACT de la CAA.",
  fuente: "UK_CAA_DELAYS", verificacion: "pagina_leida",
};

/** Organismos nacionales del Reglamento 261/2004 (lista de la Comisión, actualizada 13-oct-2026). */
const N = (pais: string, nombre: string, formulario: string | null, correo: string | null, telefono: string | null, idioma: Organismo["idioma"] = "en", notas = ""): Organismo =>
  ({ id: `NEB_${pais}`, nombre, pais, url: formulario, formulario, correo, telefono, idioma, notas, fuente: "EU_NEB", verificacion: "pagina_leida" });

export const EU_NEB: Record<string, Organismo> = {
  AT: N("AT", "Agentur für Passagier- und Fahrgastrechte (apf)", "https://www.apf.gv.at/beschwerde-flug", null, "+43 1 505 07 07 – 740"),
  BE: N("BE", "SPF Mobilité & Transport — Droits des passagers", "https://servicerequest.mobilit.fgov.be/p/question/en/LV_PAXR", null, null, "fr"),
  BG: N("BG", "Civil Aviation Administration (Bulgaria)", "https://www.caa.bg/en/category/282", "caa@caa.bg", "+359 2 937 10 71"),
  HR: N("HR", "Croatian Civil Aviation Agency", "https://www.ccaa.hr/en/passenger-rights-26099", "passenger.rights@ccaa.hr", "+385 1 2369 300"),
  CY: N("CY", "Department of Civil Aviation (Cyprus)", null, "passengerrights@dca.mcw.gov.cy", "+357 22 404 119"),
  CZ: N("CZ", "Civil Aviation Authority (Czechia)", "https://kompenzace.caa.cz/?lang=en", "caa@caa.cz", "+420 225 422 726"),
  DK: N("DK", "Danish Civil Aviation and Railway Authority", "https://www.en.flypassager.dk/your-guide-to-filing-a-complaint-about-your-flight", "info@trafikstyrelsen.dk", "+45 7221 8800"),
  EE: N("EE", "Consumer Protection and Technical Regulatory Authority", "https://ttja.ee/en/private-client/consumer-rights/trade-services/travel-services#air-passenger-rights", "info@ttja.ee", "+372 667 2000"),
  FI: N("FI", "Consumer Disputes Board (Finland)", "https://www.kuluttajariita.fi/en/index/yhteystiedot.html", "kril@oikeus.fi", "+358 29 56 65200"),
  FR: N("FR", "Direction générale de l'aviation civile (DGAC)", "https://droits-passagers-aeriens.aviation-civile.gouv.fr/public/signalement?new-signalement=true", null, "+33 1 58 09 43 21", "fr"),
  DE: N("DE", "Luftfahrt-Bundesamt (LBA)", "https://www.lba.de/EN/AirPassengersRights/_functions_Kacheln_neu/Kachel_5/Complaint_Forms_node.html", "fluggastrechte@lba.de", "+49 531 2355-115"),
  GR: N("GR", "Hellenic Civil Aviation Authority", "https://hcaa.gov.gr/en/Passenger-Rights", "apr@hcaa.gov.gr", "+30 210 3541400"),
  HU: N("HU", "Government Office of the Capital City Budapest — Consumer Protection", "https://kormanyhivatalok.hu/kormanyhivatalok/budapest", "fogyasztovedelem@bfkh.gov.hu", "+36 1 4502598"),
  IE: N("IE", "Irish Aviation Authority", "https://www.iaa.ie/consumer-protection/air-passenger-rights", "apr@iaa.ie", "+353 1 6031100"),
  IT: N("IT", "ENAC — Ente Nazionale per l'Aviazione Civile", "https://carta-diritti.enac.gov.it/en", null, null, "en",
    "La queja ante ENAC es para sancionar, no para obtener el pago; para reembolso o compensación se usa ConciliaWeb de la ART."),
  LV: N("LV", "Consumer Rights Protection Centre (Latvia)", "https://www.ptac.gov.lv/en/air-passenger-rights", "pasts@ptac.gov.lv", "+371 67388624"),
  LT: N("LT", "Lithuanian Transport Safety Administration", "https://ltsa.lrv.lt/en/sector-activities/civil-aviation/air-passenger-rights", "ltsa@ltsa.lt", "+370 5 278 5601"),
  LU: N("LU", "Direction de la Protection des consommateurs (Luxembourg)", "https://guichet.public.lu/en/citoyens/transport/droits-voyageurs/annulation-dommages-retard/droit-passagers-aeriens.html", "passagers@mpc.etat.lu", "+352 247-73700", "fr"),
  MT: N("MT", "Malta Competition and Consumer Affairs Authority", "https://mccaa.org.mt/home/complaint", "airpassengerrights@mccaa.org.mt", "+356 2395 2000"),
  NL: N("NL", "Inspectie Leefomgeving en Transport (ILT)", "https://e-loket.ilent.nl/formulier/en-GB/DefaultEnvironment/MLu_005.aspx", null, "+31 884 890 000"),
  PL: N("PL", "Passengers' Rights Ombudsman (Poland)", "https://pasazerlotniczy.ulc.gov.pl/en/submit-an-application/interactive-form", "pasazerlotniczy@ulc.gov.pl", null),
  PT: N("PT", "Autoridade Nacional da Aviação Civil (ANAC Portugal)", "https://formdigital.anac.pt/?fid=607CA847-9BC7-41E0-9F59-03BC71F791CB", null, "+351 21 284 2226", "pt"),
  RO: N("RO", "National Authority for Consumer Protection (Romania)", "https://anpc.ro/", "secretariat@anpc.ro", "+40 37 775 5100"),
  SK: N("SK", "Slovak Trade Inspection", "https://www.soi.sk/sk/prava-cestujucich/prava-cestujucich-v-leteckej-doprave.soi", "oos@soi.sk", "+421 2 58 272 160"),
  SI: N("SI", "Civil Aviation Agency (Slovenia)", "https://www.caa.si/en/passenger-rights.html", "info@caa.si", "+386 1 266 66 00"),
  ES: N("ES", "Agencia Estatal de Seguridad Aérea (AESA) — División de Derechos de los Pasajeros", "https://www.seguridadaerea.gob.es/es/consultas", null, "+34 91 396 82 10", "es",
    "El correo de consultas de AESA es solo para información; las reclamaciones van por su formulario."),
  SE: N("SE", "Konsumentverket (Swedish Consumer Agency)", "https://www.hallakonsument.se/", "konsumentverket@konsumentverket.se", "+46 771 42 33 00"),
  IS: N("IS", "Icelandic Transport Authority (Samgöngustofa)", "https://island.is/en/o/transport-authority/rights-of-air-passengers", "consumers@icetra.is", "+354 480 6000"),
  NO: N("NO", "Transportklagenemnda (Norsk ReiselivsForum)", "http://www.reiselivsforum.no/", "post@reiselivsforum.no", "+47 22 54 60 00"),
  CH: N("CH", "Federal Office of Civil Aviation FOCA", "https://www.bazl.admin.ch/pax-online-form", "passengerrights@bazl.admin.ch", "+41 58 465 95 96"),
};
