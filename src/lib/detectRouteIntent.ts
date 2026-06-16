// Detecta si una frase de viaje es a un único destino o multi-destino.
// Heurística pura (sin red): rápida y suficiente para casos comunes en español.

const SEPARATORS = [
  /\s*(?:->|→|=>)\s*/i,
  /\s*,\s*(?:y\s+)?(?:luego|despu[ée]s|seguido)\s+(?:a|por|en)?\s*/i,
  /\s+y\s+luego\s+(?:a|en|por)?\s*/i,
  /\s+luego\s+(?:a|en|por)?\s+/i,
  /\s+despu[ée]s\s+(?:a|en|por)?\s+/i,
  /\s+y\s+(?:m[áa]s\s+tarde|seguido)\s+(?:a|en|por)?\s+/i,
  /\s*,\s*despu[ée]s\s+(?:a|en|por)?\s*/i,
];

const STOPWORDS = /^(quiero|me|gustar[íi]a|ir|viajar|visitar|conocer|pasar(?:e|é)?|por|de|a|al|en|hacia|desde|el|la|los|las|un|una|y|o)$/i;

// Palabras que indican que un token es una FRASE conversacional, no una ciudad.
const PHRASE_WORDS = /\b(viaje|crea(?:me)?|cr[ée]a(?:me)?|haz(?:me)?|planea(?:me)?|arma(?:me)?|necesito|quiero|busco|d[íi]as?|noches?|semanas?|meses?|roadtrip|road\s*trip|completo|todo|junto|familia|pareja|novi[oa]|amigos?|solo|sola|hijos?|presupuesto|barato|caro|lujoso|premium|aventura|relax|playa|monta[ñn]a|norte|sur|este|oeste|centro|regi[óo]n|zona|por\s+el|por\s+la)\b/i;

const cleanCity = (raw: string): string => {
  return raw
    .replace(/[.;:!?¡¿"]/g, "")
    .replace(/^(a|al|en|hacia|hasta|para|por|de|desde)\s+/i, "")
    .replace(/\s+(unos?|unas?)\s+\d+\s+d[íi]as?.*$/i, "")
    .trim();
};

const looksLikeCity = (token: string): boolean => {
  const t = cleanCity(token);
  if (!t || t.length < 2) return false;
  if (t.length > 28) return false; // ciudades reales rara vez >28 chars
  if (STOPWORDS.test(t)) return false;
  if (PHRASE_WORDS.test(t)) return false;
  const words = t.split(/\s+/);
  if (words.length > 3) return false; // ciudad/región máx 3 palabras
  // Una "ciudad" suele empezar con mayúscula o ser una palabra de >=3 letras sin ser stopword
  return /^[A-ZÁÉÍÓÚÑ]/.test(t) || words.every((w) => w.length >= 3);
};

export type RouteIntent =
  | { mode: "single"; destinations: [string] }
  | { mode: "multi"; destinations: string[] };

const titleCase = (s: string) =>
  s.split(/\s+/).map((w) => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w)).join(" ");

const dedupe = (arr: string[]) =>
  Array.from(new Set(arr.map((s) => s.trim().toLowerCase()))).map(titleCase).filter(Boolean);

export const detectRouteIntent = (input: string): RouteIntent => {
  const text = input.trim();
  if (!text) return { mode: "single", destinations: [""] as [string] };

  // Si la entrada es claramente conversacional (frase larga con verbos/sentimientos)
  // NO intentamos detectar multi heurísticamente; dejamos que el AI parsee.
  if (text.split(/\s+/).length > 8 || PHRASE_WORDS.test(text)) {
    return { mode: "single", destinations: [text] as [string] };
  }

  // 1) Conectores explícitos (→, "luego", "después")
  for (const re of SEPARATORS) {
    if (re.test(text)) {
      const parts = text.split(re).map(cleanCity).filter(looksLikeCity);
      if (parts.length >= 2) return { mode: "multi", destinations: dedupe(parts) };
    }
  }

  // 2) "de X a Y a Z"
  const fromTo = text.match(
    /(?:de|desde)?\s*([A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñ\s]+?)\s+a\s+([A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñ\s]+?)(?:\s+a\s+([A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñ\s]+?))?(?:[\s,.!?]|$)/,
  );
  if (fromTo) {
    const cities = [fromTo[1], fromTo[2], fromTo[3]].filter(Boolean).map(cleanCity).filter(looksLikeCity);
    if (cities.length >= 2) return { mode: "multi", destinations: dedupe(cities) };
  }

  // 3) Lista por comas / "y" / "+" / "/" — case-insensitive
  const cleaned = text.replace(/^.*?(?:ir|viajar|visitar|conocer|pasar(?:e|é)?)\s+(?:a|al|en|por)\s+/i, "");
  const flexible = cleaned
    .split(/\s*,\s*|\s+y\s+|\s*\+\s*|\s*\/\s*/i)
    .map(cleanCity)
    .filter(looksLikeCity);
  if (flexible.length >= 2) return { mode: "multi", destinations: dedupe(flexible) };

  // 4) (Eliminado) Antes splitteábamos por espacios sin conector, pero rompía
  //    nombres compuestos como "Buenos Aires", "Rio de Janeiro", "New York",
  //    "Los Ángeles", "San Francisco", etc. Si no hay separador explícito
  //    (coma, "y", "→", "luego", "después", "/", "+") lo tratamos como UN
  //    solo destino.

  // Default: single
  const single = cleanCity(cleaned);
  return { mode: "single", destinations: [single || text] as [string] };
};
