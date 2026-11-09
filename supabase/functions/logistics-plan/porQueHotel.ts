// «Por qué este hotel» cuando el hotel sale en vivo de Google Hotels. La IA escribió su texto para el hotel que ELLA
// propuso en ese nivel; si Google Hotels da otro hotel, ese texto describe un lugar distinto (recorrido Japón
// 9-nov-2026: «MIMARU TOKYO IKEBUKURO… ubicación céntrica impecable en Nihonbashi»). Solo se reutiliza si es el
// mismo hotel; si no, se dicen los datos reales (estrellas, calificación, tarifa consultada). Puro.

const norm = (s: unknown) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/[^a-z0-9]+/g, " ").replace(/\b(hotel|the|tokyo|tokio|kyoto|kioto|osaka|by|and|y|de|del|la|el)\b/g, " ").replace(/\s+/g, " ").trim();

/** ¿Es el mismo hotel? Todas las palabras del nombre más corto aparecen en el otro. */
export function mismoHotel(a: unknown, b: unknown): boolean {
  const x = norm(a), y = norm(b);
  if (!x || !y) return false;
  const [corto, largo] = x.length <= y.length ? [x, y] : [y, x];
  const palabras = corto.split(" ").filter((p) => p.length >= 3);
  if (!palabras.length) return corto === largo;
  const set = new Set(largo.split(" "));
  return palabras.every((p) => set.has(p));
}

export function porQueHotelVivo(
  vivo: { name?: unknown; hotel_class?: unknown; rating?: unknown },
  propuestoIA: { nombre?: unknown; por_que?: unknown } | null | undefined,
): string {
  const texto = typeof propuestoIA?.por_que === "string" ? propuestoIA.por_que.trim() : "";
  if (texto && mismoHotel(vivo?.name, propuestoIA?.nombre)) return texto;
  const estrellas = Number(vivo?.hotel_class) > 0 ? `${Math.round(Number(vivo.hotel_class))} estrellas` : null;
  const cal = Number(vivo?.rating) > 0 ? `${Number(vivo.rating).toFixed(1)} en Google` : null;
  return [estrellas, cal, "tarifa real consultada hoy en Google Hotels"].filter(Boolean).join(" · ").replace(/^./, (c) => c.toUpperCase()) + ".";
}
