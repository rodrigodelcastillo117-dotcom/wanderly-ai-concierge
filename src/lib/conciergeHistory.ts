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
import { stripDanglingFence } from "../../supabase/functions/concierge-chat/stream.ts";
import { localISODate } from "@/lib/localDate";

export type RestoredMsg = {
  id: string; role: "user" | "assistant"; text: string; ts: number; restored: true;
  cards?: ConciergeCard[]; tripId?: string | null; actions?: StoredAction[];
  /** Aviso (no es un mensaje de Iato ni se manda al modelo): "Conversación anterior resumida". */
  notice?: boolean;
  /**
   * Hilo guardado del que viene (concierge_conversations.trip_id; null = "sin viaje"). N4-P1-4: el chat
   * muestra los hilos recientes juntos y etiqueta cada bloque; al modelo solo se le manda el del viaje.
   */
  thread?: string | null;
};

/**
 * Auditoría 10, ronda 3 (N-P2-4): con más de 40 turnos el servidor resume lo anterior y guarda solo los
 * últimos; al recargar desaparecían preguntas sin aviso. Ahora el chat lo dice.
 */
export const SUMMARY_NOTICE_ID = "hist-resumen";
export const SUMMARY_NOTICE_TEXT = "Conversación anterior resumida: Iato recuerda lo importante que le dijiste; aquí ves los mensajes más recientes.";

export function summaryNotice(resumen: unknown, at?: unknown): RestoredMsg | null {
  if (typeof resumen !== "string" || !resumen.trim()) return null;
  // Ronda 4 (N4-P1-4): solo si hubo un resumen de verdad (el servidor fecha cada resumen que hace). Un
  // texto sin fecha no dice que se resumiera nada y el aviso hacía creer que se habían resumido preguntas
  // que en realidad estaban en otro hilo.
  const t = typeof at === "string" ? new Date(at).getTime() : NaN;
  if (!Number.isFinite(t)) return null;
  return { id: SUMMARY_NOTICE_ID, role: "assistant", text: SUMMARY_NOTICE_TEXT, ts: t, restored: true, notice: true };
}

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
        // N4-P2-1: un "```" suelto que quedó guardado al final de una respuesta ya no se ve al recargar.
        msg.text = stripDanglingFence(msg.text);
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
    const q = client.from("concierge_conversations").select("messages, updated_at, resumen_historico, resumen_actualizado_at").eq("user_id", userId);
    const { data, error } = await (tripId ? q.eq("trip_id", tripId) : q.is("trip_id", null))
      .order("updated_at", { ascending: false }).limit(1).maybeSingle();
    if (error || !data) return [];
    const row = data as { messages?: unknown; resumen_historico?: unknown; resumen_actualizado_at?: unknown };
    const restored = restoreConversation(row.messages, max).map((m) => (m.cards || m.actions ? { ...m, tripId } : m));
    const notice = restored.length ? summaryNotice(row.resumen_historico, row.resumen_actualizado_at) : null;
    return notice ? [notice, ...restored] : restored;
  } catch {
    return [];
  }
}

// ═══ Ronda 4 (N4-P1-4): los hilos recientes, juntos y en orden ═══
// Cada mensaje se guarda en el hilo del viaje que tenía en ese momento (una fila por trip_id). Antes el
// chat solo cargaba el del viaje en contexto: al recargar desaparecían "¿Qué hora es en Tokio?" (hilo sin
// viaje) o el chofer (hilo de Oaxaca) sin ningún aviso. Ahora se muestran los hilos recientes en orden
// cronológico, cada bloque con la etiqueta de su viaje. La memoria del modelo sigue por viaje: el servidor
// lee su hilo, y el chat solo le manda los mensajes restaurados del hilo del viaje en contexto.

export const RECENT_THREADS = 6;
export const RECENT_MAX = 40;
const PER_THREAD = 20;

type ThreadRow = { trip_id?: string | null; messages?: unknown; resumen_historico?: unknown; resumen_actualizado_at?: unknown };

type RestoredThread = { thread: string | null; msgs: RestoredMsg[] };

/** Fila guardada → hilo restaurado (con su aviso de resumen al frente, si hubo resumen de verdad). */
export function restoreThread(row: ThreadRow, opts: { perThread?: number; now?: Date | number; todayISO?: string } = {}): RestoredThread {
  const thread = row?.trip_id ?? null;
  const restored = restoreConversation(row?.messages, opts.perThread ?? PER_THREAD, opts.now, opts.todayISO)
    .map((m) => (m.cards || m.actions ? { ...m, tripId: thread } : m));
  const n = restored.length ? summaryNotice(row?.resumen_historico, row?.resumen_actualizado_at) : null;
  return { thread, msgs: n ? [n, ...restored] : restored };
}

/** Mezcla los hilos en orden cronológico (el orden dentro de cada hilo se respeta) y se queda con los últimos `max`. */
export function mergeThreads(threads: RestoredThread[], max = RECENT_MAX): RestoredMsg[] {
  const seen = new Set<string>();
  const items: Array<{ m: RestoredMsg; sortTs: number; order: number }> = [];
  const notices = new Map<string, RestoredMsg>();
  let order = 0;
  for (const t of threads) {
    const key = t.thread ?? "none";
    if (seen.has(key)) continue;
    seen.add(key);
    let prev = -Infinity;
    for (const r of t.msgs) {
      if (r.notice) { notices.set(key, { ...r, id: `${SUMMARY_NOTICE_ID}-${key}`, thread: t.thread }); continue; }
      // Sin fecha, el mensaje va justo después del anterior de su hilo.
      const sortTs = r.ts > 0 ? Math.max(r.ts, prev) : prev;
      prev = sortTs;
      items.push({ m: { ...r, id: `hist-${key}-${r.id.replace(/^hist-/, "")}`, thread: t.thread }, sortTs, order: order++ });
    }
  }
  items.sort((a, b) => (a.sortTs - b.sortTs) || (a.order - b.order));
  let list = items.slice(-max).map((x) => x.m);
  // No empieza con una respuesta cuya pregunta quedó fuera.
  while (list.length && list[0].role === "assistant") list = list.slice(1);
  // El aviso de resumen va justo antes del primer mensaje visible de su hilo.
  const out: RestoredMsg[] = [];
  const placed = new Set<string>();
  for (const m of list) {
    const key = m.thread ?? "none";
    const n = notices.get(key);
    if (n && !placed.has(key)) { out.push(n); placed.add(key); }
    out.push(m);
  }
  return out;
}

/**
 * Conversaciones recientes de todos los hilos del usuario (sin viaje y de cada viaje), mezcladas en orden.
 * Nunca lanza: si la lista falla, queda al menos el hilo del viaje en contexto, como antes.
 */
export async function loadRecentConversations(client: MinimalClient, userId: string, currentTripId: string | null, opts: { threads?: number; max?: number } = {}): Promise<RestoredMsg[]> {
  const listP = (async (): Promise<ThreadRow[]> => {
    try {
      const res = await client.from("concierge_conversations")
        .select("trip_id, messages, updated_at, resumen_historico, resumen_actualizado_at")
        .eq("user_id", userId).order("updated_at", { ascending: false }).limit(opts.threads ?? RECENT_THREADS);
      return !res?.error && Array.isArray(res?.data) ? (res.data as ThreadRow[]) : [];
    } catch {
      return [];
    }
  })();
  const [current, rows] = await Promise.all([loadConversation(client, userId, currentTripId), listP]);
  const others = rows.filter((r) => (r?.trip_id ?? null) !== currentTripId).map((r) => restoreThread(r));
  if (!others.some((t) => t.msgs.length)) return current.map((m) => ({ ...m, thread: currentTripId }));
  // El hilo del viaje en contexto: el de la lista si vino en ella; si no (es más viejo), el que se cargó aparte.
  const currentRow = rows.find((r) => (r?.trip_id ?? null) === currentTripId);
  const mine = currentRow ? restoreThread(currentRow) : { thread: currentTripId, msgs: current };
  return mergeThreads([mine, ...others], opts.max ?? RECENT_MAX);
}

/** Clave de hilo de cada mensaje del chat: restaurado → su hilo; nuevo → el viaje de la respuesta. */
type ThreadedMsg = { id: string; role: "user" | "assistant"; thread?: string | null; tripId?: string | null; notice?: boolean };
const threadKeyOf = (msgs: ThreadedMsg[], i: number): string | null | undefined => {
  const m = msgs[i];
  if (m.thread !== undefined) return m.thread;
  if (m.id === "welcome") return undefined;
  if (m.role === "assistant") return m.tripId === undefined ? undefined : m.tripId;
  for (let j = i + 1; j < msgs.length; j++) {
    if (msgs[j].role === "assistant" && !msgs[j].notice) return threadKeyOf(msgs, j);
    if (msgs[j].role === "user") break;
  }
  return undefined;
};

/**
 * Dónde va la etiqueta de viaje ("Oaxaca", "Sin viaje"): al empezar cada bloque de un hilo distinto.
 * Solo si el historial tiene más de un hilo (con uno solo, el selector ya dice de qué viaje es).
 * Devuelve id del mensaje → hilo (null = sin viaje).
 */
export function threadLabels(msgs: ThreadedMsg[]): Map<string, string | null> {
  const keys: Array<string | null | undefined> = msgs.map((_, i) => threadKeyOf(msgs, i));
  const distinct = new Set(keys.filter((k) => k !== undefined).map((k) => k ?? "none"));
  const out = new Map<string, string | null>();
  if (distinct.size < 2) return out;
  let last: string | null | undefined;
  msgs.forEach((m, i) => {
    const k = keys[i];
    if (k === undefined) return;
    if (k !== last) out.set(m.id, k);
    last = k;
  });
  return out;
}

/** Al modelo solo van los mensajes restaurados del hilo del viaje en contexto (su memoria es por viaje). */
export function historyForModel<T extends { thread?: string | null }>(msgs: T[], currentTripId: string | null): T[] {
  return msgs.filter((m) => m.thread === undefined || m.thread === currentTripId);
}
