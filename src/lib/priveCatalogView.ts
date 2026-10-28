/**
 * Textos y reglas de presentación del catálogo de IATOS Privé (lógica pura, probada en
 * src/test/priveCatalogView.test.ts). Lo que la pantalla dice de cada estado, etiqueta, imagen y
 * cobertura sale de aquí, para que ninguna tarjeta prometa más de lo que el dato respalda.
 */
import type { PriveCoverage, PriveExperience, PriveLabel, PriveState, PriveUniverse } from "@/lib/priveCatalogApi";
import { zonedIso } from "../../supabase/functions/_shared/privePlanner";
import { PRIVE_LOCALE, PRIVE_TEXT, type PriveLang } from "@/lib/priveI18n";
import { PRIVE_DESTINATION_INDEX } from "@/lib/priveDestinationIndex";

const UNIVERSE_QUERIES: { key: PriveUniverse; imageQuery: string }[] = [
  { key: "the_table", imageQuery: "fine dining tasting menu plating" },
  { key: "after_dark", imageQuery: "candlelit cocktail bar night" },
  { key: "casino_grand_nights", imageQuery: "grand casino architecture chandelier" },
  { key: "yacht_sea", imageQuery: "luxury yacht harbour sunset" },
  { key: "private_stays", imageQuery: "boutique hotel suite terrace" },
  { key: "iconic_events", imageQuery: "gala event night lights" },
  { key: "culture_access", imageQuery: "museum gallery interior art" },
  { key: "wellness_escape", imageQuery: "luxury spa pool calm" },
  { key: "adventure_elite", imageQuery: "helicopter mountains adventure" },
  { key: "sport_leisure", imageQuery: "golf course sunrise" },
  { key: "celebrations", imageQuery: "romantic dinner celebration candles" },
  { key: "signature_mexico", imageQuery: "mexican artisan craft workshop" },
];
export type UniverseView = { key: PriveUniverse; title: string; name: string; sub: string; es: string; imageQuery: string; note?: string };
/** Universos con título (mayúsculas), nombre, descripción y nota en el idioma pedido. `es` = descripción. */
export const universesView = (lang: PriveLang = "es"): UniverseView[] => UNIVERSE_QUERIES.map((u) => {
  const t = PRIVE_TEXT[lang].universes[u.key];
  return { key: u.key, imageQuery: u.imageQuery, name: t.name, sub: t.sub, title: t.name.toLocaleUpperCase(PRIVE_LOCALE[lang]), es: t.desc, ...(t.note ? { note: t.note } : {}) };
});
export const UNIVERSES = universesView("es");
export const universeMeta = (k: string, lang: PriveLang = "es") => universesView(lang).find((u) => u.key === k) ?? null;

const tone: Record<PriveState, "ok" | "info" | "warn" | "muted"> = {
  VERIFICADO: "ok", CURADO: "info", ESTIMADO: "warn", DESACTUALIZADO: "muted", PENDIENTE: "muted", NO_DISPONIBLE: "muted",
};
export const stateText = (lang: PriveLang = "es"): Record<PriveState, { label: string; tone: "ok" | "info" | "warn" | "muted"; hint: string }> =>
  Object.fromEntries((Object.keys(tone) as PriveState[]).map((k) => [k, { ...PRIVE_TEXT[lang].catalog.state[k], tone: tone[k] }])) as Record<PriveState, { label: string; tone: "ok" | "info" | "warn" | "muted"; hint: string }>;
export const STATE_TEXT = stateText("es");

export const LABEL_TEXT: Record<PriveLabel, string> = PRIVE_TEXT.es.catalog.label;

/** Etiqueta + evidencia legible. Sin evidencia no hay etiqueta (null). */
export function labelWithEvidence(e: Pick<PriveExperience, "label" | "label_evidence" | "verified_at">, lang: PriveLang = "es"): { title: string; evidence: string } | null {
  if (!e.label) return null;
  const ev = (e.label_evidence ?? {}) as Record<string, unknown>;
  const T = PRIVE_TEXT[lang].catalog;
  const d = (v: unknown) => (v ? shortDate(String(v), lang) : null);
  switch (e.label) {
    case "EXPERIENCIA_CURADA":
      return { title: T.label.EXPERIENCIA_CURADA, evidence: T.evidence.curated(ev.sources, d(e.verified_at)) };
    case "PARTNER_VERIFICADO":
      if (!ev.partner) return null;
      return { title: T.label.PARTNER_VERIFICADO, evidence: T.evidence.partner(ev.partner, d(ev.valid_to)) };
    case "BENEFICIO_EXCLUSIVO":
      if (!ev.benefit) return null;
      return { title: T.label.BENEFICIO_EXCLUSIVO, evidence: T.evidence.benefit(ev.benefit, ev.conditions, d(ev.valid_to)) };
    case "EXPERIENCIA_PRIVADA":
      if (!ev.operator) return null;
      return { title: T.label.EXPERIENCIA_PRIVADA, evidence: T.evidence.privateOp(ev.operator, ev.conditions) };
    case "ACCESO_CONFIRMADO":
      return { title: T.label.ACCESO_CONFIRMADO, evidence: T.evidence.confirmed };
  }
  return null;
}

export const COVERAGE_TEXT: Record<PriveCoverage, string> = PRIVE_TEXT.es.browse.coverage;

export function shortDate(iso?: string | null, lang: PriveLang = "es"): string {
  if (!iso) return "";
  const d = new Date(String(iso).length <= 10 ? `${iso}T12:00:00Z` : String(iso));
  if (!Number.isFinite(d.getTime())) return "";
  return d.toLocaleDateString(PRIVE_LOCALE[lang], { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).replace(".", "");
}

/** Consultas de Pexels en orden: la del curador, "<subcategoría> <ciudad>", y la del universo. */
export function imageQueries(e: Pick<PriveExperience, "image" | "subcategory" | "destination" | "universe">): string[] {
  // La ciudad va en inglés (Pexels busca mejor así): "alta cocina Mónaco" → "alta cocina Monaco".
  const city = (e.destination?.slug && PRIVE_DESTINATION_INDEX[e.destination.slug]?.en) || e.destination?.name || "";
  const out = [e.image?.query, `${(e.subcategory ?? "").replace(/_/g, " ")} ${city}`.trim(), universeMeta(e.universe)?.imageQuery]
    .map((q) => (q ?? "").trim().slice(0, 100)).filter(Boolean);
  return [...new Set(out)];
}

/** Crédito obligatorio. Una foto de Pexels es ilustrativa salvo que una persona confirme que es el lugar. */
export function pexelsCredit(photographer: string | null | undefined, illustrative = true, lang: PriveLang = "es"): string {
  return PRIVE_TEXT[lang].common.photoCredit(photographer, illustrative);
}

/** Precio honesto: solo con fuente; si no, "precio por confirmar" con el nivel relativo. */
export function priceText(e: Pick<PriveExperience, "price" | "price_level" | "price_note">, lang: PriveLang = "es"): string {
  const P = PRIVE_TEXT[lang].catalog.price;
  if (e.price?.source && (e.price.min != null || e.price.max != null)) {
    const r = e.price.min != null && e.price.max != null && e.price.max !== e.price.min ? `${e.price.min}–${e.price.max}` : `${e.price.min ?? e.price.max}`;
    return `${r} ${e.price.currency ?? ""}${e.price.basis === "por_persona" || e.price.basis === "menu_degustacion" ? P.perPerson : ""}${P.bySource}${e.price.stale ? P.stale : ""}`.replace(/\s+/g, " ").trim();
  }
  return `${P.tbc}${e.price_level ? P.level("$".repeat(e.price_level)) : ""}`;
}

export function hoursText(e: Pick<PriveExperience, "opening_hours">, lang: PriveLang = "es"): string {
  return e.opening_hours?.source ? PRIVE_TEXT[lang].catalog.hoursOfficial : PRIVE_TEXT[lang].catalog.hoursTbc;
}

export function seasonText(e: Pick<PriveExperience, "season">, lang: PriveLang = "es"): string | null {
  const s = e.season;
  if (!s) return null;
  const S = PRIVE_TEXT[lang].catalog.season;
  if (s.state === "cerrado_por_temporada") return S.closed(s.reopens_on ? shortDate(s.reopens_on, lang) : null, s.note ?? null);
  if (s.state === "en_temporada") return S.open(s.closes_on ? shortDate(s.closes_on, lang) : null);
  return s.note ?? null;
}

/**
 * Fecha de un evento de Iconic Events (P1-9, auditoría 28-oct): el catálogo tenía eventos sin
 * event_start y el universo prometía "con fecha". Con fecha se muestra; sin ella se dice que está por
 * confirmar. En otros universos no se dice nada.
 */
export function eventDateText(e: Pick<PriveExperience, "universe" | "event_start" | "event_end">, lang: PriveLang = "es"): string | null {
  const C = PRIVE_TEXT[lang].catalog;
  if (e.event_start) {
    const from = shortDate(e.event_start, lang);
    if (from) return C.eventDate(from, e.event_end ? shortDate(e.event_end, lang) : null);
  }
  return e.universe === "iconic_events" ? C.eventTbc : null;
}

/** Eventos con fecha primero (los más próximos antes); los que no la tienen, al final, en su orden. */
export function datedEventsFirst<T extends Pick<PriveExperience, "event_start">>(items: T[]): T[] {
  return items
    .map((e, i) => ({ e, i }))
    .sort((a, b) => {
      const da = a.e.event_start ?? null, db = b.e.event_start ?? null;
      if (da && db) return da < db ? -1 : da > db ? 1 : a.i - b.i;
      if (da) return -1;
      if (db) return 1;
      return a.i - b.i;
    })
    .map((x) => x.e);
}

/** Puede pedirse solo lo publicable; nunca lo pendiente, desactualizado o no disponible. */
export const canRequest = (e: Pick<PriveExperience, "state">) => e.state === "VERIFICADO" || e.state === "CURADO" || e.state === "ESTIMADO";

export const AGE_TEXT: Record<string, string> = PRIVE_TEXT.es.catalog.ageText;

/**
 * Fecha y hora pedidas en una solicitud, en la hora local del destino y con su desfase
 * ("2026-11-13T20:30:00+01:00" en Mónaco). Sin zona, el servidor leía "20:30" como UTC y el equipo
 * veía una hora corrida (una hora en Mónaco, nueve en Tokio). Sin fecha no se pide hora.
 */
export function requestedForIso(date: string, time: string, timeZone?: string | null): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  return zonedIso(date, /^\d{2}:\d{2}$/.test(time) ? time : "20:00", timeZone);
}
