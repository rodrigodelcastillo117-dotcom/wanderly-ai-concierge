// Operador IATOS · reglas deterministas (no dependen del modelo): qué casos van a una persona de inmediato, el
// horario de atención del proveedor, el consentimiento del viajero, el costo de cada llamada al modelo y los
// filtros que impiden prometer de más o mandar datos que nadie verificó. Puro (sin Deno): probado con Vitest.
import { autorizaEnvio } from "../derechos/herramientas.ts";
import { normalizeText } from "../incident-detect.ts";

// ───────────────────────────── Escalar ya ─────────────────────────────
/** Categorías donde una persona del equipo debe estar desde el inicio (el operador ayuda, pero no lleva el caso). */
const SIEMPRE_HUMANO = new Set(["salud", "seguridad"]);
/** Con severidad crítica, además: robo, documentos, traslado de noche, etc. */
export function requiereHumanoYa(categoria: string, severidad: string): { si: boolean; motivo: string | null } {
  if (SIEMPRE_HUMANO.has(categoria)) return { si: true, motivo: categoria === "salud" ? "Salud o emergencia médica: lo lleva una persona" : "Seguridad del viajero: lo lleva una persona" };
  if (severidad === "critica") return { si: true, motivo: "Caso crítico: una persona del equipo lo acompaña desde el inicio" };
  return { si: false, motivo: null };
}

// ───────────────────────────── Horario del proveedor ─────────────────────────────
export type TipoProveedor = "hotel" | "aerolinea" | "traslado" | "restaurante" | "tour" | "agencia" | "otro";
/** Hoteles y aerolíneas atienden 24 h. Los demás: 09:00–20:00 hora local del proveedor. */
const HORARIO: Record<TipoProveedor, [number, number] | null> = {
  hotel: null, aerolinea: null, traslado: [8, 21], restaurante: [10, 20], tour: [9, 20], agencia: [9, 19], otro: [9, 20],
};

function localParts(tz: string, d: Date): { y: number; m: number; day: number; h: number; min: number } | null {
  try {
    const f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
    return { y: Number(p.year), m: Number(p.month), day: Number(p.day), h: Number(p.hour), min: Number(p.minute) };
  } catch {
    return null;
  }
}

/**
 * Cuándo puede salir un correo al proveedor: ya, si está en su horario (o atiende 24 h); si no, a la hora de apertura
 * siguiente en SU zona horaria. Sin zona conocida se manda ya (no se adivina el horario).
 */
export function ventanaProveedor(tipo: TipoProveedor, tz: string | null | undefined, ahora: Date): { enviarYa: boolean; enviarDesde: Date; horaLocal: string | null } {
  const rango = tipo in HORARIO ? HORARIO[tipo] : HORARIO.otro;
  const lp = tz ? localParts(tz, ahora) : null;
  const horaLocal = lp ? `${String(lp.h).padStart(2, "0")}:${String(lp.min).padStart(2, "0")}` : null;
  if (!rango || !lp) return { enviarYa: true, enviarDesde: ahora, horaLocal };
  const [abre, cierra] = rango;
  if (lp.h >= abre && lp.h < cierra) return { enviarYa: true, enviarDesde: ahora, horaLocal };
  // Minutos hasta la próxima apertura (hoy si aún no abre, mañana si ya cerró).
  const minutosAhora = lp.h * 60 + lp.min;
  const minutosApertura = abre * 60;
  const espera = minutosAhora < minutosApertura ? minutosApertura - minutosAhora : 24 * 60 - minutosAhora + minutosApertura;
  return { enviarYa: false, enviarDesde: new Date(ahora.getTime() + espera * 60_000), horaLocal };
}

// ───────────────────────────── Consentimiento ─────────────────────────────
const NEG = /\b(no|todavia no|aun no|espera|esperate|cancela|mejor no|no quiero|ni se te ocurra|don'?t|do not|not yet|wait|stop)\b/;
const SI = /\b(si|sí|claro|adelante|dale|ok|okay|de acuerdo|autorizo|permiso|te doy permiso|puedes|hazlo|va|yes|sure|go ahead|i agree|i authorize)\b/;

/** ¿El texto del viajero da permiso para revisar sus datos ("ver todo")? Afirmación explícita y sin negación. */
export function autorizaVerTodo(texto: string | null | undefined): boolean {
  const t = normalizeText(String(texto ?? ""));
  if (!t.trim() || NEG.test(t)) return false;
  return SI.test(t) && t.length <= 400;
}

/** ¿Autoriza enviar el reclamo con ese folio? (misma regla que Iato: folio + sí explícito, sin negación). */
export const autorizaReclamo = (texto: string | null | undefined, folio: string) => autorizaEnvio(texto, folio);

// ───────────────────────────── Costo del modelo ─────────────────────────────
/** USD por millón de tokens (precios públicos de Anthropic, 2026-10). Modelo desconocido → el más caro conocido. */
export const PRECIOS: Record<string, { in: number; out: number; cacheRead: number; cacheWrite: number }> = {
  "claude-sonnet-5-5": { in: 2, out: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "claude-sonnet-5": { in: 2, out: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "claude-opus-5-5": { in: 4, out: 20, cacheRead: 0.2, cacheWrite: 5 },
  "claude-opus-5": { in: 5, out: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-haiku-5-5": { in: 0.1, out: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
};
export type Uso = { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };

export function costoUsd(modelo: string | null | undefined, uso: Uso | null | undefined): number {
  const p = PRECIOS[String(modelo ?? "")] ?? PRECIOS["claude-opus-5"];
  const u = uso ?? {};
  const c = ((u.input_tokens ?? 0) * p.in + (u.output_tokens ?? 0) * p.out + (u.cache_read_input_tokens ?? 0) * p.cacheRead
    + (u.cache_creation_input_tokens ?? 0) * p.cacheWrite) / 1_000_000;
  return Math.round(c * 100_000) / 100_000;
}

// ───────────────────────────── Nada prometido de más, nada inventado ─────────────────────────────
/** Frases que prometen algo que solo una persona o el proveedor pueden cumplir (pago, reembolso, cancelación). */
const PROMESA = [
  /\b(ya|te|le|les)\s+(reembols\w+|devolv\w+|pagu\w+|pagamos|pagaremos|cancel\w+|reserv[eé]|reservamos)\b/,
  /\b(te|le)\s+garantiz\w+\b/, /\bgarantizado\b/, /\bte\s+aseguro\s+que\b/,
  /\bwe (will|have) (refund|refunded|paid|cancel|cancelled|canceled)\b/, /\bi (have )?(refunded|cancelled|canceled|booked)\b/, /\bguarantee(d)?\b/,
];
export function promesaIndebida(texto: string): string | null {
  const t = normalizeText(texto);
  const m = PROMESA.map((r) => r.exec(t)).find(Boolean);
  return m ? m[0] : null;
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE_RE = /\+?\d[\d\s().-]{6,}\d/g;
const digits = (s: string) => s.replace(/\D/g, "");

/**
 * Correos y teléfonos de un texto saliente que NO aparecen en lo que el operador sabe (bitácora, resultados de sus
 * herramientas, guía de emergencia). Si hay alguno, el mensaje no sale: sería un dato inventado.
 */
export function datosNoVerificados(texto: string, conocido: string): string[] {
  const k = conocido.toLowerCase();
  const kd = digits(conocido);
  const fuera: string[] = [];
  for (const e of texto.match(EMAIL_RE) ?? []) if (!k.includes(e.toLowerCase())) fuera.push(e);
  for (const p of texto.match(PHONE_RE) ?? []) {
    const d = digits(p);
    // Números cortos de emergencia (911, 112…) y horas/fechas no son teléfonos.
    if (d.length < 7) continue;
    if (!kd.includes(d)) fuera.push(p.trim());
  }
  return fuera;
}

/** Correos que el viajero escribió en el caso (fuente: su propio mensaje, con el id del evento). */
export function correosEnMensajes(eventos: Array<{ id: number; actor: string; direction?: string | null; body?: string | null }>): Array<{ email: string; eventId: number }> {
  const out: Array<{ email: string; eventId: number }> = [];
  for (const e of eventos) {
    if (e.actor !== "usuario" || e.direction !== "entrante") continue;
    for (const m of String(e.body ?? "").match(EMAIL_RE) ?? []) {
      const email = m.toLowerCase();
      if (!out.some((x) => x.email === email)) out.push({ email, eventId: e.id });
    }
  }
  return out;
}

/** Firma honesta (AI Act art. 50; nada se presenta como persona). */
export const FIRMA_VIAJERO = "— Iato, operador de IA de IATOS (si hace falta, una persona del equipo toma tu caso)";
export const firmaProveedor = (viajero: string | null, idioma: string) =>
  idioma === "en" ? `IATOS AI assistant, writing on behalf of ${viajero ?? "our traveler"}. A person from the IATOS team supervises this conversation.`
    : idioma === "fr" ? `Assistant IA d'IATOS, au nom de ${viajero ?? "notre voyageur"}. Une personne de l'équipe IATOS supervise cet échange.`
    : idioma === "pt" ? `Assistente de IA da IATOS, em nome de ${viajero ?? "nosso viajante"}. Uma pessoa da equipe IATOS acompanha esta conversa.`
    : idioma === "it" ? `Assistente IA di IATOS, per conto di ${viajero ?? "il nostro viaggiatore"}. Una persona del team IATOS segue questa conversazione.`
    : `Asistente de IA de IATOS, en nombre de ${viajero ?? "nuestro viajero"}. Una persona del equipo IATOS supervisa esta conversación.`;
