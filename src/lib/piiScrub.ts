// Datos personales fuera de la telemetría (F-18 / IATOS-108). PostHog y Sentry solo reciben el id
// interno del usuario: ni correo, ni nombre, ni teléfono, ni tokens. Se aplica en identify/capture
// de PostHog y en beforeSend/beforeBreadcrumb de Sentry, para que un `track(..., { email })`
// futuro o un mensaje de error con un correo tampoco se filtren.

const PII_KEYS = /^(e-?mail|correo|name|nombre|full_?name|first_?name|last_?name|phone|telefono|tel|password|contrasena|token|access_?token|refresh_?token|authorization|apikey|api_?key|ip|ip_?address|address|direccion|fecha_?nacimiento|birth_?date)$/i;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const JWT = /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{6,}\b/g;
const BEARER = /\b(Bearer)\s+[A-Za-z0-9._~+/=-]{8,}/gi;
// Supabase devuelve los tokens de sesión en el hash (#access_token=…) de la URL de regreso.
const QUERY_SECRET = /([?&#](?:access_token|refresh_token|provider_token|token|code|apikey|api_key|key)=)[^&#\s]+/gi;

/** Tapa correos y tokens dentro de un texto. */
export function scrubText(s: string): string {
  return s.replace(EMAIL, "[correo]").replace(JWT, "[token]").replace(BEARER, "$1 [token]").replace(QUERY_SECRET, "$1[oculto]");
}

/** Copia sin llaves personales y con textos limpios (recursivo, con tope de profundidad). */
export function stripPii<T>(value: T, depth = 0): T {
  if (depth > 6 || value == null) return value;
  if (typeof value === "string") return scrubText(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => stripPii(v, depth + 1)) as unknown as T;
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (PII_KEYS.test(k)) continue;
      out[k] = stripPii(v, depth + 1);
    }
    return out as T;
  }
  return value;
}

type SentryLikeEvent = {
  user?: Record<string, unknown> | null;
  request?: { headers?: Record<string, unknown>; cookies?: unknown; data?: unknown; url?: string; query_string?: unknown } | null;
  message?: string;
  exception?: { values?: Array<{ value?: string }> };
  breadcrumbs?: Array<{ message?: string; data?: unknown }>;
  extra?: unknown;
  contexts?: unknown;
  tags?: unknown;
};

/** beforeSend de Sentry: solo el id del usuario, sin cookies/headers/cuerpos y textos limpios. */
export function scrubSentryEvent<E extends SentryLikeEvent>(event: E): E {
  const e: SentryLikeEvent = { ...event };
  if (e.user) e.user = typeof e.user.id === "string" ? { id: e.user.id } : null;
  if (e.request) {
    e.request = { url: e.request.url ? scrubText(e.request.url) : undefined };
  }
  if (e.message) e.message = scrubText(e.message);
  if (e.exception?.values) {
    e.exception = { ...e.exception, values: e.exception.values.map((v) => ({ ...v, value: v.value ? scrubText(v.value) : v.value })) };
  }
  if (e.breadcrumbs) e.breadcrumbs = e.breadcrumbs.map((b) => scrubBreadcrumb(b));
  if (e.extra) e.extra = stripPii(e.extra);
  if (e.contexts) e.contexts = stripPii(e.contexts);
  if (e.tags) e.tags = stripPii(e.tags);
  return e as E;
}

export function scrubBreadcrumb<B extends { message?: string; data?: unknown }>(b: B): B {
  return { ...b, message: b.message ? scrubText(b.message) : b.message, data: b.data ? stripPii(b.data) : b.data };
}

/** before_send de PostHog: limpia propiedades del evento y de la persona ($set / $set_once). */
export function scrubCapture<C extends { properties?: Record<string, unknown>; $set?: Record<string, unknown>; $set_once?: Record<string, unknown> }>(c: C): C {
  return {
    ...c,
    ...(c.properties ? { properties: stripPii(c.properties) } : {}),
    ...(c.$set ? { $set: stripPii(c.$set) } : {}),
    ...(c.$set_once ? { $set_once: stripPii(c.$set_once) } : {}),
  };
}
