// Textos fijos de IATOS Privé (es-MX). Las líneas ceremoniales en inglés son del dueño y van tal
// cual (contrato Privé §6). Lenguaje permitido y prohibido: docs/iatos/IATOS_PRIVE_CALIDAD_FUENTES.md §4
// (nada de "VIP", "exclusivo", "garantizado" ni "reservado" sin evidencia).
import type { PriveErrorCode } from "@/lib/priveApi";

export const CEREMONY = {
  brand: "IATOS PRIVÉ",
  tagline: "The World, Beyond Ordinary.",
  openInvitation: "OPEN INVITATION",
  welcomeName: (firstName: string) => `WELCOME, ${firstName.toLocaleUpperCase("es-MX")}.`,
  unlocked: "YOUR PRIVÉ MEMBERSHIP HAS BEEN UNLOCKED.",
  enter: "ENTER IATOS PRIVÉ",
  grandWelcome: "WELCOME TO PRIVÉ",
  worldBigger: "YOUR WORLD JUST GOT BIGGER.",
  onboardingEnd: "WELCOME TO YOUR WORLD.",
  explore: "EXPLORE PRIVÉ",
  invitationReady: "Your invitation is ready.",
} as const;

/** Versión de la bienvenida: si cambia, se vuelve a mostrar una vez a cada miembro. */
export const WELCOME_VERSION = 1;
/** Versión de la guía de inicio. */
export const ONBOARDING_VERSION = 1;

export type UniverseId =
  | "the_table" | "after_dark" | "casino_grand_nights" | "yacht_sea" | "private_stays" | "iconic_events"
  | "culture_access" | "wellness_escape" | "adventure_elite" | "sport_leisure" | "celebrations" | "signature_mexico";

/** Los 12 universos (IATOS_PRIVE_MODELO_DE_DATOS.md §3.1). El nombre es de marca; la línea, en español. */
export const UNIVERSES: { id: UniverseId; name: string; line: string; adult?: boolean }[] = [
  { id: "the_table", name: "The Table", line: "Alta cocina y mesas de autor" },
  { id: "after_dark", name: "After Dark", line: "Coctelería, jazz y noches con carácter", adult: true },
  { id: "casino_grand_nights", name: "Casino Grand Nights", line: "Casinos históricos con permiso vigente · solo información", adult: true },
  { id: "yacht_sea", name: "Yacht & Sea", line: "Navegación y días en el mar" },
  { id: "private_stays", name: "Private Stays", line: "Estancias con carácter propio" },
  { id: "iconic_events", name: "Iconic Events", line: "Eventos con fecha y fuente" },
  { id: "culture_access", name: "Culture Access", line: "Arte, museos y cultura" },
  { id: "wellness_escape", name: "Wellness Escape", line: "Bienestar y descanso" },
  { id: "adventure_elite", name: "Adventure Elite", line: "Aventura con requisitos de seguridad claros" },
  { id: "sport_leisure", name: "Sport & Leisure", line: "Golf, tenis y deporte" },
  { id: "celebrations", name: "Celebrations", line: "Para fechas que importan" },
  { id: "signature_mexico", name: "Signature México", line: "Mercados, mezcal, arte y oficio mexicano" },
];

/** Qué cuenta para los 90 días (texto llano, sin presión ni cuenta regresiva). */
export const TENURE_EXPLAINER = [
  "Cuentan los días de IATOS PRO pagado, sumados aunque haya pausas entre un periodo y otro.",
  "No cuentan los días de prueba gratuita, el PRO de cortesía ni los periodos reembolsados.",
  "Cuando llegues a 90, te enviaremos tu invitación personal por correo y aquí mismo.",
] as const;

export const tenureLine = (n: number, required = 90) =>
  `Llevas ${Math.min(n, required)} de ${required} días de PRO pagado`;

/** Mensajes para cada código del servidor: calmados, honestos y sin filtrar datos de otras cuentas. */
export const CODE_MESSAGES: Record<PriveErrorCode, string> = {
  NOT_PRO: "IATOS Privé es parte de IATOS PRO. Tu plan PRO no está activo en este momento.",
  NOT_ELIGIBLE: "Tu acceso a IATOS Privé aún no está disponible. Se abre al sumar 90 días de PRO pagado.",
  NO_INVITATION: "No encontramos una invitación vigente para tu cuenta. Si crees que es un error, escríbenos.",
  INVITATION_OTHER_ACCOUNT:
    "Esta invitación no corresponde a la cuenta con la que iniciaste sesión. Cierra sesión y entra con la cuenta que recibió el correo.",
  INVITATION_EXPIRED: "Esta invitación ya venció. Podemos enviarte una nueva a tu correo.",
  PASSWORD_WEAK: "Esa contraseña es fácil de adivinar. Usa al menos 12 caracteres, mejor una frase de varias palabras.",
  PASSWORD_BREACHED:
    "Esa contraseña aparece en filtraciones públicas conocidas. Por tu seguridad, elige otra que no uses en ningún otro sitio.",
  PASSWORD_ALREADY_SET: "Tu contraseña Privé ya estaba creada. Puedes entrar con ella o restablecerla.",
  WRONG_PASSWORD: "Contraseña Privé incorrecta. Revisa mayúsculas y espacios.",
  LOCKED: "Por seguridad pausamos los intentos un momento.",
  HARD_LOCKED: "Por seguridad bloqueamos el acceso con contraseña. Restablécela desde el enlace que te enviaremos por correo.",
  MUST_RESET: "Por seguridad necesitas crear una contraseña Privé nueva.",
  RESET_INVALID: "El enlace para restablecer ya venció o ya se usó. Pide uno nuevo.",
  PRIVE_NO_SESSION: "Ingresa tu contraseña Privé para continuar.",
  PRIVE_NOT_PRO: "Tu acceso a Privé está en pausa porque tu plan PRO no está activo.",
  PRIVE_NOT_ELIGIBLE: "Tu acceso a Privé está en pausa por ahora.",
  PRIVE_NOT_ACTIVATED: "Tu membresía Privé aún no está activada.",
  PRIVE_REVOKED: "Tu membresía Privé no está activa.",
  PRIVE_SESSION_INVALID: "Tu sesión Privé ya no es válida. Vuelve a ingresar tu contraseña.",
  PRIVE_SESSION_EXPIRED: "Tu sesión Privé venció. Vuelve a ingresar tu contraseña.",
  UNAUTHENTICATED: "Tu sesión de IATOS expiró. Vuelve a iniciar sesión.",
  RATE_LIMITED: "Demasiados intentos en poco tiempo. Espera un momento e inténtalo de nuevo.",
  INVALID_REQUEST: "No pudimos procesar la solicitud. Revisa los datos e inténtalo de nuevo.",
  NETWORK: "No pudimos conectar con el servidor. Revisa tu internet e inténtalo de nuevo.",
  SERVICE_UNAVAILABLE: "IATOS Privé no está disponible en este momento. Inténtalo de nuevo en unos minutos.",
  NOT_AVAILABLE: "Esta sección aún no está disponible.",
};

export const messageFor = (code: PriveErrorCode | null | undefined) =>
  (code && CODE_MESSAGES[code]) || CODE_MESSAGES.SERVICE_UNAVAILABLE;

/** "a las 18:42" (o la fecha si no es hoy), en la zona del usuario. */
export function formatLockedUntil(iso: string | null | undefined, now = new Date()): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime()) || d.getTime() <= now.getTime()) return null;
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
  return sameDay ? `a las ${time}` : `el ${d.toLocaleDateString("es-MX", { day: "numeric", month: "long" })} a las ${time}`;
}

export function formatDateEs(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" });
}

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

/** Seis destinos del piloto de curaduría (IATOS_PRIVE_COBERTURA_GLOBAL.md §3). Fotos ilustrativas. */
export const WELCOME_DESTINATIONS = [
  { city: "París", query: "Paris Eiffel Tower dusk" },
  { city: "Ciudad de México", query: "Mexico City Palacio de Bellas Artes" },
  { city: "Tokio", query: "Tokyo skyline night" },
  { city: "Nueva York", query: "New York skyline evening" },
  { city: "Dubái", query: "Dubai skyline night" },
  { city: "Roma", query: "Rome Colosseum golden hour" },
] as const;

/** "r•••••@dominio.com": basta para reconocer el correo sin mostrarlo completo en pantalla. */
export function maskEmail(email: string | null | undefined): string | null {
  if (!email || !email.includes("@")) return null;
  const [u, d] = email.split("@");
  return `${u.slice(0, 1)}${"•".repeat(Math.max(3, Math.min(6, u.length - 1)))}@${d}`;
}
