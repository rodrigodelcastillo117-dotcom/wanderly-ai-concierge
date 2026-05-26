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
  if (STOPWORDS.test(t)) return false;
  // Una "ciudad" suele empezar con mayúscula o ser una palabra de >=3 letras sin ser stopword
  return /^[A-ZÁÉÍÓÚÑ]/.test(t) || t.split(/\s+/).every((w) => w.length >= 3);
};

export type RouteIntent =
  | { mode: "single"; destinations: [string] }
  | { mode: "multi"; destinations: string[] };

export const detectRouteIntent = (input: string): RouteIntent => {
  const text = input.trim();
  if (!text) return { mode: "single", destinations: [""] as [string] };

  // 1) Intentar separar por conectores explícitos
  for (const re of SEPARATORS) {
    if (re.test(text)) {
      const parts = text.split(re).map(cleanCity).filter(Boolean);
      const cities = parts.filter(looksLikeCity);
      if (cities.length >= 2) {
        return { mode: "multi", destinations: dedupe(cities) };
      }
    }
  }

  // 2) Patrón "de X a Y" / "X a Y a Z" sin conectores fuertes
  const fromTo = text.match(
    /(?:de|desde)?\s*([A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñ\s]+?)\s+a\s+([A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñ\s]+?)(?:\s+a\s+([A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñ\s]+?))?(?:[\s,.!?]|$)/,
  );
  if (fromTo) {
    const cities = [fromTo[1], fromTo[2], fromTo[3]].filter(Boolean).map(cleanCity).filter(looksLikeCity);
    if (cities.length >= 2) {
      return { mode: "multi", destinations: dedupe(cities) };
    }
  }

  // 3) Lista por comas con varios tokens capitalizados (>=2 ciudades)
  if (text.includes(",")) {
    const parts = text.split(/\s*,\s*/).map(cleanCity).filter(looksLikeCity);
    if (parts.length >= 2) {
      return { mode: "multi", destinations: dedupe(parts) };
    }
  }

  // Default: single destino. Limpiamos prefijos comunes.
  const single = cleanCity(text.replace(/^.*?(?:ir|viajar|visitar|conocer)\s+(?:a|al|en)\s+/i, ""));
  return { mode: "single", destinations: [single || text] as [string] };
};

const dedupe = (arr: string[]) => Array.from(new Set(arr.map((s) => s.trim()))).filter(Boolean);
