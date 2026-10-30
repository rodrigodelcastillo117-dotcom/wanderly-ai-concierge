// Vigilancia proactiva · confirmación previa con el proveedor (mesa, traslado, tour) 24–48 h antes. Reglas puras:
//   * Solo con el consentimiento GENERAL del viajero ("IATOS puede contactar a mis proveedores en mi nombre",
//     apagado por omisión). Sin él no se contacta a nadie y queda anotado.
//   * Solo a un correo con fuente verificada (la base lo exige) y en el horario local del proveedor
//     (operador/politica.ts: ventanaProveedor).
//   * La respuesta se lee sin IA: "confirma" solo si el remitente está verificado (DMARC/DKIM) y el texto confirma
//     sin negar; un problema o una respuesta poco clara abre un incidente preventivo, y también si no responde a
//     tiempo (antes de que el viajero llegue).
// Probado en src/test/vigilanciaConfirmaciones.test.ts.
import { type TipoProveedor, ventanaProveedor } from "../operador/politica.ts";
import { normalizeText } from "../incident-detect.ts";
import type { ConfigVigilancia } from "./vuelos.ts";

const H = 3_600_000;

export type Confirmacion = {
  id: string; user_id: string; trip_id: string | null; origen: "ai_reservation" | "booking"; origen_id: string;
  tipo: "traslado" | "tour" | "restaurante" | "actividad"; proveedor: string; correo: string; fuente: Record<string, unknown>;
  zona_horaria: string | null; idioma: "es" | "en" | "fr" | "pt" | "it" | "de"; servicio_at: string; servicio_local: string | null;
  personas: number | null; referencia: string | null; titular: string | null; estado: string; enviar_desde: string | null;
  enviada_at: string | null; reply_token: string; consentimiento: boolean; viajero: string | null; incidente_id?: string | null;
};

const TIPO_PROVEEDOR: Record<Confirmacion["tipo"], TipoProveedor> = { traslado: "traslado", tour: "tour", restaurante: "restaurante", actividad: "tour" };

export type PlanEnvio =
  | { accion: "sin_consentimiento" }
  | { accion: "vencida"; motivo: string }
  | { accion: "esperar"; desde: Date; horaLocal: string | null }
  | { accion: "enviar"; horaLocal: string | null };

/** ¿Se manda ya, se programa para su horario, o ya no tiene caso? */
export function planEnvio(c: Pick<Confirmacion, "consentimiento" | "servicio_at" | "tipo" | "zona_horaria">, cfg: Pick<ConfigVigilancia, "confirmacion_limite_horas" | "confirmar_desde_horas">, ahora: Date): PlanEnvio {
  if (!c.consentimiento) return { accion: "sin_consentimiento" };
  const servicio = Date.parse(c.servicio_at);
  if (!Number.isFinite(servicio)) return { accion: "vencida", motivo: "sin hora del servicio" };
  const limite = servicio - cfg.confirmacion_limite_horas * H;
  if (ahora.getTime() >= limite) return { accion: "vencida", motivo: "ya no hay tiempo para que responda antes del servicio" };
  if (servicio - ahora.getTime() > cfg.confirmar_desde_horas * H) return { accion: "esperar", desde: new Date(servicio - cfg.confirmar_desde_horas * H), horaLocal: null };
  const v = ventanaProveedor(TIPO_PROVEEDOR[c.tipo] ?? "otro", c.zona_horaria, ahora);
  if (v.enviarYa) return { accion: "enviar", horaLocal: v.horaLocal };
  if (v.enviarDesde.getTime() >= limite) return { accion: "vencida", motivo: "el proveedor no abre antes del límite" };
  return { accion: "esperar", desde: v.enviarDesde, horaLocal: v.horaLocal };
}

// ───────────────────────────── Correo ─────────────────────────────

type Txt = { asunto: string; hola: string; cuerpo: (x: Partial<Record<string, string>>) => string; pide: string; gracias: string; firma: string };
const T: Record<"es" | "en" | "fr" | "pt" | "it", Txt> = {
  es: {
    asunto: "Reconfirmación de reserva", hola: "Hola,",
    cuerpo: (x) => `Les escribimos de parte de nuestro cliente ${x.titular} para reconfirmar su reserva${x.que}${x.cuando}${x.personas}.${x.ref}`,
    pide: "¿Nos podrían confirmar respondiendo a este correo que todo sigue en pie? Si hubiera algún cambio, por favor díganos cuál.",
    gracias: "Muchas gracias.", firma: "IATOS · concierge de viajes de nuestro cliente (traveliatos.life)",
  },
  en: {
    asunto: "Booking reconfirmation", hola: "Hello,",
    cuerpo: (x) => `We are writing on behalf of our client ${x.titular} to reconfirm their booking${x.que}${x.cuando}${x.personas}.${x.ref}`,
    pide: "Could you please reply to this email confirming everything is still on? If anything has changed, please let us know.",
    gracias: "Thank you very much.", firma: "IATOS · our client's travel concierge (traveliatos.life)",
  },
  fr: {
    asunto: "Reconfirmation de réservation", hola: "Bonjour,",
    cuerpo: (x) => `Nous vous écrivons de la part de notre client ${x.titular} pour reconfirmer sa réservation${x.que}${x.cuando}${x.personas}.${x.ref}`,
    pide: "Pourriez-vous nous confirmer en répondant à ce courriel que tout est maintenu ? En cas de changement, merci de nous l'indiquer.",
    gracias: "Merci beaucoup.", firma: "IATOS · concierge de voyage de notre client (traveliatos.life)",
  },
  pt: {
    asunto: "Reconfirmação de reserva", hola: "Olá,",
    cuerpo: (x) => `Escrevemos em nome do nosso cliente ${x.titular} para reconfirmar a reserva${x.que}${x.cuando}${x.personas}.${x.ref}`,
    pide: "Poderiam confirmar respondendo a este e-mail que está tudo mantido? Se algo mudou, por favor nos informem.",
    gracias: "Muito obrigado.", firma: "IATOS · concierge de viagens do nosso cliente (traveliatos.life)",
  },
  it: {
    asunto: "Riconferma della prenotazione", hola: "Buongiorno,",
    cuerpo: (x) => `Vi scriviamo per conto del nostro cliente ${x.titular} per riconfermare la prenotazione${x.que}${x.cuando}${x.personas}.${x.ref}`,
    pide: "Potreste confermarci rispondendo a questa email che è tutto confermato? In caso di modifiche, vi preghiamo di indicarcele.",
    gracias: "Grazie mille.", firma: "IATOS · concierge di viaggio del nostro cliente (traveliatos.life)",
  },
};

const QUE: Record<string, Record<Confirmacion["tipo"], string>> = {
  es: { traslado: " de traslado", tour: " del tour", restaurante: " de mesa", actividad: "" },
  en: { traslado: " for the transfer", tour: " for the tour", restaurante: " for a table", actividad: "" },
  fr: { traslado: " de transfert", tour: " de la visite", restaurante: " de table", actividad: "" },
  pt: { traslado: " de traslado", tour: " do passeio", restaurante: " de mesa", actividad: "" },
  it: { traslado: " del transfer", tour: " del tour", restaurante: " del tavolo", actividad: "" },
};
const PERSONAS: Record<string, (n: number) => string> = {
  es: (n) => ` para ${n} persona${n === 1 ? "" : "s"}`, en: (n) => ` for ${n} ${n === 1 ? "person" : "people"}`,
  fr: (n) => ` pour ${n} personne${n === 1 ? "" : "s"}`, pt: (n) => ` para ${n} pessoa${n === 1 ? "" : "s"}`, it: (n) => ` per ${n} person${n === 1 ? "a" : "e"}`,
};
const REF: Record<string, string> = { es: "Referencia", en: "Reference", fr: "Référence", pt: "Referência", it: "Riferimento" };
const EL: Record<string, string> = { es: " el", en: " on", fr: " le", pt: " em", it: " il" };

/** Fecha y hora del servicio en la hora local del proveedor (si no la tenemos ya escrita). */
export function cuandoLocal(c: Pick<Confirmacion, "servicio_at" | "servicio_local" | "zona_horaria">, lang: string): string {
  if (c.servicio_local) return c.servicio_local;
  const d = new Date(c.servicio_at);
  try {
    return d.toLocaleString(lang === "es" ? "es-MX" : lang, { timeZone: c.zona_horaria ?? "UTC", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      + (c.zona_horaria ? "" : " UTC");
  } catch {
    return d.toISOString().slice(0, 16).replace("T", " ") + " UTC";
  }
}

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!));

/** Correo de reconfirmación en el idioma del proveedor (alemán → inglés). Sin datos que no tengamos. */
export function correoConfirmacion(c: Confirmacion): { asunto: string; texto: string; html: string; idioma: string } {
  const lang = (c.idioma === "de" ? "en" : c.idioma) in T ? (c.idioma === "de" ? "en" : c.idioma) as keyof typeof T : "en";
  const t = T[lang];
  const titular = (c.titular || c.viajero || "").trim() || (lang === "es" ? "(titular de la reserva)" : "(booking holder)");
  const cuerpo = t.cuerpo({
    titular, que: QUE[lang][c.tipo], cuando: `${EL[lang]} ${cuandoLocal(c, lang)}`,
    personas: c.personas ? PERSONAS[lang](c.personas) : "", ref: c.referencia ? ` ${REF[lang]}: ${c.referencia}.` : "",
  });
  const asunto = `${t.asunto} · ${c.proveedor.slice(0, 60)}${c.referencia ? ` · ${REF[lang]} ${c.referencia}` : ""}`.slice(0, 190);
  const texto = [t.hola, "", cuerpo, "", t.pide, "", t.gracias, t.firma].join("\n");
  const html = `<div style="font-family:sans-serif;line-height:1.5">${texto.split("\n").map((l) => (l ? `<p style="margin:0 0 8px">${esc(l)}</p>` : "")).join("")}</div>`;
  return { asunto, texto, html, idioma: lang };
}

export const direccionConfirmacion = (token: string, dominio: string) => {
  if (!/^[0-9a-f]{24}$/.test(token)) throw new Error("token inválido");
  return `confirma+${token}@${dominio}`;
};

// ───────────────────────────── Respuesta del proveedor ─────────────────────────────

const PROBLEMA = /\b(no (tenemos|encontramos|hay|aparece|existe|podemos)|cancel\w*|sin reserva|not (found|confirmed|available|able)|no (record|booking|reservation)|unable|cannot|can't|fully booked|sold out|lleno|complet[oa]s?|annul\w*|aucune reservation|pas de reservation|introuvable|non (troviamo|abbiamo|possiamo)|nao (encontramos|temos|podemos)|esgotad\w*|overbook\w*|sobrevend\w*)\b/;
const CONFIRMA = /\b(confirm\w*|reconfirm\w*|confermat\w*|confirme\w*|all set|see you|we look forward|les esperamos|lo esperamos|la esperamos|los esperamos|te esperamos|todo (listo|en orden|bien)|esta (lista|confirmada|reservada)|nous vous attendons|vi aspettiamo|aguardamos|esta tudo certo|sim)\b/;

/** Sin IA y del lado prudente: un problema gana; "confirma" solo con remitente verificado. */
export function clasificarRespuesta(texto: string, remitenteVerificado: boolean): "confirma" | "problema" | "ambigua" {
  const t = normalizeText(texto ?? "");
  if (!t.trim()) return "ambigua";
  if (PROBLEMA.test(t)) return "problema";
  if (CONFIRMA.test(t) && remitenteVerificado) return "confirma";
  return "ambigua";
}

/** ¿Ya venció el plazo sin respuesta? (lo primero entre enviada + sin_respuesta_horas y servicio − límite). */
export function venceSinRespuesta(c: Pick<Confirmacion, "enviada_at" | "servicio_at">, cfg: Pick<ConfigVigilancia, "sin_respuesta_horas" | "confirmacion_limite_horas">, ahora: Date): boolean {
  const env = c.enviada_at ? Date.parse(c.enviada_at) : NaN;
  const serv = Date.parse(c.servicio_at);
  if (!Number.isFinite(env) || !Number.isFinite(serv)) return false;
  const plazo = Math.min(env + cfg.sin_respuesta_horas * H, serv - cfg.confirmacion_limite_horas * H);
  return ahora.getTime() >= plazo;
}

const TIPO_ES: Record<Confirmacion["tipo"], string> = { traslado: "el traslado", tour: "el tour", restaurante: "la mesa", actividad: "la actividad" };

/** Textos del incidente preventivo y del aviso al viajero. Nada de alarma: decimos qué pasa y qué hacemos. */
export function textoPreventivo(c: Pick<Confirmacion, "tipo" | "proveedor" | "servicio_at" | "servicio_local" | "zona_horaria" | "referencia">,
  motivo: "sin_respuesta" | "problema" | "ambigua", extracto?: string | null) {
  const que = TIPO_ES[c.tipo];
  const cuando = cuandoLocal(c, "es");
  const razon = motivo === "sin_respuesta" ? `${c.proveedor} no respondió a nuestra solicitud de reconfirmación`
    : motivo === "problema" ? `${c.proveedor} respondió que hay un problema con ${que}` : `${c.proveedor} respondió, pero no confirma con claridad`;
  return {
    descripcion: `Preventivo: ${razon} (${que}, ${cuando}${c.referencia ? `, ref. ${c.referencia}` : ""}).${extracto ? ` Respuesta: «${extracto.slice(0, 300)}»` : ""} Hay que asegurarlo antes de que el viajero llegue.`,
    titulo: `Estamos asegurando ${que} con ${c.proveedor}`,
    cuerpo: `${razon[0].toUpperCase()}${razon.slice(1)} (${cuando}, hora local). Ya lo está revisando el equipo IATOS para asegurarlo antes de que llegues y te escribimos con lo que confirmemos. Si tienes un comprobante o un contacto del proveedor, compártelo en tu caso.`,
  };
}
