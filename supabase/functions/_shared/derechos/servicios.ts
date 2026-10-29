// Quejas contra hotel, traslado, tour o agencia: cobro doble, servicio no prestado, sobreventa del hotel
// o servicio deficiente. Ruta: proveedor (carta) → banco (aclaración / contracargo) → PROFECO.
// Determinista, sin red. Fuentes: LFPC arts. 7, 14, 65 Ter 1, 92 Bis/Ter, 99; LTOSF art. 23 (fuentes.ts).
import { PROFECO } from "./datos.ts";
import type { Certeza, Plazo } from "./motor.ts";
import type { Carta, DatosPasajero, Idioma } from "./cartas.ts";

export type TipoServicio = "hotel" | "traslado" | "agencia" | "tour" | "otro";
export type ProblemaServicio = "cobro_doble" | "servicio_no_prestado" | "sobreventa_hotel" | "servicio_deficiente" | "reserva_no_encontrada";

export type CasoServicio = {
  problema: ProblemaServicio;
  proveedor: { nombre: string; tipo: TipoServicio; pais?: string | null; correo?: string | null; correo_fuente?: "reserva" | "correo_del_proveedor" | "usuario_confirmado" | null };
  monto_pagado?: number | null;
  monto_cobrado_de_mas?: number | null;
  moneda?: string | null;
  pagado_con?: "tarjeta_credito" | "tarjeta_debito" | "efectivo" | "transferencia" | "plataforma" | null;
  banco_mexicano?: boolean | null;
  fecha_servicio?: string | null;
  fecha_cargo?: string | null;
  reserva?: string | null;
  relato?: string | null;
  hoy?: string | null;
};

export type DerechoServicio = { id: string; titulo: string; detalle: string; certeza: Certeza; fuente: string; monto?: { valor: number; moneda: string; tipo: "minimo" | "fijo" } };
export type PasoServicio = { paso: number; a_quien: "proveedor" | "banco" | "organismo"; nombre: string; que_hacer: string; cuando: string; url: string | null; telefono: string | null };
export type EvaluacionServicio = { caso: CasoServicio; derechos: DerechoServicio[]; ruta: PasoServicio[]; plazos: Plazo[]; pruebas: string[]; ahora: string[]; avisos: string[]; resumen: string };

const dias = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

export function evaluarServicio(c: CasoServicio): EvaluacionServicio {
  const mx = (c.proveedor.pais ?? "MX").toUpperCase() === "MX";
  const cur = (c.moneda ?? "MXN").toUpperCase();
  const pagado = typeof c.monto_pagado === "number" && c.monto_pagado > 0 ? c.monto_pagado : null;
  const derechos: DerechoServicio[] = [];
  const avisos: string[] = [];
  const cert: Certeza = mx ? "te_corresponde" : "depende";
  const nombre = c.proveedor.nombre || "el proveedor";

  if (c.problema === "cobro_doble") {
    derechos.push({ id: "SV_devolucion", titulo: "Devolución del cargo de más", detalle: `${nombre} debe devolverte lo cobrado de más${typeof c.monto_cobrado_de_mas === "number" ? ` (${c.monto_cobrado_de_mas} ${cur})` : ""}: solo puede cobrar el precio y las condiciones que te ofreció.`, certeza: cert, fuente: "MX_LFPC_7" });
  }
  if (c.problema === "servicio_no_prestado" || c.problema === "sobreventa_hotel" || c.problema === "reserva_no_encontrada") {
    derechos.push({ id: "SV_respetar", titulo: "Que respeten tu reserva o te devuelvan lo pagado", detalle: `${nombre} está obligado a respetar la reservación y las condiciones que te ofreció; si no te dio el servicio, procede la devolución de lo pagado por lo no prestado.`, certeza: cert, fuente: "MX_LFPC_7" });
  }
  if (c.problema !== "cobro_doble") {
    derechos.push({
      id: "SV_bonificacion", titulo: "Bonificación de al menos 20 %", detalle: "Si el servicio fue deficiente o no se prestó por causas del proveedor, te corresponde una bonificación o compensación de al menos el 20 % del precio pagado, además de los daños que se prueben.",
      certeza: cert, fuente: "MX_LFPC_92BIS", ...(pagado ? { monto: { valor: Math.round(pagado * 20) / 100, moneda: cur, tipo: "minimo" as const } } : {}),
    });
  }
  if (c.proveedor.tipo === "agencia") {
    derechos.push({ id: "SV_agencia_lac", titulo: "La agencia también responde por tus derechos de pasajero", detalle: "Las agencias que venden boletos, reservas o hacen el check-in también deben cumplir los derechos de los pasajeros de la Ley de Aviación Civil.", certeza: mx ? "te_corresponde" : "depende", fuente: "MX_LFPC_65TER1" });
  }
  if (!mx) avisos.push("El proveedor no es mexicano: la Ley Federal de Protección al Consumidor y PROFECO pueden no alcanzarlo. El banco (contracargo) suele ser la vía más efectiva.");

  const ruta: PasoServicio[] = [{
    paso: 1, a_quien: "proveedor", nombre, que_hacer: "Reclamación formal por escrito (te la preparo) pidiendo la devolución y la bonificación, con plazo de respuesta.",
    cuando: "Ya: es el primer paso y sirve de prueba ante el banco y PROFECO.", url: null, telefono: null,
  }];
  const tarjeta = c.pagado_con === "tarjeta_credito" || c.pagado_con === "tarjeta_debito";
  const plazos: Plazo[] = [];
  if (tarjeta) {
    const bancoMx = c.banco_mexicano !== false;
    let cuando = "Si el proveedor no lo resuelve en su plazo (o de inmediato en un cobro doble).";
    if (bancoMx && c.fecha_cargo && c.hoy) {
      const restan = 90 - dias(c.fecha_cargo, c.hoy);
      cuando += restan > 0 ? ` Te quedan como máximo ${restan} días (si cuentas desde el cargo; la ley cuenta desde la fecha de corte, que puede darte más).` : " Ojo: ya pasaron 90 días desde el cargo; revisa la fecha de corte de tu estado de cuenta, que es desde donde cuenta la ley.";
    }
    ruta.push({ paso: 2, a_quien: "banco", nombre: "Tu banco (aclaración / contracargo)", que_hacer: bancoMx ? "Presenta una solicitud de aclaración por escrito o por la app; el banco debe acusar recibo y darte un dictamen en máximo 45 días. En cargos a tu cargo (como tarjeta de crédito, según las reglas de la CONDUSEF) puedes no pagar lo que está en aclaración mientras se resuelve." : "Pide un contracargo (chargeback) a tu banco con la carta enviada y la falta de respuesta.", cuando, url: null, telefono: null });
    if (bancoMx) plazos.push({ que: "Aclaración ante tu banco (México)", plazo: "90 días naturales desde la fecha de corte o de la operación; el banco responde en máximo 45 días", fuente: "MX_LTOSF_23", certeza: "te_corresponde" });
  }
  ruta.push({ paso: ruta.length + 1, a_quien: "organismo", nombre: PROFECO.nombre, que_hacer: "Queja en Concilianet (si el proveedor está registrado) o por el Teléfono del Consumidor; lleva identificación, comprobante de pago, datos del proveedor y la relación de hechos.", cuando: "Si el proveedor no responde o se niega.", url: PROFECO.formulario, telefono: PROFECO.telefono });
  plazos.push({ que: "Prescripción ante PROFECO", plazo: "1 año", fuente: "MX_LFPC_14", certeza: mx ? "te_corresponde" : "depende" });

  const pruebas = [
    "Confirmación de la reserva (correo o PDF) con precio y condiciones.",
    "Estado de cuenta o comprobante de cada cargo (con fecha y monto).",
    ...(c.problema === "sobreventa_hotel" || c.problema === "reserva_no_encontrada" ? ["Foto o nombre de quien te dijo en recepción que no había habitación o reserva, con hora.", "Comprobante del hotel alternativo que tuviste que pagar."] : []),
    ...(c.problema === "servicio_no_prestado" ? ["Capturas de mensajes con el chofer/proveedor y hora en que esperaste."] : []),
    "Toda conversación por escrito con el proveedor.",
  ];
  const ahora = c.problema === "sobreventa_hotel" || c.problema === "reserva_no_encontrada"
    ? ["Pide en recepción, por escrito, que te reubiquen en un hotel de igual o mejor categoría sin costo y el traslado.", "Si pagas otro hotel, guarda el comprobante: se reclama.", "Te preparo la reclamación para el hotel o la agencia."]
    : c.problema === "cobro_doble"
      ? ["Toma captura de los dos cargos en tu app del banco.", "Escribe al proveedor hoy (te preparo el texto) y, si no responde rápido, inicia la aclaración en tu banco."]
      : ["Guarda la evidencia (mensajes, hora, fotos).", "Te preparo la reclamación formal para el proveedor."];
  const resumen = `${derechos[0]?.certeza === "te_corresponde" ? "Te corresponde" : "Depende"}: ${derechos[0]?.titulo.toLowerCase() ?? "revisar el caso"}. Ruta: ${ruta.map((r) => r.nombre).join(" → ")}.`;
  return { caso: c, derechos, ruta, plazos, pruebas, ahora, avisos, resumen };
}

const PROB: Record<ProblemaServicio, Record<Idioma, string>> = {
  cobro_doble: { es: "cobro duplicado", en: "duplicate charge", pt: "cobrança em duplicidade", fr: "double facturation" },
  servicio_no_prestado: { es: "servicio contratado no prestado", en: "booked service not provided", pt: "serviço contratado não prestado", fr: "prestation réservée non fournie" },
  sobreventa_hotel: { es: "no me dieron la habitación reservada (sobreventa)", en: "my reserved room was not provided (overbooking)", pt: "o quarto reservado não foi fornecido (overbooking)", fr: "la chambre réservée n'a pas été fournie (surréservation)" },
  servicio_deficiente: { es: "servicio deficiente", en: "deficient service", pt: "serviço deficiente", fr: "prestation défaillante" },
  reserva_no_encontrada: { es: "no encontraron mi reserva confirmada", en: "my confirmed booking could not be found", pt: "minha reserva confirmada não foi localizada", fr: "ma réservation confirmée est introuvable" },
};

/** Carta al hotel / traslado / agencia. Si el proveedor no es mexicano no se cita la LFPC (puede no aplicarle). */
export function cartaServicio(c: CasoServicio, ev: EvaluacionServicio, pasajero: DatosPasajero, ref: string, fechaCarta: string, idioma: Idioma = "es"): Carta {
  const mx = (c.proveedor.pais ?? "MX").toUpperCase() === "MX";
  const lang = idioma;
  const cur = (c.moneda ?? "MXN").toUpperCase();
  const T = (es: string, en: string, pt: string, fr: string) => ({ es, en, pt, fr }[lang]);
  const asunto = `${T("Reclamación formal", "Formal complaint", "Reclamação formal", "Réclamation formelle")} — ${PROB[c.problema][lang]}${c.reserva ? ` · ${c.reserva}` : ""} · Ref. ${ref}`;
  const pedido: string[] = [];
  if (c.problema === "cobro_doble" && typeof c.monto_cobrado_de_mas === "number") pedido.push(T(`La devolución inmediata de ${c.monto_cobrado_de_mas} ${cur} cobrados de más, al mismo medio de pago.`, `Immediate refund of the ${c.monto_cobrado_de_mas} ${cur} overcharged, to the original payment method.`, `A devolução imediata de ${c.monto_cobrado_de_mas} ${cur} cobrados a mais, no mesmo meio de pagamento.`, `Le remboursement immédiat des ${c.monto_cobrado_de_mas} ${cur} facturés en trop, sur le moyen de paiement d'origine.`));
  if (c.problema !== "cobro_doble") pedido.push(T("La devolución de lo pagado por el servicio no prestado y el reembolso de los gastos que tuve que cubrir.", "A refund of the amount paid for the service not provided and reimbursement of the costs I had to cover.", "A devolução do valor pago pelo serviço não prestado e o reembolso das despesas que tive de cobrir.", "Le remboursement de la prestation non fournie et des frais que j'ai dû engager."));
  const bon = ev.derechos.find((d) => d.id === "SV_bonificacion");
  if (bon && mx) pedido.push(T(`Una bonificación de al menos el 20 % del precio pagado${bon.monto ? ` (${bon.monto.valor} ${bon.monto.moneda})` : ""}, conforme a los artículos 92 Bis y 92 Ter de la Ley Federal de Protección al Consumidor.`, `Compensation of at least 20% of the price paid, under Articles 92 Bis and 92 Ter of Mexico's Federal Consumer Protection Law.`, `Uma bonificação de pelo menos 20% do preço pago, nos termos dos arts. 92 Bis e 92 Ter da Lei Federal de Proteção ao Consumidor do México.`, `Une compensation d'au moins 20 % du prix payé, en vertu des articles 92 Bis et 92 Ter de la loi fédérale mexicaine de protection du consommateur.`));
  const fundamentos = mx ? [
    "Ley Federal de Protección al Consumidor, art. 7 (respetar precios, reservaciones y condiciones ofrecidas).",
    ...(c.problema !== "cobro_doble" ? ["Ley Federal de Protección al Consumidor, arts. 92 Bis y 92 Ter (bonificación no menor al 20 %)."] : []),
    ...(c.proveedor.tipo === "agencia" ? ["Ley Federal de Protección al Consumidor, art. 65 Ter 1 (agencias de viaje)."] : []),
  ] : [T("Las condiciones de la reserva confirmada y la ley de protección al consumidor aplicable.", "The terms of the confirmed booking and the applicable consumer protection law.", "As condições da reserva confirmada e a legislação de defesa do consumidor aplicável.", "Les conditions de la réservation confirmée et le droit de la consommation applicable.")];
  const lineas = [
    fechaCarta, c.proveedor.nombre, `Ref. ${ref}`, "",
    T("Estimados señores:", "Dear Sir or Madam,", "Prezados senhores,", "Madame, Monsieur,"),
    T(`Presento una reclamación formal por ${PROB[c.problema].es}.`, `I am submitting a formal complaint regarding a ${PROB[c.problema].en}.`, `Apresento reclamação formal por ${PROB[c.problema].pt}.`, `Je vous adresse une réclamation formelle pour ${PROB[c.problema].fr}.`),
    "",
    `${T("Nombre", "Name", "Nome", "Nom")}: ${pasajero.nombre}`,
    ...(c.reserva ? [`${T("Reserva", "Booking", "Reserva", "Réservation")}: ${c.reserva}`] : []),
    ...(c.fecha_servicio ? [`${T("Fecha del servicio", "Service date", "Data do serviço", "Date de la prestation")}: ${c.fecha_servicio}`] : []),
    ...(typeof c.monto_pagado === "number" ? [`${T("Monto pagado", "Amount paid", "Valor pago", "Montant payé")}: ${c.monto_pagado} ${cur}`] : []),
    ...(c.relato ? ["", `${T("Hechos", "Facts", "Fatos", "Faits")}: «${String(c.relato).slice(0, 1500)}»`] : []),
    "", `${T("Fundamento", "Basis", "Fundamento", "Fondement")}:`, ...fundamentos.map((f) => `• ${f}`),
    "", `${T("Solicito", "I request", "Solicito", "Je demande")}:`, ...pedido.map((p) => `• ${p}`),
    "", T("Pido respuesta por escrito en un máximo de 10 días naturales. De lo contrario, iniciaré la aclaración con mi banco y la queja ante PROFECO.", "Please reply in writing within 10 calendar days; otherwise I will dispute the charge with my bank and file a complaint with the competent consumer authority.", "Peço resposta por escrito em até 10 dias corridos; caso contrário, contestarei a cobrança junto ao meu banco e recorrerei ao órgão de defesa do consumidor.", "Merci de me répondre par écrit sous 10 jours calendaires ; à défaut, je contesterai le paiement auprès de ma banque et saisirai l'autorité de protection des consommateurs."),
    "", T("Atentamente,", "Sincerely,", "Atenciosamente,", "Veuillez agréer mes salutations distinguées,"), pasajero.nombre,
  ];
  const texto = lineas.join("\n");
  const html = `<div lang="${lang}" style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5">${lineas.map((l) => (l ? `<p style="margin:0 0 6px">${l.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>` : "<br>")).join("")}</div>`;
  const correoOk = !!(c.proveedor.correo && c.proveedor.correo_fuente);
  return {
    idioma: lang, asunto, texto, html,
    destinatario: { nombre: c.proveedor.nombre, correo: correoOk ? c.proveedor.correo! : null, url: null, canal: correoOk ? "correo" : "sitio" },
    fundamentos, pedido, plazo_respuesta_dias: 10, adjuntos: [],
  };
}
