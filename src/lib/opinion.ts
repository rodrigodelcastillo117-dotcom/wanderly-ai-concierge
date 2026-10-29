// Opiniones ("¿Algo no se entiende? Cuéntanos"), lado de la app: qué se adjunta solo (y se le dice al
// usuario), el envío a la función enviar-opinion y estados honestos (enviada, sin conexión, error).
// La validación y la pantalla las decide el servidor (supabase/functions/_shared/opinion.ts).
import { supabase } from "@/integrations/supabase/client";
import { readFunctionError } from "@/lib/functionErrors";
import { currentMainBundle } from "@/lib/versionCheck";
import {
  OPINION_MAX, OPINION_MIN, OPINION_TYPE_LABEL, OPINION_TYPES, type OpinionType, sanitizeRoute, screenName, tripIdFromRoute,
} from "../../supabase/functions/_shared/opinion.ts";
import { newIdemKey } from "../../supabase/functions/_shared/idempotency.ts";

export { OPINION_MAX, OPINION_MIN, OPINION_TYPE_LABEL, OPINION_TYPES, type OpinionType };

export type OpinionContext = {
  ruta: string | null;
  pantalla: string | null;
  dispositivo: "celular" | "escritorio";
  version: string | null;
  trip_id: string | null;
};

/** "index-AbC123" del paquete principal publicado (en desarrollo no hay: null). */
export function appVersion(doc: Document = document): string | null {
  const b = currentMainBundle(doc);
  const m = b ? /\/assets\/(index-[A-Za-z0-9_-]+)\.js$/.exec(b) : null;
  return m ? m[1] : null;
}

/** Celular o escritorio, por el ancho de la pantalla (lo mismo que decide la barra inferior). */
export function deviceKind(win: Pick<Window, "matchMedia"> | undefined = typeof window !== "undefined" ? window : undefined): "celular" | "escritorio" {
  try {
    return win && typeof win.matchMedia === "function" && win.matchMedia("(min-width: 1024px)").matches ? "escritorio" : "celular";
  } catch {
    return "celular";
  }
}

/** Lo que se adjunta solo. Nada de capturas ni datos personales: ruta, pantalla, dispositivo, versión y viaje. */
export function opinionContext(pathname: string): OpinionContext {
  const ruta = sanitizeRoute(pathname);
  return { ruta, pantalla: screenName(ruta), dispositivo: deviceKind(), version: appVersion(), trip_id: tripIdFromRoute(ruta) };
}

/** Renglones que ve el usuario antes de enviar ("Se adjunta: …"). */
export function contextLines(c: OpinionContext): string[] {
  // Los id largos se acortan en pantalla (se envían completos).
  const ruta = c.ruta ? c.ruta.replace(/([0-9a-f]{8})-[0-9a-f-]{27}/gi, "$1…") : null;
  return [
    `Pantalla: ${c.pantalla ? `${c.pantalla} (${ruta})` : ruta ?? "—"}`,
    `Dispositivo: ${c.dispositivo === "celular" ? "Celular" : "Escritorio"}`,
    c.version ? `Versión de la app: ${c.version}` : null,
    c.trip_id ? `Viaje: el que tienes abierto (id ${c.trip_id.slice(0, 8)}…)` : null,
  ].filter((x): x is string => !!x);
}

export type OpinionDraft = { tipo: OpinionType | null; texto: string; calificacion: number | null; contactar: boolean };

/** El mismo criterio que el servidor, para avisar antes de enviar. */
export function draftProblem(d: OpinionDraft): string | null {
  if (!d.tipo) return "Elige qué nos quieres contar.";
  const t = d.texto.trim();
  if (t.length < OPINION_MIN) return "Escribe qué pasó o qué te gustaría (al menos unas palabras).";
  if (t.length > OPINION_MAX) return `Máximo ${OPINION_MAX} caracteres.`;
  return null;
}

export type SendResult =
  | { ok: true; folio: string; teamNotified: boolean }
  | { ok: false; kind: "offline" | "rate_limited" | "invalid" | "session" | "error"; message: string };

const INVALID_TEXT: Record<string, string> = {
  INVALID_TYPE: "Elige qué nos quieres contar.",
  TEXT_REQUIRED: "Escribe qué pasó o qué te gustaría (al menos unas palabras).",
  TEXT_TOO_LONG: `Máximo ${OPINION_MAX} caracteres.`,
  INVALID_RATING: "La calificación va de 1 a 5.",
  INVALID: "Revisa lo que escribiste e inténtalo de nuevo.",
};
const OFFLINE = "Estás sin conexión. Tu opinión no se envió: sigue aquí escrita; vuelve a intentarlo cuando tengas internet.";

const isOffline = () => typeof navigator !== "undefined" && navigator.onLine === false;

/**
 * Envía la opinión. `idemKey` se conserva entre reintentos del MISMO envío: si la red se cae después de
 * guardarla, reintentar no la duplica.
 */
export async function sendOpinion(d: OpinionDraft & { tipo: OpinionType }, ctx: OpinionContext, idemKey: string): Promise<SendResult> {
  if (isOffline()) return { ok: false, kind: "offline", message: OFFLINE };
  let data: unknown, error: unknown;
  try {
    ({ data, error } = await supabase.functions.invoke("enviar-opinion", {
      body: {
        tipo: d.tipo, texto: d.texto.trim(), calificacion: d.calificacion, contactar: d.contactar,
        ruta: ctx.ruta, dispositivo: ctx.dispositivo, version: ctx.version, trip_id: ctx.trip_id, idempotency_key: idemKey,
      },
    }));
  } catch (e) {
    error = e;
  }
  if (error) {
    const info = await readFunctionError(error, "No pudimos enviar tu opinión. Inténtalo de nuevo en un momento.");
    const name = (error as { name?: string })?.name;
    if (isOffline() || (name === "FunctionsFetchError" && info.status === null)) return { ok: false, kind: "offline", message: OFFLINE };
    if (info.status === 401) return { ok: false, kind: "session", message: info.message };
    if (info.status === 429) return { ok: false, kind: "rate_limited", message: info.message };
    if (info.status === 400) return { ok: false, kind: "invalid", message: INVALID_TEXT[info.code ?? ""] ?? INVALID_TEXT.INVALID };
    return { ok: false, kind: "error", message: info.message };
  }
  const r = (data ?? {}) as { ok?: boolean; folio?: string; team_notified?: boolean };
  if (!r.ok || !r.folio) return { ok: false, kind: "error", message: "No pudimos enviar tu opinión. Inténtalo de nuevo en un momento." };
  return { ok: true, folio: r.folio, teamNotified: r.team_notified === true };
}

export { newIdemKey };

// ───────────────────────────── abrir el diálogo desde cualquier pantalla ─────────────────────────────
// El menú, el pie de página y el perfil llaman openOpinion(); el diálogo vive una sola vez en el layout.
type Listener = () => void;
const listeners = new Set<Listener>();
export function openOpinion(): void {
  listeners.forEach((l) => l());
}
export function onOpenOpinion(l: Listener): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}
