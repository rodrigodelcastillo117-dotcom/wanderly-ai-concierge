// Fuentes oficiales del motor de derechos (consultadas el 29-oct-2026). Sin Deno ni red.
//
// Regla: cada derecho, monto o plazo que el motor afirma apunta a una fuente de esta tabla.
//   estado "verificado"         → leímos el texto oficial hoy (PDF/HTML/XML del sitio oficial) y la cita
//                                  es textual.
//   estado "verificado_indice"  → el sitio oficial bloquea lectura automática (403/captcha); lo vimos hoy
//                                  en el índice de búsqueda restringido a ese dominio oficial. Sirve para
//                                  dar un enlace, NUNCA para mandar un correo automático.
//   estado "no_verificado"      → no se pudo comprobar: el motor no lo usa para afirmar nada.
// El detalle (con la cita completa de cada artículo) está en docs/iatos/IATOS_DERECHOS_RECLAMOS.md.

export const CONSULTADO = "2026-10-29";

export type EstadoFuente = "verificado" | "verificado_indice" | "no_verificado";

export type Fuente = {
  id: string;
  titulo: string;
  url: string;
  consultado: string;
  estado: EstadoFuente;
  /** Cita textual corta (o resumen fiel marcado con […]) del pasaje que se usa. */
  cita: string;
};

const F = (id: string, titulo: string, url: string, estado: EstadoFuente, cita: string): Fuente =>
  ({ id, titulo, url, consultado: CONSULTADO, estado, cita });

const LAC = "https://www.diputados.gob.mx/LeyesBiblio/pdf/LAC.pdf";
const LFPC = "https://www.diputados.gob.mx/LeyesBiblio/pdf/LFPC.pdf";
const EU261_TXT = "https://www.legislation.gov.uk/eur/2004/261/adopted";
const UK261_TXT = "https://www.legislation.gov.uk/eur/2004/261";
const YOUR_EUROPE = "https://europa.eu/youreurope/citizens/travel/passenger-rights/air/index_en.htm";
const ECFR = "https://www.ecfr.gov/current/title-14";
const APPR = "https://laws-lois.justice.gc.ca/eng/regulations/SOR-2019-150/";
const ANAC400 = "https://www.anac.gov.br/assuntos/legislacao/legislacao-1/resolucoes/resolucoes-2016/resolucao-no-400-13-12-2016";
const MONTREAL = "https://www.legislation.gov.uk/ukpga/1961/27/schedule/1B";

export const FUENTES: Record<string, Fuente> = Object.fromEntries([
  // ───────── México ─────────
  F("MX_LAC_47BIS_III", "Ley de Aviación Civil, art. 47 Bis fr. III (última reforma DOF 14-11-2025)", LAC, "verificado",
    "…están obligadas a informar de manera rápida y expedita… con al menos veinticuatro horas de anticipación a la salida programada."),
  F("MX_LAC_47BIS_V", "Ley de Aviación Civil, art. 47 Bis fr. V (retraso)", LAC, "verificado",
    "a) Cuando la demora sea superior a una hora e inferior a cuatro, se compensará conforme las políticas de compensación de cada permisionario o concesionario. […] Si la demora es mayor a dos horas pero menor a cuatro, los descuentos… no podrán ser menores al 7.5% del precio del boleto. b) Si la demora es mayor a cuatro horas… accederá a las opciones y, en el caso, a la indemnización establecida por esta Ley para la cancelación del vuelo…"),
  F("MX_LAC_47BIS_VI", "Ley de Aviación Civil, art. 47 Bis fr. VI (cancelación)", LAC, "verificado",
    "a) Reintegrarle el precio del boleto… b) Ofrecerle… transporte sustituto en el primer vuelo disponible… alimentos… alojamiento… c) Transportarle en la fecha posterior que convenga… En los casos de los incisos a) y c)… una indemnización… no inferior al veinticinco por ciento del precio del boleto…"),
  F("MX_LAC_47BIS_VII", "Ley de Aviación Civil, art. 47 Bis fr. VII (aterrizaje en otro lugar)", LAC, "verificado",
    "Si por caso fortuito o fuerza mayor, la aeronave realiza un aterrizaje en un lugar distinto al de destino… debe trasladar a la persona pasajera por los medios de transporte más rápidos disponibles, hasta el lugar de destino."),
  F("MX_LAC_47BIS_X", "Ley de Aviación Civil, art. 47 Bis fr. X (plazo de pago)", LAC, "verificado",
    "…obligadas a pagar las indemnizaciones previstas en la presente Ley dentro de un periodo máximo de diez días naturales posteriores a su reclamación… salvo las compensaciones de alimentos y hospedaje que deben ser cubiertas al momento de que el retraso del vuelo se actualice."),
  F("MX_LAC_47BIS_IX", "Ley de Aviación Civil, art. 47 Bis fr. IX (equipaje internacional)", LAC, "verificado",
    "Para los servicios de transporte aéreo internacional, el transporte de equipaje se sujetará a lo dispuesto en los Tratados."),
  F("MX_LAC_52", "Ley de Aviación Civil, arts. 52 y 52 Bis (sobreventa)", LAC, "verificado",
    "Cuando se hayan expedido boletos en exceso… I. Reintegrarle el precio… II. …transporte sustituto en el primer vuelo disponible… III. Transportarle en la fecha posterior… En los casos de las fracciones I y III… una indemnización… que no será inferior al veinticinco por ciento del precio del boleto…"),
  F("MX_LAC_62", "Ley de Aviación Civil, art. 62 (equipaje)", LAC, "verificado",
    "La indemnización por la destrucción o avería del equipaje de mano será de hasta ochenta Unidades de Medida y Actualización. Por la pérdida o avería del equipaje facturado la indemnización será equivalente a la suma de ciento cincuenta Unidades de Medida y Actualización."),
  F("MX_UMA_2026", "Valor de la UMA 2026 (DOF 09-01-2026)", "https://dof.gob.mx/nota_detalle.php?codigo=5778072&fecha=09%2F01%2F2026", "verificado",
    "el valor diario de la Unidad de Medida y Actualización es de $117.31 pesos mexicanos… vigentes a partir del 1º de febrero de 2026"),
  F("MX_LFPC_7", "Ley Federal de Protección al Consumidor, art. 7 (última reforma DOF 12-12-2025)", LFPC, "verificado",
    "Todo proveedor está obligado a informar y a respetar los precios, tarifas… reservaciones y demás condiciones aplicables…"),
  F("MX_LFPC_14", "Ley Federal de Protección al Consumidor, art. 14 (prescripción)", LFPC, "verificado",
    "El plazo de prescripción de los derechos y obligaciones establecidos en la presente ley será de un año, salvo otros términos previstos por esta ley."),
  F("MX_LFPC_65TER1", "Ley Federal de Protección al Consumidor, art. 65 Ter 1 (agencias y aerolíneas)", LFPC, "verificado",
    "Las disposiciones relativas a derechos de los pasajeros contenidas en la Ley de Aviación Civil, son de obligatorio cumplimiento por parte de los concesionarios o permisionarios… y de las agencias de viaje a cargo de las ventas de pasajes, reservas y chequeo en mostradores."),
  F("MX_LFPC_92BIS", "Ley Federal de Protección al Consumidor, arts. 92 Bis y 92 Ter (bonificación)", LFPC, "verificado",
    "Los consumidores tendrán derecho a la bonificación o compensación cuando la prestación de un servicio sea deficiente, no se preste o proporcione por causas imputables al proveedor… La bonificación… no podrá ser menor al veinte por ciento del precio pagado."),
  F("MX_LFPC_99", "Ley Federal de Protección al Consumidor, art. 99 (requisitos de la queja)", LFPC, "verificado",
    "…podrán presentarse en forma escrita, oral, telefónica, electrónica… I. Señalar nombre y domicilio del reclamante; II. Descripción del bien o servicio que se reclama y relación sucinta de los hechos; III. Señalar nombre y domicilio del proveedor…"),
  F("MX_LTOSF_23", "Ley para la Transparencia y Ordenamiento de los Servicios Financieros, art. 23 (aclaraciones)", "https://www.diputados.gob.mx/LeyesBiblio/pdf/LTOSF.pdf", "verificado",
    "…podrá presentar una solicitud de aclaración dentro del plazo de noventa días naturales contados a partir de la fecha de corte… la institución tendrá un plazo máximo de cuarenta y cinco días para entregar al Cliente el dictamen…"),
  F("PROFECO_TELCON", "PROFECO · Teléfono del Consumidor", "https://www.gob.mx/profeco/articulos/telefono-del-consumidor?idiom=es", "verificado",
    "55 5568 8722 y 800 468 8722; de 9:00 a 19:00 horas de lunes a viernes y de 10:00 a 18:00 horas los fines de semana y días festivos."),
  F("PROFECO_CONCILIANET", "PROFECO · Concilianet (queja en línea)", "https://concilianet.profeco.gob.mx/Concilianet/inicio.jsp", "verificado",
    "Procedimiento conciliatorio en línea con «Proveedores registrados en Concilianet»; para otros proveedores, acudir a la oficina de Profeco más cercana. Correo: quejasconcilianet@profeco.gob.mx."),
  F("PROFECO_REQUISITOS", "PROFECO · Proceso y requisitos de quejas", "https://www.gob.mx/profeco/articulos/proceso-y-requisitos-de-quejas-y-denuncias", "verificado",
    "Identificación oficial; contrato, recibo o comprobante de compra; nombre y domicilio del proveedor; descripción del bien o servicio y de los hechos. Desde el extranjero: extranjeros@profeco.gob.mx (CARE)."),
  // ───────── Unión Europea ─────────
  F("EU261_3", "Reglamento (CE) 261/2004, art. 3 (ámbito)", EU261_TXT, "verificado",
    "a) to passengers departing from an airport located in the territory of a Member State… b) …departing from an airport located in a third country to an airport situated in the territory of a Member State… if the operating air carrier of the flight concerned is a Community carrier."),
  F("EU261_4", "Reglamento (CE) 261/2004, art. 4 (denegación de embarque)", EU261_TXT, "verificado",
    "If boarding is denied to passengers against their will, the operating air carrier shall immediately compensate them in accordance with Article 7 and assist them in accordance with Articles 8 and 9."),
  F("EU261_5", "Reglamento (CE) 261/2004, art. 5 (cancelación)", EU261_TXT, "verificado",
    "…right to compensation… unless: (i) informed… at least two weeks before…; (ii) between two weeks and seven days… re-routing… depart no more than two hours before… reach… less than four hours after…; (iii) less than seven days… depart no more than one hour before… less than two hours after… (3) …not obliged to pay compensation… if… caused by extraordinary circumstances which could not have been avoided even if all reasonable measures had been taken."),
  F("EU261_6", "Reglamento (CE) 261/2004, art. 6 (retraso: asistencia)", EU261_TXT, "verificado",
    "…two hours or more… 1500 kilometres or less; three hours or more… intra-Community… more than 1500 km and… between 1500 and 3500 km; four hours or more… all other flights… (iii) when the delay is at least five hours, the assistance specified in Article 8(1)(a)."),
  F("EU261_7", "Reglamento (CE) 261/2004, art. 7 (compensación)", EU261_TXT, "verificado",
    "EUR 250 for all flights of 1500 kilometres or less; EUR 400 for all intra-Community flights of more than 1500 kilometres, and for all other flights between 1500 and 3500 kilometres; EUR 600 for all flights not falling under (a) or (b). […] may reduce the compensation… by 50 % […] paid in cash… or, with the signed agreement of the passenger, in travel vouchers […] measured by the great circle route method."),
  F("EU261_8", "Reglamento (CE) 261/2004, art. 8 (reembolso o transporte alternativo)", EU261_TXT, "verificado",
    "…reimbursement within seven days… of the full cost of the ticket… re-routing… at the earliest opportunity; or… at a later date at the passenger's convenience…"),
  F("EU261_9", "Reglamento (CE) 261/2004, art. 9 (asistencia)", EU261_TXT, "verificado",
    "meals and refreshments in a reasonable relation to the waiting time; hotel accommodation…; transport between the airport and place of accommodation… two telephone calls, telex or fax messages, or e-mails."),
  F("EU261_10", "Reglamento (CE) 261/2004, art. 10 (clase inferior)", EU261_TXT, "verificado",
    "…reimburse 30 % of the price of the ticket for all flights of 1500 kilometres or less, or 50 %… between 1500 and 3500 kilometres, or 75 %… for all flights not falling under (a) or (b)…"),
  F("EU261_14", "Reglamento (CE) 261/2004, art. 14 (aviso por escrito)", EU261_TXT, "verificado",
    "…shall provide each passenger affected with a written notice setting out the rules for compensation and assistance… The contact details of the national designated body… shall also be given to the passenger in written form."),
  F("EU_YOUR_EUROPE", "Your Europe · Derechos de los pasajeros aéreos (revisado 21/09/2026)", YOUR_EUROPE, "verificado",
    "Arrival delay of 3 hours or more → €250 (≤1,500 km), €400 (intra-EU >1,500 km or 1,500–3,500 km), €300 (>3,500 km, 3–4 h), €600 (>3,500 km, 4 h or more). Not extraordinary: most technical problems… Send your complaint to the airline first; if no reply within 2 months, complain to the national authority of the country where the incident took place. Luggage: in writing within 7 days (21 days if delayed)."),
  F("EU_NEB", "Comisión Europea · Organismos nacionales (actualizado 13-oct-2026)",
    "https://transport.ec.europa.eu/document/download/d7b5dd33-4083-4faa-8132-b6dc8b3a1c07_en?filename=2004_261_national_enforcement_bodies.pdf", "verificado",
    "National Enforcement Bodies — Regulation (EC) No 261/2004. Updated: 13 October 2026."),
  // ───────── Reino Unido ─────────
  F("UK261_3", "UK261 (Reg. 261/2004 tal como quedó en el Reino Unido), art. 3", UK261_TXT, "verificado",
    "a) to passengers departing from an airport located in the United Kingdom; b) …departing from… a country other than the United Kingdom to… the United Kingdom if the operating air carrier… is a Community carrier or a UK air carrier; or… a Member State… if the operating air carrier… is a UK air carrier. […] 9. For limitation purposes a claim… will be determined in accordance with section 9 of the Limitation Act 1980."),
  F("UK261_7", "UK261, art. 7 (compensación)", UK261_TXT, "verificado",
    "£220 for all flights of 1500 kilometres or less; £350 for all flights between 1500 and 3500 kilometres; £520 for all flights not falling under (a) or (b)."),
  F("UK_CAA_DELAYS", "CAA · Delays", "https://www.caa.co.uk/air-passengers/travel-problems-and-rights/flight-delays-and-cancellations/delays/", "verificado",
    "If you arrive between three and four hours late, the compensation amount is £260 per person; but if you arrive more than four hours late… £520… escalate… to an Alternative Dispute Resolution (ADR) provider if your airline is signed up to one… the CAA's… Passenger Advice and Complaints Team (PACT) if they are not."),
  // ───────── Estados Unidos ─────────
  F("US_260", "14 CFR parte 260 (reembolsos, regla de 2024)", `${ECFR}/part-260`, "verificado",
    "Significantly delayed or changed flight: …three hours or more for domestic itineraries and six hours or more for international itineraries… A full refund of the airfare, including any taxes and ancillary fees, is due… Prompt refund: within 7 business days… credit card… within 20 calendar days… other forms."),
  F("US_260_BAGS", "14 CFR 260.2 (equipaje significativamente retrasado)", `${ECFR}/part-260`, "verificado",
    "…not delivered… within 12 hours… domestic… within 15 hours… international… 12 hours or less in duration, and within 30 hours… more than 12 hours in duration."),
  F("US_250", "14 CFR 250.5 (compensación por denegación de embarque)", `${ECFR}/part-250`, "verificado",
    "…at least 200 percent of the fare… or $1,075, whichever is lower… more than one hour but less than two hours [domestic] / less than four hours [international]… at least 400 percent of the fare… or $2,150, whichever is lower… Applies to… nonstop flight segments originating at a point within the United States (250.2), aircraft of 30 or more seats."),
  F("US_254", "14 CFR 254.4 (equipaje nacional EE. UU.)", `${ECFR}/part-254`, "verificado",
    "…shall not limit its liability… to an amount less than $4,700 for each passenger."),
  F("US_DOT_QUEJA", "DOT · Formulario de queja (Aviation Consumer Protection)", "https://airconsumer.dot.gov/consumer/s/complaint-form", "verificado_indice",
    "OACP asks you to contact the airline or travel agency first; if not resolved, file a complaint with the web-based form."),
  // ───────── Canadá ─────────
  F("CA_APPR_10", "APPR (SOR/2019-150), art. 10 (fuera del control de la aerolínea)", APPR, "verificado",
    "(a) war or political instability; (b) illegal acts or sabotage; (c) meteorological conditions or natural disasters that make the safe operation of the aircraft impossible; (d) instructions from air traffic control; … (g) airport operation issues; (h) a medical emergency; (i) a collision with wildlife; (j) a labour disruption…"),
  F("CA_APPR_12", "APPR, arts. 11–12 (dentro del control)", APPR, "verificado",
    "…if a passenger is informed 14 days or less before the departure time… provide the minimum compensation for inconvenience in the manner set out in section 19."),
  F("CA_APPR_19", "APPR, art. 19 (compensación por retraso o cancelación)", APPR, "verificado",
    "large carrier: $400 (3 h–<6 h), $700 (6 h–<9 h), $1,000 (9 h or more); small carrier: $125, $250, $500. […] refunded: $400 large / $125 small. […] file a request… before the first anniversary… The carrier must, within 30 days… provide the compensation or an explanation."),
  F("CA_APPR_20", "APPR, art. 20 (denegación de embarque)", APPR, "verificado",
    "$900 (delayed by less than six hours); $1,800 (six hours or more, but less than nine hours); $2,400 (nine hours or more)."),
  F("CA_APPR_17", "APPR, art. 17 (reembolso en 30 días)", APPR, "verificado",
    "Refunds must be provided by a carrier within 30 days after the day on which the carrier becomes obligated to provide the refund."),
  F("CA_CTA_QUEJA", "Canadian Transportation Agency · Air Passenger Protection", "https://protection-passager-passenger.otc-cta.gc.ca/en", "verificado_indice",
    "Flights to, from, and within Canada, including connecting flights. First contact the airline in writing; if no response after 30 days or not satisfied, complain to the CTA."),
  // ───────── Brasil ─────────
  F("BR_ANAC400_21", "ANAC Resolução 400/2016, art. 21 (alternativas)", ANAC400, "verificado",
    "…rebooking, refund, and service provided by another modal of transport, at the passenger's choice… I – more than four hours flight delay…; II – flight disruption or cancellation; III – denial of boarding; IV – when the passenger misses a connecting flight… if the operator is responsible…"),
  F("BR_ANAC400_24", "ANAC Resolução 400/2016, art. 24 (preterição)", ANAC400, "verificado",
    "…immediate financial compensation made by bank transfer, voucher, or in cash, in the amount of: I – 250 SDR for domestic flights; and II – 500 SDR for international flights."),
  F("BR_ANAC400_27", "ANAC Resolução 400/2016, art. 27 (assistência material)", ANAC400, "verificado",
    "I – more than one hour: means for communication; II – more than two hours: food…; III – more than four hours: hotel accommodations, in case of overnight stay, and round-trip transfer."),
  F("BR_ANAC400_29", "ANAC Resolução 400/2016, arts. 29 y 31 (reembolso)", ANAC400, "verificado",
    "Refunds shall be given within seven days from the date of request… Refund may be made through vouchers… upon agreement by the passenger."),
  F("BR_ANAC400_32", "ANAC Resolução 400/2016, art. 32 (bagagem)", ANAC400, "verificado",
    "…return the lost baggage… within seven days, in the case of domestic flights; or within 21 days, in the case of international flights… If baggage is not located… refund the passenger within 7 days… If baggage is… damaged, the passenger shall file a claim… within 7 days…"),
  F("BR_ANAC400_38", "ANAC Resolução 400/2016, art. 38 (resposta em 10 dias)", ANAC400, "verificado",
    "…complaints shall be answered within a maximum of ten days from claim registration…"),
  F("BR_ANAC_PASSAGEIRO", "ANAC · Anac Passageiro (reclamações contra empresas aéreas)", "https://www.gov.br/anac/pt-br/canais_atendimento/anacpassageiro", "verificado_indice",
    "A partir de 13 de abril de 2026… plataforma Anac Passageiro… principal canal para registro de reclamações contra empresas aéreas. Procure primeiro a própria empresa."),
  // ───────── Convenio de Montreal ─────────
  F("MC99_17_22", "Convenio de Montreal 1999, arts. 17, 19 y 22", MONTREAL, "verificado",
    "If the carrier admits the loss of the checked baggage, or if the checked baggage has not arrived at the expiration of twenty-one days… The carrier is liable for damage occasioned by delay…"),
  F("MC99_LIMITES_2024", "Límites revisados del Convenio de Montreal (vigentes desde 28-dic-2024)", "https://www.legislation.gov.uk/uksi/2025/123/made", "verificado",
    "Article 22, paragraph 1: 6,303; Article 22, paragraph 2: 1,519 (Special Drawing Rights)."),
  F("MC99_31", "Convenio de Montreal 1999, art. 31 (aviso por escrito)", MONTREAL, "verificado",
    "…at the latest, within seven days from the date of receipt in the case of checked baggage… In the case of delay… within twenty-one days… Every complaint must be made in writing…"),
  F("MC99_35", "Convenio de Montreal 1999, art. 35 (caducidad)", MONTREAL, "verificado",
    "The right to damages shall be extinguished if an action is not brought within a period of two years…"),
].map((f) => [f.id, f]));

export function fuente(id: string): Fuente {
  const f = FUENTES[id];
  if (!f) throw new Error(`fuente desconocida: ${id}`);
  return f;
}

/** Lo que se muestra al usuario: título + URL + fecha de consulta. */
export function citaCorta(id: string): string {
  const f = fuente(id);
  return `${f.titulo} — ${f.url} (consultado ${f.consultado})`;
}
