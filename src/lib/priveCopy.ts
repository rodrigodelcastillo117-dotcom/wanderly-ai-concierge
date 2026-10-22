// Textos fijos de IATOS Privé. El diccionario completo (es / en) vive en priveI18n.ts: aquí quedan
// los atajos que ya usaban otras piezas, en español por omisión. Lenguaje permitido y prohibido:
// docs/iatos/IATOS_PRIVE_CURATION_STANDARD.md §4 (nada de "VIP", "exclusivo", "garantizado" ni
// "reservado" sin evidencia). Las líneas ceremoniales siguen el idioma de la persona (dueño, 2026-10-22).
import type { PriveErrorCode } from "@/lib/priveApi";
import { activePriveLang, PRIVE_LOCALE, PRIVE_TEXT, type PriveLang } from "@/lib/priveI18n";

/** Líneas ceremoniales en español (la versión en inglés: PRIVE_TEXT.en.ceremony). */
export const CEREMONY = PRIVE_TEXT.es.ceremony;

/** Versión de la bienvenida: si cambia, se vuelve a mostrar una vez a cada miembro. */
export const WELCOME_VERSION = 1;
/** Versión de la guía de inicio. */
export const ONBOARDING_VERSION = 1;

export type UniverseId =
  | "the_table" | "after_dark" | "casino_grand_nights" | "yacht_sea" | "private_stays" | "iconic_events"
  | "culture_access" | "wellness_escape" | "adventure_elite" | "sport_leisure" | "celebrations" | "signature_mexico";

/** Los 12 universos (IATOS_PRIVE_MODELO_DE_DATOS.md §3.1). Nombre y línea en el idioma pedido. */
const UNIVERSE_IDS: { id: UniverseId; adult?: boolean }[] = [
  { id: "the_table" }, { id: "after_dark", adult: true }, { id: "casino_grand_nights", adult: true }, { id: "yacht_sea" },
  { id: "private_stays" }, { id: "iconic_events" }, { id: "culture_access" }, { id: "wellness_escape" },
  { id: "adventure_elite" }, { id: "sport_leisure" }, { id: "celebrations" }, { id: "signature_mexico" },
];
export const universesFor = (lang: PriveLang): { id: UniverseId; name: string; line: string; adult?: boolean }[] =>
  UNIVERSE_IDS.map((u) => ({ ...u, name: PRIVE_TEXT[lang].universes[u.id].name, line: PRIVE_TEXT[lang].universes[u.id].line }));
export const UNIVERSES = universesFor("es");

/** Qué cuenta para los 90 días (texto llano, sin presión ni cuenta regresiva). */
export const TENURE_EXPLAINER = PRIVE_TEXT.es.tenure.explainer;

export const tenureLine = (n: number, required = 90, lang: PriveLang = "es") => PRIVE_TEXT[lang].tenure.line(n, required);

/** Mensajes para cada código del servidor: calmados, honestos y sin filtrar datos de otras cuentas. */
export const CODE_MESSAGES: Record<PriveErrorCode, string> = PRIVE_TEXT.es.codes;

/** Mensaje del código en el idioma vigente de Privé (o el pedido). */
export const messageFor = (code: PriveErrorCode | null | undefined, lang: PriveLang = activePriveLang()) => {
  const m = PRIVE_TEXT[lang].codes;
  return (code && m[code]) || m.SERVICE_UNAVAILABLE;
};

/** "a las 18:42" (o la fecha si no es hoy), en la zona del usuario. */
export function formatLockedUntil(iso: string | null | undefined, now = new Date()): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime()) || d.getTime() <= now.getTime()) return null;
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
  return sameDay ? `a las ${time}` : `el ${d.toLocaleDateString("es-MX", { day: "numeric", month: "long" })} a las ${time}`;
}

export function formatDate(iso: string | null | undefined, lang: PriveLang = "es"): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(PRIVE_LOCALE[lang], { day: "numeric", month: "long", year: "numeric" });
}
export const formatDateEs = (iso: string | null | undefined) => formatDate(iso, "es");

const ROMAN: [number, string][] = [
  [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"],
  [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
];
export function toRoman(n: number): string {
  let out = "";
  let v = Math.max(1, Math.floor(n));
  for (const [k, s] of ROMAN) while (v >= k) { out += s; v -= k; }
  return out;
}

/**
 * Código ceremonial de la tarjeta: la fecha de activación en números romanos ("XXII · X · MMXXVI").
 * Es PURAMENTE DECORATIVO: se deriva de un dato público, no se guarda, no se envía y no abre nada.
 */
export function ceremonialCode(activatedAt: string | null | undefined): string {
  const d = activatedAt ? new Date(activatedAt) : new Date();
  const ok = !Number.isNaN(d.getTime()) ? d : new Date();
  return `${toRoman(ok.getDate())} · ${toRoman(ok.getMonth() + 1)} · ${toRoman(ok.getFullYear())}`;
}

/** Contacto de soporte que ya usa la app (Legal, correos). */
export const SUPPORT_EMAIL = "hola@traveliatos.life";

/**
 * Seis destinos de la bienvenida (IATOS_PRIVE_GLOBAL_DESTINATIONS.md §3). Fotos ilustrativas de Pexels
 * con varias consultas en orden: si la primera no trae foto, se prueba la siguiente (más amplia).
 * El nombre visible sale del diccionario (welcome.cities) en el mismo orden.
 */
export const WELCOME_DESTINATIONS = [
  { slug: "paris", city: "París", queries: ["Paris Eiffel Tower dusk", "Paris Eiffel Tower", "Paris France"] },
  { slug: "cdmx", city: "Ciudad de México", queries: ["Mexico City Palacio de Bellas Artes", "Mexico City skyline", "Mexico City"] },
  { slug: "tokio", city: "Tokio", queries: ["Tokyo skyline night", "Tokyo skyline", "Tokyo"] },
  { slug: "nueva-york", city: "Nueva York", queries: ["New York skyline evening", "New York City skyline", "New York City"] },
  { slug: "dubai", city: "Dubái", queries: ["Dubai skyline night", "Dubai skyline", "Dubai"] },
  { slug: "roma", city: "Roma", queries: ["Rome Colosseum golden hour", "Rome Colosseum", "Rome Italy"] },
] as const;

/** "r•••••@dominio.com": basta para reconocer el correo sin mostrarlo completo en pantalla. */
export function maskEmail(email: string | null | undefined): string | null {
  if (!email || !email.includes("@")) return null;
  const [u, d] = email.split("@");
  return `${u.slice(0, 1)}${"•".repeat(Math.max(3, Math.min(6, u.length - 1)))}@${d}`;
}
