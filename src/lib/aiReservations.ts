// Cliente de Reservas IA (edge function ai-reservations). La app nunca escribe en las tablas: todo
// pasa por la función con el JWT del usuario. Contrato: docs/iatos/IATOS_RESERVAS_IA.md §API.
import { supabase } from "@/integrations/supabase/client";

export type AiReservation = {
  id: string;
  ref_code: string;
  venue_name: string;
  venue_email: string | null;
  venue_address: string | null;
  venue_city: string | null;
  venue_place_id: string | null;
  requested_local: string;
  requested_for: string;
  party_size: number;
  customer_name: string;
  status: string;
  reason: string | null;
  label: string;
  is_confirmed: boolean;
  confirm_prompt: string;
  user_options: { phone_url?: string | null; whatsapp_url?: string | null; booking_url?: string | null; website?: string | null; maps_url?: string | null; info_requested?: string | null } | null;
  alternatives: Array<{ local: string; note?: string | null; held?: boolean }> | null;
  confirmation: { quote?: string; code?: string | null } | null;
  confirmation_code: string | null;
  venue_reply_excerpt: string | null;
  created_at: string;
};

export type AiReservationsResult = { ok: boolean; code?: string; message?: string; enabled?: boolean; reservations?: AiReservation[]; reservation?: AiReservation; venue_notified?: boolean };

async function call(body: Record<string, unknown>): Promise<AiReservationsResult> {
  let data: unknown, error: unknown;
  try {
    ({ data, error } = await supabase.functions.invoke("ai-reservations", { body }));
  } catch {
    return { ok: false, code: "NETWORK", message: "No pudimos conectar. Inténtalo de nuevo." };
  }
  if (error) {
    // Los errores de negocio vienen como JSON en la respuesta (code + message).
    const ctx = (error as { context?: Response }).context;
    const parsed = ctx && typeof ctx.json === "function" ? await ctx.json().catch(() => null) : null;
    return parsed ?? { ok: false, code: "NETWORK", message: "No pudimos conectar. Inténtalo de nuevo." };
  }
  return data as AiReservationsResult;
}

export const listAiReservations = () => call({ action: "status" });
export const confirmAiReservation = (id: string, prompt: string, consent: { share_contact: boolean; cc_me: boolean }) =>
  call({ action: "confirm_send", id, confirm: true, confirm_text: prompt, consent });
export const chooseAiAlternative = (id: string, index: number) => call({ action: "choose_alternative", id, index });
export const cancelAiReservation = (id: string) => call({ action: "cancel", id });

/** "2026-11-03T20:30" → "mar 3 nov 2026, 20:30" (hora local del restaurante, sin zona del navegador). */
export function formatLocalSlot(local: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) return local;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12));
  const day = new Intl.DateTimeFormat("es-MX", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(d);
  return `${day}, ${m[4]}:${m[5]}`;
}

const icsEscape = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const icsDate = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

/** .ics de una reserva CONFIRMADA (el servidor también lo sirve por enlace firmado en el correo). */
export function reservationIcsBlob(r: AiReservation): Blob {
  const start = new Date(r.requested_for);
  const end = new Date(start.getTime() + 2 * 3_600_000);
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//IATOS//Reservas IA//ES", "BEGIN:VEVENT",
    `UID:${r.ref_code}@traveliatos.life`, `DTSTAMP:${icsDate(new Date())}`, `DTSTART:${icsDate(start)}`, `DTEND:${icsDate(end)}`,
    `SUMMARY:${icsEscape(`Reserva en ${r.venue_name}`)}`,
    `LOCATION:${icsEscape([r.venue_name, r.venue_address ?? r.venue_city].filter(Boolean).join(", "))}`,
    `DESCRIPTION:${icsEscape(`Confirmada por escrito por el restaurante. ${r.party_size} personas.${r.confirmation_code ? ` Código: ${r.confirmation_code}.` : ""} Ref ${r.ref_code}.`)}`,
    "END:VEVENT", "END:VCALENDAR", "",
  ];
  return new Blob([lines.join("\r\n")], { type: "text/calendar" });
}
