// Traduce los errores de supabase.functions.invoke a algo claro para el usuario.
// supabase-js solo dice "Edge Function returned a non-2xx status code"; el cuerpo real viene en
// error.context (el Response de fetch). Aquí lo leemos y decidimos por `code` (contrato estable de
// supabase/functions/_shared/quota.ts), nunca por el texto técnico: los mensajes internos
// (errores de base, de proveedores, stack traces) jamás llegan al usuario.
//   FREE_LIMIT_REACHED   → diálogo de límite (FreeLimitDialog), con o sin oferta de PRO
//   SERVICE_UNAVAILABLE  → "intenta de nuevo", sin venta de PRO
//   UNAUTHENTICATED      → sesión expirada
//   ANALYSIS_IN_PROGRESS → "ya está en proceso"
import { toast } from "sonner";
import { openFreeLimitDialog } from "@/lib/freeLimitStore";
import { PRICE_LINE } from "@/lib/planCopy";

export const PRO_PATH = "/dashboard/pro";

export type QuotaName =
  | "concierge_monthly" | "trip_analysis_once" | "trip_analysis_monthly"
  | "concierge_trial" | "trip_analysis_trial" | "concierge_daily" | "trip_analysis_daily"
  // Alertas y vuelos activos a la vez, y bolsa de búsquedas en vivo (supabase/functions/_shared/quota.ts).
  | "price_watches_active" | "tracked_flights_active"
  | "live_searches_daily" | "live_searches_monthly" | "live_searches_trial";

export type FreeLimitInfo = {
  quota: QuotaName;
  limit: number | null;
  used: number | null;
  renewsAt: string | null;
  upgradeAvailable: boolean;
};

export type FunctionErrorInfo = {
  status: number | null;
  code: string | null;
  message: string;
  /** Ruta interna para activar PRO (solo si el límite es del plan gratuito). */
  upgradeUrl: string | null;
  needsUpgrade: boolean;
  /** Presente solo con FREE_LIMIT_REACHED. */
  freeLimit: FreeLimitInfo | null;
};

const GENERIC_SUPABASE = /edge function returned a non-2xx status code|failed to send a request to the edge function|relay error/i;
// Mensajes del navegador o de JavaScript que no le dicen nada al usuario ("Failed to fetch",
// "TypeError: x is undefined", "Unexpected token < in JSON"): se reemplazan por el texto de la pantalla.
const TECHNICAL = /failed to fetch|networkerror|load failed|network request failed|typeerror|referenceerror|syntaxerror|unexpected token|is not a function|is undefined|is null|cannot read|json|abort|timeout|\bat\s+\S+\s*\(|https?:\/\//i;

const QUOTAS: QuotaName[] = [
  "concierge_monthly", "trip_analysis_once", "trip_analysis_monthly",
  "concierge_trial", "trip_analysis_trial", "concierge_daily", "trip_analysis_daily",
  "price_watches_active", "tracked_flights_active",
  "live_searches_daily", "live_searches_monthly", "live_searches_trial",
];
/** Solo los límites mensuales y diarios se renuevan; los de una vez y los de la prueba, no. */
const renews = (q: QuotaName) => q.endsWith("_monthly") || q.endsWith("_daily");

type ResponseLike = { status?: number; clone?: () => ResponseLike; json?: () => Promise<unknown>; text?: () => Promise<string> };

async function readBody(ctx: ResponseLike): Promise<Record<string, unknown> | null> {
  // clone() para no consumir el cuerpo si alguien más quiere leerlo.
  const res = typeof ctx.clone === "function" ? ctx.clone() : ctx;
  try {
    if (typeof res.text === "function") {
      const raw = await res.text();
      const parsed = raw ? JSON.parse(raw) : null;
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
    }
    if (typeof res.json === "function") {
      const parsed = await res.json();
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
    }
  } catch {
    /* cuerpo vacío o no JSON */
  }
  return null;
}

export function formatRenewal(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  // En UTC: la cuota se renueva a las 00:00 UTC del día 1.
  return d.toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Texto del aviso de límite. Mismo texto que el servidor (supabase/functions/_shared/quota.ts). */
export function freeLimitCopy(info: FreeLimitInfo): string {
  const q = info.quota;
  const fecha = formatRenewal(info.renewsAt) ?? (q.endsWith("_daily") ? "mañana" : "próximo mes");
  // Precio desde la fuente única de textos comerciales (planCopy).
  const pro = `Puedes seguir usando las funciones gratuitas o activar IATOS PRO por ${PRICE_LINE}, sujeto a las condiciones vigentes.`;
  const n = typeof info.limit === "number" && info.limit >= 0 ? info.limit : null;
  if (q === "price_watches_active") {
    if (info.upgradeAvailable && !n) return `Las alertas de precio están incluidas en IATOS PRO. ${pro}`;
    const tope = n ? `Ya tienes ${plural(n, "alerta de precio activa", "alertas de precio activas")}, el máximo de tu plan.` : "Llegaste al máximo de alertas de precio de tu plan.";
    return `${tope} Desactiva una para activar otra.${info.upgradeAvailable ? ` ${pro}` : ""}`;
  }
  if (q === "tracked_flights_active") {
    const tope = n ? `Ya sigues ${plural(n, "vuelo", "vuelos")} a la vez, el máximo de tu plan.` : "Llegaste al máximo de vuelos seguidos de tu plan.";
    return `${tope} Deja de seguir uno para agregar otro.${info.upgradeAvailable ? ` ${pro}` : ""}`;
  }
  if (q.startsWith("live_searches_") && info.upgradeAvailable) {
    const cuantas = n ? `tus ${plural(n, "búsqueda", "búsquedas")} en vivo` : "tus búsquedas en vivo";
    if (q === "live_searches_trial") return `Usaste ${cuantas} de tu prueba gratuita de IATOS PRO. ${pro}`;
    return q === "live_searches_daily"
      ? `Usaste ${cuantas} de hoy (vuelos y hoteles); se renuevan el ${fecha}. ${pro}`
      : `Usaste ${cuantas} de este mes (vuelos y hoteles); se renuevan el ${fecha}. ${pro}`;
  }
  // Un plan de pago que llega a su límite no recibe oferta de "mejorar".
  if (!info.upgradeAvailable) {
    return q.endsWith("_daily")
      ? `Llegaste al límite diario de tu plan; se renueva el ${fecha}.`
      : `Llegaste al límite mensual de tu plan; se renueva el ${fecha}.`;
  }
  if (q.endsWith("_trial")) return `Llegaste al límite de tu prueba gratuita de IATOS PRO. ${pro}`;
  if (q === "concierge_monthly") {
    return `Has utilizado tus mensajes gratuitos de Iato de este mes. Se renuevan el ${fecha}. ${pro}`;
  }
  // El análisis gratuito es de una sola vez: nunca se promete renovación.
  return `Ya usaste tu análisis gratuito de viaje (es de una sola vez). ${pro}`;
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

function parseFreeLimit(body: Record<string, unknown> | null, status: number | null): FreeLimitInfo | null {
  if (body?.code === "FREE_LIMIT_REACHED") {
    const quota = QUOTAS.includes(body.quota as QuotaName) ? (body.quota as QuotaName) : "trip_analysis_once";
    return {
      quota,
      limit: num(body.limit),
      used: num(body.used),
      renewsAt: !renews(quota) ? null : typeof body.renews_at === "string" ? body.renews_at : null,
      upgradeAvailable: body.upgrade_available !== false,
    };
  }
  // 402 de una versión anterior del servidor (upgrade_required): mismo diálogo.
  if (status === 402 || body?.error === "upgrade_required") {
    const quota: QuotaName = body?.kind === "concierge" ? "concierge_monthly" : "trip_analysis_once";
    return { quota, limit: null, used: null, renewsAt: null, upgradeAvailable: true };
  }
  return null;
}

// Mensajes del servidor que sí se muestran: los de códigos del contrato (texto curado en
// _shared/quota.ts) y el `message` de respuestas de negocio (409 de checkout, 429 de ritmo).
// Nunca `error` ni `detail`, que pueden traer texto técnico.
const SAFE_CODES = new Set(["SERVICE_UNAVAILABLE", "ANALYSIS_IN_PROGRESS", "INVALID_REQUEST", "TRIP_NOT_FOUND"]);
const isText = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

export async function readFunctionError(error: unknown, fallback: string): Promise<FunctionErrorInfo> {
  const err = (error ?? {}) as { message?: unknown; name?: unknown; context?: unknown };
  const ctx = err.context as ResponseLike | undefined;
  const status = ctx && typeof ctx.status === "number" ? ctx.status : null;
  const body = status !== null && ctx ? await readBody(ctx) : null;
  const code = typeof body?.code === "string" ? body.code : null;

  const freeLimit = parseFreeLimit(body, status);
  if (freeLimit) {
    return {
      status,
      code: "FREE_LIMIT_REACHED",
      message: freeLimitCopy(freeLimit),
      upgradeUrl: freeLimit.upgradeAvailable ? PRO_PATH : null,
      needsUpgrade: freeLimit.upgradeAvailable,
      freeLimit,
    };
  }

  let message: string;
  if (status === 401 || code === "UNAUTHENTICATED") message = "Tu sesión expiró. Vuelve a iniciar sesión.";
  else if (code && SAFE_CODES.has(code) && isText(body?.message)) message = body!.message as string;
  else if (status === 503 || code === "SERVICE_UNAVAILABLE") message = "El servicio no está disponible en este momento. Intenta de nuevo en unos minutos.";
  else if (status === 429) message = isText(body?.message) ? (body!.message as string) : "Demasiadas solicitudes en poco tiempo. Espera un momento e inténtalo de nuevo.";
  else if (status === 409 && isText(body?.message)) message = body!.message as string;
  else if (err.name === "FunctionsFetchError") message = "No pudimos conectar con el servidor. Revisa tu internet e intenta de nuevo.";
  // Errores lanzados por la propia pantalla (sin respuesta HTTP), p. ej. "Sin resultado".
  else if (status === null && isText(err.message) && !GENERIC_SUPABASE.test(err.message) && !TECHNICAL.test(err.message)) message = err.message;
  else message = fallback;

  return { status, code, message, upgradeUrl: null, needsUpgrade: false, freeLimit: null };
}

/**
 * Muestra el error de una edge function. FREE_LIMIT_REACHED abre el diálogo de límite ("Conocer
 * IATOS PRO" solo en el plan gratuito); lo demás, un toast simple sin venta de PRO. Devuelve la info
 * por si la pantalla quiere reaccionar (p. ej. no agregar "hubo un tropiezo" al chat).
 */
export async function toastFunctionError(error: unknown, fallback: string): Promise<FunctionErrorInfo> {
  const info = await readFunctionError(error, fallback);
  if (info.freeLimit) openFreeLimitDialog(info.freeLimit);
  else toast.error(info.message);
  return info;
}
