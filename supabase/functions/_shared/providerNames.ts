// Nombres técnicos de proveedores → lo que ve la persona (pedido del dueño, 28-oct-2026: el análisis y
// Iato decían "vía SerpApi" y "Perplexity"). Puro, sin Deno: lo usan analizar-viaje (narrative.ts),
// concierge-chat (texto final de Iato y contexto del viaje que lee el modelo) y las pruebas.
/**
 * Nombres técnicos de proveedores → lo que ve la persona (pedido del dueño, 28-oct-2026: el análisis decía
 * "vía SerpApi" y "Perplexity"). Solo cambia el nombre de la fuente, nunca un dato.
 */
export const PROVIDER_WORDS = /serp ?api|perplexity|travelpayouts|b[oó]veda/i;

export function scrubProviders(text: string): string {
  // Sin nombres técnicos el texto se queda idéntico (ni espacios ni saltos de línea se tocan).
  if (!PROVIDER_WORDS.test(text)) return text;
  return text
    .replace(/\bSerpApi\s*\/\s*/gi, "")
    .replace(/\s*\/\s*SerpApi\b/gi, "")
    .replace(/\s*\((?:v[ií]a\s+)?SerpApi\)/gi, "")
    .replace(/\s+(?:v[ií]a|de|desde|en)\s+SerpApi\b/gi, "")
    .replace(/\bSerpApi\b/gi, "datos en vivo")
    .replace(/\bTravelpayouts\s*\/\s*Aviasales\b/gi, "Aviasales")
    .replace(/\bTravelpayouts\b/gi, "Aviasales")
    .replace(/\b(?:seg[uú]n|de|en|v[ií]a)\s+Perplexity\b/gi, "según búsquedas web")
    .replace(/\bPerplexity\b/gi, "búsqueda web")
    .replace(/\btu B[oó]veda (est[aá]|esta) vac[ií]a\b/g, "no tienes tarjetas ni programas guardados")
    .replace(/\btu B[oó]veda\b/g, "tus documentos y tarjetas")
    .replace(/\bla B[oó]veda\b/g, "Documentos y tarjetas")
    .replace(/\bB[oó]veda\b/g, "Documentos y tarjetas")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+([,.;:)])/g, "$1");
}

/** Igual, en cada texto de un objeto (contexto del viaje para el modelo). Llaves y no-textos intactos. */
export function scrubProvidersDeep<T>(value: T): T {
  if (typeof value === "string") return scrubProviders(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => scrubProvidersDeep(v)) as unknown as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, scrubProvidersDeep(v)])) as T;
  }
  return value;
}
