// Limpia mensajes de error antes de guardarlos o mandarlos por correo. Los errores de red de
// Deno incluyen la URL de la petición ("error sending request for url (https://…?api_key=…)"),
// y SerpApi y Travelpayouts reciben la llave en la URL, así que nunca se guarda el texto crudo.
// Sin dependencias de Deno para poder probarlo con Vitest.

const SECRET_PARAM = /([?&;\s(]|^)(api_key|apikey|api-key|access_token|token|key|secret|password|signature|sig)=([^&\s)"'<>]+)/gi;
const BEARER = /\b(Bearer)\s+[A-Za-z0-9._~+/=-]{8,}/gi;
// Llaves con prefijos conocidos aunque aparezcan sueltas en el texto.
const KNOWN_KEYS = /\b(sk_(?:live|test)_[A-Za-z0-9]{6,}|rk_(?:live|test)_[A-Za-z0-9]{6,}|sb_secret_[A-Za-z0-9_-]{6,}|sk-ant-[A-Za-z0-9_-]{6,}|AIza[0-9A-Za-z_-]{20,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{6,})/g;

/** Quita valores secretos de un texto y lo recorta. Devuelve undefined si no hay texto. */
export function redactSecrets(input: unknown, max = 200): string | undefined {
  if (input == null) return undefined;
  const text = String(input)
    .replace(SECRET_PARAM, (_m, pre: string, name: string) => `${pre}${name}=***`)
    .replace(BEARER, "$1 ***")
    .replace(KNOWN_KEYS, "***")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return undefined;
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Mensaje de un error desconocido, ya limpio. */
export const safeErrorMessage = (e: unknown, max = 200) =>
  redactSecrets(e instanceof Error ? e.message : e, max) ?? "error desconocido";
