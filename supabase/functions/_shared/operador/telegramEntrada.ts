// Operador IATOS · lo que llega por TELEGRAM. Desde el 30-oct-2026 la lógica vive en _shared/channels/conversacion.ts
// (la misma para Telegram y WhatsApp, con Iato completo). Esta envoltura conserva la interfaz de antes: sin Iato, el
// chat atiende problemas (vincular, caso abierto, caso nuevo) y manda lo demás a la app.
import type { InboundMessage } from "../channels/types.ts";
import { atenderCanal, type CanalAccion, type IatoCanal } from "../channels/conversacion.ts";
import type { IncidentDb } from "../incidents.ts";
import type { ReportIncidentInput, ReportIncidentResult } from "../incident-report.ts";

export type TelegramDeps = {
  db: IncidentDb;
  enviar: (chatId: string, texto: string) => Promise<unknown>;
  reportar: (i: ReportIncidentInput) => Promise<ReportIncidentResult>;
  despertar: (incidentId: string, motivo: string) => Promise<void>;
  sha256: (s: string) => Promise<string>;
  appUrl: string;
  iato?: IatoCanal | null;
};

export type TelegramAccion = CanalAccion;

export function atenderTelegram(d: TelegramDeps, m: InboundMessage): Promise<{ accion: TelegramAccion; incidentId?: string }> {
  return atenderCanal({
    canal: "telegram", db: d.db, enviar: (chat, msg) => d.enviar(chat, msg.texto), reportar: d.reportar, despertar: d.despertar,
    sha256: d.sha256, appUrl: d.appUrl, iato: d.iato ?? null,
  }, m);
}
