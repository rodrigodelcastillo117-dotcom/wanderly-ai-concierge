// Traduce los errores de supabase.functions.invoke a un mensaje claro para el usuario.
// supabase-js solo dice "Edge Function returned a non-2xx status code"; el cuerpo real (por ejemplo
// el 402 de "agotaste tu análisis gratis" con su upgrade_url) viene en error.context, que es el
// Response de fetch. Aquí lo leemos para mostrar el mensaje del servidor y, si toca, el botón a PRO.
import { toast } from "sonner";

export const PRO_PATH = "/dashboard/pro";

export type FunctionErrorInfo = {
  status: number | null;
  code: string | null;
  message: string;
  /** Ruta interna a la que mandar al usuario para activar PRO (solo en 402). */
  upgradeUrl: string | null;
  needsUpgrade: boolean;
};

const GENERIC_SUPABASE = /edge function returned a non-2xx status code|failed to send a request to the edge function|relay error/i;

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

// Un código tipo "checkout_failed" no se le muestra al usuario; una frase ("Faltan datos requeridos") sí.
const isHumanText = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0 && /\s/.test(v.trim());

// Solo rutas internas: el cuerpo viene del servidor, pero no queremos abrir redirecciones externas.
const internalPath = (v: unknown): string | null =>
  typeof v === "string" && v.startsWith("/") && !v.startsWith("//") ? v : null;

export async function readFunctionError(error: unknown, fallback: string): Promise<FunctionErrorInfo> {
  const err = (error ?? {}) as { message?: unknown; name?: unknown; context?: unknown };
  const ctx = err.context as ResponseLike | undefined;
  const status = ctx && typeof ctx.status === "number" ? ctx.status : null;
  const body = status !== null && ctx ? await readBody(ctx) : null;
  const code = typeof body?.error === "string" ? body.error : null;

  if (status === 402 || code === "upgrade_required") {
    return {
      status,
      code,
      message: isHumanText(body?.message)
        ? body!.message as string
        : "Llegaste al límite del plan gratuito. Activa IATOS PRO para seguir sin límites.",
      upgradeUrl: internalPath(body?.upgrade_url) ?? PRO_PATH,
      needsUpgrade: true,
    };
  }

  let message: string;
  if (isHumanText(body?.message)) message = body!.message as string;
  else if (isHumanText(body?.error)) message = body!.error as string;
  else if (status === 429) message = "Demasiadas solicitudes en poco tiempo. Espera un momento e inténtalo de nuevo.";
  else if (status === 401) message = "Tu sesión expiró. Vuelve a iniciar sesión.";
  else if (err.name === "FunctionsFetchError") message = "No pudimos conectar con el servidor. Revisa tu internet e intenta de nuevo.";
  else if (typeof err.message === "string" && err.message && !GENERIC_SUPABASE.test(err.message)) message = err.message;
  else message = fallback;

  return { status, code, message, upgradeUrl: null, needsUpgrade: false };
}

/**
 * Muestra el error de una edge function como toast. Si es un 402 (cuota o PRO), agrega el botón
 * "Ver IATOS PRO". Devuelve la info por si la pantalla quiere reaccionar (p. ej. no reintentar).
 */
export async function toastFunctionError(
  error: unknown,
  fallback: string,
  navigate?: (path: string) => void,
): Promise<FunctionErrorInfo> {
  const info = await readFunctionError(error, fallback);
  if (info.needsUpgrade) {
    const url = info.upgradeUrl ?? PRO_PATH;
    toast.error(info.message, {
      duration: 12000,
      action: {
        label: "Ver IATOS PRO",
        onClick: () => (navigate ? navigate(url) : window.location.assign(url)),
      },
    });
  } else {
    toast.error(info.message);
  }
  return info;
}
