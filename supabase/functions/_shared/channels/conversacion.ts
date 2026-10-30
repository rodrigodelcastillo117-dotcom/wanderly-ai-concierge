// Iato por Telegram y WhatsApp: lo que llega por el chat (ya verificada la firma del proveedor). Puro (sin Deno).
//
//   1. Idempotente: el mismo mensaje (update_id / wamid) no se procesa dos veces (channel_inbound_seen).
//   2. Código de la app ("/start CÓDIGO", el código solo, o "IATOS CÓDIGO" por WhatsApp): vincula el chat.
//   3. Chat sin vincular: se le dice cómo vincularlo. No se lee ni se guarda nada de ninguna cuenta.
//   4. Botón «Confirmar»/«Cancelar» de una acción que propuso Iato: se toma UNA vez (channel_action_take, mismo
//      chat y misma cuenta) y se ejecuta con la sesión del viajero (concierge-chat mode=action vuelve a validar todo).
//   5. Ubicación compartida: se guarda 2 horas para "¿qué hay cerca?" y, si hay un caso abierto, va a su bitácora.
//   6. Foto de un ticket: se lee con scan-receipt (con la sesión del viajero) y se propone registrar el gasto.
//   7. Texto con un caso abierto que es la respuesta a ese caso (el operador le escribió hace poco, menciona el folio,
//      cuenta el problema o empieza con "caso"): entra a la bitácora y despierta al operador (como antes).
//   8. Un problema nuevo: se abre el caso con la guía inmediata y el folio (igual que "Tengo un problema").
//   9. Lo demás: Iato completo (concierge-chat, con su plan, cuota, herramientas, honestidad y memoria), con la sesión
//      del propio viajero. Sin Iato configurado: respuesta honesta y la app.
import type { InboundMessage } from "./types.ts";
import { linkCodeIn } from "./telegram.ts";
import { type AccionGuardada, type AccionIato, armarMensajes, type CanalConversacion, leerBoton, type MensajeCanal, type RespuestaIato, textoSimple } from "./formato.ts";
import { detectIncident } from "../incident-detect.ts";
import { incidentFolio, ingestInboundMessage, type IncidentDb } from "../incidents.ts";
import type { ReportIncidentInput, ReportIncidentResult } from "../incident-report.ts";

export type ResultadoIato = { ok: true; reply: RespuestaIato } | { ok: false; mensaje: string; code?: string };

/** Iato en nombre de UN usuario (la implementación abre una sesión real de ese usuario: RLS, plan y cuotas). */
export interface IatoCanal {
  conversar(userId: string, p: { texto: string; coords: { lat: number; lng: number } | null; canal: CanalConversacion }): Promise<ResultadoIato>;
  ejecutar(userId: string, accion: AccionIato, ref: string): Promise<{ ok: boolean; mensaje: string; link?: string | null }>;
  ticket(userId: string, archivo: { bytes: Uint8Array; mime: string }, nota: string): Promise<{ ok: true; accion: AccionIato; texto: string } | { ok: false; mensaje: string }>;
}

export type CanalDeps = {
  canal: CanalConversacion;
  db: IncidentDb;
  enviar: (to: string, m: MensajeCanal) => Promise<unknown>;
  escribiendo?: (to: string) => Promise<void>;
  responderBoton?: (callbackId: string, texto?: string) => Promise<void>;
  descargar?: (ref: string) => Promise<{ bytes: Uint8Array; mime: string } | null>;
  reportar: (i: ReportIncidentInput) => Promise<ReportIncidentResult>;
  despertar: (incidentId: string, motivo: string) => Promise<void>;
  sha256: (s: string) => Promise<string>;
  appUrl: string;
  /** null/ausente: el chat solo atiende problemas (como antes) y manda lo demás a la app. */
  iato?: IatoCanal | null;
  /** WhatsApp por Twilio: confirmaciones con "sí <código>". */
  twilio?: boolean;
  ahora?: () => Date;
};

export type CanalAccion =
  | "duplicado" | "vinculado" | "codigo_invalido" | "sin_vincular" | "ayuda" | "al_caso" | "caso_nuevo" | "general" | "error"
  | "iato" | "iato_error" | "accion_confirmada" | "accion_cancelada" | "accion_invalida" | "ubicacion" | "ticket" | "ticket_error";

const NOMBRE: Record<CanalConversacion, string> = { telegram: "Telegram", whatsapp: "WhatsApp" };
const EMERGENCIA = "Si hay peligro o es una emergencia médica, llama ya al número de emergencias del país (911 en México, EE. UU. y Canadá; 112 en la UE).";

const AYUDA_CASOS = (app: string) =>
  "Soy Iato, el operador de IATOS. Por aquí atiendo 24/7 los problemas de tu viaje: vuelo cancelado o retrasado, el chofer no llegó, el hotel, " +
  `equipaje, documentos, robos o cobros. Cuéntame qué pasó y dónde estás. Para planear o buscar, sigue en la app: ${app}\n` + EMERGENCIA;

const AYUDA_IATO =
  "Soy Iato, tu concierge de IATOS. Por aquí puedes hacer lo mismo que en la app:\n" +
  "• Planear y preguntar por tu viaje (vuelos, hoteles, qué hacer, itinerario).\n" +
  "• Gastos: pregúntame cuánto llevas o mándame la foto de un ticket.\n" +
  "• Clima, hora local, eventos y lugares cerca (comparte tu ubicación).\n" +
  "• Si algo sale mal (vuelo, chofer, hotel, equipaje, documentos), abro tu caso y el operador te contesta aquí 24/7.\n" +
  "Nada se registra ni se reserva sin que toques «Confirmar».\n" + EMERGENCIA;

const CODIGO_MAL = (c: CanalConversacion): Record<string, string> => ({
  USED: `Ese código ya se usó. Pide uno nuevo en la app (Perfil → Ajustes → ${NOMBRE[c]}).`,
  EXPIRED: `Ese código venció (duran 15 minutos). Pide uno nuevo en la app (Perfil → Ajustes → ${NOMBRE[c]}).`,
  BAD_CODE: `No reconozco ese código. Revísalo o pide uno nuevo en la app (Perfil → Ajustes → ${NOMBRE[c]}).`,
});

const ACCION_MAL: Record<string, string> = {
  USED: "Eso ya quedó atendido (lo confirmaste o lo cancelaste antes).",
  EXPIRED: "Ese botón venció (duran 24 horas). Pídemelo de nuevo y te lo vuelvo a proponer.",
  AMBIGUOUS: "Hay más de una acción con ese código; usa el botón o el código completo.",
};

type CasoAbierto = { id: string; lastToUserAt: string | null };

const RE_CASO = /^\s*\/?caso\b[:\s,]*/i;
const RE_RECLAMO = /\bC-[A-Z0-9]{6}\b/;
const RE_CORTA = /^\s*(s[ií]|no|ok|okay|vale|listo|claro|de acuerdo|gracias|perfecto|ya)\b/i;

/**
 * ¿Lo que escribió es para su caso abierto (operador) o una pregunta para Iato? Con el caso abierto va al caso si:
 * empieza con "caso", menciona el folio o un reclamo (C-…), cuenta un problema, el operador o el equipo le escribió en
 * las últimas 3 horas, o es una respuesta corta ("sí", "ok"…) a algo que le escribieron en las últimas 24 horas.
 */
export function vaAlCaso(texto: string, caso: CasoAbierto | null, ahora: Date, folio?: string | null): boolean {
  if (!caso) return false;
  if (RE_CASO.test(texto)) return true;
  if ((folio && incidentFolio(caso.id) === folio) || RE_RECLAMO.test(texto)) return true;
  if (detectIncident(texto).detected) return true;
  const t = caso.lastToUserAt ? Date.parse(caso.lastToUserAt) : NaN;
  if (!Number.isFinite(t)) return false;
  const hace = ahora.getTime() - t;
  if (hace < 3 * 3600_000) return true;
  return hace < 24 * 3600_000 && RE_CORTA.test(texto) && texto.trim().length <= 80;
}

const plano = (d: CanalDeps, t: string): MensajeCanal => ({ texto: textoSimple(t, d.canal), botones: [] });
const enlaceApp = (d: CanalDeps, link?: string | null) => (link && /^\/[\w/?=&.-]*$/.test(link) ? `${d.appUrl.replace(/\/dashboard\/?$/, "")}${link}` : null);

async function guardarAcciones(d: CanalDeps, userId: string, chat: string, acciones: AccionIato[]): Promise<AccionGuardada[]> {
  const out: AccionGuardada[] = [];
  for (const a of acciones.filter((x) => x.runs !== "client" && x.type).slice(0, 3)) {
    const accion = { id: a.id ?? null, type: a.type, params: a.params ?? {}, summary: String(a.summary ?? "").slice(0, 500), confirm_label: String(a.confirm_label ?? "Confirmar").slice(0, 60), note: a.note ? String(a.note).slice(0, 300) : undefined, runs: "server" };
    const r = await d.db.rpc("channel_action_put", { _user: userId, _channel: d.canal, _external_id: chat, _action: accion });
    const x = r.data as { ok?: boolean; ref?: string } | null;
    if (!r.error && x?.ok && x.ref) out.push({ ref: x.ref, accion: accion as AccionIato });
  }
  return out;
}

async function enviarTodos(d: CanalDeps, chat: string, ms: MensajeCanal[]) {
  for (const m of ms) await d.enviar(chat, m);
}

export async function atenderCanal(d: CanalDeps, m: InboundMessage): Promise<{ accion: CanalAccion; incidentId?: string }> {
  const chat = m.from;
  const ahora = d.ahora?.() ?? new Date();
  const nuevo = await d.db.rpc("channel_inbound_seen", { _channel: d.canal, _update_id: m.providerMessageId });
  if (nuevo.error) return { accion: "error" };
  if (nuevo.data !== true) {
    if (m.callbackId) await d.responderBoton?.(m.callbackId);
    return { accion: "duplicado" };
  }

  const code = m.boton ? null : linkCodeIn(m.text);
  if (code) {
    const raw = (m.raw ?? {}) as { username?: string | null };
    const r = await d.db.rpc("channel_link_redeem", { _channel: d.canal, _code_hash: await d.sha256(code), _external_id: chat, _username: raw.username ?? null });
    const x = r.data as { ok?: boolean; code?: string } | null;
    if (x?.ok) {
      await d.enviar(chat, plano(d, "Listo: tu cuenta de IATOS quedó vinculada. " + (d.iato ? AYUDA_IATO : AYUDA_CASOS(d.appUrl))));
      return { accion: "vinculado" };
    }
    await d.enviar(chat, plano(d, CODIGO_MAL(d.canal)[x?.code ?? "BAD_CODE"] ?? CODIGO_MAL(d.canal).BAD_CODE));
    return { accion: "codigo_invalido" };
  }

  const u = await d.db.rpc("channel_link_for", { _channel: d.canal, _external_id: chat });
  const userId = typeof u.data === "string" ? u.data : null;
  if (!userId) {
    if (m.callbackId) await d.responderBoton?.(m.callbackId);
    await d.enviar(chat, plano(d, `Para atenderte aquí necesito vincular tu cuenta de IATOS: en la app entra a Perfil → Ajustes → ${NOMBRE[d.canal]} y toca «Vincular ${NOMBRE[d.canal]}». ` + EMERGENCIA));
    return { accion: "sin_vincular" };
  }

  // ── Botones de acciones (o "sí 4f2a9c1b" por Twilio) ──
  const twilioSi = d.twilio && !m.boton ? /^\s*s[ií]\s+([0-9a-f]{8})\s*$/i.exec(m.text) : null;
  const boton = m.boton ? leerBoton(m.boton) : twilioSi ? { ref: twilioSi[1].toLowerCase(), confirmar: true } : null;
  if (m.boton || twilioSi) {
    if (!boton || !d.iato) {
      if (m.callbackId) await d.responderBoton?.(m.callbackId);
      await d.enviar(chat, plano(d, "Ese botón ya no sirve. Pídemelo de nuevo."));
      return { accion: "accion_invalida" };
    }
    if (m.callbackId) await d.responderBoton?.(m.callbackId, boton.confirmar ? "Un momento…" : "Cancelado");
    const r = await d.db.rpc("channel_action_take", { _ref: boton.ref, _channel: d.canal, _external_id: chat, _cancel: !boton.confirmar });
    const x = r.data as { ok?: boolean; code?: string; user_id?: string; action?: AccionIato } | null;
    // Defensa extra: la acción debe ser de la cuenta vinculada HOY a este chat.
    if (r.error || !x?.ok || x.user_id !== userId || !x.action) {
      await d.enviar(chat, plano(d, ACCION_MAL[x?.code ?? ""] ?? "No encontré esa acción. Pídemela de nuevo."));
      return { accion: "accion_invalida" };
    }
    if (!boton.confirmar) {
      await d.enviar(chat, plano(d, "Listo, no hice nada."));
      return { accion: "accion_cancelada" };
    }
    await d.escribiendo?.(chat);
    const e = await d.iato.ejecutar(userId, x.action, boton.ref);
    const url = enlaceApp(d, e.link);
    await d.enviar(chat, e.ok
      ? d.canal === "telegram" && url ? { texto: textoSimple(`✅ ${e.mensaje}`, d.canal), botones: [{ texto: "Ver en la app", url }] } : plano(d, `✅ ${e.mensaje}${url ? `\n${url}` : ""}`)
      : plano(d, e.mensaje || "No pude hacerlo ahora. Inténtalo de nuevo en un momento o desde la app."));
    return { accion: "accion_confirmada" };
  }

  // ── Ubicación compartida ──
  if (m.ubicacion) {
    await d.db.rpc("channel_location_set", { _channel: d.canal, _external_id: chat, _lat: m.ubicacion.lat, _lng: m.ubicacion.lng });
    const caso = await casoAbierto(d, userId);
    if (caso) {
      const mapa = `https://www.google.com/maps/search/?api=1&query=${m.ubicacion.lat.toFixed(5)},${m.ubicacion.lng.toFixed(5)}`;
      await ingestInboundMessage(d.db, caso.id, { channel: d.canal, from: `${d.canal}:${chat}`, text: `Ubicación compartida: ${mapa}`, providerMessageId: m.providerMessageId, fromUser: true,
        data: { ubicacion: { lat: m.ubicacion.lat, lng: m.ubicacion.lng } } });
      await d.despertar(caso.id, "mensaje");
    }
    await d.enviar(chat, plano(d, `Tengo tu ubicación (la uso las próximas 2 horas${caso ? ` y ya está en tu caso ${incidentFolio(caso.id)}` : ""}). ` +
      (d.iato ? "Pregúntame, por ejemplo: «farmacia abierta cerca», «dónde cenar» o «cómo llego a mi hotel»." : "")));
    return { accion: "ubicacion", incidentId: caso?.id };
  }

  // ── Foto de un ticket ──
  if (m.media) {
    if (!d.iato || !d.descargar) {
      await d.enviar(chat, plano(d, "Para registrar un ticket, súbelo en la app: Gastos → Escanear ticket."));
      return { accion: "ticket_error" };
    }
    await d.escribiendo?.(chat);
    const archivo = await d.descargar(m.media.ref);
    if (!archivo) {
      await d.enviar(chat, plano(d, "No pude descargar la foto. Mándala otra vez (como foto, no como enlace)."));
      return { accion: "ticket_error" };
    }
    const t = await d.iato.ticket(userId, archivo, m.text);
    if (!t.ok) {
      await d.enviar(chat, plano(d, t.mensaje));
      return { accion: "ticket_error" };
    }
    const guardadas = await guardarAcciones(d, userId, chat, [t.accion]);
    if (!guardadas.length) {
      await d.enviar(chat, plano(d, `${t.texto}\nNo pude preparar el botón para registrarlo; captúralo en la app (Gastos).`));
      return { accion: "ticket_error" };
    }
    await enviarTodos(d, chat, armarMensajes({ text: t.texto, actions: [] }, d.canal, { guardadas, appUrl: d.appUrl, twilio: d.twilio }));
    return { accion: "ticket" };
  }

  const texto = m.text.trim();
  if (/^\/(start|ayuda|help)\b/i.test(texto) || /^(ayuda|help|menu|menú)$/i.test(texto)) {
    await d.enviar(chat, plano(d, d.iato ? AYUDA_IATO : AYUDA_CASOS(d.appUrl)));
    return { accion: "ayuda" };
  }

  // ── Caso abierto ──
  const caso = await casoAbierto(d, userId);
  if (caso && (!d.iato || vaAlCaso(texto, caso, ahora, m.folio))) {
    const cuerpo = texto.replace(RE_CASO, "").trim() || texto;
    const r = await ingestInboundMessage(d.db, caso.id, { channel: d.canal, from: `${d.canal}:${chat}`, text: cuerpo, providerMessageId: m.providerMessageId, fromUser: true });
    if (!r.ok) return { accion: "error" };
    await d.despertar(caso.id, "mensaje");
    await d.enviar(chat, plano(d, `Recibido (folio ${incidentFolio(caso.id)}). El operador de IATOS te contesta por aquí; si hace falta, una persona del equipo toma tu caso.`));
    return { accion: "al_caso", incidentId: caso.id };
  }

  // ── Problema nuevo: caso con guía inmediata y folio (determinista, sin depender de la IA) ──
  if (!caso && detectIncident(texto).detected) {
    const loc = await Promise.resolve(d.db.rpc("channel_location_get", { _channel: d.canal, _external_id: chat })).catch(() => ({ data: null, error: null }));
    const coords = loc?.data as { lat?: number; lng?: number } | null;
    const r = await d.reportar({
      userId, descripcion: texto, origen: "canal", canal: d.canal, idempotencyKey: `${d.canal === "telegram" ? "tg" : "wa"}:${chat}:${m.providerMessageId}`,
      ...(coords && Number.isFinite(coords.lat) && Number.isFinite(coords.lng) ? { ubicacion: { lat: coords.lat!, lng: coords.lng! } } : {}),
    });
    if (!r.ok) {
      await d.enviar(chat, plano(d, "No pude abrir tu caso. Inténtalo de nuevo o escríbenos en la app. " + EMERGENCIA));
      return { accion: "error" };
    }
    await d.enviar(chat, plano(d, r.texto));
    await d.despertar(r.id, "nuevo");
    return { accion: "caso_nuevo", incidentId: r.id };
  }

  if (!d.iato) {
    await d.enviar(chat, plano(d, AYUDA_CASOS(d.appUrl)));
    return { accion: "general" };
  }

  // ── Iato completo ──
  try {
    await d.escribiendo?.(chat);
    const loc = await d.db.rpc("channel_location_get", { _channel: d.canal, _external_id: chat });
    const c = loc.data as { lat?: number; lng?: number } | null;
    const coords = c && Number.isFinite(c.lat) && Number.isFinite(c.lng) ? { lat: Number(c.lat), lng: Number(c.lng) } : null;
    const r = await d.iato.conversar(userId, { texto, coords, canal: d.canal });
    if (!r.ok) {
      await d.enviar(chat, plano(d, r.mensaje));
      return { accion: "iato_error" };
    }
    const guardadas = await guardarAcciones(d, userId, chat, r.reply.actions ?? []);
    const pie = caso ? `Tu caso ${incidentFolio(caso.id)} sigue abierto: para escribirle al operador, empieza tu mensaje con «caso».` : null;
    await enviarTodos(d, chat, armarMensajes(r.reply, d.canal, { guardadas, appUrl: d.appUrl, pie, twilio: d.twilio }));
    return { accion: "iato" };
  } catch {
    await d.enviar(chat, plano(d, "Tuve un problema para responderte. Inténtalo de nuevo en un momento o sigue en la app. " + EMERGENCIA));
    return { accion: "iato_error" };
  }
}

async function casoAbierto(d: CanalDeps, userId: string): Promise<CasoAbierto | null> {
  if (!d.iato) {
    // Sin Iato: como siempre (todo lo que escribe con un caso abierto va al caso).
    const r = await d.db.rpc("incident_open_for_user", { _user: userId });
    return typeof r.data === "string" ? { id: r.data, lastToUserAt: null } : null;
  }
  const r = await d.db.rpc("channel_open_case", { _user: userId });
  const x = r.data as { id?: string; last_to_user_at?: string | null } | null;
  return x?.id ? { id: x.id, lastToUserAt: x.last_to_user_at ?? null } : null;
}
