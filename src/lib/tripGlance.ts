// "Tu viaje en 30 segundos" y el resumen de una línea de cada día (feedback de Álvaro, 28-oct-2026:
// "hay partes que tienen demasiado texto en los itinerarios; pondría el texto como está, pero hasta
// arriba 2-3 bullet points que te den un summary rápido").
//
// Todo sale de lo que el viaje ya tiene: destino, fechas, viajeros, experiencias del plan, títulos y
// texto de los días, y el MISMO total que muestra la página (con su etiqueta: estimado, de tu selección
// o ya comprado). Aquí no se calcula ningún precio ni se escribe nada que el viaje no diga.
import { formatTripDateRange } from "@/lib/localDate";
import { listaHumana } from "@/lib/tripTotal";

export type GlanceBullet = { key: "viaje" | "destacado" | "costo"; text: string };

/** El total tal como lo muestra la página (RealTripTotal y tripTotalSummary), sin recalcular nada. */
export type GlanceTotal = {
  /** La cifra grande de la página (MXN). */
  amount: number;
  /** "Total estimado" · "Total de tu selección". */
  title: string;
  /** La misma marca "aproximado" de la tarjeta del total. */
  estimated: boolean;
  /** Viajeros con que se cotizó (los de la tarjeta del total). */
  travelers: number;
  /** Lo que falta elegir en Comprar ("vuelo", "hotel en Florencia"). */
  missing?: string[];
  /** Lo que la cotización dejó sin precio ("el vuelo"). */
  porCotizar?: string[];
  /** "comprado": ya hay compras marcadas o reservas confirmadas. */
  state?: "estimado" | "seleccion" | "comprado";
  paid?: number;
  pending?: number;
};

/** Qué puede decir la página del costo del viaje. */
export type GlanceCost =
  | { kind: "cotizado"; total: GlanceTotal }
  | { kind: "recotizar" }
  | { kind: "sin_cotizacion" }
  | { kind: "traido" }
  | { kind: "documento" };

export const fmtGlanceMXN = (n: number) => `$${Math.round(Number(n) || 0).toLocaleString("es-MX")} MXN`;

const norm = (v: unknown) =>
  String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

const clean = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim();

function itineraryDays(trip: any): any[] {
  const it = trip?.itinerario_json;
  const raw = Array.isArray(it) ? it : Array.isArray(it?.days) ? it.days : [];
  return raw.filter((d: any) => d && typeof d === "object");
}

function dayText(d: any): string {
  return [d?.["mañana"] ?? d?.manana, d?.tarde, d?.noche].map(clean).filter(Boolean).join(" ");
}

/** Lugares con nombre que el viaje ya tiene: experiencias, restaurantes y hoteles del plan. */
export function tripPlaceNames(trip: any): string[] {
  const names: string[] = [];
  for (const col of ["tours_json", "restaurantes_json", "hospedaje_json"]) {
    const arr = Array.isArray(trip?.[col]) ? trip[col] : [];
    for (const x of arr) {
      const n = clean(x?.nombre);
      if (n.length >= 3 && !names.some((m) => norm(m) === norm(n))) names.push(n);
    }
  }
  return names;
}

// Títulos de día que no dicen nada de lo que se hace ("Día libre", "Regreso").
// Tampoco los de llegada o vuelo («Llegada a Madrid y primer paseo…»): no son lo destacado y en viajes viejos
// pueden contradecir el vuelo (R3 viajes P1-1).
const GENERIC_TITLE = /^(d[ií]a libre|llegada|regreso|salida|traslado|vuelo de regreso|regreso a casa|d[ií]a \d+)\.?$|^(llegada|vuelo)\b/i;

/**
 * Lo más destacado del viaje (máximo `max`): las experiencias del plan, primero las que el itinerario
 * menciona; si el viaje no trae experiencias, los títulos de sus días.
 */
export function tripHighlights(trip: any, max = 3): string[] {
  const days = itineraryDays(trip).filter((d) => !d.pendiente);
  const allText = norm(days.map((d) => `${d.titulo ?? ""} ${dayText(d)}`).join(" "));
  const tours: string[] = [];
  for (const t of Array.isArray(trip?.tours_json) ? trip.tours_json : []) {
    const n = clean(t?.nombre);
    if (n.length >= 3 && !tours.some((m) => norm(m) === norm(n))) tours.push(n);
  }
  if (tours.length) {
    const mentioned = tours.filter((n) => allText.includes(norm(n)));
    const rest = tours.filter((n) => !mentioned.includes(n));
    return [...mentioned, ...rest].slice(0, max);
  }
  const titles: string[] = [];
  for (const d of days) {
    const t = clean(d.titulo);
    if (t && !GENERIC_TITLE.test(t) && !titles.some((m) => norm(m) === norm(t))) titles.push(t);
  }
  return titles.slice(0, max);
}

/** Primera frase corta de un texto: hasta el primer punto, punto y coma, dos puntos, coma, paréntesis o guion largo. */
export function firstClause(text: unknown, maxLen = 60): string {
  const t = clean(text);
  if (!t) return "";
  // "7:30" o "1.5 h" no cortan: el punto y los dos puntos solo cuentan seguidos de espacio.
  const cut = t.split(/\.(?=\s|$)|;|:(?=\s)|,|\(|\s[—–-]\s/)[0].trim();
  const s = cut || t;
  if (s.length <= maxLen) return s;
  const head = s.slice(0, maxLen - 1);
  const sp = head.lastIndexOf(" ");
  return `${(sp > maxLen * 0.5 ? head.slice(0, sp) : head).replace(/[\s,;:]+$/, "")}…`;
}

/**
 * Una línea que resume el día, arriba del detalle de mañana, tarde y noche: por cada parte del día, el
 * primer lugar del plan que menciona (experiencia, restaurante u hotel) o, si no menciona ninguno, su
 * primera frase corta. Nunca agrega nada que el día no diga.
 */
export function daySummaryLine(day: any, placeNames: string[] = []): string {
  if (!day || day.pendiente) return "";
  const names = placeNames.filter((n) => norm(n).length >= 4);
  const parts: string[] = [];
  for (const raw of [day?.["mañana"] ?? day?.manana, day?.tarde, day?.noche]) {
    const t = clean(raw);
    if (!t) continue;
    const nt = norm(t);
    const hit = names
      .map((name) => ({ name, at: nt.indexOf(norm(name)) }))
      .filter((p) => p.at >= 0)
      // Gana el que aparece primero; empatados, el nombre más largo ("Templo de Santo Domingo" sobre "Santo Domingo").
      .sort((a, b) => a.at - b.at || b.name.length - a.name.length)[0];
    const part = hit ? hit.name : firstClause(t, 50);
    if (part && !parts.some((x) => norm(x) === norm(part))) parts.push(part);
  }
  return parts.join(" · ");
}

function peopleLabel(n: number): string {
  return n === 1 ? "1 persona" : `${n} personas`;
}

function costText(cost: GlanceCost): string {
  switch (cost.kind) {
    case "recotizar":
      return "Costo: la cotización guardada tiene un error; vuelve a cotizar para ver el total.";
    case "sin_cotizacion":
      return "Costo: este viaje aún no tiene una cotización guardada.";
    case "traido":
      return "Vuelos y hotel ya los tienes: aquí solo suma lo que agregues.";
    case "documento":
      return "Viaje importado de tus documentos: abajo está lo que pagaste.";
    case "cotizado": {
      const t = cost.total;
      if (!(t.amount > 0)) return "Costo: este viaje aún no tiene una cotización guardada.";
      const head = `${t.title}: ${fmtGlanceMXN(t.amount)} para ${peopleLabel(Math.max(1, Math.round(t.travelers || 1)))}${t.estimated ? " (aproximado)" : ""}.`;
      if (t.state === "comprado" && (t.paid ?? 0) > 0) return `${head} Ya compraste ${fmtGlanceMXN(t.paid ?? 0)}; falta ${fmtGlanceMXN(t.pending ?? 0)}.`;
      if (t.missing?.length) return `${head} Falta elegir ${listaHumana(t.missing)} en Comprar.`;
      if (t.porCotizar?.length) return `${head} Falta cotizar ${listaHumana(t.porCotizar)}.`;
      return `${head} Ya elegiste lo principal: revisa y compra en Comprar.`;
    }
  }
}

/**
 * Los 2-3 puntos de "Tu viaje en 30 segundos": a dónde y cuándo, lo más destacado y cuánto cuesta (o
 * qué falta). El costo es el texto del total que la página ya muestra, con su misma etiqueta.
 */
export function tripGlance(trip: any, cost: GlanceCost): GlanceBullet[] {
  if (!trip) return [];
  const out: GlanceBullet[] = [];
  const it = trip.itinerario_json;
  const multi = !!(it && !Array.isArray(it) && it.multi);
  const dests: string[] = multi && Array.isArray(it.destinations) ? it.destinations.map(clean).filter(Boolean) : [];
  const place = dests.length > 1
    ? dests.join(" → ")
    : [clean(trip.destino), clean(trip.pais_destino)].filter((x, i, a) => x && (i === 0 || norm(x) !== norm(a[0]))).join(", ");
  const n = Number(trip.num_viajeros) || 0;
  const parts = [
    place,
    formatTripDateRange(trip.fecha_salida, trip.fecha_regreso),
    n > 0 ? (n === 1 ? "1 viajero" : `${n} viajeros`) : null,
  ].filter(Boolean);
  if (parts.length) out.push({ key: "viaje", text: parts.join(" · ") });
  const hl = tripHighlights(trip);
  if (hl.length) out.push({ key: "destacado", text: `Lo más destacado: ${listaHumana(hl)}.` });
  out.push({ key: "costo", text: costText(cost) });
  return out;
}
