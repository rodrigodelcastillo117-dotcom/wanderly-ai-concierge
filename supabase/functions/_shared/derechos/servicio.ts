// Orquestación de Reclamos (sin Deno): la usan las funciones reclamos, reclamos-inbound y reclamos-cron
// y las herramientas de Iato/operador. Todas las dependencias (base, correo, IA, núcleo de incidentes)
// se inyectan: cada flujo se prueba de punta a punta con dobles en src/test/derechosServicio.test.ts.
//
// Reglas:
//   * Nada sale sin consentimiento explícito (confirm === true) y con la bandera reclamos_enabled.
//   * Un correo de destinatario siempre tiene fuente; si no hay correo verificado, la carta se prepara
//     para pegarla en el formulario oficial y el usuario marca "lo envié".
//   * La respuesta del proveedor: el modelo extrae, las reglas deciden (respuesta.ts); nada se da por
//     aceptado sin cita textual comprobable y remitente verificado.
import { senderAuthentication } from "../ai-reservations/core.ts";
import type { ModelCall } from "../ai-reservations/classifier.ts";
import { verifySvixSignature } from "../ai-reservations/signature.ts";
import { htmlToText, stripQuotedReply } from "../ai-reservations/core.ts";
import { cartaAerolinea, cartaOrganismo, correoUsuario, type DatosPasajero, type Gasto, type Idioma, recordatorio } from "./cartas.ts";
import { ANAC_BR, CAA_UK, contactoAerolinea, correoUtilizable, CTA, DOT, EU_NEB, type Organismo, PROFECO } from "./datos.ts";
import { type CasoVuelo, type Evaluacion, evaluarVuelo, type RegimenId } from "./motor.ts";
import { estadoIncidenteDe, type NucleoIncidentes, nucleoNulo } from "./nucleo.ts";
import { categoriaDeReclamo } from "./nucleoIncidentes.ts";
import { clasificarQueja, respuestaQueja } from "./quejas.ts";
import { clasificarRespuesta, decidirRespuesta, ModeloNoDisponible, siguientePaso } from "./respuesta.ts";
import { direccionCasos, direccionReclamo, DOMINIO_RESPUESTA, REMITENTE_RECLAMOS, rutaEntrante } from "./rutas.ts";
import { type CasoServicio, cartaServicio, evaluarServicio } from "./servicios.ts";

type RpcResult<T> = { data: T | null; error: { message: string } | null };
export type Db = { rpc<T = unknown>(fn: string, args?: Record<string, unknown>): Promise<RpcResult<T>> };
export type Correo = { to: string | string[]; subject: string; html: string; text: string; from?: string; replyTo?: string };
export type CorreoRecibido = {
  id?: string; from?: string; to?: unknown[]; subject?: string; text?: string | null; html?: string | null; created_at?: string;
  authentication?: { spf?: string; dkim?: string; dmarc?: string } | null; message_id?: string | null;
};

export type ReclamosDeps = {
  db: Db;
  sendEmail(m: Correo): Promise<{ ok: boolean; id?: string; error?: string }>;
  callModel: ModelCall | null;
  receivedEmail(id: string): Promise<CorreoRecibido | null>;
  profile(userId: string): Promise<{ name: string | null; email: string | null }>;
  nucleo?: NucleoIncidentes;
  /** Respuesta de un proveedor al Operador IATOS (operador+<token>@): la atiende _shared/operador/entrante.ts. */
  operadorEntrante?: (x: { token: string; emailId: string; eventId: string }) => Promise<Resultado>;
  /** Respuesta de un proveedor a la reconfirmación previa (confirma+<token>@): _shared/vigilancia/entrante.ts. */
  confirmacionEntrante?: (x: { token: string; emailId: string; eventId: string }) => Promise<Resultado>;
  config: { replyDomain?: string; fromAddress?: string; inboundSecret?: string; appUrl: string };
  now?: () => Date;
  warn?: (...a: unknown[]) => void;
};

export type Resultado = { status: number; body: Record<string, unknown> };
const ok = (body: Record<string, unknown>): Resultado => ({ status: 200, body: { ok: true, ...body } });
export const MENSAJES: Record<string, string> = {
  FEATURE_DISABLED: "El envío de reclamaciones por correo todavía no está activo. Te dejo la carta lista para que la envíes tú.",
  CONSENT_REQUIRED: "Necesito tu confirmación explícita para enviar la reclamación en tu nombre.",
  NOT_FOUND: "No encontramos ese reclamo.",
  NO_EMAIL: "No tenemos un correo verificado de este destinatario: la carta está lista para pegarla en su formulario oficial.",
  IN_PROGRESS: "Ya estamos enviando este reclamo.",
  ALREADY_SENT: "Este reclamo ya se envió.",
  USER_DAILY_LIMIT: "Llegaste al límite de reclamos por hoy.",
  TOO_MANY_ACTIVE: "Tienes varios reclamos abiertos; cierra o espera alguno.",
  TRIP_NOT_FOUND: "No encontramos ese viaje.",
  ILLEGAL_TRANSITION: "Esa acción no aplica en el estado actual del reclamo.",
  SEND_FAILED: "No pudimos enviar el correo. No se envió nada; inténtalo de nuevo.",
  BAD_REQUEST: "Faltan datos del caso.",
  INVALID: "Los datos del reclamo no son válidos.",
  NO_ESCALATION: "No hay un organismo al que escalar con los datos de este caso.",
};
const fail = (status: number, code: string, extra: Record<string, unknown> = {}): Resultado =>
  ({ status, body: { ok: false, code, message: MENSAJES[code] ?? "No se pudo completar.", ...extra } });
const statusFor = (code: string) => code === "FEATURE_DISABLED" ? 403 : code === "NOT_FOUND" || code === "TRIP_NOT_FOUND" ? 404
  : /LIMIT|TOO_MANY/.test(code) ? 429 : code === "IN_PROGRESS" || code === "ALREADY_SENT" ? 409 : 400;

const nucleo = (d: ReclamosDeps) => d.nucleo ?? nucleoNulo;
const hoyIso = (d: ReclamosDeps) => (d.now?.() ?? new Date()).toISOString().slice(0, 10);
const fromHeader = (d: ReclamosDeps, nombre: string) =>
  `${nombre.replace(/["<>\r\n]/g, "").slice(0, 60)} vía IATOS <${d.config.fromAddress ?? REMITENTE_RECLAMOS}>`;

const ESCALAR_DIAS: Partial<Record<RegimenId, number>> = { EU261: 60, CA_APPR: 30, MX_LAC: 12, BR_ANAC: 12, US_DOT: 30, UK261: 30 };

function organismoPara(e: Evaluacion): Organismo | null {
  const paso = e.reclamar.find((p) => p.a_quien === "organismo");
  if (!paso?.organismo_id) return null;
  const id = paso.organismo_id;
  if (id === "PROFECO") return PROFECO;
  if (id === "DOT") return DOT;
  if (id === "CTA") return CTA;
  if (id === "ANAC_BR") return ANAC_BR;
  if (id === "CAA") return CAA_UK;
  if (id.startsWith("NEB_")) return EU_NEB[id.slice(4)] ?? null;
  return null;
}

/** Lo que se guarda de la evaluación (la carta de escalamiento se rehace con esto). */
const snapshot = (e: Evaluacion) => JSON.parse(JSON.stringify(e)) as Record<string, unknown>;

// ───────────────────────────── Preparar (no envía nada) ─────────────────────────────
export type PrepararVueloInput = {
  caso: CasoVuelo;
  pasajero?: Partial<DatosPasajero>;
  relato?: string | null;
  gastos?: Gasto[];
  eleccion?: "reembolso" | "reubicacion" | null;
  trip_id?: string | null;
  /** Correo del proveedor que NO sale del directorio: solo con su fuente (el usuario lo confirmó o venía en su reserva). */
  correo_proveedor?: { email: string; fuente: "correo_del_proveedor" | "reserva" | "usuario_confirmado"; detalle?: string | null } | null;
  idioma?: Idioma | null;
  actor?: "usuario" | "iato" | "equipo";
};

const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

export async function prepararReclamoVuelo(d: ReclamosDeps, userId: string, i: PrepararVueloInput): Promise<Resultado> {
  if (!i?.caso?.evento || !i.caso.origen || !i.caso.destino || !i.caso.aerolinea) return fail(400, "BAD_REQUEST");
  const e = evaluarVuelo({ ...i.caso, hoy: i.caso.hoy ?? hoyIso(d) });
  const perfil = await d.profile(userId).catch(() => ({ name: null, email: null }));
  const pasajero: DatosPasajero = { ...i.pasajero, nombre: (i.pasajero?.nombre ?? perfil.name ?? "").trim() || "Pasajero", correo: i.pasajero?.correo ?? perfil.email };
  const carta = cartaAerolinea({ evaluacion: e, pasajero, ref: "C-PENDIENTE", fecha_carta: hoyIso(d), relato: i.relato, gastos: i.gastos, eleccion: i.eleccion, idioma: i.idioma });
  const contacto = contactoAerolinea(e.aerolinea.codigo);
  let channel: "correo" | "formulario" | "telefono" | "sitio" = carta.destinatario.canal;
  let recipient: string | null = null;
  let source: Record<string, unknown> | null = null;
  if (correoUtilizable(contacto)) {
    channel = "correo"; recipient = contacto!.correo;
    source = { kind: "directorio_oficial", url: contacto!.fuente_url, verificado: contacto!.consultado };
  } else if (i.correo_proveedor && EMAIL_RE.test(i.correo_proveedor.email.trim())) {
    channel = "correo"; recipient = i.correo_proveedor.email.trim().toLowerCase();
    source = { kind: i.correo_proveedor.fuente, detalle: i.correo_proveedor.detalle ?? null, at: (d.now?.() ?? new Date()).toISOString() };
  }
  const regimen = e.principal?.regimen ?? e.regimenes[0]?.id ?? null;
  return crearYPresentar(d, userId, {
    kind: "vuelo", target: "proveedor", provider_name: carta.destinatario.nombre, provider_code: e.aerolinea.codigo,
    channel, recipient_email: recipient, recipient_source: source, form_url: carta.destinatario.url, language: carta.idioma,
    subject: carta.asunto, body_text: carta.texto, body_html: carta.html, evaluation: snapshot(e), request: carta.pedido,
    response_days: carta.plazo_respuesta_dias, escalate_days: (regimen && ESCALAR_DIAS[regimen]) || 30, trip_id: i.trip_id ?? null,
    actor: i.actor ?? "usuario",
  }, {
    evaluacion: { resumen: e.resumen, derechos: e.derechos, pruebas: e.pruebas, ahora: e.ahora, reclamar: e.reclamar, plazos: e.plazos, avisos: e.avisos },
    incidente: { tipo: "reclamo_vuelo", titulo: `Reclamo a ${carta.destinatario.nombre}: ${e.caso.evento.replace("_", " ")} ${e.ruta.origen}-${e.ruta.destino}`, gravedad: "media" as const,
      categoria: categoriaDeReclamo({ tipo: "reclamo_vuelo", datos: { evento: e.caso.evento } }) },
    telefono: contacto?.telefono ?? null, notas_contacto: contacto?.notas ?? null,
  });
}

export type PrepararServicioInput = { caso: CasoServicio; pasajero?: Partial<DatosPasajero>; trip_id?: string | null; idioma?: Idioma | null; actor?: "usuario" | "iato" | "equipo" };

export async function prepararReclamoServicio(d: ReclamosDeps, userId: string, i: PrepararServicioInput): Promise<Resultado> {
  if (!i?.caso?.problema || !i.caso.proveedor?.nombre) return fail(400, "BAD_REQUEST");
  const ev = evaluarServicio({ ...i.caso, hoy: i.caso.hoy ?? hoyIso(d) });
  const perfil = await d.profile(userId).catch(() => ({ name: null, email: null }));
  const pasajero: DatosPasajero = { ...i.pasajero, nombre: (i.pasajero?.nombre ?? perfil.name ?? "").trim() || "Cliente" };
  const carta = cartaServicio(i.caso, ev, pasajero, "C-PENDIENTE", hoyIso(d), i.idioma ?? "es");
  const email = i.caso.proveedor.correo && EMAIL_RE.test(i.caso.proveedor.correo.trim()) && i.caso.proveedor.correo_fuente ? i.caso.proveedor.correo.trim().toLowerCase() : null;
  const kind = i.caso.proveedor.tipo === "otro" ? "otro" : i.caso.proveedor.tipo;
  return crearYPresentar(d, userId, {
    kind, target: "proveedor", provider_name: i.caso.proveedor.nombre.slice(0, 200), provider_code: null,
    channel: email ? "correo" : "sitio", recipient_email: email, recipient_source: email ? { kind: i.caso.proveedor.correo_fuente } : null, form_url: null,
    language: carta.idioma, subject: carta.asunto, body_text: carta.texto, body_html: carta.html, evaluation: snapshot(ev as unknown as Evaluacion),
    request: carta.pedido, response_days: 10, escalate_days: 12, trip_id: i.trip_id ?? null, actor: i.actor ?? "usuario",
  }, {
    evaluacion: { resumen: ev.resumen, derechos: ev.derechos, pruebas: ev.pruebas, ahora: ev.ahora, ruta: ev.ruta, plazos: ev.plazos, avisos: ev.avisos },
    incidente: { tipo: "reclamo_servicio", titulo: `Reclamo a ${i.caso.proveedor.nombre}: ${i.caso.problema.replace(/_/g, " ")}`, gravedad: i.caso.problema === "sobreventa_hotel" ? "alta" as const : "media" as const,
      categoria: categoriaDeReclamo({ tipo: "reclamo_servicio", datos: { problema: i.caso.problema, tipo_proveedor: i.caso.proveedor.tipo } }) },
    telefono: null, notas_contacto: null,
  });
}

type FilaNueva = {
  kind: string; target: "proveedor" | "organismo"; provider_name: string; provider_code: string | null; channel: string; recipient_email: string | null;
  recipient_source: Record<string, unknown> | null; form_url: string | null; language: string; subject: string; body_text: string; body_html: string;
  evaluation: Record<string, unknown>; request: string[]; response_days: number; escalate_days: number; trip_id: string | null; actor: string; parent_id?: string | null;
};

async function crearYPresentar(d: ReclamosDeps, userId: string, f: FilaNueva, extra: {
  evaluacion: Record<string, unknown>; incidente: { tipo: string; titulo: string; gravedad: "baja" | "media" | "alta" | "critica"; categoria?: string | null } | null;
  telefono: string | null; notas_contacto: string | null;
}): Promise<Resultado> {
  const r = await d.db.rpc<Record<string, unknown>>("claim_create", { _user_id: userId, _p: f });
  if (r.error || !r.data) return fail(500, "CREATE_FAILED");
  if (r.data.ok !== true) return fail(statusFor(String(r.data.code)), String(r.data.code));
  let claim = r.data.claim as Record<string, unknown>;
  // El folio real reemplaza al provisional en el texto (la carta todavía no se ha enviado).
  const ref = String(claim.ref_code);
  const asunto = f.subject.split("C-PENDIENTE").join(ref);
  const texto = f.body_text.split("C-PENDIENTE").join(ref);
  const html = f.body_html.split("C-PENDIENTE").join(ref);
  const upd = await d.db.rpc<Record<string, unknown>>("claim_set_text", { _id: claim.id, _user_id: userId, _subject: asunto, _body_text: texto, _body_html: html });
  if (upd.data && upd.data.ok === true) claim = upd.data.claim as Record<string, unknown>;
  // Caso abierto en el núcleo de incidentes (si está conectado). Si falla, el reclamo sigue igual.
  if (extra.incidente) {
    const inc = await nucleo(d).crear({ user_id: userId, trip_id: f.trip_id, ...extra.incidente, datos: { claim_id: claim.id, ref } }).catch(() => null);
    if (inc?.id) {
      await d.db.rpc("claim_set_incident", { _id: claim.id, _incident_id: inc.id });
      claim.incident_id = inc.id;
    }
  }
  const puedeEnviar = f.channel === "correo" && !!f.recipient_email;
  return ok({
    claim,
    ...extra.evaluacion,
    carta: { para: f.recipient_email, canal: f.channel, url: f.form_url, telefono: extra.telefono, notas: extra.notas_contacto, asunto, texto, idioma: f.language },
    siguiente: puedeEnviar ? "confirmar_envio" : "enviar_tu_mismo",
    confirmacion: puedeEnviar
      ? `¿Envío esta reclamación a ${f.provider_name} (${f.recipient_email}) en tu nombre? Las respuestas te llegarán por IATOS.`
      : `${f.provider_name} no tiene un correo verificado para reclamos: copia el texto y pégalo en su ${f.form_url ? "formulario oficial" : "canal oficial"}. Luego dime "ya lo envié" para darle seguimiento.`,
  });
}

// ───────────────────────────── Enviar (con consentimiento) ─────────────────────────────
export async function confirmarEnvio(d: ReclamosDeps, userId: string, i: { id?: string; confirm?: boolean; confirm_text?: string; cc_me?: boolean }): Promise<Resultado> {
  if (!i?.id || i.confirm !== true) return fail(400, "CONSENT_REQUIRED");
  const claim = await d.db.rpc<Record<string, unknown>>("claim_claim_send", {
    _id: i.id, _user_id: userId, _consent: { confirmed: true, text: String(i.confirm_text ?? "Autorizo a IATOS a enviar esta reclamación en mi nombre").slice(0, 300), cc_user: i.cc_me === true },
  });
  if (claim.error || !claim.data) return fail(500, "SEND_FAILED");
  if (claim.data.ok !== true) return fail(statusFor(String(claim.data.code)), String(claim.data.code));
  const c = claim.data.claim as Record<string, unknown>;
  const token = String(claim.data.reply_token);
  const perfil = await d.profile(userId).catch(() => ({ name: null, email: null }));
  const sent = await d.sendEmail({
    to: String(c.recipient_email), subject: String(c.subject), html: String(c.body_html), text: String(c.body_text),
    from: fromHeader(d, perfil.name ?? "Pasajero"), replyTo: direccionReclamo(token, d.config.replyDomain ?? DOMINIO_RESPUESTA),
  }).catch((e): { ok: boolean; id?: string; error?: string } => ({ ok: false, error: String((e as Error)?.message ?? e) }));
  const mark = await d.db.rpc<Record<string, unknown>>("claim_mark_sent", { _id: c.id, _kind: "envio", _ok: sent.ok, _provider_id: sent.id ?? null, _error: sent.ok ? null : sent.error ?? "send_failed" });
  if (!sent.ok) return fail(502, "SEND_FAILED");
  if (i.cc_me && perfil.email) {
    await d.sendEmail({ to: perfil.email, subject: `Copia: ${c.subject}`, html: String(c.body_html), text: String(c.body_text), from: `IATOS Reclamos <${d.config.fromAddress ?? REMITENTE_RECLAMOS}>` }).catch(() => null);
  }
  if (c.incident_id) await nucleo(d).evento(String(c.incident_id), { tipo: "reclamo_enviado", nota: `Enviado a ${c.provider_name} (${c.ref_code})` }).catch(() => null);
  if (c.incident_id) await nucleo(d).estado(String(c.incident_id), estadoIncidenteDe("enviado")).catch(() => null);
  return ok({ claim: mark.data?.claim ?? c });
}

export async function marcarEnviadoPorUsuario(d: ReclamosDeps, userId: string, i: { id?: string; numero_caso?: string | null }): Promise<Resultado> {
  if (!i?.id) return fail(400, "BAD_REQUEST");
  const r = await d.db.rpc<Record<string, unknown>>("claim_mark_user_sent", { _id: i.id, _user_id: userId, _case_number: i.numero_caso ? String(i.numero_caso).slice(0, 60) : null });
  if (r.error || !r.data) return fail(500, "UPDATE_FAILED");
  if (r.data.ok !== true) return fail(statusFor(String(r.data.code)), String(r.data.code));
  return ok({ claim: r.data.claim, mensaje: "Listo: le doy seguimiento. Si la aerolínea te responde a tu correo, reenvíamelo a tu dirección personal de casos para leerlo." });
}

export async function estadoReclamos(d: ReclamosDeps, userId: string, i: { id?: string | null } = {}): Promise<Resultado> {
  const r = await d.db.rpc<Record<string, unknown>[]>("claim_list_for_user", { _user_id: userId, _id: i?.id ?? null });
  if (r.error) return fail(500, "STATUS_FAILED");
  const list = (r.data ?? []).map((c) => {
    const { body_html: _h, ...rest } = c as Record<string, unknown>;
    return rest;
  });
  if (i?.id && !list.length) return fail(404, "NOT_FOUND");
  const tok = await d.db.rpc<string>("claim_forward_token", { _user_id: userId });
  return ok({ reclamos: list, direccion_casos: tok.data ? direccionCasos(tok.data, d.config.replyDomain ?? DOMINIO_RESPUESTA) : null });
}

export async function cancelarReclamo(d: ReclamosDeps, userId: string, i: { id?: string }): Promise<Resultado> {
  if (!i?.id) return fail(400, "BAD_REQUEST");
  const r = await d.db.rpc<Record<string, unknown>>("claim_transition", { _id: i.id, _to: "cancelado", _actor: "usuario", _user_id: userId, _note: "Cancelado por el usuario", _data: null });
  if (r.error || !r.data) return fail(500, "UPDATE_FAILED");
  if (r.data.ok !== true) return fail(statusFor(String(r.data.code)), String(r.data.code));
  return ok({ claim: r.data.claim });
}

/** Marca resuelto (el usuario confirma que le pagaron / se resolvió). */
export async function resolverReclamo(d: ReclamosDeps, userId: string, i: { id?: string; nota?: string }): Promise<Resultado> {
  if (!i?.id) return fail(400, "BAD_REQUEST");
  const r = await d.db.rpc<Record<string, unknown>>("claim_transition", { _id: i.id, _to: "resuelto", _actor: "usuario", _user_id: userId, _note: String(i.nota ?? "Resuelto según el usuario").slice(0, 300), _data: null });
  if (r.error || !r.data) return fail(500, "UPDATE_FAILED");
  if (r.data.ok !== true) return fail(statusFor(String(r.data.code)), String(r.data.code));
  const c = r.data.claim as Record<string, unknown>;
  if (c.incident_id) await nucleo(d).estado(String(c.incident_id), "resuelto", "El usuario confirmó la solución").catch(() => null);
  return ok({ claim: c });
}

// ───────────────────────────── Escalar al organismo ─────────────────────────────
export async function escalarReclamo(d: ReclamosDeps, userId: string, i: { id?: string; pasajero?: Partial<DatosPasajero> }): Promise<Resultado> {
  if (!i?.id) return fail(400, "BAD_REQUEST");
  const l = await d.db.rpc<Record<string, unknown>[]>("claim_list_for_user", { _user_id: userId, _id: i.id });
  const padre = l.data?.[0];
  if (!padre) return fail(404, "NOT_FOUND");
  if (!["escalable", "enviado", "recordado", "respondido", "necesita_usuario"].includes(String(padre.status))) return fail(400, "ILLEGAL_TRANSITION");
  if (padre.kind !== "vuelo") {
    // Hotel/traslado/agencia: PROFECO (la carta para el organismo es la misma relación de hechos).
    return ok({ organismo: PROFECO, carta: { texto: String(padre.body_text), url: PROFECO.formulario }, siguiente: "enviar_tu_mismo" });
  }
  const e = padre.evaluation as unknown as Evaluacion;
  if (!e?.caso) return fail(400, "NO_ESCALATION");
  const org = organismoPara(e);
  if (!org) return fail(400, "NO_ESCALATION");
  const perfil = await d.profile(userId).catch(() => ({ name: null, email: null }));
  const pasajero: DatosPasajero = { ...i.pasajero, nombre: (i.pasajero?.nombre ?? perfil.name ?? "").trim() || "Pasajero", correo: i.pasajero?.correo ?? perfil.email };
  const reply = padre.reply as Record<string, unknown> | null;
  const carta = cartaOrganismo({
    evaluacion: e, pasajero, ref: String(padre.ref_code), fecha_carta: hoyIso(d), organismo: org,
    reclamo_previo: { fecha: String(padre.sent_at ?? padre.created_at).slice(0, 10), respuesta: reply ? String(reply.resumen_es ?? "") || null : null },
  });
  const email = org.verificacion === "pagina_leida" ? org.correo : null;
  // El hijo nace esperando el ok; el padre pasa a escalable → escalado.
  if (padre.status !== "escalable") {
    await d.db.rpc("claim_transition", { _id: padre.id, _to: "escalable", _actor: "usuario", _user_id: userId, _note: "El usuario pidió escalar", _data: null });
  }
  const res = await crearYPresentar(d, userId, {
    kind: "vuelo", target: "organismo", provider_name: org.nombre, provider_code: org.id.replace(/[^A-Z0-9_]/gi, "").toUpperCase().slice(0, 20),
    channel: email ? "correo" : org.formulario ? "formulario" : "sitio", recipient_email: email,
    recipient_source: email ? { kind: "directorio_oficial", url: "lista de organismos de la Comisión Europea (13-oct-2026)", fuente: org.fuente } : null,
    form_url: org.formulario ?? org.url, language: carta.idioma, subject: carta.asunto, body_text: carta.texto, body_html: carta.html,
    evaluation: padre.evaluation as Record<string, unknown>, request: carta.pedido, response_days: 30, escalate_days: 60, trip_id: (padre.trip_id as string) ?? null,
    actor: "usuario", parent_id: String(padre.id),
  }, { evaluacion: { organismo: { id: org.id, nombre: org.nombre, notas: org.notas } }, incidente: null, telefono: org.telefono, notas_contacto: org.notas });
  if (res.body.ok === true) {
    await d.db.rpc("claim_transition", { _id: padre.id, _to: "escalado", _actor: "usuario", _user_id: userId, _note: `Escalado a ${org.nombre}`, _data: null });
    if (padre.incident_id) await nucleo(d).evento(String(padre.incident_id), { tipo: "reclamo_escalado", nota: `Escalado a ${org.nombre}` }).catch(() => null);
  }
  return res;
}

// ───────────────────────────── Quejas del viajero ─────────────────────────────
export async function registrarQueja(d: ReclamosDeps, userId: string, i: { texto?: string; contra?: "iatos" | "proveedor" | null; proveedor?: string | null; trip_id?: string | null }): Promise<Resultado> {
  const texto = String(i?.texto ?? "").trim();
  if (texto.length < 3) return fail(400, "BAD_REQUEST");
  const c = await clasificarQueja(texto.slice(0, 4000), { contra: i.contra ?? null, proveedor: i.proveedor ?? null }, d.callModel);
  const perfil = await d.profile(userId).catch(() => ({ name: null, email: null }));
  const caso = await nucleo(d).crear({
    user_id: userId, trip_id: i.trip_id ?? null, tipo: c.contra === "iatos" ? "queja_iatos" : "queja_proveedor",
    titulo: `${c.contra === "iatos" ? "Queja sobre IATOS" : `Queja${c.proveedor ? ` sobre ${c.proveedor}` : ""}`}: ${c.que_paso.slice(0, 120)}`,
    gravedad: c.gravedad, datos: { clasificacion: c, texto: texto.slice(0, 2000) },
  }).catch(() => null);
  return ok({ clasificacion: c, caso, respuesta: respuestaQueja(c, { nombre: perfil.name, caso: caso ? { id: caso.id } : null }) });
}

// ───────────────────────────── Correo entrante ─────────────────────────────
async function sha256Hex(s: string): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

type EventoEntrante = { type?: string; data?: { email_id?: string; from?: string; to?: unknown[]; cc?: unknown[]; received_for?: unknown[]; subject?: string } };

export async function handleInbound(d: ReclamosDeps, headers: Headers, raw: string): Promise<Resultado> {
  const sig = await verifySvixSignature(headers, raw, d.config.inboundSecret, d.now?.() ?? new Date());
  if (sig.ok !== true) {
    const reason = (sig as { reason: string }).reason;
    return { status: reason === "secret_not_configured" ? 503 : 401, body: { ok: false, code: "INVALID_SIGNATURE", reason } };
  }
  let ev: EventoEntrante;
  try { ev = JSON.parse(raw); } catch { return { status: 400, body: { ok: false, code: "BAD_JSON" } }; }
  if (ev?.type !== "email.received" || !ev.data?.email_id) return ok({ ignored: "event_type" });
  const dominio = d.config.replyDomain ?? DOMINIO_RESPUESTA;
  const ruta = rutaEntrante([...(ev.data.to ?? []), ...(ev.data.received_for ?? []), ...(ev.data.cc ?? [])], dominio);
  if (ruta.tipo === "operador" && ruta.token) {
    return d.operadorEntrante ? d.operadorEntrante({ token: ruta.token, emailId: String(ev.data.email_id), eventId: sig.id }) : ok({ ignored: "operador_no_conectado" });
  }
  if (ruta.tipo === "confirmacion" && ruta.token) {
    return d.confirmacionEntrante ? d.confirmacionEntrante({ token: ruta.token, emailId: String(ev.data.email_id), eventId: sig.id }) : ok({ ignored: "confirmacion_no_conectada" });
  }
  if (ruta.tipo === "reserva" || ruta.tipo === "confirmacion" || ruta.tipo === "ninguna" || !ruta.token) return ok({ ignored: ruta.tipo });
  const kind = ruta.tipo === "reclamo" ? "reclamo" : "caso";
  const claim = await d.db.rpc<Record<string, unknown>>("claim_inbound_claim", { _event_id: sig.id, _email_id: ev.data.email_id, _kind: kind, _token: ruta.token });
  if (claim.error || !claim.data) return { status: 500, body: { ok: false, code: "CLAIM_FAILED" } };
  if (claim.data.state === "duplicate") return ok({ duplicate: true });
  if (claim.data.state !== "new") return ok({ unmatched: true });
  const inboundId = String(claim.data.inbound_id);
  const userId = String(claim.data.user_id);
  const fila = claim.data.claim as Record<string, unknown> | null;

  const content = await d.receivedEmail(String(ev.data.email_id)).catch(() => null);
  if (!content) {
    await d.db.rpc("claim_inbound_finish", { _inbound_id: inboundId, _status: "failed", _outcome: "fetch_failed" });
    return { status: 500, body: { ok: false, code: "FETCH_FAILED" } };
  }
  const textoCompleto = content.text?.trim() ? content.text : htmlToText(content.html ?? "", true);
  const texto = stripQuotedReply(content.text?.trim() ? content.text! : htmlToText(content.html ?? ""));
  const perfil = await d.profile(userId).catch(() => ({ name: null, email: null }));
  // Remitente: en un reclamo, el mismo correo (o su dominio propio) al que escribimos; en un reenvío, el
  // correo de la cuenta del usuario. Siempre con DMARC/DKIM (misma regla que Reservas IA).
  const esperado = kind === "reclamo" ? (fila?.recipient_email as string | null) ?? null : perfil.email;
  const sitio = kind === "reclamo" && esperado ? `https://${esperado.split("@")[1]}` : null;
  const veredicto = senderAuthentication(content.from ?? ev.data.from, esperado, content.authentication, sitio);
  const evidencia = {
    provider: "resend", provider_email_id: ev.data.email_id, message_id: typeof content.message_id === "string" ? content.message_id.slice(0, 998) : null,
    received_at: content.created_at ?? null, from_address: veredicto.from_address, auth: veredicto.auth,
    sender: { verified: veredicto.verified, basis: veredicto.basis, reasons: veredicto.reasons },
    body_sha256: await sha256Hex(`${content.text ?? ""}\n\u0000\n${content.html ?? ""}`),
  };
  const att = await d.db.rpc<Record<string, unknown>>("claim_inbound_attach", { _inbound_id: inboundId, _e: evidencia });
  if (att.data?.duplicate === true) return ok({ duplicate: true, reason: "message_id" });

  if (kind === "caso") {
    if (!veredicto.verified) {
      await d.db.rpc("claim_inbound_finish", { _inbound_id: inboundId, _status: "unmatched", _outcome: "remitente_no_verificado" });
      return ok({ ignored: "remitente_no_verificado" });
    }
    const st = await d.db.rpc<Record<string, unknown>>("claim_store_forward", {
      _user_id: userId, _inbound_id: inboundId,
      _p: { from: veredicto.from_address, subject: String(content.subject ?? ev.data.subject ?? "").slice(0, 300), text: textoCompleto.slice(0, 8000), received_at: content.created_at ?? null, body_sha256: evidencia.body_sha256, sender_verified: true },
    });
    const claimId = st.data?.claim_id as string | null | undefined;
    if (!claimId) return ok({ stored: true, linked: false });
    // Reenvío con folio: se lee como respuesta del proveedor (sin remitente del proveedor verificable).
    const l = await d.db.rpc<Record<string, unknown>[]>("claim_list_for_user", { _user_id: userId, _id: claimId });
    const c = l.data?.[0];
    if (!c) return ok({ stored: true, linked: false });
    return aplicarRespuesta(d, c, inboundId, textoCompleto, String(content.subject ?? ""), false, perfil.email);
  }
  if (!fila) {
    await d.db.rpc("claim_inbound_finish", { _inbound_id: inboundId, _status: "unmatched", _outcome: "sin_reclamo" });
    return ok({ unmatched: true });
  }
  return aplicarRespuesta(d, fila, inboundId, texto || textoCompleto, String(content.subject ?? ev.data.subject ?? ""), veredicto.verified, perfil.email);
}

async function aplicarRespuesta(d: ReclamosDeps, c: Record<string, unknown>, inboundId: string, texto: string, asunto: string, remitenteOk: boolean, correoUsuarioDestino: string | null): Promise<Resultado> {
  let cls = null;
  try {
    cls = d.callModel && texto.trim()
      ? await clasificarRespuesta(d.callModel, { ref: String(c.ref_code), proveedor: String(c.provider_name), pedido: (c.request as string[]) ?? [], asunto, texto })
      : null;
  } catch (e) {
    if (e instanceof ModeloNoDisponible) {
      await d.db.rpc("claim_inbound_finish", { _inbound_id: inboundId, _status: "failed", _outcome: "modelo_no_disponible" });
      return { status: 500, body: { ok: false, code: "CLASSIFIER_UNAVAILABLE" } };
    }
    throw e;
  }
  const decision = decidirRespuesta(cls, texto, remitenteOk);
  const ev = c.evaluation as unknown as Evaluacion | null;
  const regimen = ev?.principal?.regimen ?? ev?.regimenes?.[0]?.id ?? null;
  const paso = siguientePaso(decision, { regimen, organismo: ev?.reclamar ? organismoPara(ev) : null, pedido: (c.request as string[]) ?? [] });
  const ap = await d.db.rpc<Record<string, unknown>>("claim_apply_reply", { _id: c.id, _inbound_id: inboundId, _d: { ...decision, siguiente: paso, estado_sugerido: paso.estado_sugerido } });
  if (ap.error || !ap.data || ap.data.ok !== true) {
    await d.db.rpc("claim_inbound_finish", { _inbound_id: inboundId, _status: "failed", _outcome: "apply_failed" });
    return { status: 500, body: { ok: false, code: "APPLY_FAILED" } };
  }
  if (correoUsuarioDestino) {
    const m = correoUsuario(`${c.provider_name} respondió tu reclamo ${c.ref_code}`, [decision.resumen_es || "Recibimos una respuesta.", paso.mensaje], d.config.appUrl);
    await d.sendEmail({ to: correoUsuarioDestino, subject: m.asunto, html: m.html, text: m.texto, from: `IATOS Reclamos <${d.config.fromAddress ?? REMITENTE_RECLAMOS}>` }).catch(() => null);
  }
  if (c.incident_id) await nucleo(d).evento(String(c.incident_id), { tipo: "respuesta_proveedor", nota: paso.mensaje.slice(0, 400), datos: { resultado: decision.resultado_final } }).catch(() => null);
  return ok({ resultado: decision.resultado_final, siguiente: paso.accion, status: (ap.data.claim as Record<string, unknown>)?.status ?? null });
}

// ───────────────────────────── Seguimiento (cron) ─────────────────────────────
export async function runSeguimiento(d: ReclamosDeps): Promise<Resultado> {
  const due = await d.db.rpc<Record<string, unknown>[]>("claim_due", { _limit: 200 });
  if (due.error) return { status: 500, body: { ok: false, code: "DUE_FAILED" } };
  let recordados = 0, escalables = 0, errores = 0;
  const now = d.now?.() ?? new Date();
  for (const c of due.data ?? []) {
    if (c.due === "escalar") {
      const t = await d.db.rpc<Record<string, unknown>>("claim_transition", { _id: c.id, _to: "escalable", _actor: "sistema", _user_id: null, _note: "Sin solución en el plazo: listo para escalar", _data: null });
      if (t.data?.ok === true && t.data.noop !== true) {
        escalables++;
        const p = await d.profile(String(c.user_id)).catch(() => ({ name: null, email: null }));
        if (p.email) {
          const m = correoUsuario(`Tu reclamo ${c.ref_code} puede escalarse`, [`${c.provider_name} no lo resolvió en el plazo.`, "Tengo lista la queja para la autoridad; solo se envía si tú lo autorizas."], d.config.appUrl);
          await d.sendEmail({ to: p.email, subject: m.asunto, html: m.html, text: m.texto, from: `IATOS Reclamos <${d.config.fromAddress ?? REMITENTE_RECLAMOS}>` }).catch(() => null);
        }
        if (c.incident_id) await nucleo(d).evento(String(c.incident_id), { tipo: "plazo_vencido", nota: "Listo para escalar" }).catch(() => null);
      } else if (t.error) errores++;
      continue;
    }
    const r = await d.db.rpc<Record<string, unknown> | null>("claim_claim_reminder", { _id: c.id });
    if (!r.data) continue; // otro proceso ya lo mandó, o la bandera está apagada
    const row = r.data;
    const dias = Math.max(1, Math.round((now.getTime() - Date.parse(String(row.sent_at))) / 86_400_000));
    const m = recordatorio(row.language as Idioma, String(row.ref_code), String(row.subject), String(row.sent_at), dias);
    const p = await d.profile(String(row.user_id)).catch(() => ({ name: null, email: null }));
    const sent = await d.sendEmail({
      to: String(row.recipient_email), subject: m.asunto, html: m.html, text: m.texto,
      from: fromHeader(d, p.name ?? "Pasajero"), replyTo: direccionReclamo(String(row.reply_token), d.config.replyDomain ?? DOMINIO_RESPUESTA),
    }).catch((e): { ok: boolean; id?: string; error?: string } => ({ ok: false, error: String((e as Error)?.message ?? e) }));
    await d.db.rpc("claim_mark_sent", { _id: row.id, _kind: "recordatorio", _ok: sent.ok, _provider_id: sent.id ?? null, _error: sent.ok ? null : sent.error ?? null });
    if (sent.ok) recordados++; else errores++;
  }
  return { status: errores ? 500 : 200, body: { ok: errores === 0, recordados, escalables, errores, revisados: (due.data ?? []).length } };
}
