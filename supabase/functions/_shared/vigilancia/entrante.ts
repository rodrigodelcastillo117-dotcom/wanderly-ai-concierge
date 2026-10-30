// Vigilancia proactiva · respuesta del proveedor a la reconfirmación (confirma+<token>@reply.traveliatos.life). Llega
// por el webhook de reclamos-inbound (firma Svix ya verificada en handleInbound). Se busca la confirmación por su
// token, se descarga el correo de Resend, se verifica el remitente (DMARC/DKIM contra el correo al que escribimos,
// misma regla que Reservas IA y el Operador) y se clasifica sin IA:
//   confirma  (solo con remitente verificado) → se anota y se avisa al viajero, a buena hora.
//   problema / ambigua → incidente preventivo (antes de que el viajero llegue) y aviso.
// Idempotente: una confirmación ya respondida no vuelve a procesarse. Puro (sin Deno).
import { htmlToText, senderAuthentication, stripQuotedReply } from "../ai-reservations/core.ts";
import { clasificarRespuesta, type Confirmacion } from "./confirmaciones.ts";
import { abrirPreventivo, type VigilanciaDeps } from "./runner.ts";

export type CorreoProveedor = {
  from?: string; subject?: string; text?: string | null; html?: string | null; created_at?: string; message_id?: string | null;
  authentication?: { spf?: string; dkim?: string; dmarc?: string } | null;
};

export type EntradaDeps = VigilanciaDeps & { receivedEmail: (emailId: string) => Promise<CorreoProveedor | null> };

const TIPO: Record<string, string> = { traslado: "tu traslado", tour: "tu tour", restaurante: "tu mesa", actividad: "tu reserva" };

export async function respuestaConfirmacion(d: EntradaDeps, x: { token: string; emailId: string; eventId: string }): Promise<{ status: number; body: Record<string, unknown> }> {
  const r = await d.db.rpc("vigilancia_confirmacion_por_token", { _token: x.token });
  if (r.error) return { status: 500, body: { ok: false, code: "LOOKUP_FAILED" } };
  const c = r.data as (Confirmacion & { respuesta_resultado?: string | null }) | null;
  if (!c?.id) return { status: 200, body: { ok: true, unmatched: true } };
  if (c.estado === "confirmada" || c.estado === "problema") return { status: 200, body: { ok: true, duplicate: true } };
  const mail = await d.receivedEmail(x.emailId).catch(() => null);
  if (!mail) return { status: 500, body: { ok: false, code: "FETCH_FAILED" } };
  const sitio = typeof c.fuente?.url === "string" ? (() => { try { return new URL(String(c.fuente.url)).origin; } catch { return null; } })() : null;
  const v = senderAuthentication(mail.from, c.correo, mail.authentication ?? null, sitio);
  const texto = stripQuotedReply(mail.text?.trim() ? mail.text : htmlToText(mail.html ?? "")).trim().slice(0, 3000);
  const resultado = clasificarRespuesta(`${mail.subject ?? ""}\n${texto}`, v.verified);
  const extracto = texto.replace(/\s+/g, " ").slice(0, 600) || null;
  const datos = { remitente: v.from_address, verificado: v.verified, base: v.basis, razones: v.reasons, evento_svix: x.eventId, resultado };

  if (resultado === "confirma") {
    await d.db.rpc("vigilancia_confirmacion_actualizar", { _id: c.id, _p: { estado: "confirmada", respuesta_resultado: "confirma", respuesta_extracto: extracto, remitente_verificado: true } });
    await d.db.rpc("vigilancia_evento", { _e: { user_id: c.user_id, trip_id: c.trip_id, ambito: "confirmacion", tipo: "confirmacion_recibida",
      clave: `confirmacion:${c.id}:confirmada`, resumen: `${c.proveedor} reconfirmó ${TIPO[c.tipo] ?? "la reserva"} (remitente verificado).`,
      datos, ref_id: c.id, visible_viajero: true } });
    await d.db.rpc("vigilancia_aviso_encolar", { _a: { user_id: c.user_id, trip_id: c.trip_id, clave: `aviso:confirmada:${c.id}`, tipo: "confirmacion",
      titulo: `${c.proveedor} reconfirmó ${TIPO[c.tipo] ?? "tu reserva"}`,
      cuerpo: `Le pedimos a ${c.proveedor} que reconfirmara ${TIPO[c.tipo] ?? "tu reserva"} y respondió que todo sigue en pie${extracto ? `: «${extracto.slice(0, 200)}»` : "."}`,
      url: c.trip_id ? `/dashboard/viajes/${c.trip_id}` : "/dashboard/reservas", urgente: false, zona_horaria: c.zona_horaria, expira_at: c.servicio_at } });
    return { status: 200, body: { ok: true, resultado, verified: true } };
  }
  await d.db.rpc("vigilancia_confirmacion_actualizar", { _id: c.id, _p: { respuesta_resultado: resultado, respuesta_extracto: extracto, remitente_verificado: v.verified } });
  await d.db.rpc("vigilancia_evento", { _e: { user_id: c.user_id, trip_id: c.trip_id, ambito: "confirmacion", tipo: "confirmacion_respuesta",
    clave: `confirmacion:${c.id}:respuesta:${String(mail.message_id ?? x.emailId).slice(0, 120)}`,
    resumen: `${c.proveedor} respondió (${resultado}${v.verified ? "" : ", remitente NO verificado"}).`, datos, ref_id: c.id } });
  const id = await abrirPreventivo(d, c, resultado === "problema" ? "problema" : "ambigua", extracto);
  return { status: 200, body: { ok: true, resultado, verified: v.verified, incident_id: id } };
}
