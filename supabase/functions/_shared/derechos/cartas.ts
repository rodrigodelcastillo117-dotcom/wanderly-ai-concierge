// Cartas formales de reclamación (aerolínea u organismo) en el idioma del destinatario (es/en/pt/fr).
// Deterministas: los hechos salen de los datos del caso, el fundamento de las fuentes verificadas y
// el pedido del motor. El relato libre del pasajero va citado tal cual (nunca se traduce con IA).
// Sin Deno ni red. Probado en src/test/derechosCartas.test.ts.
import { AIRLINE_COUNTRY, contactoAerolinea, idiomaProveedor, type Organismo } from "./datos.ts";
import { FUENTES } from "./fuentes.ts";
import type { CasoVuelo, Derecho, Evaluacion, RegimenId } from "./motor.ts";

export type Idioma = "es" | "en" | "pt" | "fr";
export type DatosPasajero = {
  nombre: string;
  correo?: string | null;
  telefono?: string | null;
  domicilio?: string | null;
  reserva?: string | null;
  boleto?: string | null;
  acompanantes?: string[];
};
export type Gasto = { concepto: string; monto: number; moneda: string };
export type Carta = {
  idioma: Idioma;
  asunto: string;
  texto: string;
  html: string;
  destinatario: { nombre: string; correo: string | null; url: string | null; canal: "correo" | "formulario" | "telefono" | "sitio" };
  fundamentos: string[];
  pedido: string[];
  plazo_respuesta_dias: number;
  adjuntos: string[];
};

// ───────────────────────────── Textos por idioma ─────────────────────────────
type T = Record<Idioma, string>;
const L = {
  asunto: { es: "Reclamación formal", en: "Formal claim", pt: "Reclamação formal", fr: "Réclamation formelle" } as T,
  asuntoOrg: { es: "Queja contra", en: "Complaint against", pt: "Reclamação contra", fr: "Plainte contre" } as T,
  vuelo: { es: "vuelo", en: "flight", pt: "voo", fr: "vol" } as T,
  saludo: { es: "Estimados señores:", en: "Dear Sir or Madam,", pt: "Prezados senhores,", fr: "Madame, Monsieur," } as T,
  intro: {
    es: "Por medio de la presente presento una reclamación formal por los hechos que se describen a continuación.",
    en: "I hereby submit a formal claim regarding the facts described below.",
    pt: "Venho, por meio desta, apresentar uma reclamação formal pelos fatos descritos a seguir.",
    fr: "Par la présente, je vous adresse une réclamation formelle concernant les faits décrits ci-dessous.",
  } as T,
  introOrg: {
    es: "Presento queja contra la aerolínea indicada, a la que reclamé previamente sin una solución satisfactoria.",
    en: "I am filing a complaint against the airline below, which I contacted first without a satisfactory solution.",
    pt: "Apresento reclamação contra a companhia aérea indicada, que contatei previamente sem solução satisfatória.",
    fr: "Je dépose une plainte contre la compagnie aérienne ci-dessous, que j'ai contactée au préalable sans solution satisfaisante.",
  } as T,
  datos: { es: "Datos del pasajero", en: "Passenger details", pt: "Dados do passageiro", fr: "Données du passager" } as T,
  nombre: { es: "Nombre", en: "Name", pt: "Nome", fr: "Nom" } as T,
  correo: { es: "Correo", en: "Email", pt: "E-mail", fr: "E-mail" } as T,
  telefono: { es: "Teléfono", en: "Phone", pt: "Telefone", fr: "Téléphone" } as T,
  domicilio: { es: "Domicilio", en: "Address", pt: "Endereço", fr: "Adresse" } as T,
  reserva: { es: "Código de reserva", en: "Booking reference", pt: "Código da reserva", fr: "Référence de réservation" } as T,
  boleto: { es: "Número de boleto", en: "Ticket number", pt: "Número do bilhete", fr: "Numéro de billet" } as T,
  acompanantes: { es: "Acompañantes en la misma reserva", en: "Other passengers on the same booking", pt: "Acompanhantes na mesma reserva", fr: "Autres passagers de la réservation" } as T,
  hechos: { es: "Hechos", en: "Facts", pt: "Fatos", fr: "Faits" } as T,
  relato: { es: "Relato del pasajero", en: "Passenger's account (original wording, in Spanish)", pt: "Relato do passageiro (texto original, em espanhol)", fr: "Récit du passager (texte original, en espagnol)" } as T,
  fundamento: { es: "Fundamento legal", en: "Legal basis", pt: "Fundamento legal", fr: "Fondement juridique" } as T,
  pido: { es: "Por lo anterior, solicito", en: "Accordingly, I request", pt: "Diante do exposto, solicito", fr: "En conséquence, je demande" } as T,
  plazo: {
    es: "Les pido una respuesta por escrito en un plazo máximo de {n} días naturales a partir de la recepción de esta carta. De no recibirla, acudiré a {org}.",
    en: "Please reply in writing within {n} calendar days of receipt of this letter. Otherwise I will refer the matter to {org}.",
    pt: "Peço resposta por escrito no prazo máximo de {n} dias corridos a partir do recebimento desta carta. Caso contrário, recorrerei a {org}.",
    fr: "Je vous prie de me répondre par écrit dans un délai de {n} jours calendaires à compter de la réception de ce courrier. À défaut, je saisirai {org}.",
  } as T,
  pagoEfectivo: {
    es: "El pago debe hacerse en dinero (transferencia o al mismo medio de pago); no acepto vales ni millas en su lugar.",
    en: "Payment must be made in money (bank transfer or to the original form of payment); I do not accept vouchers or miles instead.",
    pt: "O pagamento deve ser feito em dinheiro (transferência ou no mesmo meio de pagamento); não aceito vouchers nem milhas em substituição.",
    fr: "Le paiement doit être effectué en argent (virement ou sur le moyen de paiement d'origine) ; je n'accepte pas de bons ni de miles à la place.",
  } as T,
  extraordinaria: {
    es: "Si sostienen que hubo circunstancias extraordinarias, les pido acreditarlo documentalmente, incluyendo las medidas razonables que tomaron para evitarlo.",
    en: "Should you claim extraordinary circumstances, please provide documentary evidence, including the reasonable measures taken to avoid them.",
    pt: "Caso aleguem circunstâncias extraordinárias, peço que as comprovem documentalmente, incluindo as medidas razoáveis adotadas para evitá-las.",
    fr: "Si vous invoquez des circonstances extraordinaires, merci d'en apporter la preuve documentaire, y compris les mesures raisonnables prises pour les éviter.",
  } as T,
  noDuplicar: {
    es: "Las cantidades se solicitan sin duplicar pagos por un mismo concepto.",
    en: "These amounts are requested without duplicating payments for the same item.",
    pt: "Os valores são solicitados sem duplicidade de pagamento pelo mesmo motivo.",
    fr: "Ces montants sont demandés sans double paiement pour un même motif.",
  } as T,
  adjuntos: { es: "Anexos", en: "Attachments", pt: "Anexos", fr: "Pièces jointes" } as T,
  firma: { es: "Atentamente,", en: "Sincerely,", pt: "Atenciosamente,", fr: "Veuillez agréer mes salutations distinguées," } as T,
  via: {
    es: "Enviado con autorización expresa del pasajero a través de IATOS (traveliatos.life). Las respuestas a este correo le llegan al pasajero.",
    en: "Sent with the passenger's express authorisation through IATOS (traveliatos.life). Replies to this email reach the passenger.",
    pt: "Enviado com autorização expressa do passageiro por meio da IATOS (traveliatos.life). As respostas a este e-mail chegam ao passageiro.",
    fr: "Envoyé avec l'autorisation expresse du passager via IATOS (traveliatos.life). Les réponses à ce courriel parviennent au passager.",
  } as T,
  previo: {
    es: "Reclamé a la aerolínea el {f}.",
    en: "I submitted my claim to the airline on {f}.",
    pt: "Apresentei minha reclamação à companhia aérea em {f}.",
    fr: "J'ai adressé ma réclamation à la compagnie aérienne le {f}.",
  } as T,
  sinResp: {
    es: "No he recibido respuesta.", en: "I have not received a reply.", pt: "Não recebi resposta.", fr: "Je n'ai reçu aucune réponse.",
  } as T,
  resp: {
    es: "Su respuesta fue: «{r}».", en: "Their reply was: \"{r}\".", pt: "A resposta foi: \"{r}\".", fr: "Leur réponse était : « {r} ».",
  } as T,
  pidoOrg: {
    es: "su intervención para que la aerolínea cumpla con los derechos señalados y, en su caso, la conciliación correspondiente",
    en: "your intervention so that the airline complies with the rights set out above",
    pt: "a intervenção para que a companhia aérea cumpra os direitos indicados",
    fr: "votre intervention afin que la compagnie aérienne respecte les droits indiqués",
  } as T,
};
const t = (k: keyof typeof L, lang: Idioma, vars: Record<string, string | number> = {}) =>
  Object.entries(vars).reduce((s, [a, b]) => s.split(`{${a}}`).join(String(b)), L[k][lang]);

const EVENTO: Record<CasoVuelo["evento"], T> = {
  retraso: { es: "retraso del vuelo", en: "flight delay", pt: "atraso do voo", fr: "retard du vol" },
  cancelacion: { es: "cancelación del vuelo", en: "flight cancellation", pt: "cancelamento do voo", fr: "annulation du vol" },
  sobreventa: { es: "denegación de embarque por sobreventa", en: "denied boarding (overbooking)", pt: "preterição de embarque (overbooking)", fr: "refus d'embarquement (surréservation)" },
  conexion_perdida: { es: "pérdida de la conexión", en: "missed connection", pt: "perda da conexão", fr: "correspondance manquée" },
  clase_inferior: { es: "cambio a una clase inferior", en: "downgrading", pt: "rebaixamento de classe", fr: "déclassement" },
  equipaje_perdido: { es: "pérdida del equipaje facturado", en: "loss of checked baggage", pt: "extravio da bagagem despachada", fr: "perte du bagage enregistré" },
  equipaje_danado: { es: "daño al equipaje", en: "damaged baggage", pt: "dano à bagagem", fr: "bagage endommagé" },
  equipaje_retrasado: { es: "retraso en la entrega del equipaje", en: "delayed baggage", pt: "atraso na entrega da bagagem", fr: "retard de livraison du bagage" },
};

/** Fundamento por fuente, en cada idioma (solo fuentes verificadas). */
const FUND: Record<string, T> = {
  EU261_4: { es: "Reglamento (CE) n.º 261/2004, art. 4 (denegación de embarque)", en: "Regulation (EC) No 261/2004, Article 4 (denied boarding)", pt: "Regulamento (CE) n.º 261/2004, art. 4.º (recusa de embarque)", fr: "Règlement (CE) n° 261/2004, article 4 (refus d'embarquement)" },
  EU261_5: { es: "Reglamento (CE) n.º 261/2004, art. 5 (cancelación)", en: "Regulation (EC) No 261/2004, Article 5 (cancellation)", pt: "Regulamento (CE) n.º 261/2004, art. 5.º (cancelamento)", fr: "Règlement (CE) n° 261/2004, article 5 (annulation)" },
  EU261_6: { es: "Reglamento (CE) n.º 261/2004, art. 6 (retraso)", en: "Regulation (EC) No 261/2004, Article 6 (delay)", pt: "Regulamento (CE) n.º 261/2004, art. 6.º (atraso)", fr: "Règlement (CE) n° 261/2004, article 6 (retard)" },
  EU261_7: { es: "Reglamento (CE) n.º 261/2004, art. 7 (compensación)", en: "Regulation (EC) No 261/2004, Article 7 (compensation)", pt: "Regulamento (CE) n.º 261/2004, art. 7.º (indemnização)", fr: "Règlement (CE) n° 261/2004, article 7 (indemnisation)" },
  EU261_8: { es: "Reglamento (CE) n.º 261/2004, art. 8 (reembolso o transporte alternativo)", en: "Regulation (EC) No 261/2004, Article 8 (reimbursement or re-routing)", pt: "Regulamento (CE) n.º 261/2004, art. 8.º (reembolso ou reencaminhamento)", fr: "Règlement (CE) n° 261/2004, article 8 (remboursement ou réacheminement)" },
  EU261_9: { es: "Reglamento (CE) n.º 261/2004, art. 9 (derecho de atención)", en: "Regulation (EC) No 261/2004, Article 9 (right to care)", pt: "Regulamento (CE) n.º 261/2004, art. 9.º (direito a assistência)", fr: "Règlement (CE) n° 261/2004, article 9 (droit à une prise en charge)" },
  EU261_10: { es: "Reglamento (CE) n.º 261/2004, art. 10 (clase inferior)", en: "Regulation (EC) No 261/2004, Article 10 (downgrading)", pt: "Regulamento (CE) n.º 261/2004, art. 10.º (classe inferior)", fr: "Règlement (CE) n° 261/2004, article 10 (déclassement)" },
  EU_YOUR_EUROPE: { es: "Reglamento (CE) n.º 261/2004, arts. 6 y 7, conforme a la guía oficial de la Comisión Europea (retraso de 3 h o más a la llegada)", en: "Regulation (EC) No 261/2004, Articles 6 and 7, as set out in the European Commission's official guidance (arrival delay of 3 hours or more)", pt: "Regulamento (CE) n.º 261/2004, arts. 6.º e 7.º, conforme a orientação oficial da Comissão Europeia (atraso de 3 horas ou mais na chegada)", fr: "Règlement (CE) n° 261/2004, articles 6 et 7, selon les indications officielles de la Commission européenne (retard de 3 heures ou plus à l'arrivée)" },
  UK261_3: { es: "UK261 (Reglamento 261/2004 conservado en el Reino Unido)", en: "UK261 (Regulation (EC) No 261/2004 as retained in UK law)", pt: "UK261 (Regulamento 261/2004 conforme mantido no Reino Unido)", fr: "UK261 (règlement 261/2004 tel que maintenu au Royaume-Uni)" },
  UK261_7: { es: "UK261, art. 7 (compensación)", en: "UK261, Article 7 (compensation)", pt: "UK261, art. 7.º (indemnização)", fr: "UK261, article 7 (indemnisation)" },
  UK_CAA_DELAYS: { es: "UK261, arts. 6 y 7, según la guía de la Civil Aviation Authority", en: "UK261, Articles 6 and 7, as set out in Civil Aviation Authority guidance", pt: "UK261, arts. 6.º e 7.º, conforme orientação da Civil Aviation Authority", fr: "UK261, articles 6 et 7, selon les indications de la Civil Aviation Authority" },
  MX_LAC_47BIS_V: { es: "Ley de Aviación Civil (México), art. 47 Bis, fracción V (retraso)", en: "Mexican Civil Aviation Law (Ley de Aviación Civil), Article 47 Bis, section V (delay)", pt: "Lei de Aviação Civil do México, art. 47 Bis, inciso V (atraso)", fr: "Loi mexicaine sur l'aviation civile, article 47 Bis, fraction V (retard)" },
  MX_LAC_47BIS_VI: { es: "Ley de Aviación Civil (México), art. 47 Bis, fracción VI (cancelación) y fracción X (pago en 10 días naturales)", en: "Mexican Civil Aviation Law, Article 47 Bis, sections VI (cancellation) and X (payment within 10 calendar days)", pt: "Lei de Aviação Civil do México, art. 47 Bis, incisos VI (cancelamento) e X (pagamento em 10 dias corridos)", fr: "Loi mexicaine sur l'aviation civile, article 47 Bis, fractions VI (annulation) et X (paiement sous 10 jours calendaires)" },
  MX_LAC_52: { es: "Ley de Aviación Civil (México), arts. 52 y 52 Bis (sobreventa)", en: "Mexican Civil Aviation Law, Articles 52 and 52 Bis (overbooking)", pt: "Lei de Aviação Civil do México, arts. 52 e 52 Bis (overbooking)", fr: "Loi mexicaine sur l'aviation civile, articles 52 et 52 Bis (surréservation)" },
  MX_LAC_62: { es: "Ley de Aviación Civil (México), art. 62 (equipaje)", en: "Mexican Civil Aviation Law, Article 62 (baggage)", pt: "Lei de Aviação Civil do México, art. 62 (bagagem)", fr: "Loi mexicaine sur l'aviation civile, article 62 (bagages)" },
  US_260: { es: "14 CFR parte 260 (reembolsos del DOT de EE. UU.)", en: "14 CFR Part 260 (U.S. DOT refund rule)", pt: "14 CFR Parte 260 (reembolsos, DOT dos EUA)", fr: "14 CFR partie 260 (remboursements, DOT des États-Unis)" },
  US_260_BAGS: { es: "14 CFR 260 (reembolso del cargo por equipaje perdido o retrasado)", en: "14 CFR Part 260 (refund of fees for lost or significantly delayed checked bags)", pt: "14 CFR Parte 260 (reembolso de taxa de bagagem)", fr: "14 CFR partie 260 (remboursement des frais de bagage)" },
  US_250: { es: "14 CFR 250.5 (compensación por denegación de embarque)", en: "14 CFR 250.5 (denied boarding compensation)", pt: "14 CFR 250.5 (compensação por preterição)", fr: "14 CFR 250.5 (indemnisation pour refus d'embarquement)" },
  US_254: { es: "14 CFR 254.4 (responsabilidad mínima por equipaje)", en: "14 CFR 254.4 (minimum baggage liability)", pt: "14 CFR 254.4 (responsabilidade mínima por bagagem)", fr: "14 CFR 254.4 (responsabilité minimale bagages)" },
  CA_APPR_12: { es: "Air Passenger Protection Regulations (Canadá), arts. 12 y 19", en: "Air Passenger Protection Regulations (SOR/2019-150), sections 12 and 19", pt: "Air Passenger Protection Regulations (Canadá), arts. 12 e 19", fr: "Règlement sur la protection des passagers aériens (DORS/2019-150), articles 12 et 19" },
  CA_APPR_17: { es: "Air Passenger Protection Regulations (Canadá), art. 17", en: "Air Passenger Protection Regulations, section 17", pt: "Air Passenger Protection Regulations, art. 17", fr: "Règlement sur la protection des passagers aériens, article 17" },
  CA_APPR_19: { es: "Air Passenger Protection Regulations (Canadá), art. 19", en: "Air Passenger Protection Regulations, section 19", pt: "Air Passenger Protection Regulations, art. 19", fr: "Règlement sur la protection des passagers aériens, article 19" },
  CA_APPR_20: { es: "Air Passenger Protection Regulations (Canadá), art. 20", en: "Air Passenger Protection Regulations, section 20", pt: "Air Passenger Protection Regulations, art. 20", fr: "Règlement sur la protection des passagers aériens, article 20" },
  BR_ANAC400_21: { es: "Resolución ANAC n.º 400/2016, art. 21", en: "ANAC Resolution No. 400/2016, Article 21", pt: "Resolução ANAC nº 400/2016, art. 21", fr: "Résolution ANAC n° 400/2016, article 21" },
  BR_ANAC400_24: { es: "Resolución ANAC n.º 400/2016, art. 24", en: "ANAC Resolution No. 400/2016, Article 24", pt: "Resolução ANAC nº 400/2016, art. 24", fr: "Résolution ANAC n° 400/2016, article 24" },
  BR_ANAC400_27: { es: "Resolución ANAC n.º 400/2016, arts. 26 y 27", en: "ANAC Resolution No. 400/2016, Articles 26 and 27", pt: "Resolução ANAC nº 400/2016, arts. 26 e 27", fr: "Résolution ANAC n° 400/2016, articles 26 et 27" },
  BR_ANAC400_32: { es: "Resolución ANAC n.º 400/2016, art. 32", en: "ANAC Resolution No. 400/2016, Article 32", pt: "Resolução ANAC nº 400/2016, art. 32", fr: "Résolution ANAC n° 400/2016, article 32" },
  MC99_17_22: { es: "Convenio de Montreal de 1999, arts. 17, 19 y 22", en: "Montreal Convention 1999, Articles 17, 19 and 22", pt: "Convenção de Montreal de 1999, arts. 17, 19 e 22", fr: "Convention de Montréal de 1999, articles 17, 19 et 22" },
  MC99_LIMITES_2024: { es: "Convenio de Montreal de 1999, art. 22 (límites revisados vigentes desde el 28-dic-2024)", en: "Montreal Convention 1999, Article 22 (revised limits in force since 28 December 2024)", pt: "Convenção de Montreal de 1999, art. 22 (limites revisados desde 28/12/2024)", fr: "Convention de Montréal de 1999, article 22 (limites révisées depuis le 28/12/2024)" },
  MC99_31: { es: "Convenio de Montreal de 1999, art. 31 (aviso por escrito)", en: "Montreal Convention 1999, Article 31 (written complaint)", pt: "Convenção de Montreal de 1999, art. 31 (reclamação por escrito)", fr: "Convention de Montréal de 1999, article 31 (réclamation écrite)" },
};

const FMT_LOCALE: Record<Idioma, string> = { es: "es-MX", en: "en-GB", pt: "pt-BR", fr: "fr-FR" };
const money = (v: number, cur: string, lang: Idioma) => {
  if (cur === "DEG") return `${v.toLocaleString(FMT_LOCALE[lang])} ${lang === "en" ? "SDR" : lang === "fr" ? "DTS" : lang === "pt" ? "DES" : "DEG"}`;
  try { return new Intl.NumberFormat(FMT_LOCALE[lang], { style: "currency", currency: cur, currencyDisplay: "code", maximumFractionDigits: 2 }).format(v); } catch { return `${v} ${cur}`; }
};
const fecha = (iso: string | null | undefined, lang: Idioma) => {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return iso ?? "";
  return new Intl.DateTimeFormat(FMT_LOCALE[lang], { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso.slice(0, 10)}T12:00:00Z`));
};
const limpio = (s: unknown, max = 1500) => String(s ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim().slice(0, max);
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Hechos escritos a partir de los datos (no del relato libre). */
export function hechosDe(e: Evaluacion, lang: Idioma): string[] {
  const c = e.caso;
  const v = c.vuelo ? `${L.vuelo[lang]} ${c.vuelo}` : L.vuelo[lang];
  const ruta = `${e.ruta.origen}–${e.ruta.destino}${e.ruta.destino_final !== e.ruta.destino ? ` (→ ${e.ruta.destino_final})` : ""}`;
  const f = c.fecha ? fecha(c.fecha, lang) : "";
  const out: string[] = [];
  const base = {
    es: `${e.aerolinea.nombre}, ${v} ${ruta}${f ? ` del ${f}` : ""}: ${EVENTO[c.evento].es}.`,
    en: `${e.aerolinea.nombre}, ${v} ${ruta}${f ? ` on ${f}` : ""}: ${EVENTO[c.evento].en}.`,
    pt: `${e.aerolinea.nombre}, ${v} ${ruta}${f ? ` de ${f}` : ""}: ${EVENTO[c.evento].pt}.`,
    fr: `${e.aerolinea.nombre}, ${v} ${ruta}${f ? ` du ${f}` : ""} : ${EVENTO[c.evento].fr}.`,
  };
  out.push(base[lang]);
  const h = c.horas_retraso_llegada;
  if (typeof h === "number") out.push({ es: `Llegué a mi destino final con ${h} h de retraso.`, en: `I arrived at my final destination ${h} hours late.`, pt: `Cheguei ao destino final com ${h} horas de atraso.`, fr: `Je suis arrivé(e) à destination finale avec ${h} heures de retard.` }[lang]);
  const hs = c.horas_retraso_salida;
  if (typeof hs === "number" && hs !== h) out.push({ es: `El vuelo salió con ${hs} h de retraso.`, en: `The flight departed ${hs} hours late.`, pt: `O voo partiu com ${hs} horas de atraso.`, fr: `Le vol est parti avec ${hs} heures de retard.` }[lang]);
  if (typeof c.aviso_dias === "number") out.push({ es: `Me avisaron ${c.aviso_dias} día(s) antes de la salida programada.`, en: `I was informed ${c.aviso_dias} day(s) before the scheduled departure.`, pt: `Fui informado(a) ${c.aviso_dias} dia(s) antes da partida programada.`, fr: `J'ai été informé(e) ${c.aviso_dias} jour(s) avant le départ prévu.` }[lang]);
  if (c.reubicacion?.ofrecida === false) out.push({ es: "No me ofrecieron un vuelo alternativo.", en: "I was not offered an alternative flight.", pt: "Não me foi oferecido voo alternativo.", fr: "Aucun vol de remplacement ne m'a été proposé." }[lang]);
  if (c.evento === "sobreventa" && c.voluntario === false) out.push({ es: "No cedí mi lugar de forma voluntaria.", en: "I did not give up my seat voluntarily.", pt: "Não cedi meu assento voluntariamente.", fr: "Je n'ai pas renoncé volontairement à ma place." }[lang]);
  if (c.motivo) out.push({ es: `Motivo que dio la aerolínea: «${limpio(c.motivo, 200)}».`, en: `Reason given by the airline: "${limpio(c.motivo, 200)}".`, pt: `Motivo informado pela companhia: "${limpio(c.motivo, 200)}".`, fr: `Motif donné par la compagnie : « ${limpio(c.motivo, 200)} ».` }[lang]);
  if (e.ruta.distancia_km) out.push({ es: `Distancia de gran círculo de la ruta: ~${e.ruta.distancia_km} km.`, en: `Great-circle distance of the route: ~${e.ruta.distancia_km} km.`, pt: `Distância ortodrômica da rota: ~${e.ruta.distancia_km} km.`, fr: `Distance orthodromique de l'itinéraire : ~${e.ruta.distancia_km} km.` }[lang]);
  return out;
}

const PIDE: Record<string, (d: Derecho, lang: Idioma) => string> = {
  default: (d, lang) => {
    const m = d.monto!;
    const cant = money(m.valor, m.moneda, lang);
    const pre = m.tipo === "minimo" ? { es: "al menos ", en: "at least ", pt: "no mínimo ", fr: "au moins " }[lang] : m.tipo === "hasta" ? { es: "hasta ", en: "up to ", pt: "até ", fr: "jusqu'à " }[lang] : "";
    const fund = FUND[d.fuente]?.[lang] ?? FUENTES[d.fuente]?.titulo ?? d.fuente;
    return { es: `El pago de ${pre}${cant} por pasajero (${fund}).`, en: `Payment of ${pre}${cant} per passenger (${fund}).`, pt: `O pagamento de ${pre}${cant} por passageiro (${fund}).`, fr: `Le paiement de ${pre}${cant} par passager (${fund}).` }[lang];
  },
};

/** Qué se pide en la carta: dinero con certeza suficiente + compensación UE/UK aunque dependa (la carga de la prueba es de la aerolínea). */
export function pedidoDe(e: Evaluacion, lang: Idioma, gastos: Gasto[] = [], eleccion?: "reembolso" | "reubicacion" | null): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const d of e.derechos) {
    if (!d.monto || d.monto.valor <= 0 || d.id === "MC_retraso") continue;
    const euComp = /^(EU261|UK261)_compensacion$/.test(d.id);
    if (d.certeza === "depende" && !euComp) continue;
    const k = `${d.regimen}:${d.id}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(PIDE.default(d, lang));
  }
  if (eleccion === "reembolso" || e.derechos.some((d) => d.id === "US_reembolso" && d.certeza === "te_corresponde" && e.caso.reubicacion?.aceptada === false)) {
    out.push({ es: "El reembolso completo del boleto (tarifa, impuestos y cargos) al medio de pago original.", en: "A full refund of the ticket (fare, taxes and fees) to the original form of payment.", pt: "O reembolso integral do bilhete (tarifa, taxas e encargos) no meio de pagamento original.", fr: "Le remboursement intégral du billet (tarif, taxes et frais) sur le moyen de paiement d'origine." }[lang]);
  }
  const g = gastos.filter((x) => x && Number.isFinite(x.monto) && x.monto > 0).slice(0, 20);
  if (g.length) {
    const lista = g.map((x) => `${limpio(x.concepto, 80)}: ${money(x.monto, x.moneda, lang)}`).join("; ");
    out.push({ es: `El reembolso de los gastos que pagué por la falta de asistencia: ${lista} (anexo los comprobantes).`, en: `Reimbursement of the expenses I paid due to the lack of care: ${lista} (receipts attached).`, pt: `O reembolso das despesas que paguei pela falta de assistência: ${lista} (comprovantes anexos).`, fr: `Le remboursement des frais engagés faute de prise en charge : ${lista} (justificatifs joints).` }[lang]);
  }
  return out;
}

const PLAZO_REGIMEN: Partial<Record<RegimenId, number>> = { MX_LAC: 10, BR_ANAC: 10, CA_APPR: 30, US_DOT: 20, EU261: 14, UK261: 14, MONTREAL: 14 };
export function plazoRespuestaDias(e: Evaluacion): number {
  const r = e.principal?.regimen ?? e.regimenes[0]?.id;
  return (r && PLAZO_REGIMEN[r]) || 14;
}

function adjuntosDe(e: Evaluacion, lang: Idioma): string[] {
  const es = e.caso.evento.startsWith("equipaje_")
    ? ["Pase de abordar y boleto", "Reporte de irregularidad de equipaje (PIR)", "Talón de equipaje", "Fotos y comprobantes"]
    : ["Pase de abordar y boleto electrónico", "Avisos de la aerolínea", "Comprobantes de gastos"];
  const tr: Record<string, T> = {
    "Pase de abordar y boleto": { es: "Pase de abordar y boleto", en: "Boarding pass and ticket", pt: "Cartão de embarque e bilhete", fr: "Carte d'embarquement et billet" },
    "Reporte de irregularidad de equipaje (PIR)": { es: "Reporte de irregularidad de equipaje (PIR)", en: "Property Irregularity Report (PIR)", pt: "Registro de irregularidade de bagagem (RIB/PIR)", fr: "Constat d'irrégularité bagage (PIR)" },
    "Talón de equipaje": { es: "Talón de equipaje", en: "Baggage tag", pt: "Etiqueta de bagagem", fr: "Étiquette bagage" },
    "Fotos y comprobantes": { es: "Fotos y comprobantes", en: "Photos and receipts", pt: "Fotos e comprovantes", fr: "Photos et justificatifs" },
    "Pase de abordar y boleto electrónico": { es: "Pase de abordar y boleto electrónico", en: "Boarding pass and e-ticket", pt: "Cartão de embarque e bilhete eletrônico", fr: "Carte d'embarquement et billet électronique" },
    "Avisos de la aerolínea": { es: "Avisos de la aerolínea", en: "Airline notifications", pt: "Avisos da companhia aérea", fr: "Notifications de la compagnie" },
    "Comprobantes de gastos": { es: "Comprobantes de gastos", en: "Expense receipts", pt: "Comprovantes de despesas", fr: "Justificatifs de frais" },
  };
  return es.map((x) => tr[x][lang]);
}

function ensamblar(lang: Idioma, partes: { titulo?: string; lineas: string[]; vineta?: boolean }[]): { texto: string; html: string } {
  const texto = partes.map((p) => [p.titulo ? `${p.titulo}` : null, ...p.lineas.map((l) => (p.vineta ? `• ${l}` : l))].filter(Boolean).join("\n")).join("\n\n");
  const html = `<div lang="${lang}" style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#111">` + partes.map((p) => {
    const h = p.titulo ? `<p style="margin:16px 0 4px"><strong>${esc(p.titulo)}</strong></p>` : "";
    const body = p.vineta ? `<ul style="margin:0;padding-left:20px">${p.lineas.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>` : p.lineas.map((l) => `<p style="margin:0 0 8px">${esc(l)}</p>`).join("");
    return h + body;
  }).join("") + "</div>";
  return { texto, html };
}

function datosPasajero(p: DatosPasajero, lang: Idioma): string[] {
  return [
    `${L.nombre[lang]}: ${limpio(p.nombre, 120)}`,
    p.reserva ? `${L.reserva[lang]}: ${limpio(p.reserva, 20)}` : null,
    p.boleto ? `${L.boleto[lang]}: ${limpio(p.boleto, 20)}` : null,
    p.correo ? `${L.correo[lang]}: ${limpio(p.correo, 120)}` : null,
    p.telefono ? `${L.telefono[lang]}: ${limpio(p.telefono, 30)}` : null,
    p.domicilio ? `${L.domicilio[lang]}: ${limpio(p.domicilio, 200)}` : null,
    p.acompanantes?.length ? `${L.acompanantes[lang]}: ${p.acompanantes.map((x) => limpio(x, 80)).join(", ")}` : null,
  ].filter((x): x is string => !!x);
}

function fundamentosDe(e: Evaluacion, lang: Idioma): string[] {
  const ids = new Set<string>();
  for (const d of e.derechos) {
    if (d.certeza === "depende" && !/^(EU261|UK261)_compensacion$/.test(d.id)) continue;
    if (d.id.endsWith("_sin_compensacion") || d.id === "US_dbc_no_aplica" || d.id === "US_sin_compensacion_retraso") continue;
    if (FUND[d.fuente]) ids.add(d.fuente);
  }
  return [...ids].map((id) => FUND[id][lang]);
}

export type CartaAerolineaInput = {
  evaluacion: Evaluacion;
  pasajero: DatosPasajero;
  ref: string;
  fecha_carta: string;
  relato?: string | null;
  gastos?: Gasto[];
  eleccion?: "reembolso" | "reubicacion" | null;
  idioma?: Idioma | null;
};

/** Carta para la aerolínea (paso 1), en su idioma. */
export function cartaAerolinea(i: CartaAerolineaInput): Carta {
  const e = i.evaluacion;
  const lang: Idioma = i.idioma ?? idiomaProveedor(e.aerolinea.pais ?? (e.aerolinea.codigo ? AIRLINE_COUNTRY[e.aerolinea.codigo] : null));
  const c = e.caso;
  const ref = limpio(i.ref, 20);
  const asunto = `${L.asunto[lang]} — ${c.vuelo ? `${L.vuelo[lang]} ${limpio(c.vuelo, 12)} ` : ""}${c.fecha ? `${c.fecha} ` : ""}${i.pasajero.reserva ? `· ${limpio(i.pasajero.reserva, 12)} ` : ""}· Ref. ${ref}`.replace(/\s+/g, " ").trim();
  const fundamentos = fundamentosDe(e, lang);
  const pedido = pedidoDe(e, lang, i.gastos ?? [], i.eleccion ?? null);
  const dias = plazoRespuestaDias(e);
  const org = e.reclamar.find((p) => p.a_quien === "organismo")?.nombre ?? { es: "la autoridad competente", en: "the competent authority", pt: "a autoridade competente", fr: "l'autorité compétente" }[lang];
  const hayEU = e.derechos.some((d) => /^(EU261|UK261)_compensacion$/.test(d.id));
  const contacto = contactoAerolinea(e.aerolinea.codigo);
  const partes = [
    { lineas: [`${fecha(i.fecha_carta, lang)}`, `${contacto?.nombre ?? e.aerolinea.nombre}`, `Ref. ${ref}`] },
    { lineas: [L.saludo[lang], L.intro[lang]] },
    { titulo: L.datos[lang], lineas: datosPasajero(i.pasajero, lang), vineta: true },
    { titulo: L.hechos[lang], lineas: hechosDe(e, lang), vineta: true },
    ...(i.relato && limpio(i.relato) ? [{ titulo: L.relato[lang], lineas: [`«${limpio(i.relato)}»`] }] : []),
    { titulo: L.fundamento[lang], lineas: fundamentos.length ? fundamentos : [{ es: "Los derechos del pasajero aplicables a este vuelo.", en: "The passenger rights applicable to this flight.", pt: "Os direitos do passageiro aplicáveis a este voo.", fr: "Les droits des passagers applicables à ce vol." }[lang]], vineta: true },
    { titulo: L.pido[lang], lineas: [...(pedido.length ? pedido : [{ es: "Que se me informe por escrito qué solución ofrecen conforme a mis derechos.", en: "A written answer setting out the remedy you offer in accordance with my rights.", pt: "Resposta por escrito com a solução oferecida conforme meus direitos.", fr: "Une réponse écrite indiquant la solution proposée conformément à mes droits." }[lang]]), ...(pedido.length > 1 ? [L.noDuplicar[lang]] : [])], vineta: true },
    { lineas: [...(pedido.length ? [L.pagoEfectivo[lang]] : []), ...(hayEU ? [L.extraordinaria[lang]] : []), t("plazo", lang, { n: dias, org })] },
    { titulo: L.adjuntos[lang], lineas: adjuntosDe(e, lang), vineta: true },
    { lineas: [L.firma[lang], limpio(i.pasajero.nombre, 120), "", L.via[lang]] },
  ];
  const { texto, html } = ensamblar(lang, partes);
  const paso1 = e.reclamar[0];
  return {
    idioma: lang, asunto, texto, html,
    destinatario: {
      nombre: paso1?.nombre ?? e.aerolinea.nombre, correo: paso1?.correo ?? null, url: paso1?.url ?? null,
      canal: paso1?.correo ? "correo" : contacto?.canal === "telefono" ? "telefono" : paso1?.url ? "formulario" : "sitio",
    },
    fundamentos, pedido, plazo_respuesta_dias: dias, adjuntos: adjuntosDe(e, lang),
  };
}

export type CartaOrganismoInput = CartaAerolineaInput & {
  organismo: Organismo;
  reclamo_previo: { fecha: string; respuesta?: string | null };
};

/** Carta de escalamiento al organismo (PROFECO, autoridad nacional UE, DOT, CTA, ANAC, CAA) en su idioma. */
export function cartaOrganismo(i: CartaOrganismoInput): Carta {
  const e = i.evaluacion;
  const o = i.organismo;
  const lang: Idioma = i.idioma ?? o.idioma;
  const ref = limpio(i.ref, 20);
  const asunto = `${L.asuntoOrg[lang]} ${e.aerolinea.nombre} — ${i.evaluacion.caso.vuelo ? `${L.vuelo[lang]} ${limpio(i.evaluacion.caso.vuelo, 12)} ` : ""}${e.caso.fecha ?? ""} · Ref. ${ref}`.replace(/\s+/g, " ").trim();
  const previo = [t("previo", lang, { f: fecha(i.reclamo_previo.fecha, lang) }), i.reclamo_previo.respuesta ? t("resp", lang, { r: limpio(i.reclamo_previo.respuesta, 600) }) : L.sinResp[lang]];
  const fundamentos = fundamentosDe(e, lang);
  const pedido = [L.pidoOrg[lang] + ":", ...pedidoDe(e, lang, i.gastos ?? [], i.eleccion ?? null)];
  const partes = [
    { lineas: [fecha(i.fecha_carta, lang), o.nombre, `Ref. ${ref}`] },
    { lineas: [L.saludo[lang], L.introOrg[lang]] },
    { titulo: L.datos[lang], lineas: datosPasajero(i.pasajero, lang), vineta: true },
    { titulo: L.hechos[lang], lineas: [...hechosDe(e, lang), ...previo], vineta: true },
    ...(i.relato && limpio(i.relato) ? [{ titulo: L.relato[lang], lineas: [`«${limpio(i.relato)}»`] }] : []),
    { titulo: L.fundamento[lang], lineas: fundamentos, vineta: true },
    { titulo: L.pido[lang], lineas: pedido, vineta: true },
    { titulo: L.adjuntos[lang], lineas: [...adjuntosDe(e, lang), { es: "Copia de la reclamación enviada a la aerolínea y de su respuesta", en: "Copy of the claim sent to the airline and of its reply", pt: "Cópia da reclamação enviada à companhia e de sua resposta", fr: "Copie de la réclamation adressée à la compagnie et de sa réponse" }[lang]], vineta: true },
    { lineas: [L.firma[lang], limpio(i.pasajero.nombre, 120)] },
  ];
  const { texto, html } = ensamblar(lang, partes);
  return {
    idioma: lang, asunto, texto, html,
    destinatario: { nombre: o.nombre, correo: o.verificacion === "pagina_leida" ? o.correo : null, url: o.formulario ?? o.url, canal: o.formulario ? "formulario" : o.correo ? "correo" : "sitio" },
    fundamentos, pedido, plazo_respuesta_dias: 30, adjuntos: [],
  };
}

/** Recordatorio único al proveedor, en el idioma de la carta, en el mismo hilo. */
export function recordatorio(lang: Idioma, ref: string, asuntoOriginal: string, enviadoIso: string, dias: number): { asunto: string; texto: string; html: string } {
  const f = fecha(enviadoIso.slice(0, 10), lang);
  const texto = {
    es: `Estimados señores:\n\nEl ${f} les envié la reclamación con referencia ${ref}. Han pasado ${dias} días sin respuesta. Les pido responder por escrito a la brevedad; de lo contrario acudiré a la autoridad competente.\n\nAtentamente.`,
    en: `Dear Sir or Madam,\n\nOn ${f} I sent you the claim with reference ${ref}. ${dias} days have passed without a reply. Please respond in writing promptly; otherwise I will refer the matter to the competent authority.\n\nSincerely.`,
    pt: `Prezados senhores,\n\nEm ${f} enviei a reclamação com referência ${ref}. Passaram-se ${dias} dias sem resposta. Peço que respondam por escrito com brevidade; caso contrário, recorrerei à autoridade competente.\n\nAtenciosamente.`,
    fr: `Madame, Monsieur,\n\nLe ${f}, je vous ai adressé la réclamation référencée ${ref}. ${dias} jours se sont écoulés sans réponse. Merci de me répondre par écrit rapidement ; à défaut, je saisirai l'autorité compétente.\n\nVeuillez agréer mes salutations distinguées.`,
  }[lang];
  const asunto = /^(re|aw|tr|rv):/i.test(asuntoOriginal) ? asuntoOriginal : `Re: ${asuntoOriginal}`;
  return { asunto, texto, html: texto.split("\n").map((l) => (l ? `<p style="margin:0 0 8px">${esc(l)}</p>` : "")).join("") };
}

/** Correo al usuario (español) cuando llega una respuesta o cambia su reclamo. */
export function correoUsuario(titulo: string, cuerpo: string[], enlace: string | null): { asunto: string; texto: string; html: string } {
  const texto = [titulo, "", ...cuerpo, ...(enlace ? ["", `Ver el caso: ${enlace}`] : []), "", "— IATOS"].join("\n");
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5"><p><strong>${esc(titulo)}</strong></p>${cuerpo.map((c) => `<p style="margin:0 0 8px">${esc(c)}</p>`).join("")}${enlace ? `<p><a href="${esc(enlace)}">Ver el caso</a></p>` : ""}<p style="color:#666">— IATOS</p></div>`;
  return { asunto: titulo.slice(0, 200), texto, html };
}
