// Operador IATOS · lo que llega por TELEGRAM (ya verificado el secreto del webhook). Puro (sin Deno).
//   1. Idempotente: el mismo update_id no se procesa dos veces (channel_inbound_seen).
//   2. "/start CÓDIGO" (o el código solo): vincula el chat con la cuenta IATOS (código de un solo uso de la app).
//   3. Chat sin vincular: se le dice cómo vincularlo (no se lee ni se guarda nada de su cuenta).
//   4. Con caso abierto: el mensaje entra a la bitácora de ESE caso (canal telegram) y despierta al operador.
//   5. Sin caso y con un problema (misma detección que Iato): se abre el caso con la guía inmediata y el folio
//      (igual que "Tengo un problema"), y el operador lo toma.
//   6. Lo demás: respuesta honesta (aquí se atienden problemas; para planear, la app).
import type { InboundMessage } from "../channels/types.ts";
import { linkCodeIn } from "../channels/telegram.ts";
import { detectIncident } from "../incident-detect.ts";
import { incidentFolio, ingestInboundMessage, type IncidentDb } from "../incidents.ts";
import type { ReportIncidentInput, ReportIncidentResult } from "../incident-report.ts";

export type TelegramDeps = {
  db: IncidentDb;
  enviar: (chatId: string, texto: string) => Promise<unknown>;
  reportar: (i: ReportIncidentInput) => Promise<ReportIncidentResult>;
  despertar: (incidentId: string, motivo: string) => Promise<void>;
  sha256: (s: string) => Promise<string>;
  appUrl: string;
};

export type TelegramAccion = "duplicado" | "vinculado" | "codigo_invalido" | "sin_vincular" | "ayuda" | "al_caso" | "caso_nuevo" | "general" | "error";

const AYUDA = (app: string) =>
  "Soy Iato, el operador de IATOS. Por aquí atiendo 24/7 los problemas de tu viaje: vuelo cancelado o retrasado, el chofer no llegó, el hotel, " +
  `equipaje, documentos, robos o cobros. Cuéntame qué pasó y dónde estás. Para planear o buscar, sigue en la app: ${app}\n` +
  "Si hay peligro o es una emergencia médica, llama ya al número de emergencias del país (911 en México, EE. UU. y Canadá; 112 en la UE).";

const CODIGO_MAL: Record<string, string> = {
  USED: "Ese código ya se usó. Pide uno nuevo en la app (Perfil → Ajustes → Telegram).",
  EXPIRED: "Ese código venció (duran 15 minutos). Pide uno nuevo en la app (Perfil → Ajustes → Telegram).",
  BAD_CODE: "No reconozco ese código. Revísalo o pide uno nuevo en la app (Perfil → Ajustes → Telegram).",
};

export async function atenderTelegram(d: TelegramDeps, m: InboundMessage): Promise<{ accion: TelegramAccion; incidentId?: string }> {
  const chat = m.from;
  const nuevo = await d.db.rpc("channel_inbound_seen", { _channel: "telegram", _update_id: m.providerMessageId });
  if (nuevo.error) return { accion: "error" };
  if (nuevo.data !== true) return { accion: "duplicado" };

  const code = linkCodeIn(m.text);
  if (code) {
    const raw = (m.raw ?? {}) as { username?: string | null };
    const r = await d.db.rpc("channel_link_redeem", { _channel: "telegram", _code_hash: await d.sha256(code), _external_id: chat, _username: raw.username ?? null });
    const x = r.data as { ok?: boolean; code?: string } | null;
    if (x?.ok) {
      await d.enviar(chat, "Listo: tu cuenta de IATOS quedó vinculada. " + AYUDA(d.appUrl));
      return { accion: "vinculado" };
    }
    await d.enviar(chat, CODIGO_MAL[x?.code ?? "BAD_CODE"] ?? CODIGO_MAL.BAD_CODE);
    return { accion: "codigo_invalido" };
  }

  const u = await d.db.rpc("channel_link_for", { _channel: "telegram", _external_id: chat });
  const userId = typeof u.data === "string" ? u.data : null;
  if (!userId) {
    await d.enviar(chat, "Para atenderte aquí necesito vincular tu cuenta de IATOS: en la app entra a Perfil → Ajustes → Telegram y toca «Vincular Telegram». " +
      "Si es una emergencia, llama ya al número de emergencias del país (911 en México, EE. UU. y Canadá; 112 en la UE).");
    return { accion: "sin_vincular" };
  }
  if (/^\/(start|ayuda|help)\b/i.test(m.text.trim())) {
    await d.enviar(chat, AYUDA(d.appUrl));
    return { accion: "ayuda" };
  }

  const abierto = await d.db.rpc("incident_open_for_user", { _user: userId });
  const incId = typeof abierto.data === "string" ? abierto.data : null;
  if (incId) {
    const r = await ingestInboundMessage(d.db, incId, { channel: "telegram", from: `telegram:${chat}`, text: m.text, providerMessageId: m.providerMessageId, fromUser: true });
    if (!r.ok) return { accion: "error" };
    await d.despertar(incId, "mensaje");
    await d.enviar(chat, `Recibido (folio ${incidentFolio(incId)}). El operador de IATOS te contesta por aquí; si hace falta, una persona del equipo toma tu caso.`);
    return { accion: "al_caso", incidentId: incId };
  }

  const det = detectIncident(m.text);
  if (det.detected) {
    const r = await d.reportar({ userId, descripcion: m.text, origen: "canal", canal: "telegram", idempotencyKey: `tg:${chat}:${m.providerMessageId}` });
    if (!r.ok) {
      await d.enviar(chat, "No pude abrir tu caso. Inténtalo de nuevo o escríbenos en la app. Si es una emergencia, llama ya al número de emergencias del país.");
      return { accion: "error" };
    }
    await d.enviar(chat, r.texto);
    await d.despertar(r.id, "nuevo");
    return { accion: "caso_nuevo", incidentId: r.id };
  }
  await d.enviar(chat, AYUDA(d.appUrl));
  return { accion: "general" };
}
