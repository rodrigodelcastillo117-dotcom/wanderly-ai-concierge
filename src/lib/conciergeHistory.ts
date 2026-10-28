// Historial del chat de Iato (E-13). concierge-chat ya guarda los turnos en
// concierge_conversations (una fila por usuario y viaje, con trip_id null = sin viaje); antes el
// cliente no los leía y al recargar la página el chat volvía a empezar.
// Las cards validadas de cada respuesta se guardan con el turno (storedCards.ts): al recargar se
// vuelven a pintar con sus botones, y un precio que ya no es "en vivo" sale como precio guardado.

import { restoreStoredCards } from "../../supabase/functions/concierge-chat/storedCards.ts";
import type { ConciergeCard } from "../../supabase/functions/concierge-chat/cards.ts";

export type RestoredMsg = {
  id: string; role: "user" | "assistant"; text: string; ts: number; restored: true;
  cards?: ConciergeCard[]; tripId?: string | null;
};

type MinimalClient = { from: (table: string) => any };

/** Turnos guardados → mensajes del chat (los últimos `max`, sin vacíos ni roles desconocidos). */
export function restoreConversation(messages: unknown, max = 20, now: Date | number = Date.now()): RestoredMsg[] {
  const list = Array.isArray(messages) ? messages : [];
  return list
    .filter((m: any) => m && (m.role === "user" || m.role === "assistant"))
    .map((m: any, i: number) => {
      const text = typeof m.content === "string" ? m.content : m.content == null ? "" : JSON.stringify(m.content);
      const t = m.timestamp ? new Date(m.timestamp).getTime() : NaN;
      const msg: RestoredMsg = { id: `hist-${i}`, role: m.role, text: text.trim(), ts: Number.isFinite(t) ? t : 0, restored: true as const };
      if (m.role === "assistant") {
        const cards = restoreStoredCards(m.cards, now);
        if (cards.length) msg.cards = cards;
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
    return restoreConversation((data as { messages?: unknown }).messages, max).map((m) => (m.cards ? { ...m, tripId } : m));
  } catch {
    return [];
  }
}
