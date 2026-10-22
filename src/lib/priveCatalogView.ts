/**
 * Textos y reglas de presentación del catálogo de IATOS Privé (lógica pura, probada en
 * src/test/priveCatalogView.test.ts). Lo que la pantalla dice de cada estado, etiqueta, imagen y
 * cobertura sale de aquí, para que ninguna tarjeta prometa más de lo que el dato respalda.
 */
import type { PriveCoverage, PriveExperience, PriveLabel, PriveState, PriveUniverse } from "@/lib/priveCatalogApi";
import { zonedIso } from "../../supabase/functions/_shared/privePlanner";

export const UNIVERSES: { key: PriveUniverse; title: string; es: string; imageQuery: string; note?: string }[] = [
  { key: "the_table", title: "THE TABLE", es: "Mesas de autor, alta cocina y chef's tables", imageQuery: "fine dining tasting menu plating" },
  { key: "after_dark", title: "AFTER DARK", es: "Coctelería, jazz, rooftops y clubes", imageQuery: "candlelit cocktail bar night" },
  { key: "casino_grand_nights", title: "CASINO & GRAND NIGHTS", es: "Casinos con licencia: arquitectura, historia y reglas de entrada", imageQuery: "grand casino architecture chandelier",
    note: "Información práctica. IATOS no promueve ni intermedia apuestas. Juega con responsabilidad." },
  { key: "yacht_sea", title: "YACHT & SEA", es: "Navegación, yates y costas", imageQuery: "luxury yacht harbour sunset" },
  { key: "private_stays", title: "PRIVATE STAYS", es: "Estancias, villas y hoteles de autor", imageQuery: "boutique hotel suite terrace" },
  { key: "iconic_events", title: "ICONIC EVENTS", es: "Eventos y temporadas con fecha", imageQuery: "gala event night lights" },
  { key: "culture_access", title: "CULTURE & ACCESS", es: "Arte, museos y cultura", imageQuery: "museum gallery interior art" },
  { key: "wellness_escape", title: "WELLNESS & ESCAPE", es: "Spa, bienestar y retiros", imageQuery: "luxury spa pool calm" },
  { key: "adventure_elite", title: "ADVENTURE ELITE", es: "Aventura con operadores autorizados y requisitos de seguridad", imageQuery: "helicopter mountains adventure",
    note: "Solo operadores autorizados; revisa los requisitos de seguridad antes de solicitar." },
  { key: "sport_leisure", title: "SPORT & LEISURE", es: "Golf, tenis, esquí y deporte", imageQuery: "golf course sunrise" },
  { key: "celebrations", title: "CELEBRATIONS", es: "Celebraciones y momentos especiales", imageQuery: "romantic dinner celebration candles" },
  { key: "signature_mexico", title: "SIGNATURE MEXICO", es: "Lo auténtico de México: cocina, cultura y artesanos", imageQuery: "mexican artisan craft workshop" },
];
export const universeMeta = (k: string) => UNIVERSES.find((u) => u.key === k) ?? null;

export const STATE_TEXT: Record<PriveState, { label: string; tone: "ok" | "info" | "warn" | "muted"; hint: string }> = {
  VERIFICADO: { label: "Verificado", tone: "ok", hint: "Revisado en el sitio oficial y en una muestra humana" },
  CURADO: { label: "Curado", tone: "info", hint: "Curado: pendiente de verificación en sitio oficial" },
  ESTIMADO: { label: "Estimado", tone: "warn", hint: "Un dato práctico (precio, horario o reserva) es estimado" },
  DESACTUALIZADO: { label: "Por verificar", tone: "muted", hint: "La última revisión tiene más de 90 días" },
  PENDIENTE: { label: "Pendiente", tone: "muted", hint: "Sin revisar: no se publica" },
  NO_DISPONIBLE: { label: "No disponible", tone: "muted", hint: "Cerrado, fuera de temporada o evento pasado" },
};

export const LABEL_TEXT: Record<PriveLabel, string> = {
  EXPERIENCIA_CURADA: "Experiencia curada",
  PARTNER_VERIFICADO: "Partner verificado",
  BENEFICIO_EXCLUSIVO: "Beneficio para miembros",
  EXPERIENCIA_PRIVADA: "Experiencia privada",
  ACCESO_CONFIRMADO: "Acceso confirmado",
};

/** Etiqueta + evidencia legible. Sin evidencia no hay etiqueta (null). */
export function labelWithEvidence(e: Pick<PriveExperience, "label" | "label_evidence" | "verified_at">): { title: string; evidence: string } | null {
  if (!e.label) return null;
  const ev = (e.label_evidence ?? {}) as Record<string, unknown>;
  switch (e.label) {
    case "EXPERIENCIA_CURADA":
      return { title: LABEL_TEXT.EXPERIENCIA_CURADA, evidence: `Lugar público seleccionado por IATOS con ${ev.sources ?? 1} fuente(s)${e.verified_at ? `, revisado el ${shortDate(e.verified_at)}` : ""}. IATOS no tiene acuerdo comercial con el lugar.` };
    case "PARTNER_VERIFICADO":
      if (!ev.partner) return null;
      return { title: LABEL_TEXT.PARTNER_VERIFICADO, evidence: `Acuerdo documentado con ${ev.partner}${ev.valid_to ? `, vigente hasta el ${shortDate(String(ev.valid_to))}` : ""}.` };
    case "BENEFICIO_EXCLUSIVO":
      if (!ev.benefit) return null;
      return { title: LABEL_TEXT.BENEFICIO_EXCLUSIVO, evidence: `${ev.benefit}. Condiciones: ${ev.conditions ?? "según el acuerdo"}${ev.valid_to ? ` (vigente hasta el ${shortDate(String(ev.valid_to))})` : ""}.` };
    case "EXPERIENCIA_PRIVADA":
      if (!ev.operator) return null;
      return { title: LABEL_TEXT.EXPERIENCIA_PRIVADA, evidence: `Operada por ${ev.operator}. ${ev.conditions ?? ""}`.trim() };
    case "ACCESO_CONFIRMADO":
      return { title: LABEL_TEXT.ACCESO_CONFIRMADO, evidence: "El proveedor confirmó esta solicitud." };
  }
  return null;
}

export const COVERAGE_TEXT: Record<PriveCoverage, string> = {
  PILOTO_VERIFICADO: "Selección IATOS Privé",
  COBERTURA_PARCIAL: "Selección en crecimiento",
  DESCUBRIMIENTO_BAJO_DEMANDA: "Aún no curamos este destino: Iato puede buscar opciones en vivo, no verificadas por IATOS",
  SIN_COBERTURA_VERIFICADA: "Aún no tenemos selección verificada para este destino",
};

export function shortDate(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(String(iso).length <= 10 ? `${iso}T12:00:00Z` : String(iso));
  if (!Number.isFinite(d.getTime())) return "";
  return d.toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).replace(".", "");
}

/** Consultas de Pexels en orden: la del curador, "<subcategoría> <ciudad>", y la del universo. */
export function imageQueries(e: Pick<PriveExperience, "image" | "subcategory" | "destination" | "universe">): string[] {
  const out = [e.image?.query, `${(e.subcategory ?? "").replace(/_/g, " ")} ${e.destination?.name ?? ""}`.trim(), universeMeta(e.universe)?.imageQuery]
    .map((q) => (q ?? "").trim().slice(0, 100)).filter(Boolean);
  return [...new Set(out)];
}

/** Crédito obligatorio. Una foto de Pexels es ilustrativa salvo que una persona confirme que es el lugar. */
export function pexelsCredit(photographer: string | null | undefined, illustrative = true): string {
  return `${illustrative ? "Foto ilustrativa" : "Foto del lugar"} · Pexels${photographer ? ` · ${photographer}` : ""}`;
}

/** Precio honesto: solo con fuente; si no, "precio por confirmar" con el nivel relativo. */
export function priceText(e: Pick<PriveExperience, "price" | "price_level" | "price_note">): string {
  if (e.price?.source && (e.price.min != null || e.price.max != null)) {
    const r = e.price.min != null && e.price.max != null && e.price.max !== e.price.min ? `${e.price.min}–${e.price.max}` : `${e.price.min ?? e.price.max}`;
    return `${r} ${e.price.currency ?? ""}${e.price.basis === "por_persona" || e.price.basis === "menu_degustacion" ? " por persona" : ""} · según la fuente${e.price.stale ? " (revisión de precio vencida)" : ""}`.replace(/\s+/g, " ").trim();
  }
  return `Precio por confirmar${e.price_level ? ` · nivel ${"$".repeat(e.price_level)}` : ""}`;
}

export function hoursText(e: Pick<PriveExperience, "opening_hours">): string {
  return e.opening_hours?.source ? "Horario según el sitio oficial" : "Horario por confirmar";
}

export function seasonText(e: Pick<PriveExperience, "season">): string | null {
  const s = e.season;
  if (!s) return null;
  if (s.state === "cerrado_por_temporada") return `Cerrado por temporada${s.reopens_on ? ` · reabre el ${shortDate(s.reopens_on)}` : ""}${s.note ? ` · ${s.note}` : ""}`;
  if (s.state === "en_temporada") return `En temporada${s.closes_on ? ` hasta el ${shortDate(s.closes_on)}` : ""}`;
  return s.note ?? null;
}

/** Puede pedirse solo lo publicable; nunca lo pendiente, desactualizado o no disponible. */
export const canRequest = (e: Pick<PriveExperience, "state">) => e.state === "VERIFICADO" || e.state === "CURADO" || e.state === "ESTIMADO";

export const AGE_TEXT: Record<string, string> = { todas: "Todas las edades", "18+": "Solo mayores de 18", "21+": "Solo mayores de 21" };

/**
 * Fecha y hora pedidas en una solicitud, en la hora local del destino y con su desfase
 * ("2026-11-13T20:30:00+01:00" en Mónaco). Sin zona, el servidor leía "20:30" como UTC y el equipo
 * veía una hora corrida (una hora en Mónaco, nueve en Tokio). Sin fecha no se pide hora.
 */
export function requestedForIso(date: string, time: string, timeZone?: string | null): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  return zonedIso(date, /^\d{2}:\d{2}$/.test(time) ? time : "20:00", timeZone);
}
