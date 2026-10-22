// Plantillas mínimas de correo del Booking Bridge. Sin Deno (se prueban con Vitest). El grupo emails
// puede restilizarlas: solo cambia el HTML de aquí, no el contenido honesto (nada se llama
// "reserva confirmada" si no lo está).
import { escapeHtml, layout, oneLine } from "../email.ts";
import { intentStatusText, type Verification } from "./states.ts";
import type { IntentState } from "./types.ts";

export type IntentEmailData = {
  title: string;
  product_type: string;
  city?: string | null;
  dates?: string | null;
  party?: number | null;
  processor?: string | null;
  state: IntentState;
  verification?: Verification;
  trip_url?: string | null;
};

/** Aviso al equipo: el usuario pidió asistencia para reservar (no hay otro canal fiable). */
export function assistedRequestTeamEmail(d: IntentEmailData & { user_label: string; message?: string | null; intent_id: string }) {
  const subject = oneLine(`[IATOS Reservas] Solicitud de asistencia — ${d.title} — ${d.user_label}`, 180);
  const html = layout("Solicitud de asistencia para reservar", `
    <p><b>Cliente:</b> ${escapeHtml(d.user_label)}</p>
    <p><b>Qué:</b> ${escapeHtml(d.title)} (${escapeHtml(d.product_type)})${d.city ? ` · ${escapeHtml(d.city)}` : ""}</p>
    ${d.dates ? `<p><b>Fecha:</b> ${escapeHtml(d.dates)}</p>` : ""}
    ${d.party ? `<p><b>Personas:</b> ${escapeHtml(d.party)}</p>` : ""}
    ${d.message ? `<p><b>Mensaje del cliente:</b><br>${escapeHtml(d.message).replace(/\n/g, "<br>")}</p>` : ""}
    <p>El cliente ve: “${escapeHtml(intentStatusText("REQUESTED"))}”. Responde con disponibilidad y precio reales; no lo confirmes hasta tener la respuesta del proveedor.</p>
    <p style="color:#888;font-size:12px">booking_intents.id = ${escapeHtml(d.intent_id)}</p>`);
  return { subject, html };
}

/** Recordatorio al usuario: ¿completaste tu reserva? (después de abrir el proveedor). */
export function bookingFollowUpEmail(d: IntentEmailData & { name?: string | null }) {
  const subject = oneLine(`¿Completaste tu reserva de ${d.title}?`, 150);
  const html = layout("¿Completaste tu reserva?", `
    <p>Hola${d.name ? ` ${escapeHtml(d.name)}` : ""}:</p>
    <p>Abriste ${escapeHtml(d.processor ?? "el proveedor")} para <b>${escapeHtml(d.title)}</b>${d.dates ? ` (${escapeHtml(d.dates)})` : ""}.
    Aún no sabemos si completaste la compra: IATOS no la ve.</p>
    <p>Si ya reservaste, registra tu número de confirmación en tu viaje para tenerlo a mano. Quedará como
    <b>declarada por ti</b> hasta que se verifique con el proveedor.</p>
    ${d.trip_url ? `<p><a href="${escapeHtml(d.trip_url)}" style="color:#c9a24a">Abrir mi viaje</a></p>` : ""}
    <p style="color:#888;font-size:12px">Estado: ${escapeHtml(intentStatusText(d.state, d.verification ?? "none", d.processor ?? "el proveedor"))}</p>`);
  return { subject, html };
}
