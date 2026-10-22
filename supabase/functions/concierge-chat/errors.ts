// Respuestas de error de concierge-chat con códigos ESTABLES (contrato de src/lib/functionErrors.ts).
// Antes salían al cliente textos internos: {error:"AI gateway 500", detail:<cuerpo crudo del
// proveedor>} o e.message (errores de base, de red, stack). Ahora el detalle solo va al log
// (redactado) y el cliente recibe un código y un mensaje fijo en español.

export type ChatErrorCode =
  | "UNAUTHENTICATED"
  | "INVALID_REQUEST"
  | "RATE_LIMITED"
  | "SERVICE_UNAVAILABLE"
  | "AI_UNAVAILABLE"
  | "INTERNAL_ERROR";

const TABLE: Record<ChatErrorCode, { status: number; error: string; message: string }> = {
  UNAUTHENTICATED: { status: 401, error: "unauthorized", message: "Tu sesión expiró. Vuelve a iniciar sesión." },
  INVALID_REQUEST: { status: 400, error: "invalid_request", message: "Escribe un mensaje para Iato." },
  RATE_LIMITED: { status: 429, error: "rate_limited", message: "Demasiadas solicitudes, intenta en un momento." },
  SERVICE_UNAVAILABLE: {
    status: 503, error: "service_unavailable",
    message: "Nuestro asistente no está disponible en este momento. Intenta de nuevo en unos minutos.",
  },
  AI_UNAVAILABLE: { status: 502, error: "ai_unavailable", message: "Iato no pudo responder. Intenta de nuevo en un momento." },
  INTERNAL_ERROR: { status: 500, error: "internal_error", message: "Disculpa, hubo un tropiezo. Inténtalo de nuevo en un momento." },
};

export function chatError(code: ChatErrorCode): { status: number; body: { code: ChatErrorCode; error: string; message: string } } {
  const t = TABLE[code];
  return { status: t.status, body: { code, error: t.error, message: t.message } };
}

/** Código para un error HTTP del gateway de IA (429 ritmo, 402 sin saldo, resto no disponible). */
export function modelHttpErrorCode(status: number): ChatErrorCode {
  if (status === 429) return "RATE_LIMITED";
  if (status === 402) return "SERVICE_UNAVAILABLE";
  return "AI_UNAVAILABLE";
}

/** Error de una tool para el modelo: nunca el mensaje crudo (puede traer URLs con llaves). */
export function toolErrorCode(e: unknown): string {
  return (e as { name?: string } | null)?.name === "TimeoutError" ? "timeout" : "tool_fetch_error";
}
