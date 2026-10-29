// Historial del chat de Iato (E-13). concierge-chat ya guarda los turnos en
// concierge_conversations (una fila por usuario y viaje, con trip_id null = sin viaje); antes el
// cliente no los leía y al recargar la página el chat volvía a empezar.
// Las cards validadas de cada respuesta se guardan con el turno (storedCards.ts): al recargar se
// vuelven a pintar con sus botones, y un precio que ya no es "en vivo" sale como precio guardado.

// Ronda 2 (N7): también vuelven las acciones propuestas con su estado (pendiente con su botón, o hecha
// con su resultado). Un texto viejo que dice "Te dejo el botón" sin acción guardada ya no promete un
// botón que no está. Cuenta P2-12: un enlace de reserva con fecha pasada pierde la fecha (o se quita).
import { cardsWithoutPastDates, restoreStoredActions, restoreStoredCards, type StoredAction } from "../../supabase/functions/concierge-chat/storedCards.ts";
import type { ConciergeCard } from "../../supabase/functions/concierge-chat/cards.ts";
import { localISODate } from "@/lib/localDate";

export type RestoredMsg = {
  id: string; role: "user" | "assistant"; text: string; ts: number; restored: true;
  cards?: ConciergeCard[]; tripId?: string | null; actions?: StoredAction[];
};

/** Frases que prometen un botón de acción. */
const BUTTON_PROMISE = /(?:^|(?<=[.!?]\s))[^.!?\n]*\b(te dejo el bot[oó]n|con el bot[oó]n|conf[ií]rmalo con el bot[oó]n|pulsa el bot[oó]n|toca el bot[oó]n)\b[^.!?\n]*[.!?]?/gi;
export const BUTTON_GONE = "(El botón de esta respuesta ya no está disponible; pídemelo de nuevo si lo necesitas).";

/** Sin acción guardada, la promesa del botón se cambia por un aviso honesto. */
export function withoutMissingButton(text: string): string {
  if (!BUTTON_PROMISE.test(text)) return text;
  BUTTON_PROMISE.lastIndex = 0;
  let replaced = false;
  const out = text.replace(BUTTON_PROMISE, (m) => {
    if (replaced) return "";
    replaced = true;
    return m.replace(/\S.*$/s, BUTTON_GONE);
  });
  return out.replace(/[ \t]+\n/g, "\n").replace(/ {2,}/g, " ").trim();
}

type MinimalClient = { from: (table: string) => any };

/** Turnos guardados → mensajes del chat (los últimos `max`, sin vacíos ni roles desconocidos). */
export function restoreConversation(messages: unknown, max = 20, now: Date | number = Date.now(), todayISO: string = localISODate()): RestoredMsg[] {
  const list = Array.isArray(messages) ? messages : [];
  return list
    .filter((m: any) => m && (m.role === "user" || m.role === "assistant"))
    .map((m: any, i: number) => {
      const text = typeof m.content === "string" ? m.content : m.content == null ? "" : JSON.stringify(m.content);
      const t = m.timestamp ? new Date(m.timestamp).getTime() : NaN;
      const msg: RestoredMsg = { id: `hist-${i}`, role: m.role, text: text.trim(), ts: Number.isFinite(t) ? t : 0, restored: true as const };
      if (m.role === "assistant") {
        const cards = cardsWithoutPastDates(restoreStoredCards(m.cards, now), todayISO);
        if (cards.length) msg.cards = cards;
        const actions = restoreStoredActions(m.actions);
        if (actions.length) msg.actions = actions;
        else msg.text = withoutMissingButton(msg.text);
      }
      return msg;
    })
    .filter((m) => m.text.length > 0 || !!m.cards?.length)
    .slice(-max);
}

/**
 * Última conversación del usuario para ese viaje (o la "sin viaje" si tripId es null). Nunca lanza:
 * ante cualquier error devuelve [] y el chat empieza vacío, como antes.
 */
export async function loadConversation(client: MinimalClient, userId: string, tripId: string | null, max = 20): Promise<RestoredMsg[]> {
  try {
    const q = client.from("concierge_conversations").select("messages, updated_at").eq("user_id", userId);
    const { data, error } = await (tripId ? q.eq("trip_id", tripId) : q.is("trip_id", null))
      .order("updated_at", { ascending: false }).limit(1).maybeSingle();
    if (error || !data) return [];
    return restoreConversation((data as { messages?: unknown }).messages, max).map((m) => (m.cards || m.actions ? { ...m, tripId } : m));
  } catch {
    return [];
  }
}
