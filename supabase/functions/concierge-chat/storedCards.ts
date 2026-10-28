// Cards de Iato guardadas en el historial (concierge_conversations.messages, jsonb) para que al
// recargar el chat se vuelvan a pintar con sus botones (E2E 28-oct-2026: al recargar solo quedaba el
// texto). Sin Deno: lo usan concierge-chat (al guardar) y el cliente (al restaurar).
//
// Reglas:
//   - Se guardan SOLO las cards que ya validó el servidor en ese turno (validateCards / eventCards /
//     tourCards / enrichCardLinks): aquí no se agrega nada, solo se vuelve a limpiar (tipos, llaves
//     conocidas, largos, enlaces https/tel/wa.me) y se pone un tope de cantidad y de tamaño.
//   - Al restaurar, un precio cuya consulta ya no es "en vivo" (EN_VIVO_MAX_MINUTES) se marca como
//     precio guardado con su fecha y hora de consulta: nunca sale "consultado en vivo" horas después.

import { CARD_TYPES, safeCardLink, safeHttpsUrl, type CardLink, type CardType, type ConciergeCard, type EstadoDato } from "./cards.ts";
import { frescuraPrecio } from "../_shared/priceFreshness.ts";

/** Máximo de cards por mensaje guardado (8 del modelo/planeador + eventos/tours de la búsqueda). */
export const MAX_STORED_CARDS = 12;
/** Tope de tamaño (JSON) de las cards de un mensaje: si no caben, se quitan las últimas. */
export const MAX_STORED_CARDS_BYTES = 12_000;

const STR_FIELDS: Partial<Record<keyof ConciergeCard, number>> = {
  title: 140, subtitle: 160, meta: 200, body: 600, cta_label: 40, provider: 60, from: 120, to: 120, route: 120,
  fbo: 120, status: 160, currency: 3, fuente: 60, consultado_at: 40, price_note: 200, price_basis: 80,
  photo_ref: 600, place_id: 300, address: 200, event_date: 10, event_time: 5, booking_note: 200,
};
const NUM_FIELDS: (keyof ConciergeCard)[] = ["rating", "price", "price_usd", "lat", "lng"];
const ESTADOS: EstadoDato[] = ["CONSULTADO_EN_VIVO", "NO_VERIFICADO", "SOLICITUD_HUMANA", "OBSOLETO"];

const str = (v: unknown, max: number) => {
  if (typeof v !== "string") return undefined;
  const s = v.replace(/\s+/g, " ").trim();
  return s ? s.slice(0, max) : undefined;
};

/** Una card limpia (o null): solo llaves conocidas, enlaces seguros y números finitos. */
function cleanCard(raw: unknown): ConciergeCard | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const type = String(r.type ?? "").toLowerCase() as CardType;
  if (!CARD_TYPES.includes(type)) return null;
  const title = str(r.title, 140);
  if (!title) return null;
  const card: ConciergeCard = { type, title };
  for (const [k, max] of Object.entries(STR_FIELDS) as [keyof ConciergeCard, number][]) {
    if (k === "title") continue;
    const v = str(r[k as string], max);
    if (v) (card as any)[k] = v;
  }
  if (card.currency && !/^[A-Z]{3}$/.test(card.currency)) delete card.currency;
  for (const k of NUM_FIELDS) {
    const v = r[k as string];
    if (typeof v === "number" && Number.isFinite(v)) (card as any)[k] = v;
  }
  if (typeof r.estado_dato === "string" && ESTADOS.includes(r.estado_dato as EstadoDato)) card.estado_dato = r.estado_dato as EstadoDato;
  const cta = safeHttpsUrl(r.cta_action);
  if (cta) card.cta_action = cta;
  const img = safeHttpsUrl(r.image_url);
  if (img) card.image_url = img;
  const links = (Array.isArray(r.links) ? r.links : []).map(safeCardLink).filter(Boolean) as CardLink[];
  if (links.length) card.links = links.slice(0, 5);
  return card;
}

const byteLen = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).length;

/**
 * Cards validadas del turno → lo que se guarda junto al texto del asistente. undefined si no hay
 * (así el turno guardado queda igual que antes). Un precio sin fecha de consulta lleva la del turno.
 */
export function cardsForStorage(cards: unknown, turnAt: string = new Date().toISOString(), maxBytes = MAX_STORED_CARDS_BYTES): ConciergeCard[] | undefined {
  const out = (Array.isArray(cards) ? cards : []).map(cleanCard).filter(Boolean).slice(0, MAX_STORED_CARDS) as ConciergeCard[];
  for (const c of out) if (typeof c.price === "number" && !c.consultado_at) c.consultado_at = turnAt;
  while (out.length && byteLen(out) > maxBytes) out.pop();
  return out.length ? out : undefined;
}

const fechaConsulta = (iso: string | undefined) => {
  const at = iso ? new Date(iso) : null;
  return at && Number.isFinite(at.getTime())
    ? at.toLocaleString("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
    : null;
};

/**
 * Cards guardadas → cards para pintar al recargar. Se limpian otra vez (el historial es editable por
 * su dueño) y los precios que ya no son "en vivo" quedan como precio guardado con su hora de consulta.
 */
export function restoreStoredCards(raw: unknown, now: Date | number = Date.now()): ConciergeCard[] {
  const cards = (Array.isArray(raw) ? raw : []).map(cleanCard).filter(Boolean).slice(0, MAX_STORED_CARDS) as ConciergeCard[];
  return cards.map((c) => {
    const priced = typeof c.price === "number" || typeof c.price_usd === "number";
    if (!priced) return c;
    const fr = frescuraPrecio({ estado: c.estado_dato, consultadoAt: c.consultado_at ?? null }, now);
    if (fr.frescura === "en_vivo") return c;
    if (c.estado_dato === "CONSULTADO_EN_VIVO" || c.estado_dato === "OBSOLETO") {
      // savedPrice/ProvenanceBadge: "Precio guardado · 28 oct, 09:12 · verifícalo".
      return { ...c, estado_dato: "OBSOLETO", price_note: "precio guardado" };
    }
    if (c.type === "tour" || c.type === "event") {
      // Tours y eventos no llevan estado_dato: la nota del precio dice que es de una consulta anterior.
      const f = fechaConsulta(c.consultado_at);
      const note = `Precio guardado${f ? ` (consultado ${f})` : ""} · verifícalo`;
      return { ...c, price_note: c.price_note ? `${note} · ${c.price_note}`.slice(0, 200) : note };
    }
    return c;
  });
}
