// Operador IATOS · respuesta del proveedor (operador+<token>@reply.traveliatos.life). Llega por el webhook de
// reclamos-inbound (firma Svix ya verificada). Se busca el correo que mandó el operador por su token, se descarga
// el contenido de Resend, se verifica el remitente (DMARC/DKIM contra la dirección a la que escribimos, misma regla
// que Reservas IA) y se agrega a la bitácora del incidente (idempotente por Message-ID). Eso despierta al operador.
// Un remitente no verificado se anota marcado así: el operador no lo toma como confirmación. Puro (sin Deno).
import { htmlToText, senderAuthentication, stripQuotedReply } from "../ai-reservations/core.ts";
import { ingestInboundMessage, type IncidentDb } from "../incidents.ts";

export type CorreoProveedor = {
  from?: string; subject?: string; text?: string | null; html?: string | null; created_at?: string; message_id?: string | null;
  authentication?: { spf?: string; dkim?: string; dmarc?: string } | null;
};

export type EntranteDeps = {
  db: IncidentDb;
  receivedEmail: (emailId: string) => Promise<CorreoProveedor | null>;
  /** Despierta al operador para ese caso (fetch a la función operador; en pruebas, un doble). */
  despertar?: (incidentId: string) => Promise<void>;
};

export async function respuestaProveedor(d: EntranteDeps, x: { token: string; emailId: string; eventId: string }): Promise<{ status: number; body: Record<string, unknown> }> {
  const r = await d.db.rpc("operator_outbox_by_token", { _token: x.token });
  const o = r.data as { request_id?: string; to_email?: string; provider_name?: string; website?: string | null } | null;
  if (r.error) return { status: 500, body: { ok: false, code: "LOOKUP_FAILED" } };
  if (!o?.request_id) return { status: 200, body: { ok: true, unmatched: true } };
  const c = await d.receivedEmail(x.emailId).catch(() => null);
  if (!c) return { status: 500, body: { ok: false, code: "FETCH_FAILED" } };
  const verdict = senderAuthentication(c.from, o.to_email ?? null, c.authentication ?? null, o.website ?? null);
  const texto = stripQuotedReply(c.text?.trim() ? c.text : htmlToText(c.html ?? "")).trim().slice(0, 3500);
  const cuerpo = `${verdict.verified ? "" : "[Remitente NO verificado: no lo tomes como confirmación] "}${c.subject ? `${String(c.subject).slice(0, 200)}\n\n` : ""}${texto || "(correo sin texto)"}`;
  const ev = await ingestInboundMessage(d.db, o.request_id, {
    channel: "email", from: `${o.provider_name ?? "Proveedor"} <${verdict.from_address ?? String(c.from ?? "").slice(0, 120)}>`, text: cuerpo,
    providerMessageId: String(c.message_id ?? x.emailId).slice(0, 190), fromUser: false,
    data: { proveedor: o.provider_name ?? null, remitente_verificado: verdict.verified, base: verdict.basis, evento_svix: x.eventId },
  });
  if (!ev.ok) return { status: 500, body: { ok: false, code: "INGEST_FAILED" } };
  if (!ev.duplicate && d.despertar) await d.despertar(o.request_id).catch(() => undefined);
  return { status: 200, body: { ok: true, incident_id: o.request_id, verified: verdict.verified, duplicate: ev.duplicate } };
}
