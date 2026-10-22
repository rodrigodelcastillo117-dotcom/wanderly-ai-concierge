// Origen permitido para las URLs de regreso de Stripe (checkout y portal). Sin dependencias de Deno.

// Dominios a los que Stripe puede regresar al usuario. Cualquier otro origin cae al dominio oficial
// (antes se usaba tal cual el origin del cuerpo de la petición).
// Solo los dominios de ESTE proyecto en Lovable (publicado y vistas previas), no cualquier *.lovable.app.
const LOVABLE_PROJECT = "7c80960a-e5cd-46b2-b94a-34145bb7f1f4";
const ORIGIN_RULES = [
  /^https:\/\/(www\.)?traveliatos\.life$/,
  /^https:\/\/iatos-ai\.lovable\.app$/,
  new RegExp(`^https://([a-z0-9-]+--)?${LOVABLE_PROJECT}\\.lovable\\.app$`),
  new RegExp(`^https://([a-z0-9-]+--)?${LOVABLE_PROJECT}\\.lovableproject\\.com$`),
  /^http:\/\/localhost(:\d+)?$/,
];
export const DEFAULT_ORIGIN = "https://traveliatos.life";

export function safeOrigin(candidate: unknown): string {
  if (typeof candidate !== "string") return DEFAULT_ORIGIN;
  const c = candidate.trim().replace(/\/+$/, "");
  return ORIGIN_RULES.some((r) => r.test(c)) ? c : DEFAULT_ORIGIN;
}
