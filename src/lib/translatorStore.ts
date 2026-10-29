// Frases del Traductor guardadas en el dispositivo (auditoría 10/10, P1-7).
// El aviso decía "Traductor offline" pero cada frase se pedía a la IA y vivía solo en memoria: al recargar
// o sin internet no quedaba nada. Ahora lo ya traducido se guarda en este dispositivo (localStorage, por
// viaje) y se puede ver sin conexión; traducir frases nuevas sí necesita internet. Si el navegador no deja
// guardar (modo privado, almacenamiento lleno), la pantalla funciona igual y no promete nada.

export type SavedPhrase = { es: string; destino: string; idioma: string; bcp47?: string; local: string; phon: string };

const KEY = (tripId: string) => `iatos.traductor.v1.${tripId}`;
export const MAX_SAVED_PHRASES = 200;

const clean = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : "");

export function normalizePhrases(raw: unknown): SavedPhrase[] {
  if (!Array.isArray(raw)) return [];
  const out: SavedPhrase[] = [];
  const seen = new Set<string>();
  for (const p of raw) {
    if (!p || typeof p !== "object") continue;
    const o = p as Record<string, unknown>;
    const item: SavedPhrase = {
      es: clean(o.es, 300), destino: clean(o.destino, 80), idioma: clean(o.idioma, 40),
      bcp47: /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(String(o.bcp47 ?? "")) ? String(o.bcp47) : undefined,
      local: clean(o.local, 400), phon: clean(o.phon, 400),
    };
    if (!item.es || !item.local) continue;
    const k = `${item.es}|${item.destino}|${item.local}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
    if (out.length >= MAX_SAVED_PHRASES) break;
  }
  return out;
}

export function loadPhrases(tripId: string | undefined, storage: Pick<Storage, "getItem"> | null = safeStorage()): SavedPhrase[] {
  if (!tripId || !storage) return [];
  try {
    return normalizePhrases(JSON.parse(storage.getItem(KEY(tripId)) ?? "[]"));
  } catch {
    return [];
  }
}

/** Guarda y devuelve true si quedó guardado (para no decir "sin conexión" si no se pudo). */
export function savePhrases(tripId: string | undefined, phrases: SavedPhrase[], storage: Pick<Storage, "setItem"> | null = safeStorage()): boolean {
  if (!tripId || !storage) return false;
  try {
    storage.setItem(KEY(tripId), JSON.stringify(normalizePhrases(phrases)));
    return true;
  } catch {
    return false;
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof window !== "undefined" && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}
